import { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, Center, Grid } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;

const MATERIALS = [
  { value: 'aluminum_6061', label: 'Aluminum 6061' },
  { value: 'steel_1045', label: 'Steel 1045' },
  { value: 'abs_plastic', label: 'ABS Plastic' },
  { value: 'titanium_grade5', label: 'Titanium Grade 5' },
];

interface HistoryEntry {
  iteration: number;
  stage: 'analyzed' | 'execution_failed' | 'analysis_failed';
  passed?: boolean;
  health_score?: number;
  reasons?: string[];
  metrics?: Record<string, unknown>;
  error?: string;
  script?: string;
}

interface Refinement {
  iterations_used: number;
  max_iterations: number;
  best_iteration: number;
  passed_quality_gate: boolean;
  final_reasons: string[];
  history: HistoryEntry[];
}

interface GenerateResponse {
  generated_stl_base64: string;
  generated_script: string;
  refinement: Refinement;
}

function STLMesh({ url }: { url: string }) {
  const geometry = useLoader(STLLoader, url);
  useMemo(() => {
    geometry.computeVertexNormals();
    geometry.center();
  }, [geometry]);
  return (
    <Center>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#b0b0b8" metalness={0.35} roughness={0.45} />
      </mesh>
    </Center>
  );
}

function base64ToObjectUrl(b64: string) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
}

export default function MVPPage() {
  const [prompt, setPrompt] = useState('');
  const [material, setMaterial] = useState('aluminum_6061');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [stlUrl, setStlUrl] = useState<string | null>(null);

  useEffect(() => () => { if (stlUrl) URL.revokeObjectURL(stlUrl); }, [stlUrl]);

  const handleGenerate = async () => {
    if (!prompt.trim()) { toast.error('Enter a prompt first.'); return; }
    if (!BACKEND_URL) { toast.error('VITE_BACKEND_URL is not set.'); return; }

    setLoading(true);
    try {
      const form = new FormData();
      form.append('prompt', prompt);
      form.append('material', material);
      form.append('max_iterations', '6');

      const res = await fetch(`${BACKEND_URL}/generate-validate-refine`, {
        method: 'POST',
        body: form,
      });

      const text = await res.text();
      if (!res.ok) {
        let message = text;
        try {
          const parsed = JSON.parse(text);
          message = parsed.detail ?? parsed.error ?? parsed.message ?? text;
        } catch { /* keep raw text */ }
        throw new Error(typeof message === 'string' ? message : JSON.stringify(message));
      }

      const data: GenerateResponse = JSON.parse(text);
      console.log('generate-validate-refine response:', data);

      setResult(data);
      if (stlUrl) URL.revokeObjectURL(stlUrl);
      setStlUrl(data.generated_stl_base64 ? base64ToObjectUrl(data.generated_stl_base64) : null);
      toast.success('Generation complete.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const refinement = result?.refinement;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold font-display text-gradient">MVP Generator</h1>
        <p className="text-sm text-muted-foreground">
          Generate, validate and self-refine a part. Each loop runs server-side.
        </p>
      </header>

      <section className="rounded-xl border border-border/40 p-5 space-y-4" style={{ background: '#111111' }}>
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the part you want to generate..."
          rows={4}
          disabled={loading}
        />
        <div className="flex flex-col sm:flex-row gap-3">
          <Select value={material} onValueChange={setMaterial} disabled={loading}>
            <SelectTrigger className="sm:w-64"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MATERIALS.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={handleGenerate} disabled={loading} className="sm:w-48">
            {loading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Generating...</>) : 'Generate'}
          </Button>
        </div>
        {loading && (
          <p className="text-xs text-muted-foreground">
            Running self-correction loops (AI + FEA). This can take a few minutes.
          </p>
        )}
      </section>

      {refinement && (
        <section className="rounded-xl border border-border/40 p-5 space-y-3" style={{ background: '#111111' }}>
          <h2 className="text-lg font-semibold">Self-Correction Loops</h2>
          <div className="space-y-2">
            {refinement.history.map((h, i) => {
              const failed = h.stage !== 'analyzed';
              return (
                <div
                  key={`${h.iteration}-${i}`}
                  className={`rounded-lg border p-3 ${failed ? 'border-destructive/50 bg-destructive/10' : 'border-border/40 bg-secondary/20'}`}
                >
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-sm font-medium">Iteration {h.iteration}</span>
                    {failed ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">
                        {h.stage.replace('_', ' ')}
                      </span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span
                          className="text-sm font-mono"
                          title="Derived from internal design health score, not a literal simulation error bound"
                        >
                          Error: {100 - (h.health_score ?? 0)}%
                        </span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${h.passed ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
                          {h.passed ? 'PASS' : 'FAIL'}
                        </span>
                      </div>
                    )}
                  </div>
                  {failed && h.error && (
                    <p className="mt-2 text-xs text-destructive whitespace-pre-wrap break-words">{h.error}</p>
                  )}
                  {!failed && h.reasons && h.reasons.length > 0 && (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground list-disc pl-5">
                      {h.reasons.map((r, ri) => <li key={ri}>{r}</li>)}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          <div className="pt-3 border-t border-border/30 space-y-1">
            <p className="text-sm">
              Quality gate:{' '}
              <span className={refinement.passed_quality_gate ? 'text-green-400' : 'text-amber-400'}>
                {refinement.passed_quality_gate ? 'PASSED' : 'NOT PASSED'}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              Iterations used: {refinement.iterations_used} / {refinement.max_iterations}
              {typeof refinement.best_iteration === 'number' && ` · best iteration: ${refinement.best_iteration}`}
            </p>
            {refinement.final_reasons?.length > 0 && (
              <ul className="text-xs text-muted-foreground list-disc pl-5 pt-1">
                {refinement.final_reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            )}
          </div>
        </section>
      )}

      {stlUrl && (
        <section className="rounded-xl border border-border/40 overflow-hidden" style={{ background: '#111111' }}>
          <div className="px-5 py-3 border-b border-border/30 flex items-center justify-between">
            <h2 className="text-lg font-semibold">3D Preview</h2>
            <a href={stlUrl} download="lumexa-part.stl" className="text-xs text-primary hover:underline">
              Download STL
            </a>
          </div>
          <div className="h-[480px]">
            <Canvas camera={{ position: [80, 60, 80], fov: 45 }}>
              <ambientLight intensity={0.6} />
              <directionalLight position={[50, 80, 50]} intensity={1.1} />
              <directionalLight position={[-50, -30, -50]} intensity={0.4} />
              <Suspense fallback={null}>
                <STLMesh url={stlUrl} />
              </Suspense>
              <Grid infiniteGrid cellSize={10} sectionSize={50} fadeDistance={400} sectionColor="#333" cellColor="#222" />
              <OrbitControls makeDefault enableDamping />
            </Canvas>
          </div>
        </section>
      )}
    </div>
  );
}
