import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Loader2, Upload, Cpu, Box, ExternalLink, AlertTriangle, CheckCircle2, Zap,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

// Separate service from VITE_BACKEND_URL (the CAD/FEA generation backend) —
// this points at the lumexa-electronics service, which does real 3D
// component placement + wire routing against an uploaded CAD shell.
// Runs GPT-OSS-120B via Groq (AI_PROVIDER=groq in that service's env),
// matching the rest of the stack's model choice.
const ELECTRONICS_BACKEND_URL = import.meta.env.VITE_ELECTRONICS_BACKEND_URL as string | undefined;

// Keep in sync with component_library.py's NETLIST_TEMPLATES in the
// lumexa-electronics repo — these are the only device_type values with a
// deterministic wiring template; anything else forces the agent to wire
// everything manually.
const DEVICE_TYPES = [
  { value: 'quadcopter_4motor', label: 'Quadcopter (4 motor)' },
];

interface MvpComponent {
  instance_id: string;
  label: string;
  color_rgba: number[];
  component_id: string;
  category: string;
  name: string;
  mass_g: number;
}

interface MvpConnection {
  key: string;
  label: string;
  from: string;
  to: string;
  wire_category: string;
  color_rgba: number[];
  status: string;
  length_mm: number;
  reason: string | null;
}

interface MvpManifest {
  device_type: string;
  finalized: boolean;
  final_summary: string | null;
  confidence_notes: string | null;
  total_mass_g: number;
  components: MvpComponent[];
  connections: MvpConnection[];
}

interface MvpResponse {
  design_id: string;
  stopped_reason: string;
  mesh_watertight: boolean;
  manifest: MvpManifest;
  tool_trace: { step: number; tool: string; result_status: string }[];
  scene_glb_url?: string;
  manifest_url?: string;
  viewer_url?: string;
  scene_export_error?: string;
}

function rgba(c: number[]) {
  return `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})`;
}

const views = ['Top View', 'Bottom View', 'Front View', 'Back View', 'Left View', 'Right View'];

export default function ICWirePage() {
  const { user } = useAuth();
  const [images, setImages] = useState<(string | null)[]>(Array(6).fill(null));
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState('');
  const [project, setProject] = useState<any>(null);
  const [electronics, setElectronics] = useState<any[]>([]);

  // --- Real 3D MVP (lumexa-electronics backend) state ---
  const [mvpFile, setMvpFile] = useState<File | null>(null);
  const [mvpDeviceType, setMvpDeviceType] = useState(DEVICE_TYPES[0].value);
  const [mvpRequirements, setMvpRequirements] = useState('');
  const [mvpLoading, setMvpLoading] = useState(false);
  const [mvpResult, setMvpResult] = useState<MvpResponse | null>(null);

  const runMvpAnalysis = async () => {
    if (!mvpFile) { toast.error('Upload a 3D CAD file (.stl) first.'); return; }
    if (!ELECTRONICS_BACKEND_URL) {
      toast.error('VITE_ELECTRONICS_BACKEND_URL is not set — see README for how to deploy and configure it.');
      return;
    }

    setMvpLoading(true);
    setMvpResult(null);
    try {
      const form = new FormData();
      form.append('cad_file', mvpFile);
      form.append('device_type', mvpDeviceType);
      form.append('requirements', mvpRequirements);
      form.append('max_iterations', '6');

      const res = await fetch(`${ELECTRONICS_BACKEND_URL}/design-electronics`, {
        method: 'POST',
        body: form,
      });

      const text = await res.text();
      if (!res.ok) {
        let message = text;
        try {
          const parsed = JSON.parse(text);
          message = parsed.detail ?? parsed.error ?? text;
        } catch { /* keep raw text */ }
        throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
      }

      const data: MvpResponse = JSON.parse(text);
      console.log('design-electronics response:', data);
      setMvpResult(data);

      if (!data.mesh_watertight) {
        toast.warning('CAD shell was not fully watertight — treat placement/routing results with caution.');
      } else {
        toast.success(`Design ${data.stopped_reason === 'finalized' ? 'finalized' : `stopped (${data.stopped_reason})`}.`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setMvpLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    loadProjectData();
  }, [user]);

  const loadProjectData = async () => {
    if (!user) return;
    const { data: proj } = await supabase.from('projects').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1);
    if (proj?.[0]) {
      setProject(proj[0]);
      const { data: elec } = await supabase.from('project_electronics').select('*').eq('project_id', proj[0].id);
      if (elec) setElectronics(elec);
    }
  };

  const handleUpload = (index: number, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setImages(prev => prev.map((img, i) => i === index ? url : img));
    };
    reader.readAsDataURL(file);
  };

  const uploadedCount = images.filter(Boolean).length;
  const uploadedViews = views.filter((_, i) => images[i]);

  const analyze = async () => {
    if (uploadedCount < 2) { toast.error('Upload at least 2 views'); return; }
    setAnalyzing(true);
    setResult('');

    try {
      const electronicsContext = electronics.map(e =>
        `${e.component_name} (${e.model_recommendation}) — ${e.purpose}`
      ).join('\n');

      const viewDescriptions = views.map((v, i) => images[i] ? `${v}: Uploaded ✓` : `${v}: Not provided`).join('\n');

      const systemPrompt = `You are Lumexa's IC & Wiring Integration specialist. The user has uploaded CAD screenshots from multiple angles of their assembled design.

PROJECT: ${project?.project_name || 'Unknown'}
DESCRIPTION: ${project?.description || 'Not provided'}

ELECTRONICS TO INTEGRATE:
${electronicsContext || 'Not specified'}

UPLOADED VIEWS:
${viewDescriptions}

Based on the uploaded views and electronics list, generate a comprehensive wiring and IC placement guide:

1. **Component Placement Map** — Exact location of each electronic component inside the assembly
2. **Wire Routing Paths** — Optimal paths for wires between components
3. **Connection Diagram** — Which pins connect to which (text-based pinout schematic)
4. **Clearance Warnings** — Any potential issues with component placement or wire routing
5. **Assembly Sequence** — Numbered order to install each electronic component
6. **Heat Management** — Where components generate heat and ventilation paths

Use clear numbered steps. Include specific measurements where relevant.
Never use LaTeX. Use Unicode symbols only.
Format with markdown headers and bullet points.`;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Analyze my assembly views and generate IC integration guide. I have ${uploadedCount} views uploaded: ${uploadedViews.join(', ')}.` }],
          systemOverride: systemPrompt,
        }),
      });

      if (!resp.ok) throw new Error('Analysis failed');

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let full = '', buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n')) !== -1) {
          let line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const json = line.slice(6).trim();
          if (json === '[DONE]') break;
          try {
            const p = JSON.parse(json);
            const c = p.choices?.[0]?.delta?.content;
            if (c) { full += c; setResult(full); }
          } catch {}
        }
      }
    } catch {
      toast.error('Analysis failed. Please try again.');
    }
    setAnalyzing(false);
  };

  return (
    <div className="space-y-6 animate-slide-up max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Cpu className="w-6 h-6 text-primary" /> IC & Wire Integration</h1>
        <p className="text-sm text-muted-foreground mt-1">Upload assembly views for AI-generated wiring guide</p>
      </div>

      {/* ── MVP: real 3D placement engine (lumexa-electronics backend) ── */}
      <div className="rounded-xl border border-primary/30 p-5 space-y-4" style={{ background: '#111111' }}>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Zap className="w-5 h-5 text-primary" /> MVP: Real 3D Placement Engine
          </h2>
          <Badge variant="outline" className="text-primary border-primary/40">Beta</Badge>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          Give it your actual CAD shell (.stl). It picks real components, places them with real
          collision checks against the shell's interior, and routes every wire through actual
          pathfinding — not a text guess. Separate from the quick 2D estimate below.
        </p>

        <label className="cursor-pointer block">
          <div className={`rounded-lg border-2 border-dashed p-6 text-center transition-all ${
            mvpFile ? 'border-primary/50' : 'border-border/30 hover:border-primary/30'
          }`} style={{ background: '#0a0a0a' }}>
            <Box className="w-7 h-7 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm">{mvpFile ? mvpFile.name : 'Click to upload your CAD shell (.stl)'}</p>
          </div>
          <input type="file" accept=".stl,.obj,.glb,.gltf" className="hidden"
            onChange={e => e.target.files?.[0] && setMvpFile(e.target.files[0])} />
        </label>

        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={mvpDeviceType} onValueChange={setMvpDeviceType} disabled={mvpLoading}>
            <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEVICE_TYPES.map(d => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Textarea
          value={mvpRequirements}
          onChange={e => setMvpRequirements(e.target.value)}
          placeholder="Requirements (optional) — e.g. 500g AUW, GPS return-to-home, analog FPV, 20min flight time"
          rows={2}
          disabled={mvpLoading}
        />

        <Button onClick={runMvpAnalysis} disabled={mvpLoading || !mvpFile} className="w-full gap-2">
          {mvpLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Placing components & routing wires...</>
                      : <><Zap className="w-4 h-4" /> Run MVP Analysis</>}
        </Button>
        {mvpLoading && (
          <p className="text-xs text-muted-foreground">
            This runs a real agent loop against your CAD file — can take a minute or two, especially on
            a cold-started free-tier backend.
          </p>
        )}

        {mvpResult && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={mvpResult.stopped_reason === 'finalized' ? 'default' : 'secondary'}>
                {mvpResult.stopped_reason}
              </Badge>
              {!mvpResult.mesh_watertight && (
                <Badge variant="destructive" className="gap-1">
                  <AlertTriangle className="w-3 h-3" /> mesh not watertight — verify results
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {mvpResult.manifest.total_mass_g}g total · {mvpResult.manifest.components.length} components ·{' '}
                {mvpResult.manifest.connections.filter(c => c.status === 'routed').length}/
                {mvpResult.manifest.connections.length} wires routed
              </span>
            </div>

            {mvpResult.manifest.components.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Components</h3>
                <div className="space-y-1">
                  {mvpResult.manifest.components.map(c => (
                    <div key={c.instance_id} className="flex items-center gap-2 text-xs rounded-lg border border-border/30 px-3 py-2">
                      <span className="w-5 h-5 rounded flex items-center justify-center font-bold text-[10px] flex-shrink-0"
                        style={{ background: rgba(c.color_rgba), color: '#0b0d10' }}>{c.label}</span>
                      <span className="flex-1">{c.instance_id} <span className="text-muted-foreground">({c.name})</span></span>
                      <span className="text-muted-foreground">{c.mass_g}g</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mvpResult.manifest.connections.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold mb-2">Wires</h3>
                <div className="space-y-1">
                  {mvpResult.manifest.connections.map(c => (
                    <div key={c.key} className="flex items-center gap-2 text-xs rounded-lg border border-border/30 px-3 py-2">
                      <span className="w-3 h-3 rounded-full flex-shrink-0 border border-white/20" style={{ background: rgba(c.color_rgba) }} />
                      <span className="text-muted-foreground w-8 flex-shrink-0">{c.label}</span>
                      <span className="flex-1">{c.from} → {c.to}</span>
                      {c.status === 'routed'
                        ? <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> {c.length_mm}mm</span>
                        : <span className="text-xs text-destructive flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> unrouted</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {mvpResult.manifest.confidence_notes && (
              <div className="rounded-lg border border-border/30 p-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Agent's confidence notes: </span>
                {mvpResult.manifest.confidence_notes}
              </div>
            )}

            {mvpResult.viewer_url ? (
              <div className="rounded-xl border border-border/30 overflow-hidden">
                <div className="px-4 py-2 border-b border-border/30 flex items-center justify-between">
                  <span className="text-sm font-semibold">X-Ray 3D Viewer</span>
                  <a href={`${ELECTRONICS_BACKEND_URL}${mvpResult.viewer_url}`} target="_blank" rel="noreferrer"
                    className="text-xs text-primary hover:underline flex items-center gap-1">
                    Open in new tab <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
                <iframe
                  src={`${ELECTRONICS_BACKEND_URL}${mvpResult.viewer_url}`}
                  className="w-full h-[480px] border-0"
                  title="IC & wiring X-ray viewer"
                />
              </div>
            ) : mvpResult.scene_export_error ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
                3D scene failed to build: {mvpResult.scene_export_error}. The results above are still real —
                only the visualization is missing.
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ── Quick 2D estimate: screenshots + text-only guidance, no geometry engine ── */}
      <div className="rounded-xl border border-border/30 p-5" style={{ background: '#111111' }}>
        <h2 className="text-lg font-bold mb-1">Quick 2D Estimate</h2>
        <p className="text-xs text-muted-foreground mb-4">
          Faster, no real collision/routing checks — describes a plausible layout from screenshots only.
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {views.map((view, i) => (
            <label key={view} className="cursor-pointer">
              <div className={`aspect-square rounded-lg border-2 border-dashed flex flex-col items-center justify-center transition-all overflow-hidden ${images[i] ? 'border-primary/50' : 'border-border/30 hover:border-primary/30'}`}
                style={{ background: '#0a0a0a' }}>
                {images[i] ? (
                  <img src={images[i]!} alt={view} className="w-full h-full object-cover" />
                ) : (
                  <>
                    <Upload className="w-6 h-6 text-muted-foreground mb-1" />
                    <span className="text-xs text-muted-foreground">{view}</span>
                  </>
                )}
              </div>
              <input type="file" accept="image/*" className="hidden"
                onChange={e => e.target.files?.[0] && handleUpload(i, e.target.files[0])} />
            </label>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3">{uploadedCount}/6 views uploaded · Minimum 2 required</p>
      </div>

      <Button onClick={analyze} disabled={uploadedCount < 2 || analyzing} className="w-full gap-2">
        {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing...</> : <><Cpu className="w-4 h-4" /> Generate Wiring Guide</>}
      </Button>

      {result && (
        <div className="rounded-xl border border-border/30 p-5" style={{ background: '#111111' }}>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-primary" /> IC Integration Guide
          </h2>
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown>{result}</ReactMarkdown>
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Wiring guides are AI-generated guidance. Always verify connections before powering on.
      </p>
    </div>
  );
}
