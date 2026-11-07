import { useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, PlaneTakeoff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { BalanceAnalysis } from '@/lib/assemblyApi';
import { FlightResult, fetchFlightCheck } from '@/lib/lumexaTools';

interface Props {
  balance: BalanceAnalysis | null;
  vehicle: string;
  /** the bill of components, to read motor KV / thrust, battery cells and the arm tube from */
  inventory: { name: string; dims_text?: string; qty?: number }[];
  result: FlightResult | null;
  onResult: (r: FlightResult | null) => void;
}

const num = (s: string) => (Number.isFinite(parseFloat(s)) ? parseFloat(s) : undefined);

export default function FlightPanel({ balance, vehicle, inventory, result, onResult }: Props) {
  const lp = balance?.lift_plan;
  const n = lp && lp.status !== 'no_lift_motors' ? (lp.n ?? 0) : 0;
  const motor = inventory.find((i) => /motor/i.test(i.name) && !/servo|pusher|forward|tail/i.test(i.name));
  const batt = inventory.find((i) => /batter|lipo|li-ion/i.test(i.name));
  const tube = inventory.find((i) => /tube|boom|spar/i.test(i.name));
  const [f, setF] = useState({ mass: '', thrust: '', arm: '', tipMass: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // sensible starting values from the assembly (the user can change them): total mass, the planned arm length and the lift unit mass
  useEffect(() => {
    setF((o) => ({
      ...o,
      mass: o.mass || (balance ? String(Math.round(balance.mass.total_g)) : ''),
      arm: o.arm || (lp?.arm_radius_mm ? String(Math.max(50, Math.round(lp.arm_radius_mm - 45))) : ''),
      tipMass: o.tipMass || (lp?.unit_mass_g ? String(Math.round(lp.unit_mass_g)) : ''),
    }));
  }, [balance, lp?.arm_radius_mm, lp?.unit_mass_g]);

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const run = async () => {
    setBusy(true); setError('');
    try {
      const spins = lp?.status === 'planned' ? lp.motors?.map((m) => m.spin) : undefined;
      onResult(await fetchFlightCheck({
        mass_g: num(f.mass) ?? 0, n_motors: n || 4, vehicle, spins,
        motor_max_thrust_g: num(f.thrust), motor_text: motor ? `${motor.name} ${motor.dims_text ?? ''}` : undefined,
        battery_text: batt ? `${batt.name} ${batt.dims_text ?? ''}` : undefined,
        arm_length_mm: num(f.arm), tube_text: tube ? `${tube.name} ${tube.dims_text ?? ''}` : undefined,
        arm_material: tube ? (/carbon/i.test(tube.name) ? 'carbon' : /alumin/i.test(tube.name) ? 'aluminium' : 'petg') : 'petg',
        tip_mass_g: num(f.tipMass),
      }));
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  if (!n) return <div className="text-xs text-muted-foreground">The flight check needs lift motors (a multirotor or VTOL in the vehicle selector, with motors in the bill of components).</div>;
  return (
    <div className="space-y-2 text-xs rounded border border-border/30 p-2">
      <div className="font-medium flex items-center gap-1"><PlaneTakeoff className="w-3.5 h-3.5" /> Flight check ({n} lift motors)</div>
      <p className="text-muted-foreground">Thrust-to-weight, hover throttle, yaw torque, arm bending and arm resonance. Hand calculations, not a flight simulation.</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5">Vehicle mass g<Input className="h-8 text-xs" inputMode="decimal" value={f.mass} onChange={set('mass')} /></label>
        <label className="flex flex-col gap-0.5">Max thrust per motor g<Input className="h-8 text-xs" inputMode="decimal" placeholder="from the motor datasheet" value={f.thrust} onChange={set('thrust')} /></label>
        <label className="flex flex-col gap-0.5">Arm length mm<Input className="h-8 text-xs" inputMode="decimal" value={f.arm} onChange={set('arm')} /></label>
        <label className="flex flex-col gap-0.5">Motor+prop+ESC g<Input className="h-8 text-xs" inputMode="decimal" value={f.tipMass} onChange={set('tipMass')} /></label>
      </div>
      <Button size="sm" onClick={run} disabled={busy || !num(f.mass)} className="gap-1">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Run flight check</Button>
      {error && <div className="text-red-400 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}</div>}
      {result && (
        <div className="space-y-1">
          {result.checks.map((c, i) => (
            <div key={i} className="flex items-start gap-1">
              {c.ok === true ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" /> : c.ok === false ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />
                : <CircleHelp className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />}
              <span><b>{c.name}</b> {c.value}<span className="text-muted-foreground"> · {c.note}</span></span>
            </div>
          ))}
          {result.rpm_estimate && <div className="text-muted-foreground">Estimated rotor speed {result.rpm_estimate.hover} rpm at hover, {result.rpm_estimate.max} rpm at full throttle.</div>}
          <div className="text-[10px] text-muted-foreground">{result.notes.join(' ')}</div>
        </div>
      )}
    </div>
  );
}
