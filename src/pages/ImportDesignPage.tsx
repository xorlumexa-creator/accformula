import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import AdSenseBanner from '@/components/AdSenseBanner';
import * as THREE from 'three';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import ReactMarkdown from 'react-markdown';
import {
  Upload, FileText, Send, Loader2, ChevronDown, ChevronUp,
  AlertTriangle, Shield, Ruler, Triangle, Search, CheckCircle, XCircle,
  Thermometer, Target, Wrench, Download, RefreshCw, Microscope
} from 'lucide-react';
import CADViewer, { type Annotation, type STLData, type HeatSensor } from '@/components/CADViewer';
import { useTelemetry } from '@/context/TelemetryContext';
import { useDesignAnalyses } from '@/hooks/useLocalStorage';
import { toast } from 'sonner';
import Papa from 'papaparse';

const BACKEND_URL = 'https://salman894552-axul.hf.space';
const INTERPRET_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/gemini-interpret`;

const ACCURACY_LEVELS = [
  { level: 1, label: "Standard", description: "6000 ray samples, standard FEM", surface: "machined", reliability: 0.90, force_multiplier: 1.0 },
  { level: 2, label: "Enhanced", description: "10000 ray samples, tighter tolerances", surface: "machined", reliability: 0.95, force_multiplier: 1.2 },
  { level: 3, label: "High Precision", description: "15000 samples, ground surface finish", surface: "ground", reliability: 0.99, force_multiplier: 1.5 },
  { level: 4, label: "Engineering Grade", description: "20000 samples, mirror polish reference", surface: "mirror_polished", reliability: 0.999, force_multiplier: 2.0 },
  { level: 5, label: "Aerospace Grade", description: "Maximum samples, aerospace reliability", surface: "electropolished", reliability: 0.9999, force_multiplier: 2.5 },
];

const LOADING_STEPS = [
  'Uploading to analysis engine...',
  'Running geometric analysis...',
  'Measuring wall thickness...',
  'Running FEA simulation...',
  'Detecting holes and features...',
  'Analysis complete — generating report...',
  'Placing 3D annotations...',
];

const MATERIALS_LIST = ['auto', 'Aluminum 6061', 'Steel', 'Titanium', 'PLA Plastic', 'Carbon Fiber', 'ABS', 'Nylon'];

interface BackendData {
  geometry?: { dimensions_mm?: { x: number; y: number; z: number }; volume_mm3?: number; surface_area_mm2?: number; center_of_gravity?: { x: number; y: number; z: number }; is_watertight?: boolean; vertex_count?: number; face_count?: number };
  health_score?: { score: number; label: string };
  analytical_fea?: { stress?: { von_mises_mpa?: number }; safety_factor?: number };
  wall_thickness?: { min_mm?: number; max_mm?: number; avg_mm?: number };
  hole_analysis?: { all_holes?: any[]; count?: number };
  fatigue_analysis?: { Se_modified_mpa?: number; goodman_sf?: number; hours_to_failure?: number; status?: string };
  fracture_mechanics?: { K_mpa_sqrtm?: number; critical_crack_mm?: number; hours_to_failure?: number; status?: string };
  generated_stl_base64?: string;
  gemini_context?: string;
  [key: string]: any;
}

interface GeminiResult {
  overview?: string;
  severity_cards?: any[];
  screw_table?: any[];
  modifications?: any[];
  material_recommendation?: any;
  optimization?: string[];
  assembly_score?: number;
  annotations?: any[];
  fea_summary?: string;
  fatigue_summary?: string;
  health_verdict?: string;
  error?: string;
  raw?: string;
}

export default function ImportDesignPage() {
  const { user } = useAuth();
  const { saveAnalysis } = useDesignAnalyses();
  const telemetry = useTelemetry();

  const [partName, setPartName] = useState('');
  const [selectedMaterial, setSelectedMaterial] = useState('auto');
  const [force, setForce] = useState('1000');
  const [forceDir, setForceDir] = useState('z');
  const [operatingTemp, setOperatingTemp] = useState('25');

  // File + model state
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [modelType, setModelType] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [stlData, setStlData] = useState<STLData | null>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);

  // Backend data
  const [backendData, setBackendData] = useState<BackendData | null>(null);
  const [backendLoading, setBackendLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);

  // Gemini interpretation
  const [geminiData, setGeminiData] = useState<GeminiResult | null>(null);
  const [geminiLoading, setGeminiLoading] = useState(false);

  // Annotations
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedAnnotation, setSelectedAnnotation] = useState<number | null>(null);

  // Accuracy loop
  const [accuracyLevel, setAccuracyLevel] = useState(0);
  const [refining, setRefining] = useState(false);

  // Active tab
  const [activeTab, setActiveTab] = useState<string>('overview');

  // Cold start retry
  const [retryCount, setRetryCount] = useState(0);
  const [retryCountdown, setRetryCountdown] = useState(0);

  // Error
  const [error, setError] = useState<string | null>(null);

  // Heat stress
  const [heatMode, setHeatMode] = useState(false);
  const [heatSensors, setHeatSensors] = useState<HeatSensor[]>([]);
  const [heatOpacity, setHeatOpacity] = useState(80);

  // Loading step animation
  useEffect(() => {
    if (!backendLoading) return;
    const iv = setInterval(() => setLoadingStep(s => Math.min(s + 1, LOADING_STEPS.length - 1)), 3000);
    return () => clearInterval(iv);
  }, [backendLoading]);

  // Retry countdown
  useEffect(() => {
    if (retryCountdown <= 0) return;
    const iv = setInterval(() => setRetryCountdown(c => c - 1), 1000);
    return () => clearInterval(iv);
  }, [retryCountdown]);

  const loadModel = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!['stl', 'obj', 'gltf', 'glb'].includes(ext)) {
      toast.error('Please upload STL, OBJ, GLTF or GLB');
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error('File exceeds 50MB limit');
      return;
    }
    setModelLoading(true);
    setBackendData(null);
    setGeminiData(null);
    setAnnotations([]);
    setError(null);
    setAccuracyLevel(0);
    if (modelUrl) URL.revokeObjectURL(modelUrl);
    const url = URL.createObjectURL(file);
    setModelUrl(url);
    setModelType(ext);
    setCurrentFile(file);
    setTimeout(() => setModelLoading(false), 300);
  }, [modelUrl]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) loadModel(file);
  }, [loadModel]);

  const handleSTLParsed = useCallback((data: STLData) => {
    setStlData(data);
  }, []);

  const callGeminiInterpret = async (data: BackendData) => {
    setGeminiLoading(true);
    try {
      const resp = await fetch(INTERPRET_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ backendData: data }),
      });
      if (!resp.ok) {
        if (resp.status === 429) toast.error('Rate limit exceeded. Try again shortly.');
        else if (resp.status === 402) toast.error('AI credits exhausted.');
        else toast.error('AI interpretation unavailable — showing raw measurements');
        return;
      }
      const result: GeminiResult = await resp.json();
      setGeminiData(result);

      // Build 3D annotations from Gemini result
      if (result.annotations?.length) {
        const anns: Annotation[] = result.annotations.map((a: any, i: number) => ({
          id: i + 1,
          severity: a.severity || 'MEDIUM',
          zone: a.title || `Issue ${i + 1}`,
          position_hint: a.zone || 'middle_center',
          title: a.title || `Issue ${i + 1}`,
          problem: a.problem || '',
          solution: a.solution || '',
          color: a.color || '#ffaa00',
        }));
        setAnnotations(anns);
      }
    } catch (e) {
      console.error('Gemini interpret failed:', e);
      toast('AI interpretation unavailable — showing raw measurements');
    } finally {
      setGeminiLoading(false);
    }
  };

  const analyzeFile = async (file: File, material?: string, surfaceFinish?: string, reliability?: number, forceMultiplier?: number) => {
    setBackendLoading(true);
    setLoadingStep(0);
    setError(null);
    setGeminiData(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('material', material || selectedMaterial);
    formData.append('force_n', String(parseFloat(force) * (forceMultiplier || 1)));
    formData.append('force_dir', forceDir);
    formData.append('operating_temp_c', operatingTemp);
    formData.append('surface_finish', surfaceFinish || 'machined');
    formData.append('reliability', String(reliability || 0.99));
    formData.append('part_name', partName || file.name);

    try {
      const resp = await fetch(`${BACKEND_URL}/analyze-part`, {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        if (resp.status === 503 || resp.status === 0) {
          // Cold start
          if (retryCount < 3) {
            setRetryCount(r => r + 1);
            setRetryCountdown(15);
            setError('Engineering server is waking up... Auto-retrying.');
            setBackendLoading(false);
            setTimeout(() => analyzeFile(file, material, surfaceFinish, reliability, forceMultiplier), 15000);
            return;
          }
        }
        const errText = await resp.text().catch(() => 'Unknown error');
        throw new Error(`Backend error ${resp.status}: ${errText}`);
      }

      const data: BackendData = await resp.json();
      setBackendData(data);
      setRetryCount(0);

      // Render generated STL if present
      if (data.generated_stl_base64 && !modelUrl) {
        const bytes = Uint8Array.from(atob(data.generated_stl_base64), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        setModelUrl(url);
        setModelType('stl');
      }

      // Now send to Gemini for interpretation
      await callGeminiInterpret(data);

      // Save analysis
      if (partName.trim()) {
        saveAnalysis({
          partName: partName.trim(),
          filename: file.name,
          timestamp: new Date().toISOString(),
          designScore: data.health_score?.score || 0,
          annotationsArray: [],
          analysisText: '',
          geometryData: data.geometry || null,
          severityCards: [],
          dimensions: data.geometry?.dimensions_mm,
        });
      }
    } catch (err: any) {
      setError(err.message || 'Analysis failed');
      toast.error(err.message || 'Analysis failed');
    } finally {
      setBackendLoading(false);
    }
  };

  const handleAnalyze = () => {
    if (!currentFile) {
      toast.error('Upload a 3D model first');
      return;
    }
    analyzeFile(currentFile);
  };

  const refineAnalysis = async () => {
    if (!currentFile || accuracyLevel >= ACCURACY_LEVELS.length - 1) return;
    const nextLevel = accuracyLevel + 1;
    const settings = ACCURACY_LEVELS[nextLevel];
    setAccuracyLevel(nextLevel);
    setRefining(true);
    await analyzeFile(currentFile, selectedMaterial, settings.surface, settings.reliability, settings.force_multiplier);
    setRefining(false);
  };

  const handleSelectAnnotation = useCallback((id: number | null) => {
    setSelectedAnnotation(id);
  }, []);

  // Health score display
  const healthScore = backendData?.health_score?.score;
  const healthLabel = backendData?.health_score?.label;
  const healthColor = healthScore != null ? (healthScore < 55 ? 'text-destructive' : healthScore < 70 ? 'text-orange-400' : 'text-green-400') : '';

  const dims = backendData?.geometry?.dimensions_mm;
  const sf = backendData?.analytical_fea?.safety_factor;
  const vonMises = backendData?.analytical_fea?.stress?.von_mises_mpa;
  const wallMin = backendData?.wall_thickness?.min_mm;
  const holes = backendData?.hole_analysis?.all_holes || [];
  const fatigue = backendData?.fatigue_analysis;
  const fracture = backendData?.fracture_mechanics;

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'fea', label: 'FEA' },
    { key: 'fatigue', label: 'Fatigue' },
    { key: 'fracture', label: 'Fracture' },
    { key: 'holes', label: `Holes (${holes.length})` },
    { key: 'fixes', label: 'Fixes' },
  ];

  const selectedAnn = annotations.find(a => a.id === selectedAnnotation);

  return (
    <div className="space-y-4 animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">CAD Design Analysis</h1>
          <p className="text-sm text-muted-foreground">Upload → Backend Analysis → AI Interpretation → 3D Annotations</p>
        </div>
      </div>

      {/* Error / Cold Start */}
      {error && (
        <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-4">
          <p className="text-sm text-orange-400">{error}</p>
          {retryCountdown > 0 && <p className="text-xs text-muted-foreground mt-1">Retrying in {retryCountdown}s...</p>}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* LEFT PANEL */}
        <div className="lg:col-span-3 space-y-3 order-2 lg:order-1">
          {/* Part name */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Part Name</label>
            <input value={partName} onChange={e => setPartName(e.target.value)}
              placeholder="e.g. Motor Mount" className="w-full bg-background/50 border border-primary/30 rounded-lg px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary" />
          </div>

          {/* Upload */}
          <input ref={modelInputRef} type="file" accept=".stl,.obj,.gltf,.glb" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) loadModel(f); }} />
          <Button variant="outline" className="w-full gap-2 text-xs h-9" onClick={() => modelInputRef.current?.click()}>
            <Upload className="w-3.5 h-3.5" />
            <span className="truncate">{currentFile ? currentFile.name : 'Upload 3D Model'}</span>
          </Button>

          {/* Material */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Material</label>
            <Select value={selectedMaterial} onValueChange={setSelectedMaterial}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MATERIALS_LIST.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Force */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Force (N)</label>
              <input value={force} onChange={e => setForce(e.target.value)} className="w-full bg-background/50 border border-border/30 rounded-lg px-2 py-1.5 text-xs" />
            </div>
            <div>
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Direction</label>
              <Select value={forceDir} onValueChange={setForceDir}>
                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="x">X</SelectItem>
                  <SelectItem value="y">Y</SelectItem>
                  <SelectItem value="z">Z</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Temp */}
          <div>
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1 block">Temp (°C)</label>
            <input value={operatingTemp} onChange={e => setOperatingTemp(e.target.value)} className="w-full bg-background/50 border border-border/30 rounded-lg px-2 py-1.5 text-xs" />
          </div>

          {/* Analyze Button */}
          <Button onClick={handleAnalyze} disabled={backendLoading || !currentFile} className="w-full h-10 text-sm">
            {backendLoading ? (
              <><Loader2 className="w-4 h-4 animate-spin mr-2" /> {LOADING_STEPS[loadingStep]}</>
            ) : (
              <><Send className="w-4 h-4 mr-2" /> Analyze Design</>
            )}
          </Button>

          {/* Backend Metrics (from backend only) */}
          {backendData && (
            <div className="space-y-1.5">
              {/* Health Score */}
              {healthScore != null && (
                <div className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className={`text-2xl font-bold ${healthColor}`}>{healthScore}</p>
                      <p className="text-[10px] text-muted-foreground">Health Score</p>
                    </div>
                    <Badge className={healthScore < 55 ? 'bg-destructive' : healthScore < 70 ? 'bg-orange-600' : 'bg-green-600'}>
                      {healthLabel || (healthScore < 55 ? 'FAIL' : healthScore < 70 ? 'MARGINAL' : 'PASS')}
                    </Badge>
                  </div>
                </div>
              )}

              {dims && (
                <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5"><Ruler className="w-3 h-3" /> Dimensions</div>
                  <p className="text-xs font-bold font-mono">{dims.x.toFixed(1)}×{dims.y.toFixed(1)}×{dims.z.toFixed(1)}mm</p>
                </div>
              )}

              {sf != null && (
                <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5"><Shield className="w-3 h-3" /> Safety Factor</div>
                  <p className={`text-xs font-bold font-mono ${sf < 1.5 ? 'text-destructive' : sf < 2.5 ? 'text-orange-400' : 'text-green-400'}`}>{sf.toFixed(2)}</p>
                </div>
              )}

              {vonMises != null && (
                <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5"><AlertTriangle className="w-3 h-3" /> Von Mises</div>
                  <p className="text-xs font-bold font-mono">{vonMises.toFixed(1)} MPa</p>
                </div>
              )}

              {wallMin != null && (
                <div className="bg-secondary/50 rounded-lg px-3 py-2 border border-border/30">
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5"><Target className="w-3 h-3" /> Min Wall</div>
                  <p className={`text-xs font-bold font-mono ${wallMin < 1.5 ? 'text-destructive' : 'text-green-400'}`}>{wallMin.toFixed(2)}mm</p>
                </div>
              )}
            </div>
          )}

          {/* Accuracy Loop */}
          {backendData && currentFile && (
            <div className="rounded-lg border border-border/30 p-3 space-y-2" style={{ background: '#111111' }}>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Accuracy Level</p>
              <div className="flex gap-1">
                {ACCURACY_LEVELS.map((_, i) => (
                  <div key={i} className={`flex-1 h-1.5 rounded-full ${i <= accuracyLevel ? 'bg-primary' : 'bg-secondary/50'}`} />
                ))}
              </div>
              <div className="text-xs">
                <span className="font-medium text-primary">{ACCURACY_LEVELS[accuracyLevel].label}</span>
                <span className="text-muted-foreground ml-2">{ACCURACY_LEVELS[accuracyLevel].description}</span>
              </div>
              <Button onClick={refineAnalysis} disabled={accuracyLevel >= ACCURACY_LEVELS.length - 1 || refining || backendLoading}
                variant="outline" className="w-full gap-2 text-xs h-8">
                {refining ? (
                  <><Loader2 className="w-3 h-3 animate-spin" /> Refining...</>
                ) : accuracyLevel >= ACCURACY_LEVELS.length - 1 ? (
                  <><CheckCircle className="w-3 h-3" /> Maximum Accuracy</>
                ) : (
                  <><Microscope className="w-3 h-3" /> Refine → {ACCURACY_LEVELS[accuracyLevel + 1]?.label}</>
                )}
              </Button>
              <p className="text-[10px] text-muted-foreground">Each refinement increases ray samples and tightens tolerances. Real re-analysis.</p>
            </div>
          )}
        </div>

        {/* CENTER — 3D Viewer */}
        <div className="lg:col-span-6 order-1 lg:order-2">
          <div className={`relative transition-all ${dragOver ? 'ring-2 ring-primary' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}>
            <CADViewer
              fileUrl={modelUrl}
              fileType={modelType}
              loading={modelLoading}
              className="h-[45vh] lg:h-[calc(100vh-10rem)]"
              annotations={annotations}
              selectedAnnotation={selectedAnnotation}
              onSelectAnnotation={handleSelectAnnotation}
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
        </div>

        {/* RIGHT PANEL — Results */}
        <div className="lg:col-span-3 space-y-3 order-3 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 10rem)' }}>
          {/* Gemini Loading */}
          {geminiLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground p-4 rounded-lg border border-border/30" style={{ background: '#111111' }}>
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Generating AI interpretation...
            </div>
          )}

          {/* Selected Annotation Detail */}
          {selectedAnn && (
            <div className="rounded-lg border-2 p-3 animate-slide-up" style={{ borderColor: `${selectedAnn.color}55`, background: '#111111' }}>
              <div className="flex items-center gap-2 mb-2">
                <Badge className={selectedAnn.severity === 'CRITICAL' ? 'bg-destructive' : selectedAnn.severity === 'HIGH' ? 'bg-orange-600' : selectedAnn.severity === 'MEDIUM' ? 'bg-yellow-600' : 'bg-muted'}>
                  {selectedAnn.severity}
                </Badge>
                <span className="text-sm font-bold">{selectedAnn.title}</span>
              </div>
              <p className="text-xs text-muted-foreground mb-1"><strong>Problem:</strong> {selectedAnn.problem}</p>
              <p className="text-xs text-green-400"><strong>Solution:</strong> {selectedAnn.solution}</p>
            </div>
          )}

          {/* Tabs */}
          {(backendData || geminiData) && (
            <>
              <div className="flex gap-1 flex-wrap">
                {tabs.map(t => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${activeTab === t.key ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:text-foreground'}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              {/* Overview Tab */}
              {activeTab === 'overview' && (
                <div className="space-y-3">
                  {geminiData?.overview && (
                    <div className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                      <p className="text-sm">{geminiData.overview}</p>
                    </div>
                  )}

                  {/* Severity Cards */}
                  {geminiData?.severity_cards?.map((card: any, i: number) => (
                    <div key={i} className="rounded-lg border p-3" style={{
                      borderColor: card.color || '#ffaa00',
                      background: '#111111',
                    }}>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={card.severity === 'CRITICAL' ? 'bg-destructive' : card.severity === 'HIGH' ? 'bg-orange-600' : card.severity === 'MEDIUM' ? 'bg-yellow-600' : 'bg-blue-600'}>
                          {card.severity}
                        </Badge>
                        <span className="text-xs font-bold">{card.title}</span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">{card.problem}</p>
                      <p className="text-[11px] text-green-400 mt-1">Fix: {card.solution}</p>
                      {card.standard && <p className="text-[10px] text-muted-foreground mt-0.5">Ref: {card.standard}</p>}
                    </div>
                  ))}

                  {/* Gemini Health Verdict */}
                  {geminiData?.health_verdict && (
                    <div className="text-center py-2">
                      <Badge className={geminiData.health_verdict === 'PASS' ? 'bg-green-600' : geminiData.health_verdict === 'FAIL' ? 'bg-destructive' : 'bg-orange-600'}>
                        Verdict: {geminiData.health_verdict}
                      </Badge>
                    </div>
                  )}

                  {/* Material Recommendation */}
                  {geminiData?.material_recommendation && (
                    <div className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Material Recommendation</p>
                      <p className="text-xs"><strong>Current:</strong> {geminiData.material_recommendation.current}</p>
                      <p className="text-xs"><strong>Recommended:</strong> {geminiData.material_recommendation.recommended}</p>
                      <p className="text-[11px] text-muted-foreground mt-1">{geminiData.material_recommendation.reason}</p>
                    </div>
                  )}

                  {/* Optimization */}
                  {geminiData?.optimization?.length > 0 && (
                    <div className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Optimizations</p>
                      <ul className="space-y-1">
                        {geminiData.optimization.map((opt: string, i: number) => (
                          <li key={i} className="text-xs text-muted-foreground flex gap-2">
                            <Wrench className="w-3 h-3 text-primary shrink-0 mt-0.5" />
                            {opt}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* No Gemini - show raw backend */}
                  {!geminiData && backendData && !geminiLoading && (
                    <div className="rounded-lg border border-orange-500/30 p-3" style={{ background: '#111111' }}>
                      <p className="text-xs text-orange-400 mb-2">AI interpretation unavailable — showing raw measurements</p>
                      <pre className="text-[10px] text-muted-foreground font-mono overflow-auto max-h-64">
                        {JSON.stringify(backendData, (key, val) => key === 'generated_stl_base64' ? '[STL_DATA]' : val, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              {/* FEA Tab */}
              {activeTab === 'fea' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">FEA Results (Backend)</p>
                    {vonMises != null && <p className="text-xs"><strong>Von Mises Stress:</strong> {vonMises.toFixed(2)} MPa</p>}
                    {sf != null && <p className="text-xs"><strong>Safety Factor:</strong> {sf.toFixed(2)}</p>}
                    {backendData?.analytical_fea?.stress && (
                      <pre className="text-[10px] text-muted-foreground font-mono mt-2 overflow-auto">
                        {JSON.stringify(backendData.analytical_fea, null, 2)}
                      </pre>
                    )}
                  </div>
                  {geminiData?.fea_summary && (
                    <div className="rounded-lg border border-primary/30 p-3" style={{ background: '#111111' }}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">AI Interpretation</p>
                      <p className="text-xs">{geminiData.fea_summary}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Fatigue Tab */}
              {activeTab === 'fatigue' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Fatigue Analysis (Backend)</p>
                    {fatigue ? (
                      <>
                        {fatigue.Se_modified_mpa != null && <p className="text-xs"><strong>Se Modified:</strong> {fatigue.Se_modified_mpa} MPa</p>}
                        {fatigue.goodman_sf != null && <p className="text-xs"><strong>Goodman SF:</strong> {fatigue.goodman_sf}</p>}
                        {fatigue.hours_to_failure != null && <p className="text-xs"><strong>Hours to Failure:</strong> {fatigue.hours_to_failure.toLocaleString()}</p>}
                        {fatigue.status && <Badge className={fatigue.status === 'SAFE' ? 'bg-green-600' : 'bg-destructive'}>{fatigue.status}</Badge>}
                      </>
                    ) : <p className="text-xs text-muted-foreground">Not measured</p>}
                  </div>
                  {geminiData?.fatigue_summary && (
                    <div className="rounded-lg border border-primary/30 p-3" style={{ background: '#111111' }}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">AI Interpretation</p>
                      <p className="text-xs">{geminiData.fatigue_summary}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Fracture Tab */}
              {activeTab === 'fracture' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Fracture Mechanics (Backend)</p>
                    {fracture ? (
                      <>
                        {fracture.K_mpa_sqrtm != null && <p className="text-xs"><strong>K:</strong> {fracture.K_mpa_sqrtm} MPa√m</p>}
                        {fracture.critical_crack_mm != null && <p className="text-xs"><strong>Critical Crack:</strong> {fracture.critical_crack_mm} mm</p>}
                        {fracture.hours_to_failure != null && <p className="text-xs"><strong>Hours to Failure:</strong> {fracture.hours_to_failure.toLocaleString()}</p>}
                        {fracture.status && <Badge className={fracture.status === 'SAFE' ? 'bg-green-600' : 'bg-destructive'}>{fracture.status}</Badge>}
                      </>
                    ) : <p className="text-xs text-muted-foreground">Not measured</p>}
                  </div>
                </div>
              )}

              {/* Holes Tab */}
              {activeTab === 'holes' && (
                <div className="space-y-3">
                  <div className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Detected Holes (Backend)</p>
                    {holes.length > 0 ? (
                      <div className="space-y-2">
                        {holes.map((h: any, i: number) => (
                          <div key={i} className="bg-secondary/30 rounded p-2 text-xs space-y-0.5">
                            <p><strong>Hole {i + 1}:</strong> Ø{h.diameter_mm?.toFixed(2)}mm</p>
                            {h.recommended_screw && <p className="text-muted-foreground">Screw: {h.recommended_screw}</p>}
                            {h.thread_pitch_mm && <p className="text-muted-foreground">Thread: {h.thread_pitch_mm}mm</p>}
                            {h.torque_nm && <p className="text-muted-foreground">Torque: {h.torque_nm} Nm</p>}
                            {h.position && <p className="text-muted-foreground font-mono">Pos: ({h.position.x?.toFixed(1)}, {h.position.y?.toFixed(1)}, {h.position.z?.toFixed(1)})</p>}
                          </div>
                        ))}
                      </div>
                    ) : <p className="text-xs text-muted-foreground">No holes detected</p>}
                  </div>

                  {/* Gemini Screw Table */}
                  {geminiData?.screw_table?.length > 0 && (
                    <div className="rounded-lg border border-primary/30 p-3" style={{ background: '#111111' }}>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Screw Recommendations (AI)</p>
                      <div className="overflow-x-auto">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="border-b border-border/30">
                              <th className="text-left py-1 pr-2">#</th>
                              <th className="text-left py-1 pr-2">Bolt</th>
                              <th className="text-left py-1 pr-2">Pitch</th>
                              <th className="text-left py-1 pr-2">Length</th>
                              <th className="text-left py-1">Torque</th>
                            </tr>
                          </thead>
                          <tbody>
                            {geminiData.screw_table.map((s: any, i: number) => (
                              <tr key={i} className="border-b border-border/10">
                                <td className="py-1 pr-2">{s.hole_number}</td>
                                <td className="py-1 pr-2">{s.bolt_size}</td>
                                <td className="py-1 pr-2">{s.thread_pitch_mm}mm</td>
                                <td className="py-1 pr-2">{s.recommended_length_mm}mm</td>
                                <td className="py-1">{s.torque_nm} Nm</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Fixes Tab */}
              {activeTab === 'fixes' && (
                <div className="space-y-3">
                  {geminiData?.modifications?.length > 0 ? (
                    geminiData.modifications.map((mod: any, i: number) => (
                      <div key={i} className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-primary font-bold text-xs">Step {mod.step}</span>
                        </div>
                        <p className="text-xs font-medium">{mod.action}</p>
                        <p className="text-[11px] text-muted-foreground mt-1">{mod.reason}</p>
                        <div className="flex gap-4 mt-1 text-[10px]">
                          <span className="text-destructive">Before: {mod.before}</span>
                          <span className="text-green-400">After: {mod.after}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-4">No modifications suggested yet. Run analysis first.</p>
                  )}
                </div>
              )}
            </>
          )}

          {/* Annotations List */}
          {annotations.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">3D Annotations ({annotations.length})</p>
              {annotations.map(ann => (
                <button key={ann.id} onClick={() => handleSelectAnnotation(ann.id)}
                  className={`w-full text-left p-2 rounded-lg border text-xs transition-all ${selectedAnnotation === ann.id ? 'border-primary/50 bg-primary/5' : 'border-border/20 hover:border-border/40'}`}
                  style={{ background: '#111111' }}>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ann.color }} />
                    <span className="font-medium truncate">{ann.title}</span>
                    <Badge className={`ml-auto text-[8px] ${ann.severity === 'CRITICAL' ? 'bg-destructive' : ann.severity === 'HIGH' ? 'bg-orange-600' : ann.severity === 'MEDIUM' ? 'bg-yellow-600' : 'bg-muted'}`}>
                      {ann.severity}
                    </Badge>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
