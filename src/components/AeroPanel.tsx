import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { AlertTriangle, Loader2, Wind } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AeroResult, NewPart, fetchAeroEstimate, fetchFuselageScript, fetchWingScript } from '@/lib/lumexaTools';

interface Props {
  /** total mass from the balance tab, g */
  massG: number | null;
  /** assembly length and width, mm, as starting values for the fuselage */
  lengthMm: number;
  widthMm: number;
  onAddParts: (rows: NewPart[]) => Promise<void>;
  /** the latest estimate, for the engineering report */
  onResult?: (r: AeroResult | null) => void;
}

const num = (s: string, d: number) => (Number.isFinite(parseFloat(s)) ? parseFloat(s) : d);

export default function AeroPanel({ massG, lengthMm, widthMm, onAddParts, onResult }: Props) {
  const [f, setF] = useState({
    mass: massG ? String(Math.round(massG)) : '2000', speed: '18', span: '1500', root: '220', tip: '150', tc: '12', naca: '2412',
    sweep: '0', dihedral: '2', fl: String(Math.round(lengthMm) || 900), fw: String(Math.round(widthMm) || 120),
  });
  const [res, setRes] = useState<AeroResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const run = async () => {
    setBusy(true); setError('');
    try {
      const est = await fetchAeroEstimate({
        mass_g: num(f.mass, 2000), speed_ms: num(f.speed, 18), span_mm: num(f.span, 1500), root_chord_mm: num(f.root, 220), tip_chord_mm: num(f.tip, 150),
        thickness_ratio: num(f.tc, 12) / 100, fuselage_length_mm: num(f.fl, 900), fuselage_dia_mm: num(f.fw, 120), sweep_deg: num(f.sweep, 0),
      });
      setRes(est); onResult?.(est);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const add = async (kind: 'wing' | 'fuselage') => {
    setBusy(true); setError('');
    try {
      if (kind === 'wing') {
        const s = await fetchWingScript({ span_mm: num(f.span, 1500), root_chord_mm: num(f.root, 220), tip_chord_mm: num(f.tip, 150), naca: f.naca,
          sweep_deg: num(f.sweep, 0), dihedral_deg: num(f.dihedral, 2) });
        await onAddParts([{ name: `Wing NACA ${f.naca}`, script: s.script, material: s.material, purpose: 'Lifting surface (generated: tapered, NACA section)',
          dimensions: `${f.span} mm span, chord ${f.root} to ${f.tip} mm`, mounting: { method: 'bolted', fastener: 'M3', connects_to: [] } }]);
      } else {
        const s = await fetchFuselageScript({ length_mm: num(f.fl, 900), width_mm: num(f.fw, 120) });
        await onAddParts([{ name: 'Streamlined fuselage', script: s.script, material: s.material, purpose: 'Low-drag outer body (generated: ellipsoidal nose, tapered tail)',
          dimensions: `${f.fl} x ${f.fw} mm`, mounting: null }]);
      }
    } catch (e) { const m = e instanceof Error ? e.message : String(e); setError(m); toast.error(m.slice(0, 140)); } finally { setBusy(false); }
  };

  const field = (label: string, k: keyof typeof f) => (
    <label className="flex flex-col gap-0.5">{label}<Input className="h-8 text-xs" inputMode="decimal" value={f[k]} onChange={set(k)} /></label>
  );
  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">
        Design-stage drag, lift and stall estimate (flat-plate friction × form factor + induced drag) and generators for a streamlined
        fuselage and a tapered NACA wing. It compares shapes; it is not CFD. Check the final body with OpenFOAM or SU2.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {field('Mass g', 'mass')}{field('Speed m/s', 'speed')}{field('Thickness %', 'tc')}
        {field('Span mm', 'span')}{field('Root chord', 'root')}{field('Tip chord', 'tip')}
        {field('Fuselage L mm', 'fl')}{field('Fuselage W mm', 'fw')}{field('NACA', 'naca')}
        {field('Sweep °', 'sweep')}{field('Dihedral °', 'dihedral')}
      </div>
      {massG ? <div className="text-[10px] text-muted-foreground">The balance tab counts {Math.round(massG)} g so far; set the mass to the finished vehicle.</div> : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" className="gap-1" onClick={run} disabled={busy}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wind className="w-3.5 h-3.5" />} Estimate</Button>
        <Button size="sm" variant="outline" onClick={() => add('fuselage')} disabled={busy}>Add streamlined fuselage</Button>
        <Button size="sm" variant="outline" onClick={() => add('wing')} disabled={busy}>Add wing</Button>
      </div>
      {error && <div className="text-red-400 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}</div>}
      {res && (
        <div className="rounded border border-border/30 p-2 space-y-0.5">
          <div>Wing {res.wing.S_m2.toFixed(3)} m², AR {res.wing.AR.toFixed(1)}, mean chord {(res.wing.MAC_m * 1000).toFixed(0)} mm</div>
          <div>Needs CL <b>{res.cl_required}</b> · Re {res.reynolds_wing.toLocaleString()} · CD0 {res.cd0} + induced {res.cd_induced}</div>
          <div><b>L/D {res.l_over_d}</b> · drag {res.drag_n} N · {res.power_required_w} W at {f.speed} m/s</div>
          <div>Stall {res.stall_speed_ms} m/s · best glide {res.best_glide_speed_ms} m/s · wing loading {res.wing_loading_n_m2} N/m²</div>
          <div>Fuselage fineness {res.fuselage.fineness} (4 to 6 is lowest drag), form factor {res.fuselage.form_factor}</div>
          {res.warnings.map((w, i) => <div key={i} className="text-yellow-400 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{w}</div>)}
        </div>
      )}
    </div>
  );
}
