import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { getPartStlSignedUrl } from '@/lib/partStlStorage';
import type { AssemblyResult } from '@/lib/assemblyApi';

// The last assembly of every macro part is saved in project_assemblies, so the page opens on it instead of rebuilding.
// `fingerprint` records which CAD script each part had when it was assembled: when a part is rebuilt or edited its script
// changes, the fingerprint no longer matches, and the page rebuilds the assembly on its own. The result row has no meshes;
// those live in the part-stl-files bucket as "{user_id}/asm-{macro_part_id}-{part_id}.stl" (the STEP file as ".step").

const BUCKET = 'part-stl-files';

export interface VisionIssue { severity: 'high' | 'medium' | 'low'; part: string; what: string; fix: string }
export interface VisionVerdict {
  verdict: 'ok' | 'issues' | 'unclear' | 'error';
  summary: string;
  issues: VisionIssue[];
  model?: string;
  checked_at: string;
}

export interface SavedAssembly {
  result: AssemblyResult;           // meshes filled in again
  fingerprint: Record<string, string>;
  housingKey: string | null;
  vision: VisionVerdict | null;
  stepPath: string | null;
  savedAt: string;
}

/** FNV-1a, 32 bit, plus the length: only used to notice that a script changed. */
export function hashText(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return `${(h >>> 0).toString(16)}-${s.length}`;
}

export function fingerprintOf(parts: { id: string; cad_script?: string | null }[]): Record<string, string> {
  const fp: Record<string, string> = {};
  parts.forEach((p) => { if (p.cad_script) fp[p.id] = hashText(p.cad_script); });
  return fp;
}

export function sameFingerprint(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => a[k] === b[k]);
}

/** Which parts differ between a saved assembly and the parts as they are now (new, changed or removed). */
export function changedParts(saved: Record<string, string>, now: Record<string, string>): string[] {
  const ids = new Set([...Object.keys(saved), ...Object.keys(now)]);
  return [...ids].filter((id) => saved[id] !== now[id]);
}

export function housingKeyOf(housing: Record<string, { name: string; qty: number }[]>): string {
  const norm = Object.keys(housing).sort().map((id) => [id, housing[id].map((h) => `${h.name}x${h.qty}`).sort()]);
  return hashText(JSON.stringify(norm));
}

function bytesToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function upload(path: string, b64: string, contentType: string) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, base64ToBytes(b64), { contentType, upsert: true });
  if (error) throw error;
}

export async function saveAssembly(args: {
  userId: string; projectId: string; macroId: string;
  fingerprint: Record<string, string>; housingKey: string; result: AssemblyResult;
}): Promise<void> {
  const { userId, projectId, macroId, fingerprint, housingKey, result } = args;
  const meshPaths: Record<string, string> = {};
  await Promise.all(result.parts.map(async (p) => {
    if (!p.stl_base64) return;
    const path = `${userId}/asm-${macroId}-${p.id}.stl`;
    await upload(path, p.stl_base64, 'application/octet-stream');
    meshPaths[p.id] = path;
  }));
  if (result.step_base64) {
    const path = `${userId}/asm-${macroId}.step`;
    try { await upload(path, result.step_base64, 'application/octet-stream'); meshPaths.__step = path; } catch { /* the STEP is a convenience */ }
  }
  const light = JSON.parse(JSON.stringify({
    ...result, step_base64: undefined, parts: result.parts.map((p) => ({ ...p, stl_base64: undefined })),
  })) as Json;
  const { error } = await supabase.from('project_assemblies').upsert({
    user_id: userId, project_id: projectId, macro_part_id: macroId, fingerprint, housing_key: housingKey,
    result: light, mesh_paths: meshPaths, vision: null,        // a new build has not been looked at yet
  }, { onConflict: 'macro_part_id' });
  if (error) throw error;
}

export async function loadAssembly(macroId: string): Promise<SavedAssembly | null> {
  const { data, error } = await supabase.from('project_assemblies').select('*').eq('macro_part_id', macroId).maybeSingle();
  if (error || !data) return null;
  const result = data.result as unknown as AssemblyResult;
  const paths = (data.mesh_paths ?? {}) as Record<string, string>;
  try {
    await Promise.all(result.parts.map(async (p) => {
      const path = paths[p.id];
      if (!path) throw new Error(`no saved mesh for ${p.name}`);
      const res = await fetch(await getPartStlSignedUrl(path));
      if (!res.ok) throw new Error(`mesh download failed (${res.status})`);
      p.stl_base64 = bytesToBase64(await res.arrayBuffer());
    }));
  } catch {
    return null;                                    // meshes missing: treat as not saved, the page rebuilds
  }
  return {
    result, fingerprint: (data.fingerprint ?? {}) as Record<string, string>, housingKey: data.housing_key,
    vision: (data.vision as unknown as VisionVerdict | null) ?? null, stepPath: paths.__step ?? null, savedAt: data.updated_at,
  };
}

export async function saveVision(macroId: string, vision: VisionVerdict): Promise<void> {
  await supabase.from('project_assemblies').update({ vision: vision as unknown as Json }).eq('macro_part_id', macroId);
}

export async function downloadSavedStep(path: string): Promise<Blob> {
  const res = await fetch(await getPartStlSignedUrl(path, { downloadFilename: 'assembly.step' }));
  if (!res.ok) throw new Error(`STEP download failed (${res.status})`);
  return res.blob();
}
