import { useState, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';
import {
  Upload, FileText, Image, Send, Loader2, ChevronRight, Lightbulb, Sparkles,
} from 'lucide-react';
import CADViewer, { type Annotation } from '@/components/CADViewer';

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

interface AnalysisResult { content: string; annotations?: Annotation[]; }

export default function ImportDesignPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [software, setSoftware] = useState('');
  const [structuredData, setStructuredData] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
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
  const modelInputRef = useRef<HTMLInputElement>(null);

  const getFileExt = (name: string) => name.split('.').pop()?.toLowerCase() || '';

  const loadModel = useCallback((file: File) => {
    const ext = getFileExt(file.name);
    if (!VIEWER_FORMATS.includes(ext)) {
      toast({ title: `Unsupported 3D format: .${ext}`, description: 'Use STL, OBJ, GLTF, or GLB', variant: 'destructive' });
      return;
    }
    setModelLoading(true);
    // Revoke old URL
    if (modelUrl) URL.revokeObjectURL(modelUrl);
    const url = URL.createObjectURL(file);
    setModelUrl(url);
    setModelType(ext);
    setUploadedFile(file);
    // Give Three.js a moment
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
      if (uploadedFile) fileContent = await uploadedFile.text();

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: `Analyze the following engineering design data:\n\n${software ? `**CAD Software Used:** ${software}\n\n` : ''}${structuredData ? `**Structured Data:**\n\`\`\`\n${structuredData}\n\`\`\`\n\n` : ''}${fileContent ? `**Uploaded File Content (${uploadedFile?.name}):**\n\`\`\`\n${fileContent.slice(0, 10000)}\n\`\`\`\n\n` : ''}${uploadedImage ? `**Note:** User also attached a design image: ${uploadedImage.name}\n\n` : ''}Please provide a comprehensive engineering analysis.`,
          }],
          projectContext: project ? {
            name: project.project_name, category: project.category, purpose: project.purpose,
            budget: project.budget_range, complexity: project.complexity, description: project.description,
          } : null,
          telemetryStats: null,
        }),
      });

      if (!resp.ok) throw new Error('Analysis failed');

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
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Parse annotations from completed text
      try {
        const match = fullText.match(/```annotations-json\s*([\s\S]*?)```/);
        if (match) {
          const parsed = JSON.parse(match[1]);
          if (parsed.annotations) setAnnotations(parsed.annotations);
        }
      } catch { /* ignore parse errors */ }
    } catch (err: any) {
      toast({ title: err.message || 'Analysis failed', variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  const guide = software ? exportGuidelines[software] : null;

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border-glow">
          <FileText className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold font-display tracking-wide">Import Design Data</h2>
          <p className="text-sm text-muted-foreground">Upload 3D models, export data, and submit for AI analysis</p>
        </div>
      </div>

      {/* Split layout: Viewer + Controls */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* LEFT — 3D Viewer */}
        <div className="space-y-3">
          {/* Drop zone / Viewer */}
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
              className="h-[450px] lg:h-[520px]"
              annotations={annotations}
              selectedAnnotation={selectedAnnotation}
              onSelectAnnotation={setSelectedAnnotation}
            />

            {/* Drag overlay */}
            {dragOver && (
              <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-20">
                <p className="text-primary font-semibold">Drop 3D file here</p>
              </div>
            )}
          </div>

          {/* Upload button */}
          <div className="flex gap-2">
            <input
              ref={modelInputRef}
              type="file"
              accept=".stl,.obj,.gltf,.glb"
              className="hidden"
              onChange={handleModelInput}
            />
            <Button
              variant="outline"
              className="flex-1 gap-2"
              onClick={() => modelInputRef.current?.click()}
            >
              <Upload className="w-4 h-4" />
              {uploadedFile ? uploadedFile.name : 'Upload 3D Model (STL, OBJ, GLTF, GLB)'}
            </Button>
          </div>

          {/* Disclaimer */}
          <p className="text-[10px] text-muted-foreground/50 text-center">
            3D visualization is for reference only. Critical zone highlighting is based on AI analysis of provided data.
          </p>
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
                <div
                  onClick={() => fileRef.current?.click()}
                  className="flex items-center gap-2 p-3 rounded-lg bg-background/30 border border-dashed border-border/50 cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all group"
                >
                  <input ref={fileRef} type="file" accept={ACCEPTED_FILES} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setUploadedFile(f); }} />
                  <Upload className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{uploadedFile ? uploadedFile.name : 'Upload File'}</p>
                  </div>
                </div>
                <div
                  onClick={() => imageRef.current?.click()}
                  className="flex items-center gap-2 p-3 rounded-lg bg-background/30 border border-dashed border-border/50 cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all group"
                >
                  <input ref={imageRef} type="file" accept={ACCEPTED_IMAGES} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) setUploadedImage(f); }} />
                  <Image className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{uploadedImage ? uploadedImage.name : 'Screenshot'}</p>
                  </div>
                </div>
              </div>

              <Button onClick={handleAnalyze} disabled={analyzing} className="w-full glow-red">
                {analyzing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Analyzing…</> : <><Send className="w-4 h-4 mr-2" /> Submit for Analysis</>}
              </Button>
            </CardContent>
          </Card>

          {/* Analysis Results */}
          {result && (
            <div className="space-y-3 animate-slide-up">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                <h3 className="text-base font-bold font-display tracking-wide">Analysis Results</h3>
              </div>
              <Card className="glass-strong border-glow">
                <CardContent className="pt-5 prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown>{result.content}</ReactMarkdown>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
