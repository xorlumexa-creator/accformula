import { supabase } from '@/integrations/supabase/client';
import type { AssemblyResult, BalanceAnalysis } from '@/lib/assemblyApi';
import { fetchBalanceBrief } from '@/lib/lumexaTools';

export type Vehicle = 'multirotor' | 'vtol' | 'generic';

/** Guess the vehicle type from the project's name / category / purpose (same words as the backend's vehicle_kind). */
export function guessVehicle(text: string): Vehicle {
  const t = (text || '').toLowerCase();
  if (t.includes('vtol')) return 'vtol';
  if (/drone|quad|multirotor|multi-rotor|copter|hexa|octo/.test(t)) return 'multirotor';
  return 'generic';
}

// Parts whose geometry decides where mass and thrust end up: the AI that designs them has to know the balance numbers.
const BALANCE_RELEVANT = /arm|boom|motor|mount|frame|fuselage|body|wing|battery|cradle|chassis|pod|nacelle/i;

/** The balance paragraph for a part-generation prompt, from the saved assembly of the part's macro part ('' when there is none or
 *  the part does not affect balance, or the backend is not reachable: generation must never wait on this). */
export async function balanceBriefText(macroPartId: string | null | undefined, partName: string, purpose = ''): Promise<string> {
  if (!macroPartId || !BALANCE_RELEVANT.test(`${partName} ${purpose}`)) return '';
  try {
    const { data } = await supabase.from('project_assemblies').select('result').eq('macro_part_id', macroPartId).maybeSingle();
    const balance = (data?.result as unknown as AssemblyResult | undefined)?.balance as BalanceAnalysis | undefined;
    if (!balance?.cog_mm) return '';
    const { text } = await fetchBalanceBrief(balance);
    return text ? `\n\n${text}\nThis part must respect these numbers (symmetry about the centre of gravity, motor circle position).` : '';
  } catch {
    return '';
  }
}

/** Everything the saved assembly measured that concerns one part, as text for its next generation prompt: components that did not fit
 *  (with the room they need and the room measured), overlaps with other parts, problems the vision check saw, and the balance numbers.
 *  The next time the part is generated it starts from what the assembly found wrong with the last version. */
export async function assemblyFeedbackText(macroPartId: string | null | undefined, partId: string, partName: string, purpose = ''): Promise<string> {
  if (!macroPartId) return '';
  try {
    const { data } = await supabase.from('project_assemblies').select('result,vision').eq('macro_part_id', macroPartId).maybeSingle();
    const r = data?.result as unknown as AssemblyResult | undefined;
    if (!r) return '';
    const lines: string[] = [];
    const nameOf = (id: string) => r.parts.find((p) => p.id === id)?.name ?? id;
    const pk = r.packing?.[partId];
    if (pk && !pk.fits) {
      const need = pk.required_inner_size_mm ? ` They need about ${pk.required_inner_size_mm.map((v) => v.toFixed(0)).join(' x ')} mm inside` : '';
      const have = pk.largest_measured_box_mm ? `; the largest box measured in the last version is ${pk.largest_measured_box_mm.map((v) => v.toFixed(0)).join(' x ')} mm` : '';
      lines.push(`The components for this part did not fit in the last version.${need}${have}. Enlarge the cavity accordingly.`);
    }
    (r.interference ?? []).filter((x) => x.a === partId || x.b === partId).forEach((x) =>
      lines.push(`In the assembly it overlapped ${nameOf(x.a === partId ? x.b : x.a)} by ${x.volume_mm3} mm3: change the shape or position so they no longer collide.`));
    const v = data?.vision as unknown as { verdict?: string; issues?: { severity: string; part: string; what: string; fix: string }[] } | null;
    (v?.issues ?? []).filter((i) => partName && i.part && (i.part.toLowerCase().includes(partName.toLowerCase()) || partName.toLowerCase().includes(i.part.toLowerCase())))
      .slice(0, 3).forEach((i) => lines.push(`The vision check of the assembly saw (${i.severity}): ${i.what}${i.fix ? ` Suggested fix: ${i.fix}` : ''}`));
    const balance = await balanceBriefText(macroPartId, partName, purpose);
    const body = lines.length ? `\n\nFEEDBACK FROM THE LAST ASSEMBLY OF THIS PART (measured, not guessed):\n- ${lines.join('\n- ')}` : '';
    return body + balance;
  } catch {
    return '';
  }
}
