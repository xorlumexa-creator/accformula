import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { AlertTriangle, CheckCircle2, CircleHelp, Download, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AssemblyResult } from '@/lib/assemblyApi';
import { saveBlob } from '@/lib/exportDesign';
import { Capacity, DesignGraphResponse, SkinReport, checkSkin, fetchCapacity, fetchDesignGraph, fetchSkinScript } from '@/lib/lumexaTools';

interface Props {
  result: AssemblyResult;
  report: SkinReport | null;
  onReport: (r: SkinReport | null, geometryHash: string) => void;
}

const num = (s: string, d: number) => (Number.isFinite(parseFloat(s)) ? parseFloat(s) : d);

export default function SkinPanel({ result, report, onReport }: Props) {
  const [graph, setGraph] = useState<DesignGraphResponse | null>(null);
  const [cap, setCap] = useState<Capacity | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [f, setF] = useState({ wall: '2', margin: '3', minWall: '1.2' });
  const file = useRef<HTMLInputElement>(null);

  // the interfaces come from the engineering geometry: reread them whenever the assembly changes (no meshes are sent, only placements)
  useEffect(() => {
    let alive = true;
    const light = { ...result, step_base64: undefined, parts: result.parts.map((p) => ({ ...p, stl_base64: undefined })) };
    fetchDesignGraph(light).then((g) => { if (alive) { setGraph(g); setError(''); } }).catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); });
    fetchCapacity().then((c) => { if (alive) setCap(c); }).catch(() => { /* older backend: no limits to show */ });
    return () => { alive = false; };
  }, [result]);

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const stale = !!report && !!graph && report.record.validated_against !== graph.geometry_hash;

  const script = async () => {
    if (!graph) return;
    setBusy(true); setError('');
    try {
      const s = await fetchSkinScript({ interfaces: graph.graph.interfaces, wall_mm: num(f.wall, 2), margin_mm: num(f.margin, 3), max_tris: cap ? Math.round(cap.max_skin_triangles / 3) : 40000 });
      saveBlob(new Blob([s.script], { type: 'text/x-python' }), s.filename);
      toast.success('Saved. On a PC: blender -b -P lumexa_skin.py -- skin.stl');
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const fl = e.target.files?.[0];
    e.target.value = '';
    if (!fl || !graph) return;
    setError('');
    if (cap) {                                          // refuse before uploading what a 4 GB tablet cannot take
      const mb = fl.size / 1048576;
      const tris = Math.max(0, Math.floor((fl.size - 84) / 50));
      if (mb > cap.max_upload_mb) { setError(`That file is ${mb.toFixed(0)} MB; this backend accepts up to ${cap.max_upload_mb} MB. Decimate it in Blender (the generated script does) and export again.`); return; }
      if (tris > cap.max_skin_triangles) { setError(`About ${tris.toLocaleString()} triangles; this backend checks up to ${cap.max_skin_triangles.toLocaleString()}. Add a Decimate modifier with ratio ${(cap.max_skin_triangles * 0.8 / tris).toFixed(2)} and export again.`); return; }
    }
    setBusy(true);
    try {
      onReport(await checkSkin(fl, graph.graph.interfaces, graph.geometry_hash, { min_wall_mm: num(f.minWall, 1.2) }), graph.geometry_hash);
    } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setBusy(false); }
  };

  const counts = graph?.counts ?? {};
  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">
        Two representations of one product. The <b>skeleton</b> (build123d / OpenCASCADE, exact) is what gets analysed. The <b>skin</b> (a Blender mesh: organic shape,
        fairings, looks) is never turned back into CAD. They meet at interfaces read from this assembly, and a skin is checked against them.
      </p>
      {cap && (
        <div className="text-[10px] text-muted-foreground">
          This backend: {cap.name} memory profile{cap.mem_available_mb !== null ? `, ${cap.mem_available_mb} MB free` : ''}; skins up to {cap.max_skin_triangles.toLocaleString()} triangles / {cap.max_upload_mb} MB.
          {cap.assembly_busy ? ' It is busy with a heavy job right now.' : ''}
        </div>
      )}
      {!graph && !error && <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Reading the interfaces…</div>}
      {graph && (
        <div className="rounded border border-border/30 p-2 space-y-0.5">
          <div className="font-medium">Interfaces the skin must respect</div>
          <div>{counts.component ?? 0} components to keep enclosed with clearance · {counts.motor ?? 0} motors and props to keep free · {counts.fastener ?? 0} screw access paths</div>
          <details>
            <summary className="cursor-pointer text-muted-foreground">List</summary>
            {graph.graph.interfaces.map((i) => <div key={i.id} className="font-mono">{i.id} <span className="text-muted-foreground">{i.mode ?? 'access'}{i.clearance_mm ? ` · ${i.clearance_mm} mm` : ''}</span></div>)}
          </details>
          <div className="text-[10px] text-muted-foreground">Geometry version {graph.geometry_hash}. {graph.graph.rule}</div>
        </div>
      )}
      <div className="grid grid-cols-3 gap-2">
        <label className="flex flex-col gap-0.5">Wall mm<Input className="h-8 text-xs" inputMode="decimal" value={f.wall} onChange={set('wall')} /></label>
        <label className="flex flex-col gap-0.5">Margin mm<Input className="h-8 text-xs" inputMode="decimal" value={f.margin} onChange={set('margin')} /></label>
        <label className="flex flex-col gap-0.5">Min wall check<Input className="h-8 text-xs" inputMode="decimal" value={f.minWall} onChange={set('minWall')} /></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1" onClick={script} disabled={busy || !graph || !(counts.component > 0)}><Download className="w-3.5 h-3.5" /> Blender script</Button>
        <Button size="sm" className="gap-1" onClick={() => file.current?.click()} disabled={busy || !graph}>{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />} Check a skin (.stl)</Button>
        <input ref={file} type="file" accept=".stl" className="hidden" onChange={pick} />
      </div>
      {!(counts.component > 0) && graph && <div className="text-muted-foreground">No components are packed inside a part yet, so there is nothing to build a skin around.</div>}
      {error && <div className="text-red-400 flex items-start gap-1"><AlertTriangle className="w-3.5 h-3.5 shrink-0" />{error}</div>}
      {report && (
        <div className="space-y-1 rounded border border-border/30 p-2">
          <div className={`font-medium flex items-center gap-1 ${report.verdict === 'pass' ? 'text-green-400' : report.verdict === 'fail' ? 'text-red-400' : 'text-yellow-400'}`}>
            {report.verdict === 'pass' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {report.verdict === 'pass' ? 'The skin respects the interfaces' : report.verdict === 'fail' ? 'The skin breaks the interfaces' : 'Could not confirm everything'}
          </div>
          {stale && <div className="text-yellow-400">The engineering geometry changed after this skin was checked. Check it again.</div>}
          <div className="text-muted-foreground">{report.quality.triangles.toLocaleString()} triangles · {report.quality.watertight ? 'closed' : 'NOT closed'} · {report.quality.fem_ready ? 'clean enough to mesh' : 'not ready for meshing'}</div>
          {report.checks.map((c, i) => (
            <div key={i} className="flex items-start gap-1">
              {c.ok === true ? <CheckCircle2 className="w-3.5 h-3.5 text-green-400 shrink-0 mt-0.5" /> : c.ok === false ? <AlertTriangle className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" /> : <CircleHelp className="w-3.5 h-3.5 text-yellow-400 shrink-0 mt-0.5" />}
              <span><b>{c.name}</b><span className="text-muted-foreground"> · {c.detail}</span></span>
            </div>
          ))}
          <div className="text-[10px] text-muted-foreground">{report.note}</div>
        </div>
      )}
    </div>
  );
}
