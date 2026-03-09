import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Microscope, Upload, FileText, AlertTriangle, Shield, Activity, MapPin, Percent, Clock, ChevronRight, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';

const FEA_SOFTWARE = [
  'Ansys Mechanical', 'Abaqus', 'SolidWorks Simulation',
  'Fusion 360 Simulation', 'COMSOL Multiphysics', 'Nastran', 'OpenFOAM', 'Other',
];

const ANALYSIS_TYPES = [
  'Static Structural', 'Thermal Analysis', 'Fatigue Analysis',
  'Modal/Vibration', 'CFD', 'Coupled Thermo-Mechanical',
];

const riskColors: Record<string, string> = {
  critical: 'bg-destructive text-destructive-foreground',
  high: 'bg-warning text-warning-foreground',
  medium: 'bg-yellow-500 text-black',
  low: 'bg-success text-success-foreground',
};

const riskBorders: Record<string, string> = {
  critical: 'border-destructive/40',
  high: 'border-warning/40',
  medium: 'border-yellow-500/40',
  low: 'border-success/40',
};

interface FEAResult {
  riskLevel: string;
  riskScore: number;
  overview: string;
  materialPerformance: string;
  stressAnalysis: string;
  thermalAnalysis: string;
  fatigueLifePrediction: string;
  vibrationResonance: string;
  deformationResults: string;
  criticalErrors: string;
  optimizationRecommendations: string;
  nextSteps: string;
  metrics: {
    safetyFactor: string;
    maxStressVsYield: string;
    estimatedServiceLife: string;
    criticalLocation: string;
    failureRiskPercent: string;
  };
}

export default function FEAAnalysisPage() {
  const [software, setSoftware] = useState('');
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [pasteData, setPasteData] = useState('');
  const [fileData, setFileData] = useState('');
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FEAResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const toggleType = (t: string) =>
    setSelectedTypes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = ev => setFileData(ev.target?.result as string);
    reader.readAsText(file);
  };

  const handleSubmit = async () => {
    const data = fileData || pasteData;
    if (!software) return toast({ title: 'Select FEA software', variant: 'destructive' });
    if (selectedTypes.length === 0) return toast({ title: 'Select at least one analysis type', variant: 'destructive' });
    if (!data.trim()) return toast({ title: 'Provide FEA data', variant: 'destructive' });

    setLoading(true);
    setResult(null);
    try {
      const { data: res, error } = await supabase.functions.invoke('fea-analysis', {
        body: { feaData: data, software, analysisTypes: selectedTypes },
      });
      if (error) throw error;
      if (res.error) throw new Error(res.error);
      setResult(res);
    } catch (err: any) {
      toast({ title: 'Analysis failed', description: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const reportSections = result ? [
    { title: 'Overview', content: result.overview },
    { title: 'Material Performance', content: result.materialPerformance },
    { title: 'Stress Analysis', content: result.stressAnalysis },
    { title: 'Thermal Analysis', content: result.thermalAnalysis },
    { title: 'Fatigue & Life Prediction', content: result.fatigueLifePrediction },
    { title: 'Vibration & Resonance', content: result.vibrationResonance },
    { title: 'Deformation Results', content: result.deformationResults },
    { title: 'Critical Errors Found', content: result.criticalErrors },
    { title: 'Optimization Recommendations', content: result.optimizationRecommendations },
    { title: 'Next Steps', content: result.nextSteps },
  ] : [];

  const metrics = result ? [
    { label: 'Safety Factor', value: result.metrics.safetyFactor, icon: Shield },
    { label: 'Max Stress vs Yield', value: result.metrics.maxStressVsYield, icon: Activity },
    { label: 'Estimated Service Life', value: result.metrics.estimatedServiceLife, icon: Clock },
    { label: 'Critical Location', value: result.metrics.criticalLocation, icon: MapPin },
    { label: 'Failure Risk %', value: result.metrics.failureRiskPercent, icon: Percent },
  ] : [];

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🔬</span>
          <h1 className="text-2xl font-bold font-display text-gradient">FEA Analysis</h1>
        </div>
        <p className="text-muted-foreground text-sm">Upload your FEA results and get instant AI engineering interpretation</p>
      </div>

      {/* Step 1 — Software */}
      <Card className="gradient-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 1 — Select FEA Software</CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={software} onValueChange={setSoftware}>
            <SelectTrigger className="w-full md:w-72">
              <SelectValue placeholder="Select FEA Software" />
            </SelectTrigger>
            <SelectContent>
              {FEA_SOFTWARE.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Step 2 — Analysis Type */}
      <Card className="gradient-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 2 — Analysis Type</CardTitle>
          <CardDescription>Select all that apply</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {ANALYSIS_TYPES.map(t => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
                  selectedTypes.includes(t)
                    ? 'bg-primary text-primary-foreground border-primary glow-red'
                    : 'border-border text-muted-foreground hover:text-foreground hover:border-primary/40'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Step 3 — Data Input */}
      <Card className="gradient-card border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Step 3 — Data Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File upload */}
          <div>
            <p className="text-sm text-muted-foreground mb-2">Option A — Upload File (JSON, CSV, XML, TXT)</p>
            <input ref={fileRef} type="file" accept=".json,.csv,.xml,.txt" className="hidden" onChange={handleFile} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} className="gap-2">
              <Upload className="w-4 h-4" /> {fileName || 'Choose File'}
            </Button>
          </div>
          {/* Paste */}
          <div>
            <p className="text-sm text-muted-foreground mb-2">Option B — Paste Results</p>
            <Textarea
              value={pasteData}
              onChange={e => setPasteData(e.target.value)}
              placeholder="Paste your FEA results data here..."
              rows={8}
              className="font-mono text-xs"
            />
          </div>
        </CardContent>
      </Card>

      {/* Step 4 — Submit */}
      <Button
        onClick={handleSubmit}
        disabled={loading}
        size="lg"
        className="w-full text-base font-semibold glow-red gap-2"
      >
        {loading ? 'Analyzing…' : 'Interpret FEA Results'}
        {!loading && <ChevronRight className="w-5 h-5" />}
      </Button>

      {/* Step 5 — Results */}
      {result && (
        <div className="space-y-6 animate-slide-up">
          {/* Risk Score */}
          <Card className={`border ${riskBorders[result.riskLevel] || 'border-border'}`}>
            <CardContent className="flex items-center gap-4 p-6">
              <AlertTriangle className="w-8 h-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Overall Risk Score</p>
                <div className="flex items-center gap-3 mt-1">
                  <span className="text-3xl font-bold data-display">{result.riskScore}</span>
                  <Badge className={`${riskColors[result.riskLevel] || ''} uppercase text-xs`}>
                    {result.riskLevel}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {metrics.map(m => (
              <Card key={m.label} className="gradient-card border-border/50">
                <CardContent className="p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <m.icon className="w-3.5 h-3.5 text-primary" />
                    <span className="text-[11px] text-muted-foreground uppercase tracking-wider">{m.label}</span>
                  </div>
                  <span className="text-sm font-semibold data-display">{m.value}</span>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Report Sections */}
          <Card className="gradient-card border-border/50">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" /> AI Analysis Report
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {reportSections.map(s => (
                s.content ? (
                  <div key={s.title}>
                    <h3 className="text-sm font-semibold text-primary mb-2">{s.title}</h3>
                    <div className="prose prose-invert prose-sm max-w-none text-muted-foreground">
                      <ReactMarkdown>{s.content}</ReactMarkdown>
                    </div>
                  </div>
                ) : null
              ))}
            </CardContent>
          </Card>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3">
            <Button variant="outline" className="gap-2" onClick={() => window.print()}>
              <FileText className="w-4 h-4" /> Generate PDF Report
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => navigate('/chat')}
            >
              <MessageSquare className="w-4 h-4" /> Ask AI About Results
            </Button>
          </div>
        </div>
      )}

      {/* Disclaimer */}
      <p className="text-[11px] text-muted-foreground/60 text-center pt-4">
        Dynaxor FEA Interpretation is AI-powered analysis of your existing FEA results. It does not replace certified FEA simulation software.
      </p>
    </div>
  );
}
