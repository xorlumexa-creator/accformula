import { useState, useRef, useCallback, useEffect, Suspense } from 'react';
import { Canvas, useThree, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Center, Html, Billboard, Grid } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import {
  Upload, Trash2, Eye, EyeOff, Maximize, RotateCcw, Box, Grid3x3,
  Loader2, Zap, Save, ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  RotateCw, ChevronUp, ChevronDown, Crosshair, Star, Download,
  Link2, Scale, Shield, Wrench, AlertTriangle,
} from 'lucide-react';

const PYTHON_API = 'https://1d1141ef-3925-4e14-84d3-439cca800d44-00-38kio9wyr2lpc.sisko.replit.dev:8000/analyze-part';
const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const PART_COLORS = ['#ff4444', '#4488ff', '#44ff88', '#ffaa00', '#aa44ff', '#ff44aa'];
const VIEWER_FORMATS = ['stl', 'obj', 'gltf', 'glb'];

interface PartGeometry {
  dimensions_mm: { x: number; y: number; z: number };
  volume_mm3: number;
  center_of_gravity: { x: number; y: number; z: number };
  is_watertight: boolean;
  vertex_count: number;
  face_count: number;
}

interface AssemblyPart {
  id: string;
  file: File;
  url: string;
  fileType: string;
  name: string;
  color: string;
  visible: boolean;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  geometry?: PartGeometry;
  geometrySource: 'python' | 'estimated';
  estimatedDims?: { x: number; y: number; z: number };
}

interface AssemblyAnnotation {
  id: number;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  zone: string;
  position_hint: string;
  title: string;
  problem: string;
  solution: string;
  color: string;
}

interface AnalysisResult {
  content: string;
  annotations: AssemblyAnnotation[];
  score: number;
  metrics: {
    jointCompatibility: number;
    weightBalance: number;
    structuralRating: number;
    modificationDifficulty: string;
  };
}

type ViewMode = 'solid' | 'wireframe' | 'xray';

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

/* ─── Python API call ─── */
async function fetchPythonGeometry(file: File): Promise<PartGeometry | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const formData = new FormData();
    formData.append('file', file);
    const resp = await fetch(PYTHON_API, { method: 'POST', body: formData, signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/* ─── Three.js estimated dimensions ─── */
function estimateDimensions(geometry: THREE.BufferGeometry): { x: number; y: number; z: number } {
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox!;
  return {
    x: +(bbox.max.x - bbox.min.x).toFixed(2),
    y: +(bbox.max.y - bbox.min.y).toFixed(2),
    z: +(bbox.max.z - bbox.min.z).toFixed(2),
  };
}

/* ─── 3D Part Model Components ─── */
function PartSTL({ url, color, viewMode, isSelected, onBoundsReady }: {
  url: string; color: string; viewMode: ViewMode; isSelected: boolean;
  onBoundsReady?: (dims: { x: number; y: number; z: number }) => void;
}) {
  const geometry = useLoader(STLLoader, url);
  const meshRef = useRef<THREE.Mesh>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    if (readyRef.current || !onBoundsReady) return;
    geometry.computeVertexNormals();
    const dims = estimateDimensions(geometry);
    onBoundsReady(dims);
    readyRef.current = true;
  }, [geometry, onBoundsReady]);

  const mat = getPartMaterial(color, viewMode, isSelected);
  return <mesh ref={meshRef} geometry={geometry} material={mat} castShadow receiveShadow />;
}

function PartOBJ({ url, color, viewMode, isSelected }: { url: string; color: string; viewMode: ViewMode; isSelected: boolean }) {
  const obj = useLoader(OBJLoader, url);
  const mat = getPartMaterial(color, viewMode, isSelected);
  useEffect(() => {
    obj.traverse((child: any) => { if (child.isMesh) { child.material = mat; child.castShadow = true; } });
  }, [obj, mat]);
  return <primitive object={obj} />;
}

function PartGLTF({ url, color, viewMode, isSelected }: { url: string; color: string; viewMode: ViewMode; isSelected: boolean }) {
  const gltf = useLoader(GLTFLoader, url);
  const mat = getPartMaterial(color, viewMode, isSelected);
  useEffect(() => {
    gltf.scene.traverse((child: any) => { if (child.isMesh && viewMode !== 'solid') { child.material = mat; } });
  }, [gltf, viewMode, mat]);
  return <primitive object={gltf.scene} />;
}

function getPartMaterial(color: string, viewMode: ViewMode, isSelected: boolean): THREE.Material {
  const c = new THREE.Color(color);
  switch (viewMode) {
    case 'wireframe':
      return new THREE.MeshStandardMaterial({ color: c, wireframe: true, roughness: 0.5 });
    case 'xray':
      return new THREE.MeshPhysicalMaterial({ color: c, transparent: true, opacity: 0.3, roughness: 0.2, metalness: 0.5, side: THREE.DoubleSide });
    default:
      return new THREE.MeshStandardMaterial({
        color: c, roughness: 0.35, metalness: 0.65,
        emissive: isSelected ? c : new THREE.Color(0x000000),
        emissiveIntensity: isSelected ? 0.15 : 0,
      });
  }
}

/* ─── Auto fit camera ─── */
function AutoFit({ orbitRef }: { orbitRef: React.RefObject<any> }) {
  const { scene, camera } = useThree();
  const fitted = useRef(false);
  useEffect(() => {
    const t = setTimeout(() => {
      if (fitted.current) return;
      const box = new THREE.Box3().setFromObject(scene);
      if (box.isEmpty()) return;
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());
      const dist = Math.max(size.x, size.y, size.z) * 2.5;
      camera.position.set(center.x + dist * 0.6, center.y + dist * 0.4, center.z + dist * 0.6);
      if (orbitRef.current) { orbitRef.current.target.copy(center); orbitRef.current.update(); }
      fitted.current = true;
    }, 500);
    return () => clearTimeout(t);
  }, [scene, camera, orbitRef]);
  return null;
}

/* ─── Assembly Scene ─── */
function AssemblyScene({ parts, viewMode, selectedId, orbitRef, onEstimatedDims }: {
  parts: AssemblyPart[]; viewMode: ViewMode; selectedId: string | null;
  orbitRef: React.RefObject<any>;
  onEstimatedDims: (partId: string, dims: { x: number; y: number; z: number }) => void;
}) {
  return (
    <>
      <ambientLight intensity={0.3} />
      <directionalLight position={[5, 8, 3]} intensity={1.2} castShadow color="#ffffff" />
      <directionalLight position={[-6, 4, -2]} intensity={0.5} color="#f0f0ff" />
      <directionalLight position={[0, 2, -8]} intensity={0.3} color="#8888ff" />

      {parts.filter(p => p.visible).map(part => (
        <group key={part.id} position={[part.position.x, part.position.y, part.position.z]}
          rotation={[part.rotation.x * Math.PI / 180, part.rotation.y * Math.PI / 180, part.rotation.z * Math.PI / 180]}>
          <Suspense fallback={<Html center><Loader2 className="w-4 h-4 animate-spin text-primary" /></Html>}>
            {part.fileType === 'stl' && (
              <PartSTL url={part.url} color={part.color} viewMode={viewMode} isSelected={selectedId === part.id}
                onBoundsReady={(dims) => onEstimatedDims(part.id, dims)} />
            )}
            {part.fileType === 'obj' && <PartOBJ url={part.url} color={part.color} viewMode={viewMode} isSelected={selectedId === part.id} />}
            {(part.fileType === 'gltf' || part.fileType === 'glb') && <PartGLTF url={part.url} color={part.color} viewMode={viewMode} isSelected={selectedId === part.id} />}
          </Suspense>
        </group>
      ))}

      <Grid infiniteGrid cellSize={0.5} sectionSize={2} cellColor="#330000" sectionColor="#440000" fadeDistance={50} position={[0, -0.01, 0]} />
      <OrbitControls ref={orbitRef} makeDefault enableDamping dampingFactor={0.08} minDistance={0.001} maxDistance={10000} zoomSpeed={3} rotateSpeed={0.8} panSpeed={1.5} />
      <AutoFit orbitRef={orbitRef} />
    </>
  );
}

/* ─── Loading Messages ─── */
const LOADING_MSGS = [
  'Connecting to geometry engine...',
  'Extracting real dimensions...',
  'Calculating joint compatibility...',
  'Analyzing stress distribution...',
  'Computing screw specifications...',
  'Generating engineering report...',
  'Finalizing assessment...',
];

/* ─── Community parts placeholder ─── */
const COMMUNITY_PARTS = [
  { name: 'M8 Hex Bolt', rating: 4.5, downloads: 1240 },
  { name: 'Bearing Housing', rating: 4.8, downloads: 890 },
  { name: 'Motor Mount Bracket', rating: 4.2, downloads: 2100 },
  { name: 'Servo Horn 25T', rating: 4.6, downloads: 560 },
  { name: 'T-Slot Bracket', rating: 4.3, downloads: 1780 },
  { name: 'Wheel Hub Adapter', rating: 4.7, downloads: 930 },
];

/* ─── Main Page ─── */
export default function AssemblyBuilderPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [parts, setParts] = useState<AssemblyPart[]>([]);
  const [selectedPart, setSelectedPart] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('solid');
  const [analyzing, setAnalyzing] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [backendOffline, setBackendOffline] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const orbitRef = useRef<any>(null);

  // Loading messages cycle
  useEffect(() => {
    if (!analyzing) return;
    let i = 0;
    setLoadingMsg(LOADING_MSGS[0]);
    setLoadingProgress(0);
    const interval = setInterval(() => {
      i = (i + 1) % LOADING_MSGS.length;
      setLoadingMsg(LOADING_MSGS[i]);
      setLoadingProgress(prev => Math.min(95, prev + 12));
    }, 2000);
    return () => clearInterval(interval);
  }, [analyzing]);

  const getFileExt = (name: string) => name.split('.').pop()?.toLowerCase() || '';

  const handleUpload = useCallback(async (file: File) => {
    const ext = getFileExt(file.name);
    if (!VIEWER_FORMATS.includes(ext)) {
      toast({ title: 'Unsupported format', description: 'Please upload STL, OBJ, GLTF or GLB.', variant: 'destructive' });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: 'File exceeds 50MB limit', variant: 'destructive' });
      return;
    }

    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    const color = PART_COLORS[parts.length % PART_COLORS.length];

    const newPart: AssemblyPart = {
      id, file, url, fileType: ext, name: file.name, color, visible: true,
      position: { x: parts.length * 2, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      geometrySource: 'estimated',
    };
    setParts(prev => [...prev, newPart]);
    setSelectedPart(id);

    // Fetch Python geometry in background
    const geo = await fetchPythonGeometry(file);
    if (geo) {
      setParts(prev => prev.map(p => p.id === id ? { ...p, geometry: geo, geometrySource: 'python' as const } : p));
    } else {
      setBackendOffline(true);
    }
  }, [parts.length, toast]);

  const handleEstimatedDims = useCallback((partId: string, dims: { x: number; y: number; z: number }) => {
    setParts(prev => prev.map(p => p.id === partId ? { ...p, estimatedDims: dims } : p));
  }, []);

  const removePart = (id: string) => {
    setParts(prev => {
      const part = prev.find(p => p.id === id);
      if (part) URL.revokeObjectURL(part.url);
      return prev.filter(p => p.id !== id);
    });
    if (selectedPart === id) setSelectedPart(null);
  };

  const toggleVisibility = (id: string) => {
    setParts(prev => prev.map(p => p.id === id ? { ...p, visible: !p.visible } : p));
  };

  const movePart = (axis: 'x' | 'y' | 'z', delta: number) => {
    if (!selectedPart) return;
    const step = snapToGrid ? 5 : 1;
    setParts(prev => prev.map(p =>
      p.id === selectedPart ? { ...p, position: { ...p.position, [axis]: p.position[axis] + delta * step } } : p
    ));
  };

  const rotatePart = (axis: 'x' | 'y' | 'z', delta: number) => {
    if (!selectedPart) return;
    setParts(prev => prev.map(p =>
      p.id === selectedPart ? { ...p, rotation: { ...p.rotation, [axis]: p.rotation[axis] + delta } } : p
    ));
  };

  const getDims = (p: AssemblyPart) => {
    if (p.geometry) return p.geometry.dimensions_mm;
    if (p.estimatedDims) return p.estimatedDims;
    return { x: 0, y: 0, z: 0 };
  };

  const clearScene = () => {
    parts.forEach(p => URL.revokeObjectURL(p.url));
    setParts([]);
    setSelectedPart(null);
    setResult(null);
  };

  /* ─── Run Analysis ─── */
  const handleAnalyze = async () => {
    if (parts.length === 0) {
      toast({ title: 'Upload parts first', variant: 'destructive' });
      return;
    }
    setAnalyzing(true);
    setResult(null);

    try {
      const { data: projects } = await supabase
        .from('projects').select('*').eq('user_id', user!.id)
        .order('created_at', { ascending: false }).limit(1);
      const project = projects?.[0];

      // Build part data strings
      const partDataStr = parts.map(p => {
        const dims = getDims(p);
        const geo = p.geometry;
        return `Part: ${p.name}
Real Dimensions: ${dims.x.toFixed(1)}mm x ${dims.y.toFixed(1)}mm x ${dims.z.toFixed(1)}mm ${p.geometrySource === 'python' ? '(from Python API)' : '(estimated)'}
${geo ? `Real Volume: ${geo.volume_mm3.toFixed(1)}mm3
Real Center of Gravity: X:${geo.center_of_gravity.x.toFixed(2)} Y:${geo.center_of_gravity.y.toFixed(2)} Z:${geo.center_of_gravity.z.toFixed(2)}mm
Mesh Quality: ${geo.is_watertight ? 'Watertight' : 'Has open boundaries'}
Vertices: ${geo.vertex_count} Faces: ${geo.face_count}` : `Estimated Volume: ${(dims.x * dims.y * dims.z).toFixed(1)}mm3`}
Current Position in Scene: X:${p.position.x.toFixed(1)} Y:${p.position.y.toFixed(1)} Z:${p.position.z.toFixed(1)}`;
      }).join('\n\n');

      // Calculate distances
      const distances: string[] = [];
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const a = parts[i].position;
          const b = parts[j].position;
          const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2);
          distances.push(`Distance between ${parts[i].name} and ${parts[j].name}: ${dist.toFixed(1)}mm`);
        }
      }

      const totalVolume = parts.reduce((sum, p) => {
        const v = p.geometry?.volume_mm3 || (() => { const d = getDims(p); return d.x * d.y * d.z; })();
        return sum + v;
      }, 0);

      const prompt = `You are Lumexa Engineering AI. The user is building: ${project?.purpose || project?.project_name || 'engineering project'}. Budget: ${project?.budget_range || 'Not specified'}.

REAL GEOMETRIC DATA FROM PYTHON ANALYSIS:

${partDataStr}

ASSEMBLY GEOMETRY:
Total parts: ${parts.length}
${distances.join('\n')}
Estimated combined mass assuming aluminum 6061: ${(totalVolume * 0.0027).toFixed(1)}g

Provide complete engineering assembly analysis:

1. Overview — what this assembly appears to be and overall assessment
2. Joint Analysis — analyze each connection point between parts using real dimensions
3. Screw Specifications — provide exact table with columns: Joint Location, Bolt Size, Length mm, Thread Pitch, Torque Nm, Quantity. Base sizes on real hole dimensions if available.
4. Modifications Required — list specific changes needed with exact measurements in mm
5. Optimization Recommendations — engineering improvements
6. Next Steps — what engineer should do next

Then output a JSON annotations array:
\`\`\`annotations-json
{
  "annotations": [
    {"id": 1, "severity": "CRITICAL", "zone": "zone_name", "position_hint": "far_end_top", "title": "Issue Title", "problem": "Detailed problem with measurements", "solution": "Specific solution with exact mm", "color": "#ff0000"}
  ]
}
\`\`\`

Use the REAL geometric data for accurate analysis. Reference actual part dimensions and positions. Give specific measurements not generic advice.`;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          projectContext: project ? { name: project.project_name, category: project.category, purpose: project.purpose, budget: project.budget_range, complexity: project.complexity, description: project.description } : null,
          telemetryStats: null,
        }),
      });

      if (!resp.ok) {
        if (resp.status === 429) throw new Error('Rate limit exceeded. Please try again shortly.');
        if (resp.status === 402) throw new Error('AI credits exhausted. Please add credits.');
        throw new Error('Analysis failed.');
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '', textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let ni: number;
        while ((ni = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, ni);
          textBuffer = textBuffer.slice(ni + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const js = line.slice(6).trim();
          if (js === '[DONE]') break;
          try {
            const p = JSON.parse(js);
            const c = p.choices?.[0]?.delta?.content;
            if (c) fullText += c;
          } catch { textBuffer = line + '\n' + textBuffer; break; }
        }
      }

      // Parse annotations
      let annotations: AssemblyAnnotation[] = [];
      try {
        const match = fullText.match(/```annotations-json\s*([\s\S]*?)```/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.annotations) annotations = parsed.annotations;
        }
      } catch {}

      // Calculate score
      let score = 100;
      annotations.forEach(a => {
        if (a.severity === 'CRITICAL') score -= 25;
        else if (a.severity === 'HIGH') score -= 15;
        else if (a.severity === 'MEDIUM') score -= 8;
        else score -= 3;
      });
      score = Math.max(0, score);

      const cleanContent = fullText.replace(/```annotations-json[\s\S]*?```/g, '').trim();

      setResult({
        content: cleanContent,
        annotations: annotations.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)),
        score,
        metrics: {
          jointCompatibility: Math.min(100, score + 10),
          weightBalance: Math.min(100, score + 5),
          structuralRating: score,
          modificationDifficulty: score >= 80 ? 'Easy' : score >= 60 ? 'Medium' : 'Hard',
        },
      });
    } catch (err: any) {
      toast({ title: err.message || 'Analysis failed', variant: 'destructive' });
    } finally {
      setAnalyzing(false);
      setLoadingProgress(100);
    }
  };

  const selectedPartData = parts.find(p => p.id === selectedPart);
  const viewButtons: { mode: ViewMode; icon: typeof Box; label: string }[] = [
    { mode: 'solid', icon: Box, label: 'Solid' },
    { mode: 'wireframe', icon: Grid3x3, label: 'Wire' },
    { mode: 'xray', icon: Eye, label: 'X-Ray' },
  ];

  const getScoreStyle = (s: number) => {
    if (s >= 90) return { bg: 'bg-[#001a00]', badge: 'GOOD', badgeColor: 'bg-green-600' };
    if (s >= 80) return { bg: 'bg-[#1a1400]', badge: 'MEDIUM', badgeColor: 'bg-yellow-600' };
    if (s >= 60) return { bg: 'bg-[#1a0800]', badge: 'HIGH', badgeColor: 'bg-orange-600' };
    return { bg: 'bg-[#1a0000]', badge: 'CRITICAL', badgeColor: 'bg-destructive' };
  };

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col">
      {/* Top Bar */}
      <div className="h-12 border-b border-[#222222] bg-[#111111] flex items-center px-4 gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <Box className="w-4 h-4 text-primary" />
          <span className="text-sm font-bold text-foreground">Assembly Builder</span>
          {result && (
            <span className={`ml-2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-foreground ${getScoreStyle(result.score).badgeColor}`}>
              {result.score}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" className="gap-1.5 h-8" onClick={handleAnalyze} disabled={analyzing || parts.length === 0}>
            <Zap className="w-3.5 h-3.5" /> Analyze Assembly
          </Button>
          <Button size="sm" variant="secondary" className="gap-1.5 h-8 hover:text-destructive" onClick={clearScene}>
            <Trash2 className="w-3.5 h-3.5" /> Clear Scene
          </Button>
          <Button size="sm" variant="secondary" className="gap-1.5 h-8">
            <Save className="w-3.5 h-3.5" /> Save
          </Button>
        </div>
      </div>

      {/* Three Panel Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* LEFT SIDEBAR — Parts Library */}
        <div className="w-full lg:w-1/4 border-r border-[#222222] bg-[#111111] border-t-2 border-t-primary overflow-y-auto shrink-0 lg:max-h-full max-h-[200px] lg:order-1 order-1">
          <div className="p-3 space-y-3">
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold text-foreground">Parts Library</span>
            </div>

            <input ref={fileRef} type="file" accept=".stl,.obj,.gltf,.glb" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleUpload(f); }} />
            <Button className="w-full gap-2" onClick={() => fileRef.current?.click()}>
              <Upload className="w-4 h-4" /> Upload Part STL
            </Button>

            {/* Uploaded parts */}
            <div className="space-y-2">
              {parts.map(part => {
                const dims = getDims(part);
                const isActive = selectedPart === part.id;
                return (
                  <div key={part.id}
                    onClick={() => setSelectedPart(isActive ? null : part.id)}
                    className={`bg-[#0a0a0a] rounded-lg p-2.5 border-l-4 cursor-pointer transition-all ${isActive ? 'ring-1 ring-primary' : 'hover:bg-[#151515]'}`}
                    style={{ borderLeftColor: part.color }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: part.color }} />
                      <span className="text-xs font-medium text-foreground truncate flex-1">{part.name}</span>
                      <button onClick={e => { e.stopPropagation(); toggleVisibility(part.id); }} className="text-muted-foreground hover:text-foreground">
                        {part.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      </button>
                      <button onClick={e => { e.stopPropagation(); removePart(part.id); }} className="text-muted-foreground hover:text-destructive">
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                    <p className="text-[10px] text-primary font-mono">
                      {dims.x.toFixed(1)} × {dims.y.toFixed(1)} × {dims.z.toFixed(1)} mm
                    </p>
                    {part.geometrySource === 'estimated' && part.geometry === undefined && (
                      <p className="text-[9px] text-muted-foreground mt-0.5">
                        {backendOffline ? '⚠ Estimated' : '⏳ Extracting...'}
                      </p>
                    )}
                    <div className="flex gap-1 mt-1.5">
                      <button
                        onClick={e => { e.stopPropagation(); setSelectedPart(part.id); if (orbitRef.current) { orbitRef.current.target.set(part.position.x, part.position.y, part.position.z); orbitRef.current.update(); } }}
                        className="text-[9px] text-muted-foreground hover:text-primary flex items-center gap-0.5"
                      >
                        <Crosshair className="w-2.5 h-2.5" /> Focus
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Community Parts */}
            {parts.length >= 0 && (
              <>
                <div className="border-t border-[#222222] pt-2">
                  <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Community Parts</span>
                </div>
                <div className="space-y-1.5">
                  {COMMUNITY_PARTS.map((cp, i) => (
                    <div key={i} className="bg-[#0a0a0a] rounded p-2 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] text-foreground truncate">{cp.name}</p>
                        <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                          <span className="flex items-center gap-0.5"><Star className="w-2.5 h-2.5 text-yellow-500" />{cp.rating}</span>
                          <span className="flex items-center gap-0.5"><Download className="w-2.5 h-2.5" />{cp.downloads}</span>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 border-primary/30 text-primary hover:bg-primary/10"
                        onClick={() => toast({ title: 'Community library coming soon' })}>
                        Add
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* CENTER — 3D Viewport */}
        <div className="flex-1 relative bg-[#0a0a0a] lg:order-2 order-2 min-h-[50vh] lg:min-h-0">
          {backendOffline && (
            <div className="absolute top-12 left-1/2 -translate-x-1/2 z-20 text-[11px] text-muted-foreground bg-[#111111]/80 backdrop-blur-sm rounded px-3 py-1 border border-[#222222]">
              Geometry API offline — using estimates
            </div>
          )}

          {/* Viewport toolbar top-left */}
          <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5">
            {viewButtons.map(({ mode, icon: Icon, label }) => (
              <Button key={mode} size="sm" variant={viewMode === mode ? 'default' : 'secondary'} className="h-7 px-2 text-xs gap-1" onClick={() => setViewMode(mode)}>
                <Icon className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{label}</span>
              </Button>
            ))}
          </div>

          {/* Viewport toolbar top-right */}
          <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5">
            <Button size="sm" variant="secondary" className="h-7 w-7 p-0" title="Fullscreen">
              <Maximize className="w-3.5 h-3.5" />
            </Button>
            <Button size="sm" variant="secondary" className="h-7 w-7 p-0" onClick={() => orbitRef.current?.reset()} title="Reset camera">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
          </div>

          {/* Parts counter bottom-left */}
          <div className="absolute bottom-3 left-3 z-10 text-[11px] text-muted-foreground">
            Parts in scene: {parts.filter(p => p.visible).length}
          </div>

          {/* Transform Controls bottom-center */}
          {selectedPartData && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 bg-[#111111]/90 backdrop-blur-md border border-[#222222] rounded-lg p-3 space-y-2">
              <p className="text-[10px] text-primary font-bold text-center truncate max-w-[200px]">{selectedPartData.name}</p>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground w-6">Pos</span>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => movePart('x', -1)}><ArrowLeft className="w-3 h-3" /></Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => movePart('x', 1)}><ArrowRight className="w-3 h-3" /></Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => movePart('y', 1)}><ArrowUp className="w-3 h-3" /></Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => movePart('y', -1)}><ArrowDown className="w-3 h-3" /></Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => movePart('z', 1)}><ChevronUp className="w-3 h-3" /></Button>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => movePart('z', -1)}><ChevronDown className="w-3 h-3" /></Button>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-muted-foreground w-6">Rot</span>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[9px]" onClick={() => rotatePart('x', 1)}>X+</Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[9px]" onClick={() => rotatePart('y', 1)}>Y+</Button>
                <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[9px]" onClick={() => rotatePart('z', 1)}>Z+</Button>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch checked={snapToGrid} onCheckedChange={setSnapToGrid} className="scale-75" />
                <span className={`text-[9px] ${snapToGrid ? 'text-primary' : 'text-muted-foreground'}`}>Snap 5mm</span>
              </div>
            </div>
          )}

          {/* Canvas */}
          {parts.length > 0 ? (
            <Canvas shadows camera={{ position: [4, 3, 4], fov: 45, near: 0.001, far: 20000 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }} className="!h-full">
              <color attach="background" args={['#0a0a0a']} />
              <AssemblyScene parts={parts} viewMode={viewMode} selectedId={selectedPart} orbitRef={orbitRef} onEstimatedDims={handleEstimatedDims} />
            </Canvas>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <Box className="w-12 h-12 opacity-30 text-primary" />
              <p className="text-sm text-foreground">Upload parts to begin assembly</p>
              <p className="text-xs opacity-50">Supports STL, OBJ, GLTF, GLB</p>
            </div>
          )}
        </div>

        {/* RIGHT PANEL — Analysis Results */}
        <div className="w-full lg:w-1/4 border-l border-[#222222] bg-[#111111] border-t-2 border-t-primary overflow-y-auto shrink-0 lg:order-3 order-3">
          <div className="p-3 space-y-3">
            {analyzing ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full border-2 border-primary/20" />
                  <div className="absolute inset-0 rounded-full border-2 border-t-primary animate-spin" />
                  <div className="absolute inset-2 rounded-full border-2 border-primary/10" />
                  <div className="absolute inset-2 rounded-full border-2 border-t-primary/60 animate-spin" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
                </div>
                <p className="text-sm text-foreground animate-pulse">{loadingMsg}</p>
                <div className="w-full bg-[#222222] rounded-full h-1.5">
                  <div className="bg-primary h-1.5 rounded-full transition-all duration-500" style={{ width: `${loadingProgress}%` }} />
                </div>
              </div>
            ) : result ? (
              <>
                {/* Score */}
                <div className={`rounded-lg p-4 ${getScoreStyle(result.score).bg} border border-[#222222]`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-3xl font-bold text-primary font-display">{result.score}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Assembly Score</p>
                    </div>
                    <Badge className={`${getScoreStyle(result.score).badgeColor} text-foreground`}>
                      {getScoreStyle(result.score).badge}
                    </Badge>
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-[#0a0a0a] rounded-lg p-2.5 border border-primary/20">
                    <Link2 className="w-3.5 h-3.5 text-primary mb-1" />
                    <p className="text-xs font-bold text-foreground">{result.metrics.jointCompatibility}%</p>
                    <p className="text-[9px] text-muted-foreground">Joint Compat.</p>
                  </div>
                  <div className="bg-[#0a0a0a] rounded-lg p-2.5 border border-primary/20">
                    <Scale className="w-3.5 h-3.5 text-primary mb-1" />
                    <p className="text-xs font-bold text-foreground">{result.metrics.weightBalance}</p>
                    <p className="text-[9px] text-muted-foreground">Weight Balance</p>
                  </div>
                  <div className="bg-[#0a0a0a] rounded-lg p-2.5 border border-primary/20">
                    <Shield className="w-3.5 h-3.5 text-primary mb-1" />
                    <p className="text-xs font-bold text-foreground">{result.metrics.structuralRating}</p>
                    <p className="text-[9px] text-muted-foreground">Structural</p>
                  </div>
                  <div className="bg-[#0a0a0a] rounded-lg p-2.5 border border-primary/20">
                    <Wrench className="w-3.5 h-3.5 text-primary mb-1" />
                    <p className="text-xs font-bold text-foreground">{result.metrics.modificationDifficulty}</p>
                    <p className="text-[9px] text-muted-foreground">Mod. Difficulty</p>
                  </div>
                </div>

                {/* AI Report */}
                <Card className="bg-[#0a0a0a] border-[#222222]">
                  <CardContent className="pt-4 prose prose-sm prose-invert max-w-none text-xs">
                    <ReactMarkdown>{result.content}</ReactMarkdown>
                  </CardContent>
                </Card>

                {/* Critical Issues */}
                {result.annotations.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" /> Critical Issues Found
                    </h4>
                    {result.annotations.map(a => {
                      const borderColor = a.color;
                      const severityBg = a.severity === 'CRITICAL' ? 'bg-destructive/20' : a.severity === 'HIGH' ? 'bg-orange-500/20' : a.severity === 'MEDIUM' ? 'bg-yellow-500/20' : 'bg-muted/20';
                      return (
                        <div key={a.id} className="bg-[#0a0a0a] rounded-lg p-3 border-l-4" style={{ borderLeftColor: borderColor }}>
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded text-foreground ${severityBg}`}>
                              {a.severity}
                            </span>
                            <span className="text-xs font-bold text-foreground">{a.title}</span>
                          </div>
                          <div className="space-y-1.5">
                            <div>
                              <span className="text-[9px] text-muted-foreground uppercase">Problem:</span>
                              <p className="text-[11px] text-foreground/80">{a.problem}</p>
                            </div>
                            <div>
                              <span className="text-[9px] text-primary uppercase">Solution:</span>
                              <p className="text-[11px] text-foreground">{a.solution}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <Box className="w-10 h-10 text-primary opacity-40" />
                <p className="text-sm text-foreground">Run Analysis to get engineering report</p>
                <p className="text-xs text-muted-foreground">Upload your parts, position them, then click Analyze Assembly</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
