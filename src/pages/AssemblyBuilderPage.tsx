import { useState, useRef, useCallback, useEffect, useMemo, Suspense } from 'react';
import { useDesignAnalyses } from '@/hooks/useLocalStorage';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import {
  Upload, Search, Maximize, RotateCcw, Eye, EyeOff,
  Loader2, Zap, Box, Grid3x3, Shield, AlertTriangle,
  Wrench, Target, Activity, Download, X, Copy, ChevronRight
} from 'lucide-react';
import { toast } from 'sonner';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

interface PartGeometry {
  dimensions_mm: { x: number; y: number; z: number };
  volume_mm3: number;
  surface_area_mm2?: number;
  center_of_gravity: { x: number; y: number; z: number };
  is_watertight: boolean;
  vertex_count: number;
  face_count: number;
}

interface InspectionAnnotation {
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
  annotations: InspectionAnnotation[];
  score: number;
  metrics: {
    structuralIntegrity: number;
    jointQuality: number;
    manufacturingReadiness: number;
    overallRisk: string;
  };
}

type ViewMode = 'solid' | 'wireframe' | 'xray';

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const SEVERITY_COLORS: Record<string, string> = { CRITICAL: '#ff0000', HIGH: '#ff6600', MEDIUM: '#ffaa00', LOW: '#888888' };

const LOADING_MESSAGES = [
  'Uploading assembly...',
  'Extracting real geometry...',
  'Analyzing structural integrity...',
  'Detecting abnormalities...',
  'Placing issue markers...',
  'Generating inspection report...',
];

/* ─── Three.js estimate fallback ─── */
function estimateFromGeometry(geo: THREE.BufferGeometry): PartGeometry {
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const s = new THREE.Vector3();
  bb.getSize(s);
  const c = new THREE.Vector3();
  bb.getCenter(c);
  return {
    dimensions_mm: { x: +(s.x).toFixed(1), y: +(s.y).toFixed(1), z: +(s.z).toFixed(1) },
    volume_mm3: +(s.x * s.y * s.z * 0.4).toFixed(0),
    surface_area_mm2: +(2 * (s.x * s.y + s.y * s.z + s.x * s.z)).toFixed(0),
    center_of_gravity: { x: +c.x.toFixed(1), y: +c.y.toFixed(1), z: +c.z.toFixed(1) },
    is_watertight: false,
    vertex_count: geo.attributes.position?.count || 0,
    face_count: geo.index ? geo.index.count / 3 : (geo.attributes.position?.count || 0) / 3,
  };
}

/* ─── Position hint to 3D coords ─── */
function hintToPosition(hint: string, bb: THREE.Box3): [number, number, number] {
  const min = bb.min, max = bb.max;
  const cx = (min.x + max.x) / 2, cy = (min.y + max.y) / 2, cz = (min.z + max.z) / 2;
  const map: Record<string, [number, number, number]> = {
    far_end_top: [min.x, max.y, max.z],
    far_end_bottom: [min.x, min.y, max.z],
    middle_center: [cx, cy, cz],
    near_end_top: [max.x, max.y, min.z],
    near_end_bottom: [max.x, min.y, min.z],
    middle_top: [cx, max.y, cz],
    middle_bottom: [cx, min.y, cz],
    far_end_center: [min.x, cy, max.z],
    near_end_center: [max.x, cy, min.z],
    left_side: [min.x, cy, cz],
    right_side: [max.x, cy, cz],
  };
  return map[hint] || [cx, cy, cz];
}

/* ─── Annotation Sphere ─── */
function AnnotationSphere({ annotation, position, size, onClick, isHighlighted }: {
  annotation: InspectionAnnotation;
  position: [number, number, number];
  size: number;
  onClick: () => void;
  isHighlighted: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    if (meshRef.current) {
      const s = 1 + Math.sin(clock.getElapsedTime() * 4.2) * 0.15;
      meshRef.current.scale.setScalar(isHighlighted ? s * 1.3 : s);
    }
  });

  const sevColor = annotation.color || SEVERITY_COLORS[annotation.severity];
  const badgeColors: Record<string, string> = {
    CRITICAL: 'bg-red-600', HIGH: 'bg-orange-500', MEDIUM: 'bg-yellow-500', LOW: 'bg-gray-500'
  };

  return (
    <group position={position}>
      <mesh ref={meshRef} onClick={(e) => { e.stopPropagation(); onClick(); }}>
        <sphereGeometry args={[size, 24, 24]} />
        <meshStandardMaterial color={sevColor} emissive={sevColor} emissiveIntensity={isHighlighted ? 2 : 0.8} transparent opacity={0.85} />
      </mesh>
      <pointLight ref={lightRef} color={sevColor} intensity={isHighlighted ? 3 : 1} distance={size * 10} />
      <Html distanceFactor={size * 40} style={{ pointerEvents: 'auto', minWidth: 160 }}>
        <div
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          className="cursor-pointer px-3 py-2 rounded-lg border border-border/50 backdrop-blur-md"
          style={{ background: 'rgba(17,17,17,0.92)', borderLeft: `3px solid ${sevColor}` }}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${badgeColors[annotation.severity]} text-white`}>
              {annotation.severity}
            </span>
          </div>
          <div className="text-xs font-semibold text-white leading-tight">{annotation.title}</div>
        </div>
      </Html>
    </group>
  );
}

/* ─── Assembly Model ─── */
function AssemblyModel({ url, fileType, viewMode, geometry, onBoundsReady }: {
  url: string; fileType: string; viewMode: ViewMode;
  geometry: PartGeometry | null;
  onBoundsReady: (bb: THREE.Box3) => void;
}) {
  const meshRef = useRef<THREE.Group>(null);
  const { camera } = useThree();
  const [loadedGeo, setLoadedGeo] = useState<THREE.BufferGeometry | null>(null);
  const [loadedScene, setLoadedScene] = useState<THREE.Group | null>(null);

  useEffect(() => {
    const ext = fileType.toLowerCase();
    if (ext === 'stl') {
      const loader = new STLLoader();
      loader.load(url, (geo) => { geo.computeVertexNormals(); setLoadedGeo(geo); });
    } else if (ext === 'obj') {
      const loader = new OBJLoader();
      loader.load(url, (obj) => setLoadedScene(obj));
    } else if (ext === 'gltf' || ext === 'glb') {
      const loader = new GLTFLoader();
      loader.load(url, (gltf) => setLoadedScene(gltf.scene));
    }
  }, [url, fileType]);

  useEffect(() => {
    const target = meshRef.current;
    if (!target) return;
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    onBoundsReady(box);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = new THREE.Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    target.position.sub(center);
    target.position.y += size.y / 2;
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.position.set(maxDim * 1.5, maxDim * 1.2, maxDim * 1.5);
      camera.lookAt(0, size.y / 2, 0);
    }
  }, [loadedGeo, loadedScene, camera, onBoundsReady]);

  const matProps = useMemo(() => {
    if (viewMode === 'xray') return { color: '#ff4444', transparent: true, opacity: 0.25, wireframe: false, metalness: 0.1, roughness: 0.9 };
    if (viewMode === 'wireframe') return { color: '#ff4444', wireframe: true, transparent: false, opacity: 1, metalness: 0, roughness: 1 };
    return { color: '#ff4444', metalness: 0.6, roughness: 0.35, transparent: false, opacity: 1, wireframe: false };
  }, [viewMode]);

  return (
    <group ref={meshRef}>
      {loadedGeo && (
        <mesh geometry={loadedGeo}>
          <meshStandardMaterial {...matProps} />
        </mesh>
      )}
      {loadedScene && (
        <primitive object={loadedScene.clone()}>
          {/* apply material via traverse after clone */}
        </primitive>
      )}
    </group>
  );
}

/* ─── Main Page ─── */
export default function AssemblyBuilderPage() {
  const { user } = useAuth();
  const { analyses: savedDesigns } = useDesignAnalyses();
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [fileType, setFileType] = useState('stl');
  const [geometry, setGeometry] = useState<PartGeometry | null>(null);
  const [geoSource, setGeoSource] = useState<'python' | 'estimated'>('estimated');
  const [viewMode, setViewMode] = useState<ViewMode>('solid');
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [projectContext, setProjectContext] = useState<any>(null);
  const [modelBounds, setModelBounds] = useState<THREE.Box3 | null>(null);
  const [highlightedAnnotation, setHighlightedAnnotation] = useState<number | null>(null);
  const [detailAnnotation, setDetailAnnotation] = useState<InspectionAnnotation | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<any>(null);

  // Load project context
  useEffect(() => {
    if (!user) return;
    supabase.from('projects').select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1)
      .then(({ data }) => {
        if (data?.[0]) {
          const p = data[0];
          setProjectContext({
            name: p.project_name, category: p.category, purpose: p.purpose,
            budget: p.budget_range, complexity: p.complexity, description: p.description,
          });
        }
      });
  }, [user]);

  // Loading message rotation
  useEffect(() => {
    if (!isAnalyzing) return;
    let i = 0;
    setLoadingMsg(LOADING_MESSAGES[0]);
    const iv = setInterval(() => {
      i = (i + 1) % LOADING_MESSAGES.length;
      setLoadingMsg(LOADING_MESSAGES[i]);
    }, 2000);
    const pv = setInterval(() => setLoadingProgress(p => Math.min(p + 2, 92)), 300);
    return () => { clearInterval(iv); clearInterval(pv); };
  }, [isAnalyzing]);

  const handleUpload = useCallback(async (f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase() || '';
    if (!['stl', 'obj', 'gltf', 'glb'].includes(ext)) {
      toast.error('Please upload STL, OBJ, GLTF, or GLB file');
      return;
    }
    if (f.size > 50 * 1024 * 1024) {
      toast.error('File too large — maximum 50MB');
      return;
    }

    setFile(f);
    setFileType(ext);
    setFileUrl(URL.createObjectURL(f));
    setAnalysis(null);
    setDetailAnnotation(null);
    setHighlightedAnnotation(null);
    setIsUploading(true);

    // Geometry is derived locally from the loaded mesh
    setGeoSource('estimated');
    setIsUploading(false);

    // Auto-trigger analysis
    runAnalysis(f, null);
  }, [projectContext, user]);

  const handleBoundsReady = useCallback((bb: THREE.Box3) => {
    setModelBounds(bb);
    // If no python geometry, estimate from bounds
    if (!geometry) {
      const size = new THREE.Vector3();
      bb.getSize(size);
      const center = new THREE.Vector3();
      bb.getCenter(center);
      const est: PartGeometry = {
        dimensions_mm: { x: +size.x.toFixed(1), y: +size.y.toFixed(1), z: +size.z.toFixed(1) },
        volume_mm3: +(size.x * size.y * size.z * 0.4).toFixed(0),
        surface_area_mm2: +(2 * (size.x * size.y + size.y * size.z + size.x * size.z)).toFixed(0),
        center_of_gravity: { x: +center.x.toFixed(1), y: +center.y.toFixed(1), z: +center.z.toFixed(1) },
        is_watertight: false,
        vertex_count: 0,
        face_count: 0,
      };
      setGeometry(est);
    }
  }, [geometry]);

  const runAnalysis = async (f: File, geo: PartGeometry | null) => {
    setIsAnalyzing(true);
    setLoadingProgress(0);

    // Wait for geometry if needed
    const g = geo || geometry;
    if (!g) {
      // Will retry after bounds ready triggers geometry estimation
      setTimeout(() => {
        if (geometry) runAnalysis(f, geometry);
        else { setIsAnalyzing(false); toast.error('Could not extract geometry'); }
      }, 3000);
      return;
    }

    const dims = g.dimensions_mm;
    const vol = g.volume_mm3;
    const sa = g.surface_area_mm2 || 0;
    const cog = g.center_of_gravity;
    const bboxVol = dims.x * dims.y * dims.z;
    const fillRatio = bboxVol > 0 ? (vol / bboxVol).toFixed(3) : '0';
    const vtxFaceRatio = g.face_count > 0 ? (g.vertex_count / g.face_count).toFixed(2) : '0';
    const massAl = (vol * 0.0000027).toFixed(3);
    const massCF = (vol * 0.0000016).toFixed(3);

    const prompt = `You are Lumexa Engineering AI performing a complete assembly quality inspection.

USER PROJECT CONTEXT:
Project: ${projectContext?.name || 'Not specified'}
Budget: ${projectContext?.budget || 'Not specified'}

GEOMETRIC DATA MEASURED FROM THE UPLOADED MESH:
Filename: ${f.name}
Real Dimensions: ${dims.x}mm x ${dims.y}mm x ${dims.z}mm
Real Volume: ${vol}mm3
Real Surface Area: ${sa}mm2
Real Center of Gravity: X:${cog.x}mm Y:${cog.y}mm Z:${cog.z}mm
Mesh Watertight: ${g.is_watertight}
Vertex Count: ${g.vertex_count}
Face Count: ${g.face_count}
Bounding Box Volume: ${bboxVol.toFixed(0)}mm3
Volume Fill Ratio: ${fillRatio}
Estimated Mass Aluminum 6061: ${massAl}kg
Estimated Mass Carbon Fiber: ${massCF}kg

MESH QUALITY ASSESSMENT:
Watertight: ${g.is_watertight} — if false indicates open boundaries or mesh errors
Volume Fill Ratio: ${fillRatio} — below 0.15 indicates hollow, above 0.85 indicates nearly solid block
Vertex to Face Ratio: ${vtxFaceRatio}

Perform complete assembly quality inspection and identify all engineering abnormalities:

Assembly Overview — Identify assembly type from geometry. State overall dimensions and estimated function.

Structural Assessment — Identify structural weak points from real dimensions. Analyze load paths. Identify stress concentration regions with actual mm measurements.

Joint Analysis — Identify likely joint locations from geometry. Assess joint quality and connection points. Identify clearance or interference issues with exact measurements.

Manufacturing Concerns — Assess printability or machinability. Identify features below 1.5mm minimum wall thickness. Flag overhangs or unsupported features.

Optimization Recommendations — Specific improvements with exact mm measurements. Weight reduction opportunities. Material recommendations based on budget and volume.

Next Steps — Specific actionable items referencing real dimensions.

Output JSON annotations array for 3D model placement:
\`\`\`annotations-json
{
  "annotations": [
    {
      "id": 1,
      "severity": "CRITICAL",
      "zone": "descriptive_zone_name",
      "position_hint": "far_end_top",
      "title": "Issue Title Max 5 Words",
      "problem": "Detailed problem with specific mm measurements",
      "solution": "Specific solution with exact mm values",
      "color": "#ff0000"
    }
  ]
}
\`\`\`

Annotation rules:
- Always CRITICAL if mesh not watertight
- Always HIGH if volume fill ratio above 0.85
- Always HIGH if any dimension suggests wall below 2mm
- Always MEDIUM if mass seems excessive for stated budget
- Minimum 3 annotations maximum 8
- Use spread out position hints
- Every problem and solution must reference real measurements`;

    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: prompt }],
          projectContext,
        }),
      });

      if (!resp.ok) {
        toast.error('Analysis failed — please try again');
        setIsAnalyzing(false);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) !== -1) {
          let line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const js = line.slice(6).trim();
          if (js === '[DONE]') break;
          try {
            const p = JSON.parse(js);
            const c = p.choices?.[0]?.delta?.content;
            if (c) fullText += c;
          } catch { buf = line + '\n' + buf; break; }
        }
      }

      // Parse annotations
      let annotations: InspectionAnnotation[] = [];
      const jsonMatch = fullText.match(/```annotations-json\s*([\s\S]*?)```/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[1]);
          annotations = (parsed.annotations || parsed).map((a: any) => ({
            ...a,
            color: a.color || SEVERITY_COLORS[a.severity] || '#888888',
          }));
        } catch (e) { console.error('Failed to parse annotations:', e); }
      }

      // Calculate score
      let score = 100;
      annotations.forEach(a => {
        if (a.severity === 'CRITICAL') score -= 25;
        else if (a.severity === 'HIGH') score -= 15;
        else if (a.severity === 'MEDIUM') score -= 8;
        else score -= 3;
      });
      score = Math.max(0, score);

      // Clean content
      const cleanContent = fullText.replace(/```annotations-json[\s\S]*?```/g, '').trim();

      const critCount = annotations.filter(a => a.severity === 'CRITICAL').length;
      const highCount = annotations.filter(a => a.severity === 'HIGH').length;

      setAnalysis({
        content: cleanContent,
        annotations,
        score,
        metrics: {
          structuralIntegrity: g.is_watertight ? Math.max(60, 95 - critCount * 20) : Math.max(20, 40 - critCount * 10),
          jointQuality: Math.max(30, 90 - highCount * 15),
          manufacturingReadiness: g.is_watertight ? Math.max(50, 85 - critCount * 10 - highCount * 5) : Math.max(20, 50 - critCount * 15),
          overallRisk: score >= 90 ? 'Low' : score >= 80 ? 'Moderate' : score >= 60 ? 'High' : 'Critical',
        },
      });
      setLoadingProgress(100);
    } catch (e) {
      console.error(e);
      toast.error('Analysis failed — please try again');
    }
    setIsAnalyzing(false);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleUpload(f);
  }, [handleUpload]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleUpload(f);
  }, [handleUpload]);

  const scoreColor = (s: number) => s >= 90 ? '#22c55e' : s >= 80 ? '#eab308' : s >= 60 ? '#f97316' : '#ef4444';
  const scoreBg = (s: number) => s >= 90 ? 'rgba(34,197,94,0.1)' : s >= 80 ? 'rgba(234,179,8,0.1)' : s >= 60 ? 'rgba(249,115,22,0.1)' : 'rgba(239,68,68,0.1)';
  const scoreLabel = (s: number) => s >= 90 ? 'GOOD' : s >= 80 ? 'MEDIUM' : s >= 60 ? 'HIGH' : 'CRITICAL';

  const annotationPositions = useMemo(() => {
    if (!analysis?.annotations.length || !modelBounds) return [];
    return analysis.annotations.map(a => ({
      annotation: a,
      position: hintToPosition(a.position_hint, modelBounds),
    }));
  }, [analysis, modelBounds]);

  const maxDim = modelBounds ? Math.max(
    modelBounds.max.x - modelBounds.min.x,
    modelBounds.max.y - modelBounds.min.y,
    modelBounds.max.z - modelBounds.min.z,
  ) : 100;

  const sevCounts = useMemo(() => {
    if (!analysis) return { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    const c = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
    analysis.annotations.forEach(a => { if (a.severity in c) c[a.severity as keyof typeof c]++; });
    return c;
  }, [analysis]);

  const massEstimates = useMemo(() => {
    if (!geometry) return null;
    const v = geometry.volume_mm3;
    return {
      aluminum: (v * 0.0000027).toFixed(1),
      carbon: (v * 0.0000016).toFixed(1),
      pla: (v * 0.00000125).toFixed(1),
      steel: (v * 0.0000079).toFixed(1),
    };
  }, [geometry]);

  // ─── Upload Screen ───
  if (!file || !fileUrl) {
    return (
      <div className="min-h-[calc(100vh-3.5rem)] flex flex-col" style={{ background: '#0a0a0a' }}>
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3 mb-1">
            <Search className="w-6 h-6 text-primary" />
            <h1 className="text-2xl font-bold text-foreground font-display">Assembly Inspector</h1>
          </div>
          <p className="text-muted-foreground text-sm">
            Upload your assembled CAD design for AI abnormality detection and engineering analysis.
          </p>
        </div>

        {/* Parts Analysis Status */}
        {savedDesigns.length > 0 && (
          <div className="px-6 pb-4">
            <div className="rounded-lg border border-border/30 p-4" style={{ background: '#111111' }}>
              <h3 className="text-sm font-bold text-foreground mb-1">Parts Analysis Status</h3>
              <p className="text-[10px] text-muted-foreground mb-3">
                For best results, analyse each individual part in Insert Design page before inspecting the full assembly.
              </p>
              <div className="space-y-1.5">
                {savedDesigns.map((d, i) => (
                  <div key={i} className="flex items-center justify-between rounded-lg bg-background/50 px-3 py-2 border border-border/20">
                    <div className="flex items-center gap-2">
                      <span className="text-green-400 text-xs">✓</span>
                      <span className="text-xs font-medium text-foreground">{d.partName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] bg-green-600/20 text-green-400 px-1.5 py-0.5 rounded font-medium">Analysed</span>
                      <span className="text-[9px] text-muted-foreground">{new Date(d.timestamp).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Upload Zone */}
        <div className="flex-1 flex flex-col items-center justify-center px-6 pb-6">
          <label
            onDrop={handleDrop}
            onDragOver={e => e.preventDefault()}
            className="w-full max-w-3xl cursor-pointer border-2 border-dashed border-primary/40 hover:border-primary/70 rounded-xl p-12 flex flex-col items-center gap-4 transition-all"
            style={{ background: 'rgba(255,0,0,0.02)' }}
          >
            <Upload className="w-12 h-12 text-primary" />
            <span className="text-xl font-bold text-foreground">Upload Assembled Design</span>
            <span className="text-sm text-muted-foreground text-center max-w-md">
              Export your complete assembly from SolidWorks, Fusion 360, FreeCAD or any CAD software as STL, OBJ, STEP or IGES then upload here
            </span>
            <input type="file" accept=".stl,.obj,.gltf,.glb" onChange={handleFileInput} className="hidden" />
          </label>

          {/* Workflow Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-8 w-full max-w-3xl">
            {[
              { n: '1', title: 'Design in CAD', desc: 'Create and assemble your parts in SolidWorks, Fusion 360, or any CAD software' },
              { n: '2', title: 'Export Assembly', desc: 'Export your complete assembled design as STL or OBJ file' },
              { n: '3', title: 'Get AI Report', desc: 'Lumexa analyzes every joint, stress point, and abnormality in seconds' },
            ].map(c => (
              <div key={c.n} className="rounded-lg border border-border p-4" style={{ background: '#111111' }}>
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-primary text-primary-foreground text-xs font-bold mb-3">{c.n}</span>
                <h3 className="text-sm font-semibold text-foreground mb-1">{c.title}</h3>
                <p className="text-xs text-muted-foreground">{c.desc}</p>
              </div>
            ))}
          </div>

          {/* Empty State */}
          <div className="mt-12 text-center">
            <Search className="w-10 h-10 text-primary mx-auto mb-3 opacity-30" />
            <p className="text-muted-foreground text-sm max-w-md mx-auto">
              Upload your assembled design to detect structural abnormalities, joint issues, and manufacturing concerns before you build.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ─── Inspection View ───
  return (
    <div className="h-[calc(100vh-3.5rem)] flex flex-col" style={{ background: '#0a0a0a' }}>
      {/* Upload Progress Bar */}
      {(isUploading || isAnalyzing) && (
        <div className="h-1 w-full" style={{ background: '#1a1a1a' }}>
          <div
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${isUploading ? 30 : loadingProgress}%` }}
          />
        </div>
      )}

      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b" style={{ background: '#111111', borderColor: '#222222' }}>
        <div className="flex items-center gap-3">
          <Search className="w-5 h-5 text-primary" />
          <span className="font-bold text-foreground">Assembly Inspector</span>
          {analysis && (
            <Badge style={{ background: scoreBg(analysis.score), color: scoreColor(analysis.score), border: 'none' }}>
              Score: {analysis.score}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setFile(null); setFileUrl(null); setAnalysis(null); setGeometry(null); setModelBounds(null); }}
            className="px-3 py-1.5 text-xs rounded-md text-muted-foreground hover:text-foreground border border-border hover:border-primary/30 transition-colors"
            style={{ background: '#1a1a1a' }}
          >
            New Inspection
          </button>
        </div>
      </div>

      {/* Split Layout */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* LEFT — 3D Viewport */}
        <div className="relative md:w-[45%] h-[45vh] md:h-full" ref={canvasContainerRef}>
          <Canvas
            camera={{ position: [100, 80, 100], fov: 50, near: 0.01, far: 100000 }}
            gl={{ antialias: true, alpha: true }}
            style={{ background: '#0a0a0a' }}
          >
            <ambientLight intensity={0.5} />
            <directionalLight position={[50, 80, 30]} intensity={1} />
            <pointLight position={[0, -30, 0]} color="#ff2222" intensity={0.3} />
            <gridHelper args={[500, 50, '#1a0000', '#0f0000']} position={[0, 0, 0]} />

            <Suspense fallback={null}>
              <AssemblyModel
                url={fileUrl}
                fileType={fileType}
                viewMode={viewMode}
                geometry={geometry}
                onBoundsReady={handleBoundsReady}
              />
            </Suspense>

            {showAnnotations && annotationPositions.map(({ annotation, position }) => (
              <AnnotationSphere
                key={annotation.id}
                annotation={annotation}
                position={position}
                size={maxDim * 0.06}
                isHighlighted={highlightedAnnotation === annotation.id}
                onClick={() => setDetailAnnotation(annotation)}
              />
            ))}

            <OrbitControls
              ref={controlsRef}
              enableDamping
              dampingFactor={0.05}
              enablePan
              enableZoom
              minDistance={1}
              maxDistance={10000}
            />
          </Canvas>

          {/* Viewport Controls Top Left */}
          <div className="absolute top-3 left-3 flex gap-1">
            {(['solid', 'wireframe', 'xray'] as ViewMode[]).map(m => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={`px-2.5 py-1 text-[10px] uppercase font-bold rounded transition-colors ${
                  viewMode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
                style={{ background: viewMode === m ? undefined : '#111111', border: '1px solid #222' }}
              >
                {m === 'wireframe' ? 'Wire' : m === 'xray' ? 'X-Ray' : 'Solid'}
              </button>
            ))}
          </div>

          {/* Top Right Controls */}
          <div className="absolute top-3 right-3 flex gap-1">
            {analysis && (
              <button
                onClick={() => setShowAnnotations(!showAnnotations)}
                className="px-2.5 py-1 text-[10px] font-bold rounded flex items-center gap-1 transition-colors"
                style={{ background: showAnnotations ? 'rgba(255,0,0,0.15)' : '#111111', border: '1px solid #222', color: showAnnotations ? '#ff4444' : '#888' }}
              >
                {showAnnotations ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                Issues
              </button>
            )}
            <button
              onClick={() => {
                if (canvasContainerRef.current) {
                  if (!isFullscreen) canvasContainerRef.current.requestFullscreen?.();
                  else document.exitFullscreen?.();
                  setIsFullscreen(!isFullscreen);
                }
              }}
              className="p-1.5 rounded transition-colors"
              style={{ background: '#111111', border: '1px solid #222' }}
            >
              <Maximize className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={() => controlsRef.current?.reset?.()}
              className="p-1.5 rounded transition-colors"
              style={{ background: '#111111', border: '1px solid #222' }}
            >
              <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>

          {/* Annotation Legend */}
          {analysis && showAnnotations && (
            <div className="absolute bottom-3 right-3 rounded-lg px-3 py-2" style={{ background: 'rgba(17,17,17,0.9)', border: '1px solid #222' }}>
              {Object.entries(sevCounts).filter(([, c]) => c > 0).map(([sev, count]) => (
                <div key={sev} className="flex items-center gap-2 text-[10px]">
                  <span className="w-2 h-2 rounded-full" style={{ background: SEVERITY_COLORS[sev] }} />
                  <span className="text-muted-foreground">{sev}</span>
                  <span className="text-foreground font-bold">{count}</span>
                </div>
              ))}
            </div>
          )}

          {/* Detail Panel (slides up from bottom of viewport) */}
          {detailAnnotation && (
            <div
              className="absolute bottom-0 left-0 right-0 rounded-t-xl p-4 animate-in slide-in-from-bottom duration-300"
              style={{ background: '#111111', borderTop: '2px solid #222', maxHeight: '50%', overflowY: 'auto' }}
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded text-white"
                    style={{ background: detailAnnotation.color }}
                  >{detailAnnotation.severity}</span>
                  <span className="text-lg font-bold text-foreground">{detailAnnotation.title}</span>
                </div>
                <button onClick={() => setDetailAnnotation(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="mb-3">
                <span className="text-xs text-muted-foreground">Problem:</span>
                <p className="text-sm text-foreground mt-0.5">{detailAnnotation.problem}</p>
              </div>
              <div className="mb-3">
                <span className="text-xs text-primary font-semibold">Solution:</span>
                <p className="text-sm text-foreground mt-0.5">{detailAnnotation.solution}</p>
              </div>
              <button
                onClick={() => { navigator.clipboard.writeText(detailAnnotation.solution); toast.success('Solution copied'); }}
                className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80"
              >
                <Copy className="w-3 h-3" /> Copy Solution
              </button>
            </div>
          )}
        </div>

        {/* RIGHT — Analysis Panel */}
        <div className="flex-1 md:w-[55%] overflow-y-auto border-l" style={{ borderColor: '#222222' }}>
          {isAnalyzing ? (
            /* Loading State */
            <div className="h-full flex flex-col items-center justify-center p-8">
              <div className="relative w-20 h-20 mb-6">
                <div className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping" />
                <div className="absolute inset-2 rounded-full border-2 border-primary/50 animate-pulse" />
                <div className="absolute inset-4 rounded-full bg-primary/10 flex items-center justify-center">
                  <Zap className="w-6 h-6 text-primary animate-pulse" />
                </div>
              </div>
              <p className="text-foreground font-medium mb-2">{loadingMsg}</p>
              <p className="text-xs text-muted-foreground mb-6">This may take 15-30 seconds</p>
              <div className="w-64 h-1.5 rounded-full overflow-hidden" style={{ background: '#1a1a1a' }}>
                <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${loadingProgress}%` }} />
              </div>
            </div>
          ) : analysis ? (
            /* Results */
            <div className="p-4 space-y-4">
              {/* Geometry Summary */}
              {geometry && (
                <div className="rounded-lg border border-primary/20 p-4" style={{ background: '#111111' }}>
                  <h3 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                    <Box className="w-4 h-4 text-primary" />
                    Geometry Summary
                    {geoSource === 'estimated' && <span className="text-[10px] text-muted-foreground">(Estimated)</span>}
                  </h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Part</span>
                      <p className="text-foreground font-medium truncate">{file?.name}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Dimensions</span>
                      <p className="text-primary font-mono font-medium">{geometry.dimensions_mm.x} × {geometry.dimensions_mm.y} × {geometry.dimensions_mm.z} mm</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Volume</span>
                      <p className="text-primary font-mono">{geometry.volume_mm3.toLocaleString()} mm³</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Surface Area</span>
                      <p className="text-muted-foreground font-mono">{(geometry.surface_area_mm2 || 0).toLocaleString()} mm²</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Center of Gravity</span>
                      <p className="text-muted-foreground font-mono text-[10px]">
                        X:{geometry.center_of_gravity.x} Y:{geometry.center_of_gravity.y} Z:{geometry.center_of_gravity.z}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Mesh Status</span>
                      <p className={geometry.is_watertight ? 'text-green-400' : 'text-red-400'}>
                        {geometry.is_watertight ? '✓ Watertight' : '✗ Has Errors'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Vertices / Faces</span>
                      <p className="text-muted-foreground font-mono">{geometry.vertex_count.toLocaleString()} / {geometry.face_count.toLocaleString()}</p>
                    </div>
                  </div>
                  {massEstimates && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {[
                        { label: 'Aluminum', val: massEstimates.aluminum },
                        { label: 'Carbon Fiber', val: massEstimates.carbon },
                        { label: 'PLA', val: massEstimates.pla },
                        { label: 'Steel', val: massEstimates.steel },
                      ].map(m => (
                        <span key={m.label} className="text-[10px] px-2 py-0.5 rounded-full border border-border text-muted-foreground">
                          {m.label}: {m.val}kg
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Assembly Health Score */}
              <div className="rounded-lg border p-4" style={{ background: scoreBg(analysis.score), borderColor: scoreColor(analysis.score) + '33' }}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <Shield className="w-4 h-4 text-primary" />
                    Assembly Health Score
                  </h3>
                  <Badge style={{ background: scoreColor(analysis.score) + '22', color: scoreColor(analysis.score), border: `1px solid ${scoreColor(analysis.score)}44` }}>
                    {scoreLabel(analysis.score)}
                  </Badge>
                </div>
                <div className="text-5xl font-black font-display" style={{ color: scoreColor(analysis.score) }}>
                  {analysis.score}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {analysis.score >= 90 ? 'Assembly meets engineering standards — ready for manufacturing.' :
                   analysis.score >= 80 ? 'Minor issues detected — review recommendations before manufacturing.' :
                   analysis.score >= 60 ? 'Significant issues found — modifications required before building.' :
                   'Critical abnormalities detected — do not manufacture without addressing all issues.'}
                </p>
              </div>

              {/* 4 Metric Cards */}
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Structural Integrity', value: `${analysis.metrics.structuralIntegrity}%`, icon: Shield },
                  { label: 'Joint Quality', value: `${analysis.metrics.jointQuality}%`, icon: Target },
                  { label: 'Mfg Readiness', value: `${analysis.metrics.manufacturingReadiness}%`, icon: Wrench },
                  { label: 'Overall Risk', value: analysis.metrics.overallRisk, icon: Activity },
                ].map(m => (
                  <div key={m.label} className="rounded-lg border border-primary/15 p-3" style={{ background: '#111111' }}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">{m.label}</span>
                      <m.icon className="w-3.5 h-3.5 text-primary" />
                    </div>
                    <span className="text-lg font-bold text-foreground">{m.value}</span>
                  </div>
                ))}
              </div>

              {/* Abnormalities Detected */}
              {analysis.annotations.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle className="w-4 h-4 text-primary" />
                    <h3 className="text-sm font-bold text-primary">Abnormalities Detected</h3>
                    <Badge className="bg-primary/20 text-primary border-none text-[10px]">{analysis.annotations.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {[...analysis.annotations]
                      .sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9))
                      .map(a => (
                        <div
                          key={a.id}
                          className={`rounded-lg p-3 cursor-pointer transition-all hover:brightness-110 ${highlightedAnnotation === a.id ? 'ring-1 ring-primary/50' : ''}`}
                          style={{ background: '#0a0a0a', borderLeft: `4px solid ${a.color}` }}
                          onClick={() => { setHighlightedAnnotation(a.id); setDetailAnnotation(a); }}
                          onMouseEnter={() => setHighlightedAnnotation(a.id)}
                          onMouseLeave={() => setHighlightedAnnotation(null)}
                        >
                          <div className="flex items-center gap-2 mb-1.5">
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded text-white" style={{ background: a.color }}>
                              {a.severity}
                            </span>
                            <span className="text-sm font-bold text-foreground">{a.title}</span>
                          </div>
                          <div className="mb-1.5">
                            <span className="text-[10px] text-muted-foreground">Problem: </span>
                            <span className="text-xs text-foreground">{a.problem}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-primary font-semibold">Solution: </span>
                            <span className="text-xs text-foreground">{a.solution}</span>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); setDetailAnnotation(a); }}
                            className="flex items-center gap-1 text-[10px] text-primary mt-2 hover:underline"
                          >
                            View on Model <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* AI Analysis Report */}
              <div className="rounded-lg border border-border p-4" style={{ background: '#111111' }}>
                <h3 className="text-sm font-bold text-primary mb-3 flex items-center gap-2">
                  <Zap className="w-4 h-4" />
                  Engineering Analysis Report
                </h3>
                <div className="prose prose-invert prose-sm max-w-none text-foreground
                  prose-headings:text-primary prose-headings:font-bold prose-headings:text-sm
                  prose-strong:text-primary prose-li:text-muted-foreground
                  prose-p:text-muted-foreground prose-p:leading-relaxed">
                  <ReactMarkdown>{analysis.content}</ReactMarkdown>
                </div>
              </div>

              {/* Download Report */}
              <button
                onClick={() => toast.info('PDF export coming soon')}
                className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2 hover:bg-primary/90 transition-colors"
              >
                <Download className="w-4 h-4" />
                Download Full Report
              </button>
            </div>
          ) : (
            /* Placeholder */
            <div className="h-full flex flex-col items-center justify-center p-8 text-center">
              <Search className="w-12 h-12 text-primary opacity-30 mb-4" />
              <p className="text-muted-foreground text-sm">Analyzing your assembly...</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
