import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Cog, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CrankDesign, CrankParams, NewPart, fetchCrankshaft } from '@/lib/lumexaTools';

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAddParts: (rows: NewPart[]) => Promise<void>;
}

const DEFAULTS: CrankParams = {
  n_throws: 4, stroke_mm: 40, main_d: 20, pin_d: 18, main_len: 14, pin_len: 16, web_t: 8,
  counterweights: true, balance_pct: 100, material: 'Steel 4340', with_blocks: true,
  piston_mass_g: 0, rod_mass_g: 0, rod_length_mm: 0, rod_cg_frac: 0.3, balance_factor: 0.5, rpm_reference: 6000,
};
const FIELDS: [keyof CrankParams, string][] = [
  ['stroke_mm', 'Stroke mm'], ['main_d', 'Main journal Ø'], ['pin_d', 'Crank pin Ø'], ['main_len', 'Main length'], ['pin_len', 'Pin length'],
  ['web_t', 'Web thickness'], ['balance_pct', 'Balance %'],
  ['piston_mass_g', 'Piston g (0 = none)'], ['rod_mass_g', 'Con-rod g'], ['rod_length_mm', 'Rod length mm'], ['balance_factor', 'Recip. balance 0-1'],
];

export default function CrankshaftDialog({ open, onOpenChange, onAddParts }: Props) {
  const [p, setP] = useState<CrankParams>(DEFAULTS);
  const [d, setD] = useState<CrankDesign | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const preview = async (): Promise<CrankDesign | null> => {
    setBusy(true); setError('');
    try { const r = await fetchCrankshaft(p); setD(r); return r; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
    finally { setBusy(false); }
  };
  const add = async () => {
    const r = await preview();
    if (!r) return;
    setBusy(true);
    try {
      const rows: NewPart[] = [{
        name: 'Crankshaft', script: r.script, material: p.material,
        purpose: `${r.data.n_throws}-throw crankshaft, stroke ${p.stroke_mm} mm, counterweights balance ${p.balance_pct}% of the rotating mass${p.piston_mass_g || p.rod_mass_g ? ` and ${Math.round(p.balance_factor * 100)}% of the reciprocating mass` : ''}`,
        dimensions: `${r.data.length_mm} mm long, main journal Ø${p.main_d}, crank pin Ø${p.pin_d}`,
        mounting: { method: 'bearing', connects_to: p.with_blocks ? ['Crank bearing block A', 'Crank bearing block B'] : [] },
      }];
      if (p.with_blocks && r.block_script) {
        (['A', 'B'] as const).forEach((l) => rows.push({
          name: `Crank bearing block ${l}`, script: r.block_script as string, material: 'Aluminium 6061',
          purpose: `Plain bearing for the crankshaft main journal Ø${p.main_d} mm`, dimensions: `bore Ø${p.main_d + 0.2} mm`,
          mounting: { method: 'bolted', fastener: 'M4', connects_to: ['Crankshaft'] },
        }));
      }
      await onAddParts(rows);
      onOpenChange(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Cog className="w-4 h-4" /> Add a crankshaft</DialogTitle>
          <DialogDescription>
            Parametric crankshaft (build123d, axis along X) with counterweights sized so the rotating mass is balanced about the main axis.
            Optional bearing blocks mate to the main journals.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2 text-xs">
          <label className="flex flex-col gap-0.5">Throws
            <select className="h-8 rounded border border-border bg-background px-1" value={p.n_throws} onChange={(e) => setP({ ...p, n_throws: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          {FIELDS.map(([k, label]) => (
            <label key={k} className="flex flex-col gap-0.5">{label}
              <Input className="h-8 text-xs" inputMode="decimal" value={String(p[k])}
                onChange={(e) => { const v = parseFloat(e.target.value); setP({ ...p, [k]: Number.isFinite(v) ? v : 0 }); }} />
            </label>
          ))}
          <label className="flex flex-col gap-0.5">Material
            <select className="h-8 rounded border border-border bg-background px-1" value={p.material} onChange={(e) => setP({ ...p, material: e.target.value })}>
              <option>Steel 4340</option><option>Aluminium 7075</option><option>Titanium Ti-6Al-4V</option>
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between text-xs"><span>Counterweights</span><Switch checked={p.counterweights} onCheckedChange={(v) => setP({ ...p, counterweights: v })} /></div>
        <div className="flex items-center justify-between text-xs"><span>Add two bearing blocks</span><Switch checked={p.with_blocks} onCheckedChange={(v) => setP({ ...p, with_blocks: v })} /></div>
        {error && <div className="text-red-400 text-xs flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}</div>}
        {d && (
          <div className="rounded border border-border/30 p-2 text-xs space-y-0.5">
            <div>Length {d.data.length_mm} mm · about {d.data.mass_g_estimate} g · phases {d.data.phases_deg.join('°, ')}°</div>
            <div>Counterweight radius {d.data.counterweight_radius_mm ?? 'none'} mm · static unbalance per throw {d.data.static_unbalance_per_throw_pct}%</div>
            <div className={d.data.net_force_unbalance_g_mm < 1 && d.data.net_couple_unbalance_g_mm2 < 1 ? 'text-green-400' : 'text-yellow-400'}>
              {d.data.net_force_unbalance_g_mm < 1 && d.data.net_couple_unbalance_g_mm2 < 1
                ? <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Forces and couples between throws cancel.</span>
                : <>Net force unbalance {d.data.net_force_unbalance_g_mm} g·mm, couple {d.data.net_couple_unbalance_g_mm2} g·mm² (multiply by ω² for a force).</>}
            </div>
            {d.data.web_t_needed_mm ? <div className="text-yellow-400">Webs about {d.data.web_t_needed_mm} mm thick would balance this throw at the largest allowed counterweight.</div> : null}
            {d.data.engine && (
              <div className="pt-1 border-t border-border/20 space-y-0.5">
                <div>Reciprocating mass {d.data.engine.reciprocating_mass_g} g, balanced {Math.round(d.data.engine.balance_factor * 100)}%.</div>
                <div>Primary force {d.data.engine.primary_force_n} N, couple {d.data.engine.primary_couple_nm} N·m at {d.data.engine.rpm_reference} rpm.</div>
                <div className={d.data.engine.secondary_force_n > 1 ? 'text-yellow-400' : ''}>Secondary force {d.data.engine.secondary_force_n} N, couple {d.data.engine.secondary_couple_nm} N·m (counterweights cannot remove these).</div>
                {d.data.engine.notes.map((n, i) => <div key={i} className="text-muted-foreground">{n}</div>)}
              </div>
            )}
            {d.data.notes.map((n, i) => <div key={i} className="text-muted-foreground">{n}</div>)}
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <Button variant="outline" size="sm" onClick={preview} disabled={busy}>Preview numbers</Button>
          <Button size="sm" onClick={add} disabled={busy} className="gap-1">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Add to assembly</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
