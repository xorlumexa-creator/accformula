// Turns "this part houses these components" into a hard requirement for the CAD generator: the internal space the finished part
// must provide, computed by the backend from the components' datasheet sizes. A language model is never asked to measure or
// guess the cavity; the assembly page measures the real cavity afterwards and checks it against the same numbers.
import { supabase } from '@/integrations/supabase/client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;

export interface HousedComponent { component: string; quantity?: number }

interface ElectronicRow { component_name: string; dimensions?: string | null; quantity?: number | null }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** Matches the model's component names to the verified electronics list (exact first, then by containment). */
export function matchElectronics(housed: HousedComponent[], electronics: ElectronicRow[]) {
  return housed.map((h) => {
    const n = norm(h.component);
    const hit = electronics.find((e) => norm(e.component_name) === n)
      ?? electronics.find((e) => norm(e.component_name).includes(n) || n.includes(norm(e.component_name)));
    return { name: hit?.component_name ?? h.component, dims_text: hit?.dimensions ?? '', qty: h.quantity ?? hit?.quantity ?? 1, matched: !!hit };
  });
}

/** Extra prompt text for a part that houses components, or '' when there is nothing to add (or the backend is unreachable). */
export async function requiredCavityText(projectId: string, housed?: HousedComponent[] | null): Promise<string> {
  if (!housed?.length || !BACKEND_URL) return '';
  try {
    const { data } = await supabase.from('project_electronics').select('component_name,dimensions,quantity').eq('project_id', projectId);
    const items = matchElectronics(housed, (data ?? []) as ElectronicRow[]);
    const res = await fetch(`${BACKEND_URL}/required-cavity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ components: items, clearance_mm: 1.5, margin_mm: 1.5, wire_allowance_mm: 6 }),
    });
    if (!res.ok) return '';
    const out = await res.json();
    const req = out.required?.min_inner_size_mm as number[] | undefined;
    const names = items.map((i) => `${i.qty > 1 ? `${i.qty} x ` : ''}${i.name}`).join(', ');
    let text = '';
    if (req) {
      text += `\n\nINTERNAL SPACE REQUIRED (computed from the components' datasheet sizes; not negotiable): the finished part must contain ` +
        `an open rectangular internal cavity of at least ${req[0].toFixed(1)} x ${req[1].toFixed(1)} x ${req[2].toFixed(1)} mm ` +
        `(clear space inside the walls, after fillets) to hold: ${names}. The outside dimensions must be large enough for that cavity ` +
        `plus the wall thickness, and the cavity must not be filled by ribs or bosses. After generation the system measures the real ` +
        `cavity and rejects the part if it is smaller.`;
    }
    if (out.unknown_dimensions?.length) {
      text += `\nNo datasheet size is known for: ${out.unknown_dimensions.join(', ')}; leave generous extra room for them.`;
    }
    return text;
  } catch {
    return '';
  }
}
