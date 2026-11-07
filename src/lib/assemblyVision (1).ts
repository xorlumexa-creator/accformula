import { supabase } from '@/integrations/supabase/client';
import type { AssemblyResult } from '@/lib/assemblyApi';
import type { VisionVerdict } from '@/lib/assemblyStore';

/** What the model gets besides the pictures: only things the solver measured, so it compares what it sees with real data. */
export function visionFacts(result: AssemblyResult, viewNames: string[]) {
  const name = (id: string) => result.parts.find((p) => p.id === id)?.name ?? id;
  return {
    view_names: viewNames,
    parts: result.parts.map((p) => ({ name: p.name, is_ground: p.is_ground })),
    joints: result.mates.map((m) => ({
      between: [name(m.parent), name(m.child)], status: m.status, kind: m.type === 'coaxial' ? 'pin/bore' : 'face to face',
      holes_lined_up: m.pairs?.length ?? 0,
    })),
    hardware: result.bom.filter((b) => b.kind === 'hardware').map((b) => `${b.qty} x ${b.name}`),
    overlaps: result.interference.map((x) => `${name(x.a)} overlaps ${name(x.b)} by ${x.volume_mm3} mm3`),
    overlap_check_ran: result.interference_checked !== false,
    gaps_mm: result.clearances.map((c) => `${name(c.a)} to ${name(c.b)}: ${c.min_gap_mm}`),
    fit: Object.fromEntries(Object.entries(result.packing ?? {}).map(([id, pk]) => [name(id), pk.fits ? 'components fit' : (pk.message ?? 'do not fit')])),
    warnings: result.warnings.slice(0, 8),
  };
}

export async function runVisionCheck(images: string[], result: AssemblyResult, viewNames: string[]): Promise<VisionVerdict> {
  const { data, error } = await supabase.functions.invoke('assembly-vision-check', {
    body: { images, facts: visionFacts(result, viewNames) },
  });
  const checked_at = new Date().toISOString();
  if (error || !data || data.error) {
    return { verdict: 'error', summary: String(data?.error ?? error?.message ?? 'The vision check failed.'), issues: [], checked_at };
  }
  return { verdict: data.verdict, summary: data.summary ?? '', issues: data.issues ?? [], model: data.model, checked_at };
}
