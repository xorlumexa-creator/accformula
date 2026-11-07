import { AlertTriangle, CheckCircle2, Loader2, Scale } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { BalanceAnalysis } from '@/lib/assemblyApi';
import type { Vehicle } from '@/lib/balanceBrief';

interface Props {
  analysis: BalanceAnalysis | null;
  busy: boolean;
  error: string;
  canRecompute: boolean;
  vehicle: Vehicle;
  onVehicle: (v: Vehicle) => void;
  layout: 'auto' | 'x' | 'plus';
  onLayout: (l: 'auto' | 'x' | 'plus') => void;
  printFill: number;
  onPrintFill: (f: number) => void;
  showMarkers: boolean;
  onShowMarkers: (b: boolean) => void;
  /** build the arm frame at the planned motor positions and add it to the assembly */
  onGenerateArms?: () => void;
  armsBusy?: boolean;
}

const f1 = (v: number) => v.toFixed(1);
const xyz = (v: number[] | null | undefined) => (v ? v.map(f1).join(', ') : 'n/a');

export default function BalancePanel(p: Props) {
  const a = p.analysis;
  const lp = a?.lift_plan;
  const bs = a?.battery_shift;
  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">
        Mass and centre of gravity of the assembly as built: real solid volumes × material density, datasheet masses for components.
        Assembly frame, mm; −X is the front.
      </p>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">Vehicle
          <select className="h-8 rounded border border-border bg-background px-1" value={p.vehicle} disabled={!p.canRecompute}
            onChange={(e) => p.onVehicle(e.target.value as Vehicle)}>
            <option value="multirotor">Multirotor</option><option value="vtol">VTOL</option><option value="generic">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">Motor layout
          <select className="h-8 rounded border border-border bg-background px-1" value={p.layout} disabled={!p.canRecompute}
            onChange={(e) => p.onLayout(e.target.value as 'auto' | 'x' | 'plus')}>
            <option value="auto">Auto (X for 4)</option><option value="x">X</option><option value="plus">Plus (+)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">Printed-part fill
          <select className="h-8 rounded border border-border bg-background px-1" value={String(p.printFill)} disabled={!p.canRecompute}
            onChange={(e) => p.onPrintFill(Number(e.target.value))}>
            {[0.2, 0.35, 0.5, 1].map((v) => <option key={v} value={String(v)}>{Math.round(v * 100)}%</option>)}
          </select>
        </label>
        <label className="flex items-end justify-between gap-2 pb-1">Show in 3D
          <Switch checked={p.showMarkers} onCheckedChange={p.onShowMarkers} />
        </label>
      </div>
      {p.busy && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Recomputing…</div>}
      {p.error && <div className="text-red-400 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{p.error}</div>}
      {!a && <div className="text-muted-foreground">Rebuild the assembly to compute the balance (this assembly was saved before balance existed).</div>}
      {a && !a.cog_mm && <div className="text-yellow-400">No part has a known mass yet.</div>}
      {a?.cog_mm && (
        <>
          <div className="rounded border border-border/30 p-2 space-y-0.5">
            <div className="font-medium flex items-center gap-1"><Scale className="w-3.5 h-3.5" /> {a.mass.counted_g.toFixed(0)} g counted
              {a.mass.not_placed_g > 0 && <span className="text-muted-foreground font-normal"> · {a.mass.not_placed_g.toFixed(0)} g not placed yet</span>}</div>
            <div>CoG <span className="font-mono">{xyz(a.cog_mm)}</span> mm</div>
            <div className="text-muted-foreground">Offset from the middle of the placed parts: <span className="font-mono">{xyz(a.cog_offset_mm)}</span> mm</div>
            {a.inertia_kgm2 && <div className="text-muted-foreground">Inertia about CoG (kg·m², point-mass estimate): Ixx {a.inertia_kgm2.xx} · Iyy {a.inertia_kgm2.yy} · Izz {a.inertia_kgm2.zz}</div>}
          </div>

          {lp?.status === 'planned' && lp.motors && (
            <div className="rounded border border-primary/30 p-2 space-y-1">
              <div className="font-medium">Where to put the {lp.n} lift motors</div>
              <div>Circle radius <span className="font-mono">{lp.arm_radius_mm}</span> mm ({lp.layout}, {lp.prop_diameter_mm} mm props) centred on
                x {f1(lp.centre_xy_mm![0])}, y {f1(lp.centre_xy_mm![1])}, the CoG of everything else.</div>
              {lp.motors.map((m, i) => (
                <div key={i} className="flex justify-between font-mono">
                  <span>M{i + 1}  x {f1(m.x)}  y {f1(m.y)}</span>
                  <span className={m.spin > 0 ? 'text-cyan-400' : 'text-amber-400'}>{m.spin > 0 ? 'CW' : 'CCW'} · {lp.thrust_share_pct?.[i]}%</span>
                </div>
              ))}
              <div className="text-muted-foreground">{lp.rule}</div>
              {p.onGenerateArms && (
                <Button size="sm" className="gap-1 mt-1" onClick={p.onGenerateArms} disabled={p.armsBusy}>
                  {p.armsBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Generate arms at these positions
                </Button>
              )}
              {!lp.yaw_balanced && <div className="text-yellow-400">An odd number of motors cannot cancel yaw torque by spin direction alone.</div>}
              {lp.warning && <div className="text-yellow-400">{lp.warning}</div>}
              {lp.assumption && <div className="text-muted-foreground">{lp.assumption}</div>}
            </div>
          )}
          {lp?.status === 'placed' && (
            <div className={`rounded border p-2 space-y-0.5 ${lp.balanced ? 'border-green-500/30' : 'border-yellow-500/40'}`}>
              <div className="font-medium flex items-center gap-1">{lp.balanced ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />}
                {lp.n} lift motors placed</div>
              <div>Thrust centroid is <span className="font-mono">{xyz(lp.offset_from_cog_mm)}</span> mm from the CoG.</div>
              <div className="text-muted-foreground">Thrust each motor must give to hover: {lp.thrust_share_pct?.map((s) => `${s}%`).join(', ')} (equal is {(100 / (lp.n || 1)).toFixed(1)}%).</div>
            </div>
          )}
          {bs && (
            <div className="rounded border border-border/30 p-2 space-y-0.5">
              <div className="font-medium">Battery ({bs.battery}, {bs.battery_g} g)</div>
              <div>To put the CoG on the frame centre it would slide <span className="font-mono">{xyz(bs.needed_shift_mm.slice(0, 2))}</span> mm (x, y).</div>
              {bs.achievable_shift_mm
                ? <div className={bs.fully_corrects ? 'text-green-400' : 'text-yellow-400'}>
                    Its cavity allows <span className="font-mono">{xyz(bs.achievable_shift_mm)}</span> mm; the CoG would then be <span className="font-mono">{xyz(bs.residual_cog_offset_mm)}</span> mm off.
                    {!bs.fully_corrects && ' Move the arms or enlarge the battery bay to finish the job.'}</div>
                : <div className="text-muted-foreground">{bs.note}</div>}
            </div>
          )}

          <div>
            <div className="font-medium mb-1">Heaviest items</div>
            {a.items.slice(0, 8).map((it, i) => (
              <div key={i} className="flex justify-between border-b border-border/20 py-0.5">
                <span className="truncate pr-2">{it.name}</span>
                <span className="font-mono shrink-0">{it.mass_g.toFixed(1)} g {it.source === 'estimate' && <Badge variant="outline" className="text-[9px] ml-1">est.</Badge>}</span>
              </div>
            ))}
          </div>
          {a.not_placed.length > 0 && (
            <div>
              <div className="font-medium mb-1">Not placed in any part yet</div>
              {a.not_placed.map((r, i) => (
                <div key={i} className="flex justify-between text-muted-foreground">
                  <span className="truncate pr-2">{r.name} ×{r.qty}</span>
                  <span className="font-mono shrink-0">{r.mass_each_g === null ? 'mass unknown' : `${r.mass_each_g} g each`}</span>
                </div>
              ))}
            </div>
          )}
          {a.warnings.map((w, i) => <div key={i} className="text-yellow-400 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{w}</div>)}
          {a.assumptions.map((w, i) => <div key={i} className="text-[10px] text-muted-foreground">{w}</div>)}
        </>
      )}
    </div>
  );
}
