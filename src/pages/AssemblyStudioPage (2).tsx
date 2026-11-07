import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, Box, CheckCircle2, Cog, Download, Eye, Layers, Loader2, Scale, ScanEye, Wind, Wrench, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AssemblyScene, { CaptureFn, SceneOptions } from '@/components/AssemblyScene';
import BalancePanel from '@/components/BalancePanel';
import AeroPanel from '@/components/AeroPanel';
import CrankshaftDialog from '@/components/CrankshaftDialog';
import { AssemblyResult, BalanceAnalysis, Hardware, buildAssembly } from '@/lib/assemblyApi';
import FlightPanel from '@/components/FlightPanel';
import SkinPanel from '@/components/SkinPanel';
import { AeroResult, FlightResult, NewPart, SkinReport, fetchArmFrame, fetchBalance } from '@/lib/lumexaTools';
import { buildReport } from '@/lib/engineeringReport';
import { Vehicle, guessVehicle } from '@/lib/balanceBrief';
import { base64ToBlob, saveBlob } from '@/lib/exportDesign';
import {
  VisionVerdict, changedParts, downloadSavedStep, fingerprintOf, housingKeyOf, loadAssembly, saveAssembly, saveVision, sameFingerprint,
} from '@/lib/assemblyStore';
import { runVisionCheck } from '@/lib/assemblyVision';

interface MacroRow { id: string; name: string; purpose?: string | null; sort_order: number }
interface HousedRow { component: string; quantity?: number }
interface PartRow {
  id: string; part_name: string; purpose?: string | null; material?: string | null; dimensions?: string | null;
  macro_part_id?: string | null; cad_script?: string | null; updated_at?: string; sort_order?: number;
  housed_components?: HousedRow[] | null;
  mounting?: { method?: string; fastener?: string | null; connects_to?: string[] } | null;
}
interface ElectronicRow { id: string; component_name: string; dimensions?: string | null; quantity?: number | null }

// After a part changes, wait for this much quiet before rebuilding: a rebuild is heavy on a 4 GB tablet and several saves often come in a row.
const REBUILD_QUIET_MS = 15000;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const frames = async (n: number) => { for (let i = 0; i < n; i++) await new Promise((r) => requestAnimationFrame(() => r(null))); await sleep(120); };

// Same words as the backend's classify_component: wires run through channels, propellers/booms/spars mount outside a housing.
const WIRE_RE = /\b(wires?|wiring|cables?|harness(?:es)?|leads?(?!-?\s?acid)|tubing|sleeving)\b/i;
const OUTSIDE_RE = /\b(propellers?|props?|blades?|booms?|tubes?|spars?|rods?|wings?|wheels?|tyres?|tires?|antennas?)\b/i;
const componentKind = (name: string): 'wire' | 'external' | 'internal' => (WIRE_RE.test(name) ? 'wire' : OUTSIDE_RE.test(name) ? 'external' : 'internal');

function matchElectronic(list: ElectronicRow[], name: string): ElectronicRow | undefined {
  const n = norm(name);
  return list.find((x) => norm(x.component_name) === n)
    ?? list.find((x) => { const m = norm(x.component_name); return (m.length >= 4 && n.includes(m)) || (n.length >= 4 && m.includes(n)); });
}

const kindLabel: Record<string, string> = {
  enclosed: 'sealed void', pocket: 'open pocket', channel: 'channel / through-hole', trough: 'open trough',
};

const hardwareWords = (h: Hardware[]) => {
  const first = h[0];
  const what = first.insert ? 'screws into heat-set inserts' : first.nut ? 'bolts with nuts' : first.tapped_part ? 'screws into threaded holes' : 'bolts';
  return `${h.length} × ${first.size}×${first.length_mm} ${what}`;
};

export default function AssemblyStudioPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [projectId, setProjectId] = useState('');
  const [macros, setMacros] = useState<MacroRow[]>([]);
  const [macroId, setMacroId] = useState('');
  const [parts, setParts] = useState<PartRow[]>([]);
  const [electronics, setElectronics] = useState<ElectronicRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [result, setResult] = useState<AssemblyResult | null>(null);
  const [shownFp, setShownFp] = useState<Record<string, string> | null>(null);   // CAD scripts the shown assembly was built from
  const [shownHousing, setShownHousing] = useState<string | null>(null);
  const [savedChecked, setSavedChecked] = useState('');                           // macro id whose saved assembly has been looked up
  const [savedAt, setSavedAt] = useState('');
  const [stepPath, setStepPath] = useState<string | null>(null);
  const [vision, setVision] = useState<VisionVerdict | null>(null);
  const [visionBusy, setVisionBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle>('generic');
  const [layout, setLayout] = useState<'auto' | 'x' | 'plus'>('auto');
  const [printFill, setPrintFill] = useState(0.35);
  const [balance, setBalance] = useState<BalanceAnalysis | null>(null);
  const [balanceBusy, setBalanceBusy] = useState(false);
  const [balanceError, setBalanceError] = useState('');
  const [crankOpen, setCrankOpen] = useState(false);
  const [flight, setFlight] = useState<FlightResult | null>(null);
  const [aero, setAero] = useState<AeroResult | null>(null);
  const [armsBusy, setArmsBusy] = useState(false);
  const [skin, setSkin] = useState<SkinReport | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const [projectName, setProjectName] = useState('Project');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({
    xray: true, xrayOpacity: 0.16, explode: 0, showCavities: true, showComponents: true, showHardware: true,
    sectionOn: false, sectionAxis: 'z' as 'x' | 'y' | 'z', sectionFrac: 0.6, showBalance: true,
  });
  const captureRef = useRef<CaptureFn | null>(null);
  const autoKey = useRef('');
  const partsSig = useRef('');
  const viewRef = useRef(view);
  viewRef.current = view;

  const sigOf = (rows: { id: string; updated_at?: string }[]) => rows.map((r) => `${r.id}:${r.updated_at ?? ''}`).sort().join('|');

  const loadParts = useCallback(async (pid: string) => {
    const { data } = await supabase.from('project_parts').select('*').eq('project_id', pid).order('sort_order');
    const rows = (data ?? []) as unknown as PartRow[];
    partsSig.current = sigOf(rows);
    setParts(rows);
  }, []);

  // ---- load the project once
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: projects } = await supabase.from('projects').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(1);
      if (!projects?.[0]) { navigate('/project-plan'); return; }
      const pid = projects[0].id;
      setProjectId(pid);
      const pr = projects[0] as unknown as Record<string, unknown>;
      setProjectName(String(pr.project_name ?? 'Project'));
      setVehicle(guessVehicle([pr.project_name, pr.category, pr.purpose].filter(Boolean).join(' ')));
      const [m, e] = await Promise.all([
        supabase.from('project_macro_parts').select('id,name,purpose,sort_order').eq('project_id', pid).order('sort_order'),
        supabase.from('project_electronics').select('id,component_name,dimensions,quantity').eq('project_id', pid).order('sort_order'),
      ]);
      setMacros((m.data ?? []) as MacroRow[]);
      setElectronics((e.data ?? []) as ElectronicRow[]);
      await loadParts(pid);
      if (m.data?.[0]) setMacroId(m.data[0].id);
      setLoaded(true);
    })();
  }, [user, navigate, loadParts]);

  // ---- a part that is built or modified on the Parts page shows up here by itself: look for changes while this page is open
  useEffect(() => {
    if (!projectId) return;
    const check = async () => {
      if (document.hidden) return;
      const { data } = await supabase.from('project_parts').select('id,updated_at').eq('project_id', projectId);
      if (data && sigOf(data as { id: string; updated_at?: string }[]) !== partsSig.current) await loadParts(projectId);
    };
    const t = setInterval(check, 15000);
    const onVis = () => { if (!document.hidden) void check(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [projectId, loadParts]);

  const macroParts = useMemo(() => parts.filter((p) => p.macro_part_id === macroId), [parts, macroId]);
  const ready = useMemo(() => macroParts.filter((p) => !!p.cad_script), [macroParts]);
  const currentFp = useMemo(() => fingerprintOf(ready), [ready]);
  const selectedPart = result?.parts.find((p) => p.id === selected) ?? null;

  // what each part holds comes from the part itself (project_parts.housed_components), so the generator and this page agree
  const housing = useMemo(() => {
    const out: Record<string, { el: ElectronicRow; qty: number }[]> = {};
    parts.forEach((p) => {
      const list: { el: ElectronicRow; qty: number }[] = [];
      (p.housed_components ?? []).forEach((h) => {
        const el = matchElectronic(electronics, h.component);
        if (el && !list.some((x) => x.el.id === el.id)) list.push({ el, qty: h.quantity ?? el.quantity ?? 1 });
      });
      if (list.length) out[p.id] = list;
    });
    return out;
  }, [parts, electronics]);
  const housingForBackend = useMemo(() => {
    const o: Record<string, { name: string; qty: number }[]> = {};
    ready.forEach((p) => { if (housing[p.id]?.length) o[p.id] = housing[p.id].map((x) => ({ name: x.el.component_name, qty: x.qty })); });
    return o;
  }, [ready, housing]);
  const housingKey = useMemo(() => housingKeyOf(housingForBackend), [housingForBackend]);

  const toggleHousing = (part: PartRow, el: ElectronicRow) => {
    const cur = part.housed_components ?? [];
    const has = (housing[part.id] ?? []).some((x) => x.el.id === el.id);
    const next = has
      ? cur.filter((h) => matchElectronic(electronics, h.component)?.id !== el.id)
      : [...cur, { component: el.component_name, quantity: el.quantity ?? 1 }];
    setParts((ps) => ps.map((p) => (p.id === part.id ? { ...p, housed_components: next } : p)));
    supabase.from('project_parts').update({ housed_components: next as unknown as Json }).eq('id', part.id)
      .then(({ error: err }) => { if (err) toast.error(`Could not save the component list: ${err.message}`); });
  };

  const opts: SceneOptions = useMemo(() => {
    const bb = result?.assembly_bbox;
    const ax = view.sectionAxis === 'x' ? 0 : view.sectionAxis === 'y' ? 1 : 2;
    const offset = bb ? bb.min[ax] + (bb.max[ax] - bb.min[ax]) * view.sectionFrac : 0;
    return {
      xray: view.xray, xrayOpacity: view.xrayOpacity, explode: view.explode, showCavities: view.showCavities,
      showComponents: view.showComponents, showHardware: view.showHardware, hidden, selected,
      section: { enabled: view.sectionOn, axis: view.sectionAxis, offset },
    };
  }, [view, hidden, selected, result]);

  // ---- vision: look at renders of the finished assembly next to the measured facts
  const doVision = useCallback(async (r: AssemblyResult, forMacro: string) => {
    setVisionBusy(true);
    const prev = viewRef.current;
    try {
      for (let i = 0; i < 40 && !captureRef.current; i++) await sleep(150);   // wait for the scene to exist
      if (!captureRef.current) throw new Error('the 3D view is not ready, so there was nothing to look at');
      setView({ ...prev, xray: false, explode: 0, sectionOn: false, showCavities: false, showBalance: false }); await frames(4);
      const solid = captureRef.current?.(['iso', 'side']) ?? [];
      setView({ ...prev, xray: true, explode: 0, sectionOn: false, showCavities: false, showBalance: false }); await frames(4);
      const xr = captureRef.current?.(['iso']) ?? [];
      const shots = [...solid.map((s) => ({ ...s, name: `${s.view} solid` })), ...xr.map((s) => ({ ...s, name: `${s.view} x-ray` }))];
      if (shots.length === 0) throw new Error('could not capture the 3D view');
      const verdict = await runVisionCheck(shots.map((s) => s.image), r, shots.map((s) => s.name));
      setVision(verdict);
      await saveVision(forMacro, verdict);
      if (verdict.verdict === 'issues') toast.warning('Vision check found problems in the assembly');
      else if (verdict.verdict === 'ok') toast.success('Vision check: the assembly looks right');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setVision({ verdict: 'error', summary: msg, issues: [], checked_at: new Date().toISOString() });
    } finally {
      setView(prev);
      setVisionBusy(false);
    }
  }, []);

  // ---- build, save, then look at it
  const build = useCallback(async (reason = '') => {
    setError(''); setWhy(reason);
    if (ready.length < 2) { setError('Pick an assembly that has at least two parts generated with their CAD script saved.'); return; }
    const measured = (id: string) => {
      const bb = result?.parts.find((x) => x.id === id)?.bbox_world;
      return bb ? bb.max.map((m, i) => +(m - bb.min[i]).toFixed(1)).join(' × ') : '';
    };
    const hints: Record<string, string> = {};
    const components: Record<string, { name: string; dims_text?: string; qty?: number }[]> = {};
    ready.forEach((p) => {
      const mt = p.mounting;
      const joins = (mt?.connects_to ?? []).join(', ');
      const size = measured(p.id);
      hints[p.id] = [p.purpose, p.material && `material ${p.material}`,
        size ? `measured bounding box ${size} mm` : p.dimensions && `planned dimensions ${p.dimensions}`,   // measured size beats the planned text
        mt?.method && `attaches by ${mt.method}${mt.fastener ? ` (${mt.fastener})` : ''}`, joins && `connects to ${joins}`].filter(Boolean).join('; ');
      const inside = housing[p.id] ?? [];
      if (inside.length) components[p.id] = inside.map((x) => ({ name: x.el.component_name, dims_text: x.el.dimensions ?? '', qty: x.qty }));
    });
    const fp = fingerprintOf(ready);
    const hk = housingKey;
    const forMacro = macroId;
    setBusy(true); setProgress('starting');
    try {
      const r = await buildAssembly(
        {
          parts: ready.map((p) => ({ id: p.id, name: p.part_name, script: p.cad_script as string })), hints, components,
          options: {
            balance: {
              vehicle, print_fill: printFill, layout,
              inventory: electronics.map((e) => ({ name: e.component_name, dims_text: e.dimensions ?? '', qty: e.quantity ?? 1 })),
              materials: Object.fromEntries(ready.map((p) => [p.id, p.material ?? ''])),
            },
          },
        },
        (t) => setProgress(`${t.stage ?? 'working'} ${t.seconds}s${t.memoryMb ? ` · server memory ${t.memoryMb} MB` : ''}`),
      );
      setResult(r); setShownFp(fp); setShownHousing(hk); setVision(null); setSelected(null); setStepPath(null);
      toast.success(r.ok ? 'Assembly built' : 'Assembly built, but parts collide');
      if (user) {
        try {
          await saveAssembly({ userId: user.id, projectId, macroId: forMacro, fingerprint: fp, housingKey: hk, result: r });
          setSavedAt(new Date().toISOString());
        } catch (e) {
          toast.error(`Assembly built but could not be saved: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`);
          return;
        }
      }
      setBusy(false); setProgress('');
      await doVision(r, forMacro);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg); toast.error(msg.slice(0, 160));
      if (/another (assembly|heavy job)/i.test(msg)) {            // the backend is busy: try again by itself in a minute instead of giving up
        setTimeout(() => { autoKey.current = ''; setRetryTick((t) => t + 1); }, 60000);
      }
    } finally { setBusy(false); setProgress(''); }
  }, [ready, housing, housingKey, macroId, projectId, result, user, doVision, vehicle, printFill, layout, electronics]);

  // ---- switching assembly: open the saved one
  useEffect(() => {
    if (!macroId) return;
    let alive = true;
    setResult(null); setShownFp(null); setShownHousing(null); setVision(null); setStepPath(null); setSavedAt(''); setError(''); setWhy('');
    setSelected(null); setSavedChecked(''); setFlight(null); setAero(null); setSkin(null);
    (async () => {
      const saved = await loadAssembly(macroId);
      if (!alive) return;
      if (saved) {
        setResult(saved.result); setShownFp(saved.fingerprint); setShownHousing(saved.housingKey);
        setVision(saved.vision); setStepPath(saved.stepPath); setSavedAt(saved.savedAt);
      }
      setSavedChecked(macroId);
    })();
    return () => { alive = false; };
  }, [macroId]);

  // ---- no assembly yet, or a part changed since it was built: build it again by itself (once per state of the parts)
  useEffect(() => {
    if (!loaded || !macroId || savedChecked !== macroId || busy || visionBusy || ready.length < 2) return;
    if (result && shownFp && sameFingerprint(shownFp, currentFp)) return;
    const key = `${macroId}:${JSON.stringify(currentFp)}`;
    if (autoKey.current === key) return;
    const names = changedParts(shownFp ?? {}, currentFp).map((id) => parts.find((p) => p.id === id)?.part_name ?? 'a part');
    const timer = setTimeout(() => {
      autoKey.current = key;
      void build(shownFp ? `Rebuilt because ${names.join(', ')} changed.` : 'First build of this assembly.');
    }, shownFp ? REBUILD_QUIET_MS : 0);                        // a first build starts at once; a change waits for the saves to stop
    return () => clearTimeout(timer);
  }, [loaded, macroId, savedChecked, busy, visionBusy, ready.length, result, shownFp, currentFp, parts, build, retryTick]);

  const stale = !!result && !!shownFp && !sameFingerprint(shownFp, currentFp);
  const staleNames = stale ? changedParts(shownFp as Record<string, string>, currentFp).map((id) => parts.find((p) => p.id === id)?.part_name ?? 'a part') : [];
  const housingChanged = !!result && !stale && shownHousing !== null && shownHousing !== housingKey;

  // ---- balance: follows the assembly, and can be recomputed for another vehicle type / motor layout without rebuilding
  const recomputeBalance = useCallback(async (change: { vehicle?: Vehicle; layout?: 'auto' | 'x' | 'plus'; printFill?: number }) => {
    if (!result?.balance_inputs) return;
    setBalanceBusy(true); setBalanceError('');
    try {
      setBalance(await fetchBalance(result, {
        vehicle: change.vehicle ?? vehicle, layout: change.layout ?? layout, print_fill: change.printFill ?? printFill,
      }));
    } catch (e) { setBalanceError(e instanceof Error ? e.message : String(e)); } finally { setBalanceBusy(false); }
  }, [result, vehicle, layout, printFill]);
  useEffect(() => {
    setBalance(result?.balance ?? null); setBalanceError('');
    if (result?.balance && result.balance_inputs && result.balance.vehicle !== vehicle) void recomputeBalance({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  // ---- parts generated by the backend (crankshaft, wing, fuselage) are saved like any other part: the assembly then rebuilds itself
  const addParts = async (rows: NewPart[]) => {
    if (!user || !projectId || !macroId) throw new Error('Open an assembly first.');
    const base = parts.reduce((m, p) => Math.max(m, (p.sort_order ?? 0) + 1), 0);
    const toInsert = rows.map((r, i) => ({
      project_id: projectId, user_id: user.id, macro_part_id: macroId, part_name: r.name, material: r.material, manufacturing_method: '',
      estimated_cost: 0, complexity: 'Intermediate', dimensions: r.dimensions ?? '', purpose: r.purpose, subsystem: '', housed_components: [],
      mounting: r.mounting ?? null, sort_order: base + i, cad_script: r.script,
    }));
    const { error: err } = await supabase.from('project_parts').insert(toInsert as never);
    if (err) { toast.error(`Could not add the part: ${err.message}`); throw err; }
    await loadParts(projectId);
    toast.success(`${rows.map((r) => r.name).join(', ')} added. The assembly rebuilds with it.`);
  };

  // ---- the loop: the planner chose motor positions -> build the arm frame there -> the assembly re-checks the balance on the real geometry
  const generateArms = async () => {
    const lp = balance?.lift_plan;
    if (!lp || lp.status !== 'planned' || !lp.motors || !lp.centre_xy_mm) return;
    setArmsBusy(true);
    try {
      const fr = await fetchArmFrame({ motors: lp.motors, centre_xy_mm: lp.centre_xy_mm });
      await addParts([{
        name: fr.name, script: fr.script, material: fr.material,
        purpose: `Hub and ${lp.motors.length} arms with motor plates at the balanced positions (circle radius ${lp.arm_radius_mm} mm centred on the CoG). ${fr.note}`,
        dimensions: `${fr.arm_length_mm} mm arms, motor plates at the planned positions`, mounting: { method: 'bolted', fastener: 'M3', connects_to: [] },
      }]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message.slice(0, 160) : 'Could not build the arm frame');
    } finally { setArmsBusy(false); }
  };

  const downloadReport = () => {
    if (!result) return;
    const md = buildReport({
      projectName, assemblyName: macros.find((m) => m.id === macroId)?.name ?? 'Assembly', result, balance, flight, aero, vision, skin,
    });
    saveBlob(new Blob([md], { type: 'text/markdown' }), 'lumexa-engineering-report.md');
  };

  const toggleHidden = (id: string) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const nameOf = (id: string) => result?.parts.find((p) => p.id === id)?.name ?? parts.find((p) => p.id === id)?.part_name ?? id;

  const downloadStep = async () => {
    try {
      if (result?.step_base64) saveBlob(base64ToBlob(result.step_base64, 'model/step'), 'assembly.step');
      else if (stepPath) saveBlob(await downloadSavedStep(stepPath), 'assembly.step');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'STEP download failed'); }
  };
  const autoHardware = (result?.hardware ?? []).filter((h) => h.auto);
  const autoJoints = [...new Set(autoHardware.map((h) => h.joint))];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Layers className="w-5 h-5 text-primary" /> Assembly</h1>
          <p className="text-xs text-muted-foreground">
            Parts are placed by a solver from their real holes and faces. Internal space is measured on the actual geometry.
            The assembly is saved, and rebuilt by itself when a part changes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={macroId}
            onChange={(e) => setMacroId(e.target.value)}>
            {macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <Button variant="outline" className="gap-2" onClick={downloadReport} disabled={!result}><Download className="w-4 h-4" /> Report</Button>
          <Button variant="outline" className="gap-2" onClick={() => setCrankOpen(true)} disabled={!macroId}><Cog className="w-4 h-4" /> Crankshaft</Button>
          <Button onClick={() => build('Rebuilt on request.')} disabled={busy || visionBusy || ready.length < 2} className="gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} {result ? 'Rebuild' : 'Build assembly'}
          </Button>
          {(result?.step_base64 || stepPath) && (
            <Button variant="outline" className="gap-2" onClick={downloadStep}><Download className="w-4 h-4" /> STEP</Button>
          )}
        </div>
      </div>
      {busy && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> {why && <span>{why}</span>} {progress}</div>}
      {!busy && savedAt && result && !stale && (
        <div className="text-[11px] text-muted-foreground">Saved {new Date(savedAt).toLocaleString()}{why ? ` · ${why}` : ''}</div>
      )}
      {stale && !busy && (
        <div className="rounded-md border border-yellow-500/40 bg-yellow-500/10 text-yellow-300 text-xs p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>This is the saved assembly from before {staleNames.join(', ')} changed. {error ? 'The new build did not finish (see the error below).' : 'It will rebuild by itself.'}</span>
        </div>
      )}
      {housingChanged && !busy && (
        <div className="rounded-md border border-border/50 bg-muted/30 text-xs p-3 flex items-center gap-3">
          <span>The components assigned to the parts changed since this was checked.</span>
          <Button size="sm" variant="outline" onClick={() => build('Rechecked after the component lists changed.')}>Recheck fit</Button>
        </div>
      )}
      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 text-red-300 text-sm p-3 flex gap-2"><XCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}

      <div className="grid lg:grid-cols-[300px_1fr_360px] gap-4">
        {/* parts + what lives inside them */}
        <div className="rounded-lg border border-border/40 p-3 space-y-3 max-h-[78vh] overflow-y-auto">
          <div className="text-sm font-medium">Parts in this assembly</div>
          {macroParts.length === 0 && <div className="text-xs text-muted-foreground">No parts yet. Generate them on <Link className="underline" to="/parts">Parts & Materials</Link>.</div>}
          {macroParts.map((p) => {
            const rp = result?.parts.find((x) => x.id === p.id);
            const cav = (rp?.internal_space?.cavities ?? []).filter((c) => c.role !== 'hole');
            const pk = result?.packing?.[p.id];
            const inside = housing[p.id] ?? [];
            return (
              <div key={p.id} className={`rounded-md border p-2 text-xs space-y-1.5 ${selected === p.id ? 'border-primary' : 'border-border/30'}`}
                onClick={() => setSelected(p.id)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-sm truncate">{p.part_name}</span>
                  {p.cad_script ? <Badge variant="outline" className="text-[10px]">ready</Badge>
                    : <Badge variant="outline" className="text-[10px] border-yellow-500/40 text-yellow-400">regenerate</Badge>}
                </div>
                {!p.cad_script && <div className="text-muted-foreground">Needs its CAD script: regenerate this part on the Parts page.</div>}
                {rp && (
                  <label className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={!hidden.has(p.id)} onCheckedChange={() => toggleHidden(p.id)} /> show
                    <span className="text-muted-foreground ml-auto">{cav.length ? `${cav.length} space${cav.length > 1 ? 's' : ''}` : 'no storage space'}</span>
                  </label>
                )}
                {electronics.length > 0 && p.cad_script && (
                  <details onClick={(e) => e.stopPropagation()}>
                    <summary className="cursor-pointer text-muted-foreground">Components inside ({inside.length})</summary>
                    <div className="mt-1 space-y-1">
                      {electronics.map((el) => {
                        const kind = componentKind(el.component_name);
                        return (
                          <label key={el.id} className="flex items-start gap-2">
                            <Checkbox checked={inside.some((x) => x.el.id === el.id)} onCheckedChange={() => toggleHousing(p, el)} />
                            <span>{el.component_name}
                              <span className="text-muted-foreground"> {kind === 'wire' ? '· wire, not packed' : kind === 'external' ? '· mounts outside, not packed'
                                : el.dimensions ? `· ${el.dimensions}` : '· size unknown'}</span></span>
                          </label>
                        );
                      })}
                    </div>
                  </details>
                )}
                {pk && !stale && (
                  <div className={`flex items-start gap-1 ${pk.fits ? 'text-green-400' : 'text-red-400'}`}>
                    {pk.fits ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                    <span>{pk.fits ? `Components fit (${pk.packing?.placements.length} placed in ${pk.cavity}, stacked ${pk.packing?.used_height_mm} mm high)` : pk.message}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 3D view */}
        <div className="space-y-2">
          <div className="rounded-lg border border-border/40 overflow-hidden h-[60vh] min-h-[380px] bg-[#0b1020] relative">
            {result ? <AssemblyScene result={result} opts={opts} onSelect={setSelected} captureRef={captureRef}
              markers={{ show: view.showBalance, cog: balance?.cog_mm, propDiameter: balance?.lift_plan?.prop_diameter_mm,
                motors: balance?.lift_plan?.status === 'planned' ? balance.lift_plan.motors : undefined }} />
              : <div className="h-full grid place-items-center text-sm text-muted-foreground text-center px-6">
                  {busy ? 'Building…' : ready.length < 2 ? 'This assembly needs at least two generated parts with CAD scripts.' : savedChecked === macroId ? 'Starting the first build…' : 'Opening the saved assembly…'}
                </div>}
          </div>
          {result && (
            <div className="rounded-lg border border-border/40 p-3 grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
              <label className="flex items-center justify-between gap-2"><span className="flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> X-ray</span>
                <Switch checked={view.xray} onCheckedChange={(v) => setView({ ...view, xray: v })} /></label>
              <label className="flex items-center gap-2"><span className="w-24">See-through</span>
                <Slider min={5} max={60} step={1} value={[Math.round(view.xrayOpacity * 100)]} onValueChange={([v]) => setView({ ...view, xrayOpacity: v / 100 })} /></label>
              <label className="flex items-center gap-2"><span className="w-24">Explode</span>
                <Slider min={0} max={100} step={1} value={[Math.round(view.explode * 100)]} onValueChange={([v]) => setView({ ...view, explode: v / 100 })} /></label>
              <label className="flex items-center justify-between gap-2"><span>Internal space</span>
                <Switch checked={view.showCavities} onCheckedChange={(v) => setView({ ...view, showCavities: v })} /></label>
              <label className="flex items-center justify-between gap-2"><span>Components (ICs, boards)</span>
                <Switch checked={view.showComponents} onCheckedChange={(v) => setView({ ...view, showComponents: v })} /></label>
              <label className="flex items-center justify-between gap-2"><span>Bolts and nuts</span>
                <Switch checked={view.showHardware} onCheckedChange={(v) => setView({ ...view, showHardware: v })} /></label>
              <label className="flex items-center justify-between gap-2"><span>Section cut</span>
                <span className="flex items-center gap-2">
                  <select className="h-7 rounded border border-border bg-background px-1" value={view.sectionAxis}
                    onChange={(e) => setView({ ...view, sectionAxis: e.target.value as 'x' | 'y' | 'z' })}>
                    <option value="x">X</option><option value="y">Y</option><option value="z">Z</option></select>
                  <Switch checked={view.sectionOn} onCheckedChange={(v) => setView({ ...view, sectionOn: v })} /></span></label>
              <label className="flex items-center gap-2"><span className="w-24">Cut position</span>
                <Slider min={0} max={100} step={1} disabled={!view.sectionOn} value={[Math.round(view.sectionFrac * 100)]}
                  onValueChange={([v]) => setView({ ...view, sectionFrac: v / 100 })} /></label>
            </div>
          )}
        </div>

        {/* results */}
        <div className="rounded-lg border border-border/40 p-3 max-h-[78vh] overflow-y-auto">
          {!result ? <div className="text-xs text-muted-foreground">Results appear here: how parts connect, the measured space inside each part, the hardware list and the checks.</div> : (
            <Tabs defaultValue="space">
              <TabsList className="flex w-full overflow-x-auto justify-start">
                <TabsTrigger value="space">Space</TabsTrigger><TabsTrigger value="mates">Mates</TabsTrigger>
                <TabsTrigger value="bom">BOM</TabsTrigger><TabsTrigger value="checks">Checks</TabsTrigger>
                <TabsTrigger value="vision" className="gap-1">{visionBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <ScanEye className="w-3 h-3" />}<span className="sr-only sm:not-sr-only">Look</span></TabsTrigger>
                <TabsTrigger value="balance" className="gap-1"><Scale className="w-3 h-3" />Balance</TabsTrigger>
                <TabsTrigger value="aero" className="gap-1"><Wind className="w-3 h-3" />Aero</TabsTrigger>
                <TabsTrigger value="skin" className="gap-1"><Box className="w-3 h-3" />Skin</TabsTrigger>
              </TabsList>
              <TabsContent value="space" className="space-y-3 text-xs">
                <p className="text-muted-foreground">Measured on the generated geometry (not estimated by a model). Boxes are the largest rectangular volume you can really use.</p>
                {(selectedPart ? [selectedPart] : result.parts).map((p) => {
                  const cav = p.internal_space?.cavities ?? [];
                  const spaces = cav.filter((c) => c.role !== 'hole');
                  const holes = cav.filter((c) => c.role === 'hole');
                  const sc = result.scope?.[p.id];
                  const pk = result.packing?.[p.id];
                  return (
                    <div key={p.id} className="rounded border border-border/30 p-2 space-y-1">
                      <div className="font-medium text-sm">{p.name}</div>
                      {spaces.length === 0 && <div className="text-muted-foreground">No usable internal space (solid part).</div>}
                      {spaces.map((c) => (
                        <div key={c.id} className="flex flex-wrap items-center gap-x-2">
                          <Badge variant="outline" className="text-[10px]">{c.id}</Badge>
                          <span>{kindLabel[c.kind] ?? c.kind}</span>
                          <span className="font-mono">{c.inscribed.size.map((v) => v.toFixed(1)).join(' × ')} mm</span>
                          <span className="text-muted-foreground">{(c.volume_mm3 / 1000).toFixed(2)} cm³{c.openings.length ? ` · open ${c.openings.join(' ')}` : ''}</span>
                        </div>
                      ))}
                      {holes.length > 0 && (
                        <details>
                          <summary className="cursor-pointer text-muted-foreground">{holes.length} small hole{holes.length > 1 ? 's' : ''} / slot{holes.length > 1 ? 's' : ''} (bolt, insert or strap holes, not storage)</summary>
                          {holes.map((c) => (
                            <div key={c.id} className="flex flex-wrap items-center gap-x-2 pt-0.5">
                              <Badge variant="outline" className="text-[10px]">{c.id}</Badge>
                              <span className="font-mono">{c.inscribed.size.map((v) => v.toFixed(1)).join(' × ')} mm</span>
                            </div>
                          ))}
                        </details>
                      )}
                      {p.internal_space?.accuracy_note && <div className="text-[10px] text-muted-foreground">{p.internal_space.accuracy_note}</div>}
                      {sc && (sc.checked.length > 0 || sc.skipped.length > 0) && (
                        <div className="text-[11px] space-y-0.5 pt-1 border-t border-border/20">
                          {sc.checked.length > 0 && <div><span className="text-muted-foreground">Checked here: </span>{sc.checked.map((c) => `${c.name}${c.qty > 1 ? ` ×${c.qty}` : ''}`).join(', ')}</div>}
                          {sc.skipped.length > 0 && <div className="text-muted-foreground">Not packed: {sc.skipped.map((c) => `${c.name} (${c.reason})`).join('; ')}</div>}
                        </div>
                      )}
                      {pk && !pk.fits && (
                        <div className="text-red-400">
                          {pk.required_inner_size_mm ? <>Needs about {pk.required_inner_size_mm.map((v) => v.toFixed(1)).join(' × ')} mm inside. </> : null}
                          {pk.largest_measured_box_mm ? <>Largest measured box is {pk.largest_measured_box_mm.map((v) => v.toFixed(1)).join(' × ')} mm. </> : null}
                          Enlarge the cavity and regenerate this part, or move components to another part.
                        </div>
                      )}
                    </div>
                  );
                })}
              </TabsContent>
              <TabsContent value="mates" className="space-y-2 text-xs">
                {result.mates.map((m) => {
                  const hw = result.hardware.filter((h) => h.joint === m.id);
                  return (
                    <div key={m.id} className="rounded border border-border/30 p-2 space-y-0.5">
                      <div className="flex items-center gap-2 font-medium">
                        {m.status === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />}
                        {nameOf(m.parent)} ↔ {nameOf(m.child)}
                      </div>
                      <div className="text-muted-foreground">{m.type === 'coaxial' ? 'pin / bore' : 'face to face'} · {m.a_feature} to {m.b_feature}</div>
                      {m.pairs && m.pairs.length > 0 && <div>{m.pairs.length} holes line up (worst {m.registration_residual_mm} mm)</div>}
                      {m.fit && <div>fit: {m.fit.kind} (hole {m.fit.hole_mm} mm, pin {m.fit.pin_mm} mm)</div>}
                      {hw.length > 0 && <div className="text-primary">{hardwareWords(hw)}</div>}
                    </div>
                  );
                })}
                {autoJoints.map((j) => {
                  const hw = autoHardware.filter((h) => h.joint === j);
                  return (
                    <div key={j} className="rounded border border-primary/30 p-2 space-y-0.5">
                      <div className="flex items-center gap-2 font-medium"><Wrench className="w-3.5 h-3.5 text-primary" />{nameOf(hw[0].parts?.[0] ?? '')} ↔ {nameOf(hw[0].parts?.[1] ?? '')}</div>
                      <div className="text-primary">{hardwareWords(hw)}</div>
                      <div className="text-muted-foreground">Added automatically: the holes of these two parts line up, but the plan had no screws for them.</div>
                    </div>
                  );
                })}
                {result.plan && <div className="text-[10px] text-muted-foreground">Mates proposed by the model and checked by the solver in {result.plan.attempts.length} round(s).</div>}
              </TabsContent>
              <TabsContent value="bom" className="space-y-1 text-xs">
                {result.bom.map((r, i) => (
                  <div key={i} className="flex justify-between border-b border-border/20 py-1">
                    <span>{r.name}</span><span className="font-mono">× {r.qty}</span>
                  </div>
                ))}
                {result.hardware.length === 0 && <div className="text-muted-foreground pt-2">No bolts: these parts connect without hardware, or no holes line up between them.</div>}
              </TabsContent>
              <TabsContent value="checks" className="space-y-2 text-xs">
                {result.interference_checked === false
                  ? <div className="text-yellow-400 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" /> The overlap check could not run for every part (see below), so this is not a "no overlap" result.</div>
                  : result.interference.length === 0
                    ? <div className="text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> No parts overlap.</div>
                    : null}
                {result.interference.map((x, i) => (
                  <div key={i} className="text-red-400 flex items-start gap-1"><XCircle className="w-3.5 h-3.5 shrink-0" />{nameOf(x.a)} overlaps {nameOf(x.b)} by {x.volume_mm3} mm³</div>))}
                {result.clearances.map((c, i) => <div key={i} className="text-muted-foreground">{nameOf(c.a)} to {nameOf(c.b)}: closest gap {c.min_gap_mm} mm</div>)}
                {result.warnings.map((w, i) => <div key={i} className="text-yellow-400 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{w}</div>)}
                {result.step_error && <div className="text-muted-foreground">STEP export: {result.step_error}</div>}
              </TabsContent>
              <TabsContent value="vision" className="space-y-2 text-xs">
                <p className="text-muted-foreground">After every build the assembly is rendered from a few angles and a vision model compares what it sees with the measured data.</p>
                {visionBusy && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Looking at the assembly…</div>}
                {!visionBusy && !vision && <div className="text-muted-foreground">Not checked yet.</div>}
                {vision && !visionBusy && (
                  <div className="space-y-2">
                    <div className={`flex items-start gap-1 font-medium ${vision.verdict === 'ok' ? 'text-green-400' : vision.verdict === 'issues' ? 'text-red-400' : 'text-yellow-400'}`}>
                      {vision.verdict === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : vision.verdict === 'issues' ? <XCircle className="w-3.5 h-3.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 shrink-0" />}
                      {vision.verdict === 'ok' ? 'Looks right' : vision.verdict === 'issues' ? 'Problems seen' : vision.verdict === 'unclear' ? 'Could not tell' : 'Check did not run'}
                    </div>
                    {vision.summary && <div>{vision.summary}</div>}
                    {vision.issues.map((it, i) => (
                      <div key={i} className="rounded border border-border/30 p-2 space-y-0.5">
                        <div className="flex items-center gap-2"><Badge variant="outline" className="text-[10px]">{it.severity}</Badge><span className="font-medium">{it.part}</span></div>
                        <div>{it.what}</div>
                        {it.fix && <div className="text-muted-foreground">Fix: {it.fix}</div>}
                      </div>
                    ))}
                    <div className="text-[10px] text-muted-foreground">{vision.model ? `${vision.model} · ` : ''}{new Date(vision.checked_at).toLocaleString()}</div>
                  </div>
                )}
                <Button size="sm" variant="outline" disabled={visionBusy || busy} onClick={() => result && doVision(result, macroId)} className="gap-2">
                  <ScanEye className="w-3.5 h-3.5" /> Look again
                </Button>
              </TabsContent>
              <TabsContent value="balance">
                <BalancePanel analysis={balance} busy={balanceBusy} error={result.balance_error ?? balanceError} canRecompute={!!result.balance_inputs}
                  vehicle={vehicle} onVehicle={(v) => { setVehicle(v); void recomputeBalance({ vehicle: v }); }}
                  layout={layout} onLayout={(l) => { setLayout(l); void recomputeBalance({ layout: l }); }}
                  printFill={printFill} onPrintFill={(f) => { setPrintFill(f); void recomputeBalance({ printFill: f }); }}
                  showMarkers={view.showBalance} onShowMarkers={(b) => setView({ ...view, showBalance: b })}
                  onGenerateArms={generateArms} armsBusy={armsBusy} />
                <div className="mt-3">
                  <FlightPanel balance={balance} vehicle={vehicle} result={flight} onResult={setFlight}
                    inventory={electronics.map((e) => ({ name: e.component_name, dims_text: e.dimensions ?? '', qty: e.quantity ?? 1 }))} />
                </div>
              </TabsContent>
              <TabsContent value="skin">
                <SkinPanel result={result} report={skin} onReport={(r) => setSkin(r)} />
              </TabsContent>
              <TabsContent value="aero">
                <AeroPanel massG={balance?.mass.total_g ?? null}
                  lengthMm={Math.max(...result.assembly_bbox.max.map((m, i) => m - result.assembly_bbox.min[i]))}
                  widthMm={Math.min(...result.assembly_bbox.max.map((m, i) => m - result.assembly_bbox.min[i]))}
                  onAddParts={addParts} onResult={setAero} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
      <CrankshaftDialog open={crankOpen} onOpenChange={setCrankOpen} onAddParts={addParts} />
    </div>
  );
}
