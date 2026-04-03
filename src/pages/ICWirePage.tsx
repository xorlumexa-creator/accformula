import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Loader2, Upload, Cpu, Download, Image as ImageIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
const IMAGE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-image`;

const views = ['Top View', 'Bottom View', 'Front View', 'Back View', 'Left View', 'Right View'];

export default function ICWirePage() {
  const { user } = useAuth();
  const [images, setImages] = useState<(string | null)[]>(Array(6).fill(null));
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState('');
  const [generatedDiagrams, setGeneratedDiagrams] = useState<string[]>([]);
  const [diagramLoading, setDiagramLoading] = useState(false);
  const [project, setProject] = useState<any>(null);
  const [electronics, setElectronics] = useState<any[]>([]);

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
    setGeneratedDiagrams([]);

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

1. **Component Placement Map** — Exact location of each electronic component inside the assembly, referencing which view shows it best
2. **Wire Routing Paths** — Optimal paths for wires between components with specific routing through the assembly
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

      // After text analysis, generate annotated wiring diagrams from uploaded images
      await generateWiringDiagrams(full);
    } catch {
      toast.error('Analysis failed. Please try again.');
    }
    setAnalyzing(false);
  };

  const generateWiringDiagrams = async (analysisText: string) => {
    setDiagramLoading(true);
    const diagrams: string[] = [];

    // Generate annotated diagrams for each uploaded view
    const uploadedImages = images.map((img, i) => img ? { img, view: views[i] } : null).filter(Boolean) as { img: string; view: string }[];

    const componentsText = electronics.map(e => e.component_name).join(', ');

    for (const { img, view } of uploadedImages.slice(0, 4)) {
      try {
        const editPrompt = `Take this exact ${view} of the engineering assembly and overlay a professional wiring/IC placement diagram on top of it. Keep the original image 100% intact and identical. Add these overlays:
- Draw colored component placement boxes with labels for: ${componentsText}
- Draw wire routing lines between components in different colors (red for power, blue for signal, green for ground)
- Add pin labels at connection points
- Add small arrows showing wire direction
- Use a semi-transparent overlay so the original CAD image remains fully visible
- Make labels clean and readable with dark backgrounds behind white text
Style: Professional engineering diagram overlay, clean lines, high contrast labels`;

        const resp = await fetch(IMAGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
          body: JSON.stringify({
            prompt: editPrompt,
            editImage: img,
            model: 'google/gemini-3-pro-image-preview',
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          if (data.imageUrl) {
            diagrams.push(data.imageUrl);
            setGeneratedDiagrams([...diagrams]);
          }
        }
      } catch (e) {
        console.error(`Diagram generation failed for ${view}:`, e);
      }
    }

    if (diagrams.length === 0) {
      toast('Text analysis complete. Image overlay generation was skipped.', { description: 'You can still use the text guide below.' });
    }
    setDiagramLoading(false);
  };

  return (
    <div className="space-y-6 animate-slide-up max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Cpu className="w-6 h-6 text-primary" /> IC & Wire Integration</h1>
        <p className="text-sm text-muted-foreground mt-1">Upload assembly views for AI-generated wiring diagram</p>
      </div>

      {/* Upload Grid */}
      <div className="rounded-xl border border-border/30 p-5" style={{ background: '#111111' }}>
        <h2 className="text-lg font-bold mb-4">Upload 6 Views of Your Assembly</h2>
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
        {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing & Generating Diagrams...</> : <><Cpu className="w-4 h-4" /> Generate Wiring Diagram</>}
      </Button>

      {/* Generated Wiring Diagrams */}
      {(generatedDiagrams.length > 0 || diagramLoading) && (
        <div className="rounded-xl border border-primary/30 p-5" style={{ background: '#111111' }}>
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <ImageIcon className="w-5 h-5 text-primary" /> Annotated Wiring Diagrams
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {generatedDiagrams.map((diagram, i) => (
              <div key={i} className="rounded-lg overflow-hidden border border-border/20">
                <img src={diagram} alt={`Wiring diagram ${i + 1}`} className="w-full h-auto" />
                <div className="p-2 text-xs text-muted-foreground text-center" style={{ background: '#0a0a0a' }}>
                  {uploadedViews[i] || `Diagram ${i + 1}`} — IC Overlay
                </div>
              </div>
            ))}
            {diagramLoading && (
              <div className="rounded-lg border border-border/20 overflow-hidden">
                <Skeleton className="w-full aspect-square" />
                <div className="p-2 text-xs text-muted-foreground text-center" style={{ background: '#0a0a0a' }}>
                  Generating overlay...
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Text Analysis */}
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
        Wiring diagrams are AI-generated guidance. Always verify connections before powering on.
      </p>
    </div>
  );
}
