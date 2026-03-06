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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import ReactMarkdown from 'react-markdown';
import {
  Upload, FileText, Image, Send, Loader2, ChevronRight, ChevronDown, Lightbulb, Sparkles, Thermometer,
  Triangle, Ruler, AlertTriangle, Shield, Box, Crosshair,
} from 'lucide-react';
import CADViewer, { type Annotation, type STLData, type HeatSensor } from '@/components/CADViewer';
import { useTelemetry } from '@/context/TelemetryContext';
import Papa from 'papaparse';

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
  'Analyzing geometry…',
  'Identifying components…',
  'Assessing structural risks…',
  'Evaluating manufacturing feasibility…',
  'Generating recommendations…',
];

const TEMP_PATTERNS = /temp|temperature|thermal|heat|celsius|fahrenheit|kelvin|°c|°f|t_/i;

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
    const interval = setInterval(() => {
      i = (i + 1) % ANALYSIS_MESSAGES.length;
      setAnalysisMessage(ANALYSIS_MESSAGES[i]);
    }, 2500);
    return () => clearInterval(interval);
  }, [analyzing]);

  const getFileExt = (name: string) => name.split('.').pop()?.toLowerCase() || '';

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
    if (modelUrl) URL.revokeObjectURL(modelUrl);
    const url = URL.createObjectURL(file);
    setModelUrl(url);
    setModelType(ext);
    setUploadedFile(file);
    setUploadedFileName(file.name);
    setTimeout(() => setModelLoading(false), 300);
  }, [modelUrl, toast]);

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
    if (heatMode) {
      setHeatMode(false);
      return;
    }
    setHeatModalOpen(true);
  };

  const processHeatTelemetry = (rows: Record<string, any>[], columns: string[]) => {
    const tempCols = columns.filter(c => TEMP_PATTERNS.test(c));
    if (tempCols.length === 0) {
      setHeatNoTempOpen(true);
      setHeatModalOpen(false);
      return;
    }

    // Get last row values for each temp column and auto-map
    const lastRow = rows[rows.length - 1] || {};
    const bbox = stlData?.boundingBox;
    const w = bbox?.width || 100;
    const h = bbox?.height || 100;
    const d = bbox?.depth || 100;

    const sensors: HeatSensor[] = tempCols.map((col, i) => {
      const temp = parseFloat(String(lastRow[col])) || 25;
      const frac = tempCols.length > 1 ? i / (tempCols.length - 1) : 0.5;
      return {
        name: col,
        temperature: temp,
        position: { x: (frac - 0.5) * w * 0.8, y: 0, z: 0 } as any,
        mapped: true,
      };
    });

    setHeatSensors(sensors);
    setHeatMode(true);
    setHeatModalOpen(false);
    // Trigger heat AI analysis
    runHeatAnalysis(sensors);
  };

  const handleHeatUploadCSV = (file: File) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
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
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Analyze this heat stress data mapped onto a 3D engineering component:\n\nTEMPERATURE READINGS:\n${sensorSummary}\n\nCOMPONENT: ${uploadedFileName || 'Unknown'}\nDIMENSIONS: ${stlData ? `${stlData.boundingBox.width.toFixed(1)}mm × ${stlData.boundingBox.height.toFixed(1)}mm × ${stlData.boundingBox.depth.toFixed(1)}mm` : 'Unknown'}\n\nProvide:\n1. THERMAL OVERVIEW - Overall thermal condition\n2. CRITICAL ZONES - Temperature reading, risk level, why dangerous\n3. THERMAL PATTERNS - Hot spots, cold zones, gradient analysis\n4. ROOT CAUSE ANALYSIS - Why zones are hot\n5. COOLING RECOMMENDATIONS - Priority ordered solutions\n6. MATERIAL ASSESSMENT - Suitability for these temperatures\n7. THERMAL SCORE - Overall thermal health X/10`,
          }],
          projectContext: null,
          telemetryStats: null,
        }),
      });
      if (!resp.ok) throw new Error('Heat analysis failed');
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let textBuffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) { fullText += content; setHeatAnalysis(fullText); }
          } catch { textBuffer = line + '\n' + textBuffer; break; }
        }
      }
    } catch {
      toast({ title: 'Heat analysis failed', variant: 'destructive' });
    } finally {
      setHeatAnalyzing(false);
    }
  };

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

    try {
      const { data: projects } = await supabase
        .from('projects').select('*').eq('user_id', user!.id)
        .order('created_at', { ascending: false }).limit(1);
      const project = projects?.[0];

      let fileContent = '';
      if (uploadedFile && !VIEWER_FORMATS.includes(getFileExt(uploadedFile.name))) {
        fileContent = await uploadedFile.text();
      }

      // Build the enhanced prompt with STL data if available
      let userContent = '';
      if (stlData) {
        userContent = `Analyze this engineering component based on REAL extracted geometric data:

COMPONENT DATA:
- Filename: ${stlData.filename}
- Triangles: ${stlData.triangleCount.toLocaleString()}
- Vertices: ${stlData.vertexCount.toLocaleString()}
- Dimensions: ${stlData.boundingBox.width.toFixed(1)}mm × ${stlData.boundingBox.height.toFixed(1)}mm × ${stlData.boundingBox.depth.toFixed(1)}mm
- Bounding Volume: ${stlData.boundingBox.volume.toFixed(1)}mm³
- Surface Area: ${stlData.surfaceArea.toFixed(1)}mm²
- Aspect ratio: ${stlData.aspectRatio.toFixed(1)}:1
- Thin section percentage: ${stlData.thinSectionPercent.toFixed(1)}%
- High density zones: ${stlData.highDensityZones}
- Estimated wall thickness: ${stlData.estimatedWallThickness.toFixed(2)}mm
- Has holes/bores: ${stlData.hasHoles}
- Symmetrical: ${stlData.symmetrical}

CAD SOFTWARE: ${software || 'Not specified'}
`;
      }

      if (structuredData) userContent += `\nADDITIONAL USER DATA:\n\`\`\`\n${structuredData}\n\`\`\`\n`;
      if (fileContent) userContent += `\nUPLOADED FILE (${uploadedFile?.name}):\n\`\`\`\n${fileContent.slice(0, 10000)}\n\`\`\`\n`;
      if (!userContent.trim()) userContent = `Analyze the following engineering design:\n${software ? `Software: ${software}\n` : ''}${structuredData}`;

      userContent += `\n\nProvide a comprehensive engineering analysis with these EXACT sections:

1. COMPONENT IDENTIFICATION — What is this, what system, industry, manufacturing method
2. GEOMETRIC INSIGHTS — Dimensional analysis, feature ID, design intent, complexity
3. STRUCTURAL RISKS — Each risk with name, severity (CRITICAL/HIGH/MEDIUM/LOW), location, explanation, consequence
4. MATERIAL RECOMMENDATIONS — Best material, alternatives, heat treatment, surface finish
5. MANUFACTURING ASSESSMENT — Manufacturability, process, tolerances, cost range
6. OPTIMIZATION RECOMMENDATIONS — Geometry changes, weight reduction, strength improvement with dimensions
7. NEXT STEPS — Prioritized action list, FEA recs, testing, iterations
8. DESIGN SCORE — Structural X/10, Manufacturing X/10, Optimization X/10, Overall X/10, Status: CRITICAL/NEEDS WORK/GOOD/EXCELLENT

Be specific, technical and actionable. Use real engineering terminology. Reference actual measurements.`;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
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
      let fullText = '';
      let textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) { fullText += content; setResult({ content: fullText }); }
          } catch { textBuffer = line + '\n' + textBuffer; break; }
        }
      }

      // Parse annotations
      try {
        const match = fullText.match(/```annotations-json\s*([\s\S]*?)```/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.annotations) setAnnotations(parsed.annotations);
        }
      } catch {}
    } catch (err: any) {
      toast({ title: err.message || 'Analysis failed', variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  const guide = software ? exportGuidelines[software] : null;

  // Clean result content (remove annotations block for display)
  const displayContent = result?.content?.replace(/```annotations-json[\s\S]*?```/g, '').trim();

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
            />
            {dragOver && (
              <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-20">
                <p className="text-primary font-semibold">Drop 3D file here</p>
              </div>
            )}
          </div>

          {/* Upload + Heat Stress buttons */}
          <div className="flex gap-2">
            <input ref={modelInputRef} type="file" accept=".stl,.obj,.gltf,.glb" className="hidden" onChange={handleModelInput} />
            <Button variant="outline" className="flex-1 gap-2" onClick={() => modelInputRef.current?.click()}>
              <Upload className="w-4 h-4" />
              <span className="truncate">{uploadedFile ? uploadedFile.name : 'Upload 3D Model (STL, OBJ, GLTF, GLB)'}</span>
            </Button>
            {modelUrl && modelType === 'stl' && (
              <Button
                variant={heatMode ? 'default' : 'secondary'}
                className="gap-1.5"
                onClick={handleHeatStressToggle}
              >
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
          {stlData && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                  <Ruler className="w-3 h-3" /> Dimensions
                </div>
                <p className="text-xs font-bold text-foreground">
                  {stlData.boundingBox.width.toFixed(0)}×{stlData.boundingBox.height.toFixed(0)}×{stlData.boundingBox.depth.toFixed(0)}mm
                </p>
              </div>
              <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                  <Triangle className="w-3 h-3" /> Triangles
                </div>
                <p className="text-xs font-bold text-foreground">{stlData.triangleCount.toLocaleString()}</p>
              </div>
              <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                  <AlertTriangle className="w-3 h-3" /> Thin Sections
                </div>
                <p className={`text-xs font-bold ${stlData.thinSectionPercent > 30 ? 'text-destructive' : 'text-foreground'}`}>
                  {stlData.thinSectionPercent.toFixed(1)}%
                </p>
              </div>
              <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
                  <Crosshair className="w-3 h-3" /> Stress Zones
                </div>
                <p className="text-xs font-bold text-foreground">{stlData.highDensityZones} found</p>
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground/50 text-center">
            3D visualization is for reference only. Critical zone highlighting is based on AI analysis of provided data.
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
                  <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {analysisMessage}</>
                ) : (
                  <><Send className="w-4 h-4 mr-2" /> Submit for Analysis</>
                )}
              </Button>
            </CardContent>
          </Card>

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
            <DialogDescription>
              Map your real sensor temperature data directly onto your 3D model.
            </DialogDescription>
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
            <DialogDescription>
              Heat Stress visualization requires temperature sensor data in your telemetry.
              No temperature column was detected in your data.
            </DialogDescription>
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
