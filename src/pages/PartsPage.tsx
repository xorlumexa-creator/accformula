import { Suspense, useEffect, useMemo, useState } from 'react';
import AdSenseBanner from '@/components/AdSenseBanner';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Canvas, useLoader } from '@react-three/fiber';
import { OrbitControls, Center, Grid } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { toast } from 'sonner';
import {
  Box, CheckCircle2, Circle, ArrowRight, DollarSign, Boxes, Loader2, Download, ChevronDown, ChevronUp, AlertTriangle, RefreshCw
} from 'lucide-react';
import { submitAndPollJob } from '@/lib/backendJob';
import { uploadPartStl, getPartStlSignedUrl } from '@/lib/partStlStorage';
import { callDesignGenerator, briefFromProject } from '@/lib/designGenerator';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL as string | undefined;

// A MACRO part is a mechanical sub-assembly (e.g. "Arms", "Landing Gear") generated up front
// with the project plan. Its individual manufacturable MICRO parts (Part, below) are only
// generated on demand, the first time the user opens that assembly — see handleExpandMacro.
// This is what keeps every single design-generator call small and focused instead of asking
// the LLM for an entire 25-40 part project (with full reasoning for every one of them) at once.
interface MacroPart {
  id: string; name: string; purpose?: string | null; subsystem?: string | null;
  status: 'pending' | 'generating' | 'generated' | 'error';
  micro_parts_error?: string | null; sort_order: number;
}

interface Part {
  id: string; part_name: string; material: string; manufacturing_method: string;
  estimated_cost: number; complexity: string; dimensions: string; status: string; sort_order: number;
  purpose?: string; subsystem?: string; macro_part_id?: string | null;
  // stl_base64 is legacy (read-only fallback for parts saved before Storage was used, see
  // partStlStorage.ts); every new generation writes stl_storage_path instead.
  stl_base64?: string | null; stl_storage_path?: string | null;
  stl_quality_passed?: boolean | null; stl_iterations_used?: number | null;
}

interface Electronic {
  id: string; component_name: string; model_recommendation: string;
  where_to_buy: string; price: number; quantity: number; purpose: string;
  dimensions: string; status: string; sort_order: number;
}

const statusColors: Record<string, string> = {
  'Not Started': 'border-border/30 text-muted-foreground',
  'In Design': 'border-blue-500/30 text-blue-400',
  'Analysed': 'border-yellow-500/30 text-yellow-400',
  'Fixed': 'border-orange-500/30 text-orange-400',
  'Complete': 'border-green-500/30 text-green-400',
  'Not Purchased': 'border-border/30 text-muted-foreground',
  'Purchased': 'border-green-500/30 text-green-400',
  'Installed': 'border-primary/30 text-primary',
};

// Maps the free-text material string our AI generates (e.g. "6061 Aluminum",
// "ABS plastic") onto the fixed enum the STL-generation backend accepts.
function normalizeMaterial(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (s.includes('titanium')) return 'titanium_grade5';
  if (s.includes('steel')) return 'steel_1045';
  if (s.includes('abs') || s.includes('plastic') || s.includes('pla') || s.includes('nylon') || s.includes('petg') || s.includes('polymer')) return 'abs_plastic';
  return 'aluminum_6061';
}

function buildStlPrompt(part: Part, project: any): string {
  return `Design a single mechanical CAD part: "${part.part_name}"

PROJECT CONTEXT: This part belongs to "${project?.project_name || 'a hardware project'}" — ${project?.description || project?.purpose || 'no further project description available'}.
SUBSYSTEM: ${part.subsystem || 'general structure'}
FUNCTION / PURPOSE: ${part.purpose || 'structural component of the assembly — infer a sensible function from its name and subsystem'}
DIMENSIONS (overall bounding envelope): ${part.dimensions || 'infer reasonable dimensions for a part of this type and function within the stated project'}
MATERIAL: ${part.material || 'infer an appropriate material for this part’s function'}
MANUFACTURING METHOD: ${part.manufacturing_method || 'CNC machining or 3D printing, whichever suits this part'}
COMPLEXITY LEVEL: ${part.complexity || 'Beginner'}

DESIGN REQUIREMENTS — this is what makes the geometry actually correct, not just the right size:
- Generate ONLY this single part — not an assembly, not other parts, not a scene.
- The geometry must genuinely reflect its stated FUNCTION and SUBSYSTEM role. A "motor mount bracket" must actually look and function like a motor mount — a real bolt-pattern hole layout, correct standoff height, adequate wall thickness for the load it carries — not a generic block with the right outer dimensions. A bracket, panel, standoff, or enclosure piece should have the features an equivalent real part would have: mounting holes or slots where it attaches to neighboring parts, fillets or chamfers where mechanically sensible, ribbing if it needs stiffness without excess material.
- Respect the given dimensions as the part's overall bounding envelope unless they are clearly incompatible with its stated function, in which case adjust minimally.
- Wall thickness and feature sizing must suit the manufacturing method (e.g. roughly 2-3mm minimum walls for 3D-printed plastic; thinner sections are fine for CNC-machined metal).
- The part must be immediately manufacturable by the stated method: no floating disconnected geometry, no non-manifold edges, sensible build/machining orientation.`;
}

// Asks the stl-prompt-generator edge function (runs on a separate Groq key from the
// main planning call, GROQ_API_KEY_2) to further sharpen this part's prompt — catching
// cases where its function/subsystem/dimensions are still thin even after the template
// above fills in the gaps. Falls back to buildStlPrompt's output if that call fails for
// any reason, so STL generation never hard-blocks on this enrichment step.
async function buildEnrichedStlPrompt(part: Part, project: any): Promise<string> {
  const fallback = buildStlPrompt(part, project);
  try {
    const { data, error } = await supabase.functions.invoke('stl-prompt-generator', {
      body: {
        part: {
          partName: part.part_name,
          purpose: part.purpose,
          subsystem: part.subsystem,
          dimensions: part.dimensions,
          material: part.material,
          manufacturingMethod: part.manufacturing_method,
          complexity: part.complexity,
        },
        project: {
          projectName: project?.project_name,
          projectDescription: project?.description || project?.purpose,
        },
        fallbackPrompt: fallback,
      },
    });
    if (error || !data?.prompt) return fallback;
    return data.prompt as string;
  } catch {
    return fallback;
  }
}

function base64ToObjectUrl(b64: string) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
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

// Electronics are stored as project-wide (not scoped to any one macro assembly) — this maps
// the DB row shape back to the camelCase shape design-generator's prompts expect, matching
// what it originally returned before enrichment.
function electronicsForPrompt(electronics: Electronic[]) {
  return electronics.map(e => ({
    componentName: e.component_name,
    modelRecommendation: e.model_recommendation,
    whereToBuy: e.where_to_buy,
    price: e.price,
    quantity: e.quantity,
    purpose: e.purpose,
    dimensions: e.dimensions,
  }));
}

export default function PartsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'body' | 'electronics'>('body');
  const [macroParts, setMacroParts] = useState<MacroPart[]>([]);
  const [partsByMacro, setPartsByMacro] = useState<Record<string, Part[]>>({});
  const [legacyParts, setLegacyParts] = useState<Part[]>([]); // ungrouped parts from before this hierarchy existed
  const [electronics, setElectronics] = useState<Electronic[]>([]);
  const [project, setProject] = useState<any>(null);

  const [expandedMacroId, setExpandedMacroId] = useState<string | null>(null);
  const [macroLoading, setMacroLoading] = useState<Record<string, boolean>>({});

  const [stlLoading, setStlLoading] = useState<Record<string, boolean>>({});
  const [stlElapsed, setStlElapsed] = useState<Record<string, number>>({});
  const [stlUrls, setStlUrls] = useState<Record<string, string>>({});
  const [previewLoading, setPreviewLoading] = useState<Record<string, boolean>>({});
  const [expandedPartId, setExpandedPartId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  // Revoke blob URLs on unmount to avoid leaking memory
  useEffect(() => () => {
    Object.values(stlUrls).forEach(url => URL.revokeObjectURL(url));
  }, []);

  const loadData = async () => {
    if (!user) return;
    const { data: projects } = await supabase.from('projects')
      .select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1);

    if (!projects?.[0]) { navigate('/project-plan'); return; }
    setProject(projects[0]);

    // Only the (small) macro assembly list loads up front — individual parts are fetched
    // lazily per assembly in handleExpandMacro, whether that means generating them for the
    // first time or just loading ones already generated in an earlier session.
    const { data: macroData } = await supabase.from('project_macro_parts')
      .select('*').eq('project_id', projects[0].id).order('sort_order', { ascending: true });
    if (macroData) setMacroParts(macroData as MacroPart[]);

    // Defensive: a project created before this macro/micro hierarchy existed has its parts
    // with no macro_part_id at all. Load and show those directly so nothing that was already
    // generated silently disappears from view.
    const { data: legacyData } = await supabase.from('project_parts')
      .select('*').eq('project_id', projects[0].id).is('macro_part_id', null).order('sort_order', { ascending: true });
    if (legacyData?.length) setLegacyParts(legacyData as Part[]);

    const { data: elecData } = await supabase.from('project_electronics')
      .select('*').eq('project_id', projects[0].id).order('sort_order', { ascending: true });
    if (elecData) setElectronics(elecData as Electronic[]);
  };

  const toggleElectronicStatus = async (id: string, current: string) => {
    const next = current === 'Not Purchased' ? 'Purchased' : current === 'Purchased' ? 'Installed' : 'Not Purchased';
    await supabase.from('project_electronics').update({ status: next }).eq('id', id);
    setElectronics(prev => prev.map(e => e.id === id ? { ...e, status: next } : e));
  };

  // Expands (or collapses) a macro assembly. The first time an assembly is opened:
  //  - if its micro parts were already generated in an earlier session, just fetch them
  //  - otherwise, generate them now (one focused design-generator call scoped to just this
  //    assembly), save them, and mark the assembly 'generated' so this never re-runs for it.
  const handleExpandMacro = async (macro: MacroPart) => {
    if (expandedMacroId === macro.id) { setExpandedMacroId(null); return; }
    setExpandedMacroId(macro.id);
    if (partsByMacro[macro.id] || macroLoading[macro.id]) return;

    if (macro.status === 'generated') {
      const { data, error } = await supabase.from('project_parts')
        .select('*').eq('macro_part_id', macro.id).order('sort_order', { ascending: true });
      if (error) { toast.error('Could not load parts for this assembly.'); return; }
      setPartsByMacro(prev => ({ ...prev, [macro.id]: (data as Part[]) || [] }));
      return;
    }

    await generateMicroParts(macro);
  };

  const generateMicroParts = async (macro: MacroPart) => {
    if (!user || !project) return;
    setMacroLoading(prev => ({ ...prev, [macro.id]: true }));
    setMacroParts(prev => prev.map(m => m.id === macro.id ? { ...m, status: 'generating', micro_parts_error: null } : m));
    await supabase.from('project_macro_parts').update({ status: 'generating', micro_parts_error: null }).eq('id', macro.id);

    try {
      const result = await callDesignGenerator('generate_micro_parts', {
        briefData: briefFromProject(project),
        macroPart: { name: macro.name, purpose: macro.purpose, subsystem: macro.subsystem },
        electronics: electronicsForPrompt(electronics),
      });

      const rawParts: any[] = Array.isArray(result?.parts) ? result.parts : [];
      if (!rawParts.length) throw new Error('No parts were returned for this assembly.');

      const toInsert = rawParts.map((p, i) => ({
        project_id: project.id,
        user_id: user.id,
        macro_part_id: macro.id,
        part_name: p.partName || p.part_name || `Part ${i + 1}`,
        material: p.material || '',
        manufacturing_method: p.manufacturingMethod || '',
        estimated_cost: p.estimatedCostUSD || p.estimatedCost || 0,
        complexity: p.complexity || 'Beginner',
        dimensions: p.dimensions || '',
        purpose: p.purpose || '',
        subsystem: macro.subsystem || '',
        sort_order: i,
      }));
      const { data: inserted, error } = await supabase.from('project_parts').insert(toInsert).select('*');
      if (error) throw error;

      setPartsByMacro(prev => ({ ...prev, [macro.id]: (inserted as Part[]) || [] }));
      setMacroParts(prev => prev.map(m => m.id === macro.id ? { ...m, status: 'generated' } : m));
      await supabase.from('project_macro_parts').update({ status: 'generated' }).eq('id', macro.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setMacroParts(prev => prev.map(m => m.id === macro.id ? { ...m, status: 'error', micro_parts_error: msg } : m));
      await supabase.from('project_macro_parts').update({ status: 'error', micro_parts_error: msg }).eq('id', macro.id);
      toast.error(`Could not generate parts for "${macro.name}": ${msg}`);
    } finally {
      setMacroLoading(prev => ({ ...prev, [macro.id]: false }));
    }
  };

  // Updates one part everywhere it's cached client-side (it lives under exactly one macro
  // group, or in the legacy ungrouped list).
  const patchPart = (partId: string, macroPartId: string | null | undefined, patch: Partial<Part>) => {
    if (macroPartId) {
      setPartsByMacro(prev => {
        const list = prev[macroPartId];
        if (!list) return prev;
        return { ...prev, [macroPartId]: list.map(p => p.id === partId ? { ...p, ...patch } : p) };
      });
    } else {
      setLegacyParts(prev => prev.map(p => p.id === partId ? { ...p, ...patch } : p));
    }
  };

  // Used right after a fresh generation, where we already have the base64 payload in memory
  // (no need to round-trip it through Storage just to preview what we just uploaded).
  const showStlFromBase64 = (part: Part, base64: string) => {
    setStlUrls(prev => {
      if (prev[part.id]) URL.revokeObjectURL(prev[part.id]);
      return { ...prev, [part.id]: base64ToObjectUrl(base64) };
    });
    setExpandedPartId(part.id);
  };

  // Expands a part's preview panel, resolving its STL from wherever it actually lives:
  // a signed Storage URL for anything generated after the Storage migration, or the legacy
  // base64 column for anything generated before it.
  const toggleExpandPart = async (part: Part, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (expandedPartId === part.id) { setExpandedPartId(null); return; }

    if (!stlUrls[part.id]) {
      if (part.stl_storage_path) {
        setPreviewLoading(prev => ({ ...prev, [part.id]: true }));
        try {
          const filename = `${part.part_name.replace(/\s+/g, '-').toLowerCase()}.stl`;
          const url = await getPartStlSignedUrl(part.stl_storage_path, { downloadFilename: filename });
          setStlUrls(prev => ({ ...prev, [part.id]: url }));
        } catch (err) {
          toast.error(err instanceof Error ? err.message : 'Could not load the STL preview.');
          return;
        } finally {
          setPreviewLoading(prev => ({ ...prev, [part.id]: false }));
        }
      } else if (part.stl_base64) {
        showStlFromBase64(part, part.stl_base64);
      }
    }
    setExpandedPartId(part.id);
  };

  const handleGenerateStl = async (part: Part, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!BACKEND_URL) { toast.error('STL backend is not configured (VITE_BACKEND_URL missing).'); return; }
    if (!user) return;
    if (stlLoading[part.id]) return;

    setStlLoading(prev => ({ ...prev, [part.id]: true }));
    setStlElapsed(prev => ({ ...prev, [part.id]: 0 }));
    setExpandedPartId(part.id);

    try {
      const enrichedPrompt = await buildEnrichedStlPrompt(part, project);

      const form = new FormData();
      form.append('prompt', enrichedPrompt);
      form.append('material', normalizeMaterial(part.material));
      form.append('max_iterations', '3');

      // Submit-and-poll instead of one long fetch: each refinement iteration can run a
      // multi-minute SimScale FEA solve, and the backend's single worker needs to stay free
      // to answer these polls while that runs in the background. See lib/backendJob.ts.
      const data = await submitAndPollJob(BACKEND_URL, form, {
        onTick: ({ elapsedSeconds }) => setStlElapsed(prev => ({ ...prev, [part.id]: elapsedSeconds })),
      });

      const passed = !!data.refinement?.passed_quality_gate;
      const iterations = data.refinement?.iterations_used ?? null;
      const stlBase64 = data.generated_stl_base64 as string;
      if (!stlBase64) throw new Error('Backend did not return an STL.');

      // Store the file in Supabase Storage rather than the stl_base64 column — see
      // lib/partStlStorage.ts for why. New rows never write stl_base64 at all.
      const storagePath = await uploadPartStl(user.id, part.id, stlBase64);

      await supabase.from('project_parts').update({
        stl_storage_path: storagePath,
        stl_quality_passed: passed,
        stl_iterations_used: iterations,
      }).eq('id', part.id);

      patchPart(part.id, part.macro_part_id, { stl_storage_path: storagePath, stl_quality_passed: passed, stl_iterations_used: iterations });

      // We already have the bytes in memory from this generation — preview them directly
      // rather than immediately re-fetching the file we just uploaded via a signed URL.
      showStlFromBase64(part, stlBase64);
      toast.success(passed ? 'STL generated — passed quality checks.' : 'STL generated, but flagged in review — check the preview.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setStlLoading(prev => ({ ...prev, [part.id]: false }));
    }
  };

  // One micro part's card: material/cost/dimensions, Generate STL, preview + download.
  // Identical UI/behavior to the original flat parts list — just rendered nested under its
  // macro assembly (or in the legacy ungrouped section) instead of at the top level.
  const renderPartCard = (part: Part) => {
    const isExpanded = expandedPartId === part.id;
    const isLoading = !!stlLoading[part.id];
    const isPreviewLoading = !!previewLoading[part.id];
    const hasStl = !!part.stl_base64 || !!part.stl_storage_path;
    const url = stlUrls[part.id];
    return (
      <div key={part.id} className="rounded-lg border border-border/20 overflow-hidden" style={{ background: '#0d0d0d' }}>
        <Link to={`/design-guide/${part.id}`}
          className="flex items-center gap-3 p-4 hover:border-primary/20 transition-all">
          <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 border border-border/20" style={{ background: '#0a0a0a' }}>
            <Box className="w-5 h-5 text-muted-foreground/30" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-medium text-sm">{part.part_name}</h3>
              <Badge variant="outline" className={statusColors[part.status] || ''}>
                {part.status}
              </Badge>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>{part.material}</span>
              <span>{part.manufacturing_method}</span>
              <span className="text-primary">${part.estimated_cost}</span>
              <ArrowRight className="w-3 h-3 ml-auto text-primary" />
            </div>
            {part.dimensions && (
              <p className="text-xs text-muted-foreground/70 mt-1">📐 {part.dimensions}</p>
            )}
            {part.purpose && (
              <p className="text-xs text-muted-foreground/60 mt-0.5">{part.purpose}</p>
            )}
          </div>
        </Link>

        <div className="flex items-center gap-2 px-4 pb-3">
          <Button
            size="sm"
            variant={hasStl ? 'outline' : 'default'}
            className="text-xs h-8"
            disabled={isLoading}
            onClick={(e) => handleGenerateStl(part, e)}
          >
            {isLoading ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Generating...</>
            ) : (
              <><Boxes className="w-3.5 h-3.5 mr-1.5" />{hasStl ? 'Regenerate STL' : 'Generate STL'}</>
            )}
          </Button>
          {hasStl && !isLoading && (
            <Button size="sm" variant="ghost" className="text-xs h-8" disabled={isPreviewLoading}
              onClick={(e) => toggleExpandPart(part, e)}>
              {isPreviewLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                : isExpanded ? <ChevronUp className="w-3.5 h-3.5 mr-1" /> : <ChevronDown className="w-3.5 h-3.5 mr-1" />}
              {isPreviewLoading ? 'Loading...' : isExpanded ? 'Hide preview' : 'Show preview'}
            </Button>
          )}
          {hasStl && (
            <Badge variant="outline" className={part.stl_quality_passed ? 'border-green-500/30 text-green-400 ml-auto' : 'border-amber-500/30 text-amber-400 ml-auto'}>
              {part.stl_quality_passed ? 'Quality gate passed' : 'Flagged for review'}
            </Badge>
          )}
        </div>

        {isLoading && (
          <p className="px-4 pb-3 text-xs text-muted-foreground">
            Running self-correction loops (AI + FEA). This can take a few minutes.
            {stlElapsed[part.id] > 0 && ` (${Math.floor(stlElapsed[part.id] / 60)}m ${stlElapsed[part.id] % 60}s elapsed)`}
          </p>
        )}

        {isExpanded && url && !isLoading && (
          <div className="border-t border-border/30">
            <div className="px-4 py-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>{part.stl_iterations_used != null ? `${part.stl_iterations_used} refinement iteration(s) used` : ''}</span>
              <a href={url} download={`${part.part_name.replace(/\s+/g, '-').toLowerCase()}.stl`} className="text-primary hover:underline flex items-center gap-1">
                <Download className="w-3.5 h-3.5" /> Download STL
              </a>
            </div>
            <div className="h-[320px]">
              <Canvas camera={{ position: [80, 60, 80], fov: 45 }}>
                <ambientLight intensity={0.6} />
                <directionalLight position={[50, 80, 50]} intensity={1.1} />
                <directionalLight position={[-50, -30, -50]} intensity={0.4} />
                <Suspense fallback={null}>
                  <STLMesh url={url} />
                </Suspense>
                <Grid infiniteGrid cellSize={10} sectionSize={50} fadeDistance={400} sectionColor="#333" cellColor="#222" />
                <OrbitControls makeDefault enableDamping />
              </Canvas>
            </div>
          </div>
        )}
      </div>
    );
  };

  const allLoadedParts = [...Object.values(partsByMacro).flat(), ...legacyParts];
  const bodyTotal = allLoadedParts.reduce((s, p) => s + (p.estimated_cost || 0), 0);
  const elecTotal = electronics.reduce((s, e) => s + (e.price || 0) * (e.quantity || 1), 0);
  const grandTotal = bodyTotal + elecTotal;
  const budgetNum = parseFloat(project?.budget_range?.replace(/[^0-9.]/g, '') || '0');
  const anyMacroUngenerated = macroParts.some(m => m.status !== 'generated');

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Box className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Parts & Materials</h1>
          <p className="text-sm text-muted-foreground">{project?.project_name}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setActiveTab('body')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'body' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground'}`}>
          Body Parts ({macroParts.length} {macroParts.length === 1 ? 'assembly' : 'assemblies'})
        </button>
        <button onClick={() => setActiveTab('electronics')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'electronics' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground'}`}>
          Electronics ({electronics.length})
        </button>
      </div>

      {activeTab === 'body' && (
        <div className="space-y-2">
          {macroParts.map(macro => {
            const isOpen = expandedMacroId === macro.id;
            const isGenerating = !!macroLoading[macro.id] || macro.status === 'generating';
            const microParts = partsByMacro[macro.id];
            return (
              <div key={macro.id} className="rounded-lg border border-border/30 overflow-hidden" style={{ background: '#111111' }}>
                <button
                  onClick={() => handleExpandMacro(macro)}
                  className="w-full flex items-center gap-3 p-4 text-left hover:border-primary/20 transition-all"
                >
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border border-border/20" style={{ background: '#0a0a0a' }}>
                    {isGenerating ? <Loader2 className="w-4 h-4 text-primary animate-spin" /> : <Boxes className="w-4 h-4 text-primary" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold text-sm">{macro.name}</h3>
                      {macro.status === 'generated' && microParts && (
                        <Badge variant="outline" className="border-border/30 text-muted-foreground text-xs">
                          {microParts.length} {microParts.length === 1 ? 'part' : 'parts'}
                        </Badge>
                      )}
                      {macro.status === 'pending' && !isGenerating && (
                        <Badge variant="outline" className="border-border/30 text-muted-foreground/70 text-xs">Tap to generate</Badge>
                      )}
                      {macro.status === 'error' && (
                        <Badge variant="outline" className="border-destructive/40 text-destructive text-xs">
                          <AlertTriangle className="w-3 h-3 mr-1" /> Failed
                        </Badge>
                      )}
                    </div>
                    {macro.purpose && <p className="text-xs text-muted-foreground/70 mt-0.5">{macro.purpose}</p>}
                  </div>
                  {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </button>

                {isOpen && (
                  <div className="border-t border-border/20 p-3 space-y-2">
                    {isGenerating && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                        <Loader2 className="w-4 h-4 animate-spin" /> Generating parts for "{macro.name}"...
                      </div>
                    )}
                    {!isGenerating && macro.status === 'error' && (
                      <div className="text-center py-6 space-y-2">
                        <p className="text-sm text-destructive flex items-center justify-center gap-1.5">
                          <AlertTriangle className="w-4 h-4" /> {macro.micro_parts_error || 'Something went wrong generating these parts.'}
                        </p>
                        <Button size="sm" variant="outline" onClick={() => generateMicroParts(macro)}>
                          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Retry
                        </Button>
                      </div>
                    )}
                    {!isGenerating && microParts?.map(renderPartCard)}
                    {!isGenerating && microParts?.length === 0 && (
                      <p className="text-center text-sm text-muted-foreground py-6">No parts were generated for this assembly.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {legacyParts.length > 0 && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground/60 px-1 pb-2">Other parts</p>
              <div className="space-y-2">{legacyParts.map(renderPartCard)}</div>
            </div>
          )}

          {macroParts.length === 0 && legacyParts.length === 0 && (
            <p className="text-center text-muted-foreground py-12">No assemblies generated yet.</p>
          )}
        </div>
      )}

      {activeTab === 'electronics' && (
        <div className="space-y-2">
          {electronics.map(e => (
            <button key={e.id} onClick={() => toggleElectronicStatus(e.id, e.status)}
              className="w-full text-left p-4 rounded-lg border border-border/20 hover:border-primary/20 transition-all"
              style={{ background: '#111111' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium">{e.component_name}</h3>
                <Badge variant="outline" className={statusColors[e.status] || ''}>
                  {e.status === 'Not Purchased' ? <Circle className="w-3 h-3 mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                  {e.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-1">{e.model_recommendation}</p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {e.where_to_buy && <span>{e.where_to_buy}</span>}
                <span className="text-primary">${e.price} × {e.quantity}</span>
                <span>{e.purpose}</span>
              </div>
              {e.dimensions && (
                <p className="text-xs text-muted-foreground/70 mt-1">📐 {e.dimensions}</p>
              )}
            </button>
          ))}
          {electronics.length === 0 && (
            <p className="text-center text-muted-foreground py-12">No electronics generated yet.</p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border/30 p-4" style={{ background: '#111111' }}>
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-primary" /> Budget Tracker
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Body Parts</span>
            <span>${bodyTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Electronics</span>
            <span>${elecTotal.toFixed(2)}</span>
          </div>
          <div className="border-t border-border/20 pt-2 flex justify-between font-bold">
            <span>Total</span>
            <span className={grandTotal > budgetNum && budgetNum > 0 ? 'text-destructive' : 'text-primary'}>
              ${grandTotal.toFixed(2)}
              {budgetNum > 0 && <span className="text-xs text-muted-foreground font-normal ml-1">/ ${budgetNum}</span>}
            </span>
          </div>
        </div>
        {budgetNum > 0 && (
          <Progress value={Math.min((grandTotal / budgetNum) * 100, 100)} className="h-1.5 mt-3" />
        )}
        {anyMacroUngenerated && (
          <p className="text-xs text-muted-foreground/60 mt-2">Body Parts total updates as you open each assembly below.</p>
        )}
      </div>
      <AdSenseBanner />
    </div>
  );
}
