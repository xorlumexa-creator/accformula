import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Download, Eye, Layers, Loader2, Wrench, XCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Slider } from '@/components/ui/slider';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AssemblyScene, { SceneOptions } from '@/components/AssemblyScene';
import { AssemblyResult, buildAssembly } from '@/lib/assemblyApi';
import { base64ToBlob, saveBlob } from '@/lib/exportDesign';

interface MacroRow { id: string; name: string; purpose?: string | null; sort_order: number }
interface PartRow {
  id: string; part_name: string; purpose?: string | null; material?: string | null; dimensions?: string | null;
  macro_part_id?: string | null; cad_script?: string | null;
  housed_components?: { component: string; quantity?: number }[] | null;
  mounting?: { method?: string; fastener?: string | null; connects_to?: string[] } | null;
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
interface ElectronicRow { id: string; component_name: string; dimensions?: string | null; quantity?: number | null }

const kindLabel: Record<string, string> = {
  enclosed: 'sealed void', pocket: 'open pocket', channel: 'channel / through-hole', trough: 'open trough',
};

export default function AssemblyStudioPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [macros, setMacros] = useState<MacroRow[]>([]);
  const [macroId, setMacroId] = useState('');
  const [parts, setParts] = useState<PartRow[]>([]);
  const [electronics, setElectronics] = useState<ElectronicRow[]>([]);
  const [housing, setHousing] = useState<Record<string, string[]>>({}); // part id -> electronic ids placed inside it
  const [result, setResult] = useState<AssemblyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState({
    xray: true, xrayOpacity: 0.16, explode: 0, showCavities: true, showComponents: true, showHardware: true,
    sectionOn: false, sectionAxis: 'z' as 'x' | 'y' | 'z', sectionFrac: 0.6,
  });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: projects } = await supabase.from('projects').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: false }).limit(1);
      if (!projects?.[0]) { navigate('/project-plan'); return; }
      const pid = projects[0].id;
      const [m, p, e] = await Promise.all([
        supabase.from('project_macro_parts').select('id,name,purpose,sort_order').eq('project_id', pid).order('sort_order'),
        supabase.from('project_parts').select('*').eq('project_id', pid).order('sort_order'),
        supabase.from('project_electronics').select('id,component_name,dimensions,quantity').eq('project_id', pid).order('sort_order'),
      ]);
      setMacros((m.data ?? []) as MacroRow[]);
      const loadedParts = (p.data ?? []) as unknown as PartRow[];
      const loadedElec = (e.data ?? []) as ElectronicRow[];
      setParts(loadedParts);
      setElectronics(loadedElec);
      // what the designer model said each part houses, matched to the verified electronics list
      const pre: Record<string, string[]> = {};
      loadedParts.forEach((part) => {
        const ids = (part.housed_components ?? []).map((h) => {
          const n = norm(h.component);
          return (loadedElec.find((x) => norm(x.component_name) === n)
            ?? loadedElec.find((x) => norm(x.component_name).includes(n) || n.includes(norm(x.component_name))))?.id;
        }).filter(Boolean) as string[];
        if (ids.length) pre[part.id] = [...new Set(ids)];
      });
      setHousing(pre);
      if (m.data?.[0]) setMacroId(m.data[0].id);
    })();
  }, [user, navigate]);

  const macroParts = useMemo(() => parts.filter((p) => p.macro_part_id === macroId), [parts, macroId]);
  const ready = macroParts.filter((p) => !!p.cad_script);
  const selectedPart = result?.parts.find((p) => p.id === selected) ?? null;

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

  const build = async () => {
    setError(''); setResult(null); setSelected(null);
    if (ready.length < 2) { setError('Pick an assembly that has at least two parts generated with their CAD script saved.'); return; }
    const hints: Record<string, string> = {};
    const components: Record<string, { name: string; dims_text?: string; qty?: number }[]> = {};
    ready.forEach((p) => {
      const mt = p.mounting;
      const joins = (mt?.connects_to ?? []).join(', ');
      hints[p.id] = [p.purpose, p.material && `material ${p.material}`, p.dimensions && `dimensions ${p.dimensions}`,
        mt?.method && `attaches by ${mt.method}${mt.fastener ? ` (${mt.fastener})` : ''}`, joins && `connects to ${joins}`].filter(Boolean).join('; ');
      const inside = (housing[p.id] ?? []).map((id) => electronics.find((e) => e.id === id)).filter(Boolean) as ElectronicRow[];
      if (inside.length) components[p.id] = inside.map((e) => ({ name: e.component_name, dims_text: e.dimensions ?? '', qty: e.quantity ?? 1 }));
    });
    setBusy(true); setProgress('starting');
    try {
      const r = await buildAssembly(
        { parts: ready.map((p) => ({ id: p.id, name: p.part_name, script: p.cad_script as string })), hints, components },
        (t) => setProgress(`${t.stage ?? 'working'} ${t.seconds}s${t.memoryMb ? ` · server memory ${t.memoryMb} MB` : ''}`),
      );
      setResult(r);
      toast.success(r.ok ? 'Assembly built' : 'Assembly built, but parts collide');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg); toast.error(msg.slice(0, 160));
    } finally { setBusy(false); setProgress(''); }
  };

  const toggleHidden = (id: string) => setHidden((h) => { const n = new Set(h); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleHousing = (partId: string, elecId: string) =>
    setHousing((h) => { const cur = new Set(h[partId] ?? []); cur.has(elecId) ? cur.delete(elecId) : cur.add(elecId); return { ...h, [partId]: [...cur] }; });
  const nameOf = (id: string) => result?.parts.find((p) => p.id === id)?.name ?? id;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Layers className="w-5 h-5 text-primary" /> Assembly</h1>
          <p className="text-xs text-muted-foreground">Parts are placed by a solver from their real holes and faces. Internal space is measured on the actual geometry.</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-9 rounded-md border border-border bg-background px-2 text-sm" value={macroId}
            onChange={(e) => { setMacroId(e.target.value); setResult(null); }}>
            {macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <Button onClick={build} disabled={busy || ready.length < 2} className="gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />} Build assembly
          </Button>
          {result?.step_base64 && (
            <Button variant="outline" className="gap-2" onClick={() => saveBlob(base64ToBlob(result.step_base64 as string, 'model/step'), 'assembly.step')}>
              <Download className="w-4 h-4" /> STEP
            </Button>
          )}
        </div>
      </div>
      {busy && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> {progress}</div>}
      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 text-red-300 text-sm p-3 flex gap-2"><XCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}

      <div className="grid lg:grid-cols-[300px_1fr_360px] gap-4">
        {/* parts + what lives inside them */}
        <div className="rounded-lg border border-border/40 p-3 space-y-3 max-h-[78vh] overflow-y-auto">
          <div className="text-sm font-medium">Parts in this assembly</div>
          {macroParts.length === 0 && <div className="text-xs text-muted-foreground">No parts yet. Generate them on <Link className="underline" to="/parts">Parts & Materials</Link>.</div>}
          {macroParts.map((p) => {
            const rp = result?.parts.find((x) => x.id === p.id);
            const cav = rp?.internal_space?.cavities ?? [];
            const pk = result?.packing?.[p.id];
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
                    <span className="text-muted-foreground ml-auto">{cav.length ? `${cav.length} cavity${cav.length > 1 ? 'ies' : ''}` : 'solid'}</span>
                  </label>
                )}
                {electronics.length > 0 && p.cad_script && (
                  <details onClick={(e) => e.stopPropagation()}>
                    <summary className="cursor-pointer text-muted-foreground">Electronics inside ({(housing[p.id] ?? []).length})</summary>
                    <div className="mt-1 space-y-1">
                      {electronics.map((el) => (
                        <label key={el.id} className="flex items-start gap-2">
                          <Checkbox checked={(housing[p.id] ?? []).includes(el.id)} onCheckedChange={() => toggleHousing(p.id, el.id)} />
                          <span>{el.component_name}<span className="text-muted-foreground"> {el.dimensions ? `· ${el.dimensions}` : '· size unknown'}</span></span>
                        </label>
                      ))}
                    </div>
                  </details>
                )}
                {pk && (
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
            {result ? <AssemblyScene result={result} opts={opts} onSelect={setSelected} />
              : <div className="h-full grid place-items-center text-sm text-muted-foreground text-center px-6">
                  {busy ? 'Building…' : ready.length < 2 ? 'This assembly needs at least two generated parts with CAD scripts.' : 'Press "Build assembly".'}
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
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="space">Space</TabsTrigger><TabsTrigger value="mates">Mates</TabsTrigger>
                <TabsTrigger value="bom">BOM</TabsTrigger><TabsTrigger value="checks">Checks</TabsTrigger>
              </TabsList>
              <TabsContent value="space" className="space-y-3 text-xs">
                <p className="text-muted-foreground">Measured on the generated geometry (not estimated by a model). Boxes are the largest rectangular volume you can really use.</p>
                {(selectedPart ? [selectedPart] : result.parts).map((p) => (
                  <div key={p.id} className="rounded border border-border/30 p-2 space-y-1">
                    <div className="font-medium text-sm">{p.name}</div>
                    {(p.internal_space?.cavities ?? []).length === 0 && <div className="text-muted-foreground">No usable internal space (solid part).</div>}
                    {(p.internal_space?.cavities ?? []).map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center gap-x-2">
                        <Badge variant="outline" className="text-[10px]">{c.id}</Badge>
                        <span>{kindLabel[c.kind] ?? c.kind}</span>
                        <span className="font-mono">{c.inscribed.size.map((v) => v.toFixed(1)).join(' × ')} mm</span>
                        <span className="text-muted-foreground">{(c.volume_mm3 / 1000).toFixed(2)} cm³{c.openings.length ? ` · open ${c.openings.join(' ')}` : ''}</span>
                      </div>
                    ))}
                    {p.internal_space?.accuracy_note && <div className="text-[10px] text-muted-foreground">{p.internal_space.accuracy_note}</div>}
                    {result.packing?.[p.id] && !result.packing[p.id].fits && result.packing[p.id].required_inner_size_mm && (
                      <div className="text-red-400">Needs about {result.packing[p.id].required_inner_size_mm?.map((v) => v.toFixed(1)).join(' × ')} mm inside. Enlarge the cavity and regenerate this part.</div>
                    )}
                  </div>
                ))}
              </TabsContent>
              <TabsContent value="mates" className="space-y-2 text-xs">
                {result.mates.map((m) => (
                  <div key={m.id} className="rounded border border-border/30 p-2 space-y-0.5">
                    <div className="flex items-center gap-2 font-medium">
                      {m.status === 'ok' ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" />}
                      {nameOf(m.parent)} ↔ {nameOf(m.child)}
                    </div>
                    <div className="text-muted-foreground">{m.type === 'coaxial' ? 'pin / bore' : 'face to face'} · {m.a_feature} to {m.b_feature}</div>
                    {m.pairs && m.pairs.length > 0 && <div>{m.pairs.length} holes line up (worst {m.registration_residual_mm} mm)</div>}
                    {m.fit && <div>fit: {m.fit.kind} (hole {m.fit.hole_mm} mm, pin {m.fit.pin_mm} mm)</div>}
                  </div>
                ))}
                {result.plan && <div className="text-[10px] text-muted-foreground">Mates proposed by the model and checked by the solver in {result.plan.attempts.length} round(s).</div>}
              </TabsContent>
              <TabsContent value="bom" className="space-y-1 text-xs">
                {result.bom.map((r, i) => (
                  <div key={i} className="flex justify-between border-b border-border/20 py-1">
                    <span>{r.name}</span><span className="font-mono">× {r.qty}</span>
                  </div>
                ))}
                {result.hardware.length === 0 && <div className="text-muted-foreground pt-2">No bolts: these parts connect without hardware (or no fasteners were requested).</div>}
              </TabsContent>
              <TabsContent value="checks" className="space-y-2 text-xs">
                {result.interference.length === 0
                  ? <div className="text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> No parts overlap.</div>
                  : result.interference.map((x, i) => (
                    <div key={i} className="text-red-400 flex items-start gap-1"><XCircle className="w-3.5 h-3.5 shrink-0" />{nameOf(x.a)} overlaps {nameOf(x.b)} by {x.volume_mm3} mm³</div>))}
                {result.clearances.map((c, i) => <div key={i} className="text-muted-foreground">{nameOf(c.a)} to {nameOf(c.b)}: closest gap {c.min_gap_mm} mm</div>)}
                {result.warnings.map((w, i) => <div key={i} className="text-yellow-400 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{w}</div>)}
                {result.step_error && <div className="text-muted-foreground">STEP export: {result.step_error}</div>}
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}
