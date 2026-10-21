// Client for the backend's assembly endpoints. The backend does all the geometry (placing parts, measuring the internal space
// of each part, choosing bolts, checking fit); this file only sends scripts and hints and reads the result back.

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;

export interface Cavity {
  id: string;
  kind: 'enclosed' | 'pocket' | 'channel' | 'trough';
  volume_mm3: number;
  openings: string[];
  bbox_min: number[];
  bbox_max: number[];
  inscribed: { min: number[]; max: number[]; size: number[] };
}
export interface InternalSpace {
  pitch_mm: number;
  solid_volume_mm3: number;
  cavities: Cavity[];
  warnings: string[];
  accuracy_note: string;
}
export interface AssemblyPart {
  id: string;
  name: string;
  /** 4x4 row-major: part-local mm -> assembly mm */
  matrix: number[];
  bbox_world: { min: number[]; max: number[] };
  stl_base64?: string | null;
  internal_space?: InternalSpace | null;
  explode_dir: number[];
  is_ground: boolean;
}
export interface Hardware {
  id: string;
  joint: string;
  type: 'bolt';
  size: string;
  length_mm: number;
  head_d: number;
  head_h: number;
  shank_d: number;
  origin: number[];
  axis: number[];
  nut?: { h: number; af: number; origin: number[] } | null;
  washers?: { od: number; id: number; h: number; origins: number[][] } | null;
}
export interface MateReport {
  id: string;
  type: string;
  parent: string;
  child: string;
  status: 'ok' | 'warning';
  a_feature?: string;
  b_feature?: string;
  registration_residual_mm?: number;
  pairs?: { a: string; b: string }[];
  fit?: { hole_mm: number; pin_mm: number; clearance_mm: number; kind: string };
}
export interface Placement {
  name: string;
  index: number;
  layer: number;
  min: number[];
  size: number[];
}
export interface PackingResult {
  fits: boolean;
  cavity?: string;
  packing?: { placements: Placement[]; stack_axis: string; used_height_mm: number };
  message?: string;
  required_inner_size_mm?: number[];
  largest_measured_box_mm?: number[];
}
export interface AssemblyResult {
  ok: boolean;
  ground: string;
  parts: AssemblyPart[];
  mates: MateReport[];
  hardware: Hardware[];
  bom: { kind: 'part' | 'hardware'; name: string; qty: number }[];
  interference: { a: string; b: string; volume_mm3: number; near: number[] }[];
  clearances: { a: string; b: string; min_gap_mm: number }[];
  packing: Record<string, PackingResult>;
  warnings: string[];
  assembly_bbox: { min: number[]; max: number[] };
  step_base64?: string;
  step_error?: string;
  plan?: { mates: unknown[]; ground: string; attempts: { round: number; ok?: boolean; error?: string }[] };
}

export interface AssemblyRequest {
  parts: { id: string; name: string; script: string }[];
  /** what the designer said about each part (purpose, how it mounts); a guide for the mate proposal, geometry is the truth */
  hints?: Record<string, string>;
  /** components that must fit inside a part: dims_text is the datasheet text, e.g. "Arduino Nano 45x18x7 mm" */
  components?: Record<string, { name: string; dims_text?: string; qty?: number }[]>;
  options?: { clearance_mm?: number; margin_mm?: number; step?: boolean };
}

async function errorText(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    const m = j.detail ?? j.error ?? j.message ?? text;
    return typeof m === 'string' ? m : JSON.stringify(m);
  } catch {
    return text || `HTTP ${res.status}`;
  }
}

/** Submits the assembly as a background job and polls it, so one long request never has to stay open. */
export async function buildAssembly(
  req: AssemblyRequest,
  onTick?: (info: { seconds: number; stage?: string; memoryMb?: number }) => void,
  timeoutMs = 10 * 60 * 1000,
): Promise<AssemblyResult> {
  if (!BACKEND_URL) throw new Error('VITE_BACKEND_URL is not configured.');
  const sub = await fetch(`${BACKEND_URL}/assembly-plan-async`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!sub.ok) throw new Error(await errorText(sub));
  const { job_id } = await sub.json();
  const t0 = Date.now();
  let misses = 0;
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    let res: Response;
    try {
      res = await fetch(`${BACKEND_URL}/job/${job_id}`);
    } catch {
      continue; // network blip: keep polling
    }
    if (res.status === 404) {
      if (++misses > 2) throw new Error('The server restarted while building (it probably ran out of memory). Try fewer or smaller parts.');
      continue;
    }
    if (res.status >= 500 && res.status !== 500) continue; // 502/503/504 while the server is busy
    if (!res.ok) throw new Error(await errorText(res));
    const data = await res.json();
    if (data.status === 'running') {
      onTick?.({ seconds: Math.round((Date.now() - t0) / 1000), stage: data.stage, memoryMb: data.rss_mb });
      continue;
    }
    return data as AssemblyResult;
  }
  throw new Error('Timed out waiting for the assembly. The job may still finish on the server.');
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
