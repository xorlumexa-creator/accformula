import { useState, useRef, useCallback, useEffect } from 'react';
import * as THREE from 'three';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import {
  Upload, FileText, Image, Send, Loader2, ChevronRight, ChevronDown, Lightbulb, Sparkles, Thermometer,
  Triangle, Ruler, AlertTriangle, Shield, Box, Crosshair, Search, ChevronUp, CheckCircle, XCircle, Scale,
} from 'lucide-react';
import CADViewer, { type Annotation, type STLData, type HeatSensor, type GeometryZone, ZONE_CONFIG } from '@/components/CADViewer';
import { useTelemetry } from '@/context/TelemetryContext';
import Papa from 'papaparse';

const PYTHON_API = 'https://1d1141ef-3925-4e14-84d3-439cca800d44-00-38kio9wyr2lpc.sisko.replit.dev:8000/analyze-part';

const cadSoftware = [
  'Fusion 360', 'Blender', 'SolidWorks', 'AutoCAD', 'CATIA',
  'Siemens NX', 'Onshape', 'FreeCAD', 'SketchUp', 'Inventor', 'Rhino', 'Tinkercad',
];

const exportGuidelines: Record<string, { steps: string[]; formats: string }> = {
  'Fusion 360': { steps: ['Open your design in Fusion 360', 'Go to File → Export', 'Choose STEP, IGES, or JSON format', 'Enable metadata export in settings', 'Save and upload the file here'], formats: 'STEP, IGES, JSON' },
  'Blender': { steps: ['Select your object in the viewport', 'Go to File → Export', 'Choose glTF, FBX, or JSON format', 'Enable geometry + hierarchy data export', 'Upload the exported file'], formats: 'glTF, FBX, JSON' },
  'SolidWorks': { steps: ['Open your part or assembly', 'Go to File → Save As', 'Select STEP or Parasolid format', 'Include feature tree data in export options', 'Upload the file here'], formats: 'STEP, Parasolid' },
  'AutoCAD': { steps: ['Open your drawing file', 'Go to File → Export → Other Formats', 'Select DXF, STEP, or IGES format', 'Configure export units and precision', 'Upload the exported file'], formats: 'DXF, STEP, IGES' },
  'CATIA': { steps: ['Open your CATPart or CATProduct', 'Go to File → Save As', 'Choose STEP AP214 or IGES format', 'Enable geometric and PMI data export', 'Upload the file here'], formats: 'STEP AP214, IGES' },
  'Siemens NX': { steps: ['Open your part in NX', 'Go to File → Export', 'Select STEP, JT, or Parasolid format', 'Configure tessellation quality settings', 'Upload the exported file'], formats: 'STEP, JT, Parasolid' },
  'Onshape': { steps: ['Open your document', 'Right-click the Part Studio tab', 'Select Export and choose STEP or STL', 'Configure resolution settings', 'Download and upload here'], formats: 'STEP, STL, Parasolid' },
  'FreeCAD': { steps: ['Open your model in FreeCAD', 'Go to File → Export', 'Select STEP, IGES, or STL format', 'Review mesh quality for STL exports', 'Upload the exported file'], formats: 'STEP, IGES, STL' },
  'SketchUp': { steps: ['Open your project in SketchUp', 'Go to File → Export → 3D Model', 'Choose STL, DAE, or FBX format', 'Set export units appropriately', 'Upload the file here'], formats: 'STL, DAE, FBX' },
  'Inventor': { steps: ['Open your part or assembly', 'Go to File → Export → CAD Format', 'Select STEP or IGES format', 'Include assembly structure data', 'Upload the exported file'], formats: 'STEP, IGES' },
  'Rhino': { steps: ['Open your model in Rhino', 'Go to File → Export Selected', 'Choose STEP, IGES, or 3DM format', 'Set tolerance and units', 'Upload the file here'], formats: 'STEP, IGES, 3DM' },
  'Tinkercad': { steps: ['Open your design in Tinkercad', 'Click Export in the top-right', 'Choose STL or OBJ format', 'Download the file to your computer', 'Upload it here'], formats: 'STL, OBJ' },
};

const VIEWER_FORMATS = ['stl', 'obj', 'gltf', 'glb'];
const ACCEPTED_FILES = '.step,.stp,.iges,.igs,.stl,.obj,.json,.xml,.csv,.gltf,.glb,.fbx';
const ACCEPTED_IMAGES = 'image/png,image/jpeg,image/webp';
const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

const ANALYSIS_MESSAGES = [
  'Processing real dimensions...',
  'Identifying stress zones...',
  'Calculating material options...',
  'Generating annotations...',
  'Computing design score...',
];

const TEMP_PATTERNS = /temp|temperature|thermal|heat|celsius|fahrenheit|kelvin|°c|°f|t_/i;

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
const SEVERITY_STYLES: Record<string, { bg: string; border: string; text: string }> = {
  CRITICAL: { bg: 'bg-destructive/10', border: 'border-destructive/30', text: 'text-destructive' },
  HIGH: { bg: 'bg-orange-500/10', border: 'border-orange-500/30', text: 'text-orange-400' },
  MEDIUM: { bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', text: 'text-yellow-400' },
  LOW: { bg: 'bg-muted/30', border: 'border-border/30', text: 'text-muted-foreground' },
};

interface PythonGeoData {
  dimensions_mm: { x: number; y: number; z: number };
  volume_mm3: number;
  surface_area_mm2?: number;
  center_of_gravity: { x: number; y: number; z: number };
  is_watertight: boolean;
  vertex_count: number;
  face_count: number;
}

const MATERIALS = [
  { name: 'Aluminum 6061', density: 2.7, color: 'text-foreground' },
  { name: 'Carbon Fiber', density: 1.6, color: 'text-foreground' },
  { name: 'PLA Plastic', density: 1.24, color: 'text-foreground' },
  { name: 'Steel', density: 7.8, color: 'text-foreground' },
  { name: 'Titanium', density: 4.43, color: 'text-foreground' },
];

interface AnalysisResult { content: string; annotations?: Annotation[]; }

export default function ImportDesignPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const telemetry = useTelemetry();

  // Core state
  const [software, setSoftware] = useState('');
  const [structuredData, setStructuredData] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState('');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  // 3D viewer state
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelType, setModelType] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<number | null>(null);
  const [stlData, setStlData] = useState<STLData | null>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>('');

  // Python geometry state
  const [pythonGeo, setPythonGeo] = useState<PythonGeoData | null>(null);
  const [pythonLoading, setPythonLoading] = useState(false);
  const [pythonStatus, setPythonStatus] = useState<'idle' | 'loading' | 'success' | 'failed'>('idle');
  const [selectedMaterial, setSelectedMaterial] = useState(0);

  // Design score
  const [designScore, setDesignScore] = useState<number | null>(null);

  // Geometry data panel
  const [geoExpanded, setGeoExpanded] = useState(false);

  // Geometry zones state
  const [showZones, setShowZones] = useState(true);
  const [selectedZone, setSelectedZone] = useState<string | null>(null);
  const [zonesExpanded, setZonesExpanded] = useState(true);

  // Heat stress state
  const [heatMode, setHeatMode] = useState(false);
  const [heatModalOpen, setHeatModalOpen] = useState(false);
  const [heatNoTempOpen, setHeatNoTempOpen] = useState(false);
  const [heatSensors, setHeatSensors] = useState<HeatSensor[]>([]);
  const [heatOpacity, setHeatOpacity] = useState(80);
  const [heatAnalysis, setHeatAnalysis] = useState<string | null>(null);
  const [heatAnalyzing, setHeatAnalyzing] = useState(false);

  // Collapsible sections
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const toggleSection = (key: string) => setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));

  // Cycle analysis messages
  useEffect(() => {
    if (!analyzing) return;
    let i = 0;
    setAnalysisMessage(ANALYSIS_MESSAGES[0]);
    setAnalysisProgress(0);
    const interval = setInterval(() => {
      i = (i + 1) % ANALYSIS_MESSAGES.length;
      setAnalysisMessage(ANALYSIS_MESSAGES[i]);
      setAnalysisProgress(prev => Math.min(90, prev + 15));
    }, 2500);
    return () => clearInterval(interval);
  }, [analyzing]);

  const getFileExt = (name: string) => name.split('.').pop()?.toLowerCase() || '';

  // Python geometry fetch
  const fetchPythonGeo = useCallback(async (file: File) => {
    setPythonLoading(true);
    setPythonStatus('loading');
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const formData = new FormData();
      formData.append('file', file);
      const resp = await fetch(PYTHON_API, { method: 'POST', body: formData, signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) throw new Error('API error');
      const data: PythonGeoData = await resp.json();
      setPythonGeo(data);
      setPythonStatus('success');
    } catch {
      setPythonStatus('failed');
    } finally {
      setPythonLoading(false);
    }
  }, []);

  const loadModel = useCallback((file: File) => {
    const ext = getFileExt(file.name);
    if (!VIEWER_FORMATS.includes(ext)) {
      toast({ title: 'Unsupported 3D format', description: 'Please upload STL, OBJ, GLTF or GLB format only.', variant: 'destructive' });
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({ title: 'File exceeds 50MB limit', description: 'Please optimize your STL first.', variant: 'destructive' });
      return;
    }
    setModelLoading(true);
    setStlData(null);
    setPythonGeo(null);
    setPythonStatus('idle');
    setShowZones(true);
    setSelectedZone(null);
    setDesignScore(null);
    setResult(null);
    setAnnotations([]);
    if (modelUrl) URL.revokeObjectURL(modelUrl);
    const url = URL.createObjectURL(file);
    setModelUrl(url);
    setModelType(ext);
    setUploadedFile(file);
    setUploadedFileName(file.name);
    setTimeout(() => setModelLoading(false), 300);

    // Send to Python API immediately
    fetchPythonGeo(file);
  }, [modelUrl, toast, fetchPythonGeo]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadModel(file);
  }, [loadModel]);

  const handleModelInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadModel(file);
  };

  const handleSTLParsed = useCallback((data: STLData) => {
    setStlData(data);
  }, []);

  // ─── Heat Stress Logic ───
  const handleHeatStressToggle = () => {
    if (heatMode) { setHeatMode(false); return; }
    setHeatModalOpen(true);
  };

  const processHeatTelemetry = (rows: Record<string, any>[], columns: string[]) => {
    const tempCols = columns.filter(c => TEMP_PATTERNS.test(c));
    if (tempCols.length === 0) {
      setHeatNoTempOpen(true);
      setHeatModalOpen(false);
      return;
    }
    const lastRow = rows[rows.length - 1] || {};
    const bbox = stlData?.boundingBox;
    const w = bbox?.width || 100;

    const sensors: HeatSensor[] = tempCols.map((col, i) => {
      const temp = parseFloat(String(lastRow[col])) || 25;
      const frac = tempCols.length > 1 ? i / (tempCols.length - 1) : 0.5;
      return { name: col, temperature: temp, position: new THREE.Vector3((frac - 0.5) * w * 0.8, 0, 0), mapped: true };
    });

    setHeatSensors(sensors);
    setHeatMode(true);
    setHeatModalOpen(false);
    runHeatAnalysis(sensors);
  };

  const handleHeatUploadCSV = (file: File) => {
    Papa.parse(file, {
      header: true, skipEmptyLines: true, dynamicTyping: true,
      complete: (results) => {
        const columns = results.meta.fields || [];
        processHeatTelemetry(results.data as Record<string, any>[], columns);
      },
    });
  };

  const handleHeatUseLast = () => {
    if (telemetry.data.length > 0 && telemetry.stats) {
      processHeatTelemetry(telemetry.data as Record<string, any>[], telemetry.stats.columns);
    } else {
      toast({ title: 'No telemetry data available', description: 'Upload telemetry data first on the Telemetry page.', variant: 'destructive' });
    }
  };

  const runHeatAnalysis = async (sensors: HeatSensor[]) => {
    setHeatAnalyzing(true);
    try {
      const sensorSummary = sensors.map(s => `${s.name}: ${s.temperature.toFixed(1)}°C`).join('\n');
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Analyze this heat stress data mapped onto a 3D engineering component:\n\nTEMPERATURE READINGS:\n${sensorSummary}\n\nCOMPONENT: ${uploadedFileName || 'Unknown'}\nDIMENSIONS: ${stlData ? `${stlData.boundingBox.width.toFixed(1)}mm × ${stlData.boundingBox.height.toFixed(1)}mm × ${stlData.boundingBox.depth.toFixed(1)}mm` : 'Unknown'}\n\nProvide:\n1. THERMAL OVERVIEW\n2. CRITICAL ZONES\n3. THERMAL PATTERNS\n4. ROOT CAUSE ANALYSIS\n5. COOLING RECOMMENDATIONS\n6. MATERIAL ASSESSMENT\n7. THERMAL SCORE X/10` }],
          projectContext: null, telemetryStats: null,
        }),
      });
      if (!resp.ok) throw new Error('Heat analysis failed');
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
            if (c) { fullText += c; setHeatAnalysis(fullText); }
          } catch { textBuffer = line + '\n' + textBuffer; break; }
        }
      }
    } catch { toast({ title: 'Heat analysis failed', variant: 'destructive' }); }
    finally { setHeatAnalyzing(false); }
  };

  // Volume helper
  const getVolumeMm3 = () => {
    if (pythonGeo?.volume_mm3) return pythonGeo.volume_mm3;
    if (stlData) return stlData.boundingBox.volume;
    return 0;
  };

  const getVolumeCm3 = () => getVolumeMm3() / 1000;

  // ─── Main Analysis ───
  const handleAnalyze = async () => {
    if (!structuredData.trim() && !uploadedFile) {
      toast({ title: 'Please provide design data or upload a file', variant: 'destructive' });
      return;
    }
    setAnalyzing(true);
    setResult(null);
    setAnnotations([]);
    setSelectedAnnotation(null);
    setDesignScore(null);

    try {
      const { data: projects } = await supabase
        .from('projects').select('*').eq('user_id', user!.id)
        .order('created_at', { ascending: false }).limit(1);
      const project = projects?.[0];

      let fileContent = '';
      if (uploadedFile && !VIEWER_FORMATS.includes(getFileExt(uploadedFile.name))) {
        fileContent = await uploadedFile.text();
      }

      // Build enhanced prompt with Python data
      const pg = pythonGeo;
      const dims = pg ? pg.dimensions_mm : stlData ? { x: stlData.boundingBox.width, y: stlData.boundingBox.height, z: stlData.boundingBox.depth } : null;
      const volume = pg?.volume_mm3 || (stlData ? stlData.boundingBox.volume : 0);
      const surfaceArea = pg?.surface_area_mm2 || stlData?.surfaceArea || 0;
      const cog = pg?.center_of_gravity || stlData?.centerOfMass || { x: 0, y: 0, z: 0 };
      const watertight = pg ? pg.is_watertight : stlData ? !stlData.hasHoles : true;
      const vertCount = pg?.vertex_count || stlData?.vertexCount || 0;
      const faceCount = pg?.face_count || stlData?.triangleCount || 0;
      const selectedMat = MATERIALS[selectedMaterial];

      let userContent = `You are Lumexa Engineering AI analyzing a 3D mechanical design.

USER PROJECT CONTEXT:
What they are building: ${project?.purpose || project?.project_name || 'Not specified'}
Budget: ${project?.budget_range || 'Not specified'}
CAD Software used: ${software || 'Not specified'}

REAL GEOMETRIC DATA ${pg ? 'FROM PYTHON ANALYSIS' : '(Three.js Estimates)'}:
Part filename: ${uploadedFileName || 'Unknown'}
Real Dimensions: ${dims ? `${dims.x.toFixed(1)}mm x ${dims.y.toFixed(1)}mm x ${dims.z.toFixed(1)}mm` : 'Unknown'}
Real Volume: ${volume.toFixed(1)}mm3
Real Surface Area: ${surfaceArea.toFixed(1)}mm2
Real Center of Gravity: X:${cog.x.toFixed(2)}mm Y:${cog.y.toFixed(2)}mm Z:${cog.z.toFixed(2)}mm
Mesh Watertight: ${watertight}
Vertex Count: ${vertCount}
Face Count: ${faceCount}
Estimated Mass ${selectedMat.name}: ${(getVolumeCm3() * selectedMat.density).toFixed(1)}g

MESH QUALITY ASSESSMENT:
Watertight mesh: ${watertight} ${!watertight ? '— mesh has open boundaries indicating geometry errors' : ''}
Vertex to face ratio: ${(vertCount / Math.max(faceCount, 1)).toFixed(3)}
`;

      if (stlData) {
        userContent += `
GEOMETRY ANALYSIS ZONES DETECTED:
${stlData.geometryZones.map(z => `- ${z.label} (${z.severity}): ${z.explanation}`).join('\n')}
Thin section percentage: ${stlData.thinSectionPercent.toFixed(1)}%
Aspect ratio: ${stlData.aspectRatio.toFixed(1)}:1
`;
      }

      if (structuredData) userContent += `\nADDITIONAL DESIGN DATA PROVIDED BY USER:\n\`\`\`\n${structuredData}\n\`\`\`\n`;
      if (fileContent) userContent += `\nUPLOADED FILE (${uploadedFile?.name}):\n\`\`\`\n${fileContent.slice(0, 10000)}\n\`\`\`\n`;
      if (!dims && !structuredData.trim()) userContent = `Analyze the following engineering design:\n${software ? `Software: ${software}\n` : ''}${structuredData}`;

      userContent += `

Based on ALL of this real geometric data provide a comprehensive engineering design analysis:

1. COMPONENT IDENTIFICATION — What is this component, what system, industry, manufacturing method
2. GEOMETRIC INSIGHTS — Analyze real dimensions ${dims ? `[${dims.x.toFixed(1)} x ${dims.y.toFixed(1)} x ${dims.z.toFixed(1)}mm]` : ''} and volume. Design intent, complexity
3. STRUCTURAL RISKS — Each risk with name (bold), severity CRITICAL/HIGH/MEDIUM/LOW, location, engineering explanation, consequence
4. MATERIAL RECOMMENDATIONS — Given budget ${project?.budget_range || 'unknown'} and real volume ${volume.toFixed(0)}mm3, recommend optimal material. Calculate exact weight for each option
5. MANUFACTURING ASSESSMENT — Based on real dimensions assess 3D printability, CNC machinability, tolerance concerns, cost range
6. OPTIMIZATION RECOMMENDATIONS — Specific geometry changes with exact mm, weight reduction, strength improvement
7. NEXT STEPS — Prioritized actions referencing real dimensions
8. DESIGN SCORE — Structural X/10, Manufacturing X/10, Optimization X/10, Overall X/10, Status: CRITICAL/NEEDS WORK/GOOD/EXCELLENT

Special rules:
${!watertight ? '- Mesh is NOT watertight — add CRITICAL annotation for mesh errors' : ''}
${dims && Math.min(dims.x, dims.y, dims.z) < 2 ? '- Minimum dimension below 2mm — add HIGH annotation for thin wall risk' : ''}

Be specific, technical and actionable. Use real engineering terminology. Reference actual measurements in mm.

Then output JSON annotations:
\`\`\`annotations-json
{
  "annotations": [
    {"id": 1, "severity": "CRITICAL", "zone": "zone_name", "position_hint": "far_end_top", "title": "Issue Title", "problem": "Detailed problem referencing actual mm from data", "solution": "Specific solution with exact mm", "color": "#ff0000"}
  ]
}
\`\`\`

Severity colors: CRITICAL=#ff0000, HIGH=#ff6600, MEDIUM=#ffaa00, LOW=#888888
Valid position_hints: far_end_top, far_end_bottom, middle_center, near_end_top, near_end_bottom, middle_top, middle_bottom`;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: userContent }],
          projectContext: project ? {
            name: project.project_name, category: project.category, purpose: project.purpose,
            budget: project.budget_range, complexity: project.complexity, description: project.description,
          } : null,
          telemetryStats: null,
        }),
      });

      if (!resp.ok) {
        if (resp.status === 429) throw new Error('Rate limit exceeded. Please try again shortly.');
        if (resp.status === 402) throw new Error('AI credits exhausted. Please add credits.');
        throw new Error('Analysis failed. Please try pasting your design data manually.');
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
            if (c) { fullText += c; setResult({ content: fullText }); }
          } catch { textBuffer = line + '\n' + textBuffer; break; }
        }
      }

      // Parse annotations
      let parsedAnnotations: Annotation[] = [];
      try {
        const match = fullText.match(/```annotations-json\s*([\s\S]*?)```/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.annotations) parsedAnnotations = parsed.annotations;
        }
      } catch {}

      setAnnotations(parsedAnnotations);

      // Calculate design score
      let score = 100;
      parsedAnnotations.forEach(a => {
        if (a.severity === 'CRITICAL') score -= 25;
        else if (a.severity === 'HIGH') score -= 15;
        else if (a.severity === 'MEDIUM') score -= 8;
        else score -= 3;
      });
      setDesignScore(Math.max(0, score));

      // Clean content (remove JSON annotations from display)
      setResult({ content: fullText, annotations: parsedAnnotations });
    } catch (err: any) {
      toast({ title: err.message || 'Analysis failed', variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  const guide = software ? exportGuidelines[software] : null;
  const displayContent = result?.content?.replace(/```annotations-json[\s\S]*?```/g, '').trim();
  const geometryZones = stlData?.geometryZones || [];
  const sortedZones = [...geometryZones].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));
  const sortedAnnotations = [...annotations].sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9));

  const getScoreStyle = (s: number) => {
    if (s >= 90) return { bg: 'bg-[#001a00]', badge: 'EXCELLENT', badgeColor: 'bg-green-600', text: 'text-green-400' };
    if (s >= 80) return { bg: 'bg-[#1a1400]', badge: 'GOOD', badgeColor: 'bg-yellow-600', text: 'text-yellow-400' };
    if (s >= 60) return { bg: 'bg-[#1a0800]', badge: 'NEEDS WORK', badgeColor: 'bg-orange-600', text: 'text-orange-400' };
    return { bg: 'bg-[#1a0000]', badge: 'CRITICAL', badgeColor: 'bg-destructive', text: 'text-destructive' };
  };

  const geoHealth = pythonGeo ? (pythonGeo.is_watertight ? 'Good' : 'Warning') : stlData ? (!stlData.hasHoles ? 'Good' : 'Warning') : 'N/A';

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border-glow">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold font-display tracking-wide">Import Design Data</h2>
          <p className="text-sm text-muted-foreground">Upload 3D models, extract geometry, and submit for AI analysis</p>
        </div>
      </div>

      {/* Split layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — 3D Viewer */}
        <div className="space-y-3">
          <div
            className={`relative transition-all ${dragOver ? 'ring-2 ring-primary' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <CADViewer
              fileUrl={modelUrl}
              fileType={modelType}
              loading={modelLoading}
              className="h-[40vh] lg:h-[520px]"
              annotations={annotations}
              selectedAnnotation={selectedAnnotation}
              onSelectAnnotation={setSelectedAnnotation}
              onSTLParsed={handleSTLParsed}
              heatSensors={heatSensors}
              heatMode={heatMode}
              heatOpacity={heatOpacity / 100}
              geometryZones={geometryZones}
              showZones={showZones && !heatMode}
              selectedZone={selectedZone}
              onSelectZone={setSelectedZone}
            />
            {dragOver && (
              <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-20">
                <p className="text-primary font-semibold">Drop 3D file here</p>
              </div>
            )}
          </div>

          {/* Python geometry status */}
          {pythonStatus === 'loading' && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" /> Extracting geometry...
            </div>
          )}
          {pythonStatus === 'success' && (
            <div className="flex items-center gap-2 text-xs text-green-400 animate-pulse">
              <CheckCircle className="w-3 h-3" /> Geometry extracted ✓
            </div>
          )}

          {/* Upload + Heat Stress buttons */}
          <div className="flex gap-2">
            <input ref={modelInputRef} type="file" accept=".stl,.obj,.gltf,.glb" className="hidden" onChange={handleModelInput} />
            <Button variant="outline" className="flex-1 gap-2" onClick={() => modelInputRef.current?.click()}>
              <Upload className="w-4 h-4" />
              <span className="truncate">{uploadedFile ? uploadedFile.name : 'Upload 3D Model (STL, OBJ, GLTF, GLB)'}</span>
            </Button>
            {modelUrl && modelType === 'stl' && (
              <Button variant={heatMode ? 'default' : 'secondary'} className="gap-1.5" onClick={handleHeatStressToggle}>
                <Thermometer className="w-4 h-4" />
                <span className="hidden sm:inline">Heat</span>
              </Button>
            )}
          </div>

          {/* Heat opacity slider */}
          {heatMode && (
            <div className="flex items-center gap-3 px-1">
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">Heat Overlay:</span>
              <Slider value={[heatOpacity]} onValueChange={([v]) => setHeatOpacity(v)} min={10} max={100} step={5} className="flex-1" />
              <span className="text-[10px] text-muted-foreground w-8">{heatOpacity}%</span>
            </div>
          )}

          {/* STL Data Summary */}
          {(stlData || pythonGeo) && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                  <Ruler className="w-3 h-3" /> Dimensions
                </div>
                <p className="text-xs font-bold text-foreground font-mono">
                  {pythonGeo ? `${pythonGeo.dimensions_mm.x.toFixed(0)}×${pythonGeo.dimensions_mm.y.toFixed(0)}×${pythonGeo.dimensions_mm.z.toFixed(0)}mm` :
                    stlData ? `${stlData.boundingBox.width.toFixed(0)}×${stlData.boundingBox.height.toFixed(0)}×${stlData.boundingBox.depth.toFixed(0)}mm` : '—'}
                </p>
              </div>
              <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                  <Triangle className="w-3 h-3" /> Triangles
                </div>
                <p className="text-xs font-bold text-foreground">{(pythonGeo?.face_count || stlData?.triangleCount || 0).toLocaleString()}</p>
              </div>
              <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                  <AlertTriangle className="w-3 h-3" /> Thin Sections
                </div>
                <p className={`text-xs font-bold ${stlData && stlData.thinSectionPercent > 30 ? 'text-destructive' : 'text-foreground'}`}>
                  {stlData ? `${stlData.thinSectionPercent.toFixed(1)}%` : '—'}
                </p>
              </div>
              <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                  <Search className="w-3 h-3" /> Zones Found
                </div>
                <p className="text-xs font-bold text-primary">{geometryZones.length}</p>
              </div>
            </div>
          )}

          {/* ─── Geometry Data Panel (Collapsible) ─── */}
          {(pythonGeo || stlData) && (
            <Collapsible open={geoExpanded} onOpenChange={setGeoExpanded}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between bg-secondary/50 rounded-lg px-3 py-2 border border-border/30 hover:bg-secondary/70 transition-colors">
                  <span className="text-xs font-medium text-muted-foreground">Geometry Data</span>
                  {geoExpanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="bg-[#0a0a0a] rounded-lg border border-border/30 p-3 mt-1 grid grid-cols-2 gap-x-6 gap-y-2 text-[11px]">
                  {pythonGeo ? (
                    <>
                      <div>
                        <span className="text-muted-foreground">Dimensions</span>
                        <p className="text-primary font-mono">{pythonGeo.dimensions_mm.x.toFixed(1)} × {pythonGeo.dimensions_mm.y.toFixed(1)} × {pythonGeo.dimensions_mm.z.toFixed(1)} mm</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Center of Gravity</span>
                        <p className="text-primary font-mono">X:{pythonGeo.center_of_gravity.x.toFixed(2)} Y:{pythonGeo.center_of_gravity.y.toFixed(2)} Z:{pythonGeo.center_of_gravity.z.toFixed(2)} mm</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Volume</span>
                        <p className="text-primary font-mono">{pythonGeo.volume_mm3.toFixed(1)} mm³</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Mesh Quality</span>
                        <p className={`font-mono ${pythonGeo.is_watertight ? 'text-green-400' : 'text-destructive'}`}>
                          {pythonGeo.is_watertight ? '✓ Watertight' : '✕ Has Errors'}
                        </p>
                      </div>
                      {pythonGeo.surface_area_mm2 && (
                        <div>
                          <span className="text-muted-foreground">Surface Area</span>
                          <p className="text-primary font-mono">{pythonGeo.surface_area_mm2.toFixed(1)} mm²</p>
                        </div>
                      )}
                      <div>
                        <span className="text-muted-foreground">Vertices / Faces</span>
                        <p className="text-primary font-mono">{pythonGeo.vertex_count.toLocaleString()} / {pythonGeo.face_count.toLocaleString()}</p>
                      </div>
                    </>
                  ) : stlData ? (
                    <>
                      <div>
                        <span className="text-muted-foreground">Dimensions</span>
                        <p className="text-primary font-mono">{stlData.boundingBox.width.toFixed(1)} × {stlData.boundingBox.height.toFixed(1)} × {stlData.boundingBox.depth.toFixed(1)} mm</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Mesh Quality</span>
                        <p className={`font-mono ${!stlData.hasHoles ? 'text-green-400' : 'text-destructive'}`}>
                          {!stlData.hasHoles ? '✓ Watertight' : '✕ Has Holes'}
                        </p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Surface Area</span>
                        <p className="text-primary font-mono">{stlData.surfaceArea.toFixed(1)} mm²</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Vertices / Faces</span>
                        <p className="text-primary font-mono">{stlData.vertexCount.toLocaleString()} / {stlData.triangleCount.toLocaleString()}</p>
                      </div>
                    </>
                  ) : null}
                  {pythonStatus === 'failed' && (
                    <div className="col-span-2 text-muted-foreground italic text-[10px]">Geometry API offline</div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* ─── Material Weight Calculator ─── */}
          {(pythonGeo || stlData) && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Material Weight Calculator</p>
              <div className="space-y-1">
                {MATERIALS.map((mat, idx) => {
                  const weight = getVolumeCm3() * mat.density;
                  const isActive = selectedMaterial === idx;
                  return (
                    <button key={mat.name}
                      onClick={() => setSelectedMaterial(idx)}
                      className={`w-full flex items-center justify-between bg-[#0a0a0a] rounded px-3 py-1.5 border transition-all text-[11px] ${isActive ? 'border-primary/50 ring-1 ring-primary/30' : 'border-border/20 hover:border-border/40'}`}
                    >
                      <span className="text-foreground">{mat.name}</span>
                      <span className="text-primary font-mono font-bold">{weight.toFixed(1)}g</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── Geometry Zones Report ─── */}
          {sortedZones.length > 0 && (
            <Card className="glass-strong border-glow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Search className="w-4 h-4 text-primary" />
                    <span className="uppercase tracking-wider text-muted-foreground">Geometry Inspection</span>
                    <span className="text-xs font-normal text-muted-foreground">({sortedZones.length} zones)</span>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground">Show on 3D</span>
                      <Switch checked={showZones} onCheckedChange={setShowZones} className="scale-75" />
                    </div>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setZonesExpanded(!zonesExpanded)}>
                      {zonesExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              {zonesExpanded && (
                <CardContent className="space-y-2 pt-0">
                  {sortedZones.map((zone) => {
                    const style = SEVERITY_STYLES[zone.severity] || SEVERITY_STYLES.LOW;
                    const typeLabel = ZONE_CONFIG[zone.type]?.label || zone.type;
                    const isActive = selectedZone === zone.id;
                    return (
                      <div
                        key={zone.id}
                        onClick={() => { setSelectedZone(isActive ? null : zone.id); setShowZones(true); }}
                        className={`rounded-lg border p-3 cursor-pointer transition-all hover:ring-1 hover:ring-primary/30 ${style.bg} ${style.border} ${isActive ? 'ring-2 ring-primary' : ''}`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: zone.color }} />
                            <span className="text-xs font-bold text-foreground">{zone.label}</span>
                          </div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${style.bg} ${style.text}`}>
                            {zone.severity}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-background/50 border border-border/30 text-muted-foreground">
                            {typeLabel}
                          </span>
                          {zone.affectedTriangles > 0 && (
                            <span className="text-[10px] text-muted-foreground">{zone.affectedTriangles} faces</span>
                          )}
                        </div>
                        <p className="text-[11px] text-foreground/70 mb-1.5">{zone.explanation}</p>
                        <div className="flex items-start gap-1.5 bg-background/30 rounded px-2 py-1.5 border border-border/20">
                          <Lightbulb className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                          <p className="text-[11px] text-foreground/80">{zone.suggestion}</p>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              )}
            </Card>
          )}

          <p className="text-[10px] text-muted-foreground/50 text-center">
            3D visualization is for reference only. Critical zone highlighting is based on geometry analysis of provided data.
          </p>

          {/* Heat Analysis Results */}
          {heatMode && (heatAnalyzing || heatAnalysis) && (
            <Card className="glass-strong border-glow">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Thermometer className="w-4 h-4 text-destructive" />
                  <span className="uppercase tracking-wider text-muted-foreground">Thermal Analysis</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="prose prose-sm prose-invert max-w-none">
                {heatAnalyzing && !heatAnalysis && (
                  <div className="flex items-center gap-2 text-muted-foreground py-4">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Analyzing thermal data…</span>
                  </div>
                )}
                {heatAnalysis && <ReactMarkdown>{heatAnalysis}</ReactMarkdown>}
              </CardContent>
            </Card>
          )}
        </div>

        {/* RIGHT — Controls + Results */}
        <div className="space-y-4">
          {/* Software selector */}
          <Card className="glass-strong border-glow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Select CAD Software</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={software} onValueChange={setSoftware}>
                <SelectTrigger className="bg-background/50 border-border/50">
                  <SelectValue placeholder="Select the software used" />
                </SelectTrigger>
                <SelectContent>
                  {cadSoftware.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          {/* Export guide */}
          {guide && (
            <Card className="glass border-glow animate-slide-up">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-primary" />
                  <span className="uppercase tracking-wider text-muted-foreground">Export Guide — {software}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-2">
                  {guide.steps.map((step, i) => (
                    <div key={i} className="flex items-start gap-3 text-sm">
                      <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
                      <span className="text-foreground/80">{step}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-2 text-xs text-muted-foreground">
                  <ChevronRight className="w-3 h-3" />
                  Supported: <span className="text-primary font-medium">{guide.formats}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Data input */}
          <Card className="glass-strong border-glow">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Design Data Input</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={structuredData}
                onChange={e => setStructuredData(e.target.value)}
                placeholder="Paste structured data, JSON, STEP metadata, or exported design parameters…"
                className="min-h-[100px] bg-background/50 border-border/50 font-mono text-xs"
                rows={5}
              />
              <div className="grid grid-cols-2 gap-2">
                <div onClick={() => fileRef.current?.click()} className="flex items-center gap-2 p-3 rounded-lg bg-background/30 border border-dashed border-border/50 cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all group">
                  <input ref={fileRef} type="file" accept={ACCEPTED_FILES} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setUploadedFile(f); }} />
                  <Upload className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
                  <div className="min-w-0"><p className="text-xs font-medium truncate">{uploadedFile ? uploadedFile.name : 'Upload File'}</p></div>
                </div>
                <div onClick={() => imageRef.current?.click()} className="flex items-center gap-2 p-3 rounded-lg bg-background/30 border border-dashed border-border/50 cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all group">
                  <input ref={imageRef} type="file" accept={ACCEPTED_IMAGES} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setUploadedImage(f); }} />
                  <Image className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
                  <div className="min-w-0"><p className="text-xs font-medium truncate">{uploadedImage ? uploadedImage.name : 'Screenshot'}</p></div>
                </div>
              </div>
              <Button onClick={handleAnalyze} disabled={analyzing} className="w-full glow-red">
                {analyzing ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" /> {analysisMessage}
                    <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary/20">
                      <div className="h-full bg-primary transition-all duration-500" style={{ width: `${analysisProgress}%` }} />
                    </div>
                  </>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> Submit for Analysis</>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* ─── Design Score Card ─── */}
          {designScore !== null && (
            <div className={`rounded-lg p-4 ${getScoreStyle(designScore).bg} border border-[#222222] animate-slide-up`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-3xl font-bold text-primary font-display">{designScore}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Design Score</p>
                </div>
                <Badge className={`${getScoreStyle(designScore).badgeColor} text-foreground`}>
                  {getScoreStyle(designScore).badge}
                </Badge>
              </div>
              <div className="flex gap-2 mt-3">
                <div className={`flex-1 bg-background/30 rounded px-2 py-1 text-center`}>
                  <p className={`text-[10px] font-bold ${geoHealth === 'Good' ? 'text-green-400' : 'text-destructive'}`}>{geoHealth}</p>
                  <p className="text-[9px] text-muted-foreground">Geometry</p>
                </div>
                <div className="flex-1 bg-background/30 rounded px-2 py-1 text-center">
                  <p className={`text-[10px] font-bold ${getScoreStyle(designScore).text}`}>{designScore >= 80 ? 'Good' : designScore >= 60 ? 'Fair' : 'Poor'}</p>
                  <p className="text-[9px] text-muted-foreground">Structural</p>
                </div>
                <div className="flex-1 bg-background/30 rounded px-2 py-1 text-center">
                  <p className={`text-[10px] font-bold ${stlData && Math.min(stlData.boundingBox.width, stlData.boundingBox.height, stlData.boundingBox.depth) < 1.5 ? 'text-destructive' : 'text-green-400'}`}>
                    {stlData && Math.min(stlData.boundingBox.width, stlData.boundingBox.height, stlData.boundingBox.depth) < 1.5 ? 'Warning' : 'Ready'}
                  </p>
                  <p className="text-[9px] text-muted-foreground">Mfg Ready</p>
                </div>
                <div className="flex-1 bg-background/30 rounded px-2 py-1 text-center">
                  <p className="text-[10px] font-bold text-foreground">{(getVolumeCm3() * MATERIALS[selectedMaterial].density).toFixed(0)}g</p>
                  <p className="text-[9px] text-muted-foreground">Weight</p>
                </div>
              </div>
            </div>
          )}

          {/* Analysis Results */}
          {result && displayContent && (
            <div className="space-y-3 animate-slide-up">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold font-display tracking-wide">Analysis Results</h3>
              </div>
              <Card className="glass-strong border-glow">
                <CardContent className="pt-5 prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown>{displayContent}</ReactMarkdown>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ─── Annotation Cards (never raw JSON) ─── */}
          {sortedAnnotations.length > 0 && (
            <div className="space-y-2 animate-slide-up">
              <h4 className="text-xs font-bold text-primary uppercase tracking-wider flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" /> Critical Issues Found ({sortedAnnotations.length})
              </h4>
              {sortedAnnotations.map(a => {
                const severityBg = a.severity === 'CRITICAL' ? 'bg-destructive/20' : a.severity === 'HIGH' ? 'bg-orange-500/20' : a.severity === 'MEDIUM' ? 'bg-yellow-500/20' : 'bg-muted/20';
                return (
                  <div key={a.id} className="bg-[#0a0a0a] rounded-lg p-3 border-l-4 cursor-pointer hover:ring-1 hover:ring-primary/20 transition-all"
                    style={{ borderLeftColor: a.color }}
                    onClick={() => setSelectedAnnotation(selectedAnnotation === a.id ? null : a.id)}
                  >
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
                        <span className="text-[9px] text-green-400 uppercase">Solution:</span>
                        <p className="text-[11px] text-foreground">{a.solution}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Disclaimer */}
      <p className="text-[10px] text-muted-foreground/40 text-center max-w-xl mx-auto">
        Lumexa CAD Analysis is AI-powered interpretation of your design data and 3D geometry.
        Heat visualization based on real sensor data mapped to component geometry. Not a substitute for certified FEA simulation software or CFD analysis.
      </p>

      {/* Heat Stress Modal */}
      <Dialog open={heatModalOpen} onOpenChange={setHeatModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Thermometer className="w-5 h-5 text-destructive" /> Heat Stress Visualization
            </DialogTitle>
            <DialogDescription>Map your real sensor temperature data directly onto your 3D model.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div>
              <input type="file" accept=".csv" className="hidden" id="heat-csv" onChange={e => { const f = e.target.files?.[0]; if (f) handleHeatUploadCSV(f); }} />
              <Button variant="outline" className="w-full gap-2 justify-start" onClick={() => document.getElementById('heat-csv')?.click()}>
                <Upload className="w-4 h-4" /> Upload Telemetry CSV
              </Button>
            </div>
            <Button variant="outline" className="w-full gap-2 justify-start" onClick={handleHeatUseLast}>
              <Box className="w-4 h-4" /> Use Last Telemetry Data
            </Button>
            <Button variant="ghost" className="w-full" onClick={() => setHeatModalOpen(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* No Temperature Data Modal */}
      <Dialog open={heatNoTempOpen} onOpenChange={setHeatNoTempOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-warning" /> No Temperature Data
            </DialogTitle>
            <DialogDescription>Heat Stress visualization requires temperature sensor data in your telemetry. No temperature column was detected.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <p className="text-xs text-muted-foreground">Please include sensors like: temperature_c, temp, T_motor, thermal_reading, heat_sensor</p>
            <div className="flex gap-2">
              <Button variant="ghost" className="flex-1" onClick={() => setHeatNoTempOpen(false)}>Close</Button>
              <Button variant="outline" className="flex-1" onClick={() => { setHeatNoTempOpen(false); setHeatModalOpen(true); }}>Upload New Data</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
