import type { AssemblyResult, BalanceAnalysis } from '@/lib/assemblyApi';
import type { AeroResult, FlightResult, SkinReport } from '@/lib/lumexaTools';
import type { VisionVerdict } from '@/lib/assemblyStore';

// One document with everything the assembly page knows: what was solved, what fits, where the mass is, whether the motors are balanced,
// what the flight check and the vision check said, and what none of it proves. Written as Markdown so it opens anywhere.

interface ReportInput {
  projectName: string; assemblyName: string; result: AssemblyResult; balance: BalanceAnalysis | null;
  flight: FlightResult | null; aero: AeroResult | null; vision: VisionVerdict | null; skin?: SkinReport | null;
}

const f1 = (v: number) => v.toFixed(1);
const list = (v: number[] | null | undefined) => (v ? v.map(f1).join(', ') : 'n/a');
const mark = (ok: boolean | null | undefined) => (ok === true ? 'OK' : ok === false ? 'ATTENTION' : 'not checked');

export function buildReport({ projectName, assemblyName, result, balance, flight, aero, vision, skin }: ReportInput): string {
  const name = (id: string) => result.parts.find((p) => p.id === id)?.name ?? id;
  const L: string[] = [];
  const unfit = Object.entries(result.packing ?? {}).filter(([, pk]) => !pk.fits);
  const overlapRan = result.interference_checked !== false;
  const lp = balance?.lift_plan;

  L.push(`# Engineering report: ${projectName} / ${assemblyName}`);
  L.push(`Generated ${new Date().toLocaleString()} by Lumexa. These are design-stage numbers. They are not a certification and not a substitute for testing.`, '');
  L.push('## Summary', '', '| Check | Result | Detail |', '|---|---|---|');
  L.push(`| Assembly solved | ${mark(result.ok)} | ${result.parts.length} parts, ${result.mates.length} joints |`);
  L.push(`| Overlaps | ${overlapRan ? mark(result.interference.length === 0) : 'not checked'} | ${overlapRan ? `${result.interference.length} found` : 'the overlap check could not run for every part'} |`);
  L.push(`| Components fit | ${Object.keys(result.packing ?? {}).length ? mark(unfit.length === 0) : 'not checked'} | ${unfit.length ? unfit.map(([id]) => name(id)).join(', ') + ' do not fit' : 'every checked part holds its components'} |`);
  L.push(`| Hardware | ${result.hardware.length ? 'OK' : 'none'} | ${result.hardware.length} fasteners${result.hardware.some((h) => h.auto) ? ` (${result.hardware.filter((h) => h.auto).length} added automatically where holes lined up)` : ''} |`);
  if (balance?.cog_mm) {
    const balanced = lp?.status === 'placed' ? lp.balanced : lp?.status === 'planned' ? null : null;
    L.push(`| Balance | ${mark(balanced)} | ${balance.mass.counted_g.toFixed(0)} g counted, CoG ${list(balance.cog_mm)} mm${lp?.status === 'planned' ? '; motors not placed yet, layout planned' : ''} |`);
  }
  if (flight) L.push(`| Flight check | ${flight.verdict === 'pass' ? 'OK' : flight.verdict === 'fail' ? 'ATTENTION' : 'incomplete'} | ${flight.checks.length} checks |`);
  if (skin) L.push(`| Visual skin | ${skin.verdict === 'pass' ? 'OK' : skin.verdict === 'fail' ? 'ATTENTION' : 'incomplete'} | ${skin.quality.triangles.toLocaleString()} triangles, ${skin.quality.watertight ? 'closed' : 'not closed'} (appearance only) |`);
  L.push(`| Vision check | ${vision ? (vision.verdict === 'ok' ? 'OK' : vision.verdict === 'issues' ? 'ATTENTION' : vision.verdict) : 'not run'} | ${vision?.summary ?? ''} |`, '');

  if (balance?.cog_mm) {
    L.push('## Mass and centre of gravity', '');
    L.push(`Counted mass ${balance.mass.counted_g.toFixed(1)} g; not placed yet ${balance.mass.not_placed_g.toFixed(1)} g. Centre of gravity (assembly frame, mm; -X is the front): **${list(balance.cog_mm)}**. ` +
      `Offset from the middle of the placed parts: ${list(balance.cog_offset_mm)}.`);
    if (balance.inertia_kgm2) L.push('', `Inertia about the CoG (point-mass estimate, kg·m²): Ixx ${balance.inertia_kgm2.xx}, Iyy ${balance.inertia_kgm2.yy}, Izz ${balance.inertia_kgm2.zz}.`);
    L.push('', '| Item | Mass g | Source |', '|---|---|---|');
    balance.items.slice(0, 15).forEach((i) => L.push(`| ${i.name} | ${i.mass_g.toFixed(1)} | ${i.source} |`));
    if (balance.not_placed.length) L.push('', 'Not placed in any part yet: ' + balance.not_placed.map((r) => `${r.name} x${r.qty} (${r.mass_each_g === null ? 'mass unknown' : r.mass_each_g + ' g each'})`).join('; ') + '.');
    L.push('');
    if (lp?.status === 'planned' && lp.motors) {
      L.push('## Motor layout (planned)', '', `${lp.n} lift motors on a circle of radius ${lp.arm_radius_mm} mm (${lp.layout}, ${lp.prop_diameter_mm} mm props), centred on x ${f1(lp.centre_xy_mm![0])}, y ${f1(lp.centre_xy_mm![1])}, the CoG of everything else. ${lp.rule ?? ''}`, '');
      lp.motors.forEach((m, i) => L.push(`- M${i + 1}: x ${f1(m.x)}, y ${f1(m.y)}, ${m.spin > 0 ? 'clockwise' : 'counter-clockwise'}, ${lp.thrust_share_pct?.[i]}% of the thrust`));
      L.push('');
    } else if (lp?.status === 'placed') {
      L.push('## Motor layout (placed in the assembly)', '', `Thrust centroid is ${list(lp.offset_from_cog_mm)} mm from the CoG (${lp.balanced ? 'balanced' : 'NOT balanced: move the arms or the battery'}). ` +
        `Thrust each motor must give to hover: ${lp.thrust_share_pct?.map((s) => s + '%').join(', ')}.`, '');
    }
    if (balance.battery_shift) {
      const b = balance.battery_shift;
      L.push(`Battery: to put the CoG on the frame centre it would slide ${list(b.needed_shift_mm.slice(0, 2))} mm (x, y)` +
        (b.achievable_shift_mm ? `; its cavity allows ${list(b.achievable_shift_mm)} mm, leaving the CoG ${list(b.residual_cog_offset_mm)} mm off.` : '.'), '');
    }
  }

  if (flight) {
    L.push('## Flight check', '');
    flight.checks.forEach((c) => L.push(`- **${c.name}**: ${c.value} (${mark(c.ok)}). ${c.note}`));
    if (flight.rpm_estimate) L.push(`- Estimated rotor speed ${flight.rpm_estimate.hover} rpm at hover, ${flight.rpm_estimate.max} rpm at full throttle.`);
    L.push('', flight.notes.join(' '), '');
  }
  if (aero) {
    L.push('## Aerodynamics (estimate)', '', `Wing ${aero.wing.S_m2.toFixed(3)} m², aspect ratio ${aero.wing.AR.toFixed(1)}. Needs CL ${aero.cl_required} at Re ${aero.reynolds_wing.toLocaleString()}; ` +
      `L/D ${aero.l_over_d}, drag ${aero.drag_n} N, ${aero.power_required_w} W; stall ${aero.stall_speed_ms} m/s; best glide ${aero.best_glide_speed_ms} m/s.`);
    aero.warnings.forEach((w) => L.push(`- ${w}`));
    L.push('');
  }

  if (skin) {
    L.push('## Visual skin (appearance geometry, checked against the engineering interfaces)', '');
    skin.checks.forEach((c) => L.push(`- **${c.name}**: ${mark(c.ok)}. ${c.detail}`));
    L.push('', skin.note, '');
  }
  L.push('## Fit of components', '');
  result.parts.forEach((p) => {
    const pk = result.packing?.[p.id];
    const sc = result.scope?.[p.id];
    if (!pk && !sc) return;
    L.push(`- **${p.name}**: ${pk ? (pk.fits ? 'fits' : `DOES NOT FIT. ${pk.message ?? ''}`) : 'nothing to pack'}` +
      (sc?.checked.length ? `; checked ${sc.checked.map((c) => c.name).join(', ')}` : '') + (sc?.skipped.length ? `; not packed: ${sc.skipped.map((c) => `${c.name} (${c.reason})`).join(', ')}` : ''));
  });
  L.push('', '## Hardware', '');
  result.bom.forEach((b) => L.push(`- ${b.qty} x ${b.name}`));
  if (vision?.issues.length) {
    L.push('', '## Vision check findings', '');
    vision.issues.forEach((i) => L.push(`- (${i.severity}) ${i.part}: ${i.what}${i.fix ? ` Fix: ${i.fix}` : ''}`));
  }
  const warns = [...result.warnings, ...(balance?.warnings ?? [])];
  if (warns.length) L.push('', '## Warnings', '', ...warns.map((w) => `- ${w}`));
  L.push('', '## What this report does not show', '',
    '- Part masses assume solid volume x density x a print-fill factor for plastics; component masses are datasheet values or flagged estimates.',
    '- The flight check is hand calculation (thrust ~ throttle², cantilever beam theory). It is not a flight simulation and not a structural analysis.',
    '- Aerodynamic numbers are design-stage estimates (flat-plate friction x form factor + induced drag), not CFD.',
    '- Crankshaft balance figures are analytic; dynamic balance of a real part must be measured on a balancing machine.',
    '- Nothing here replaces physical testing and review by a qualified engineer before anything is built or flown.');
  return L.join('\n');
}
