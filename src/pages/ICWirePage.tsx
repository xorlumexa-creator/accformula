import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, Cpu, AlertCircle, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

const views = ['Top View', 'Bottom View', 'Front View', 'Back View', 'Left View', 'Right View'];

export default function ICWirePage() {
  const { user } = useAuth();
  const [images, setImages] = useState<(string | null)[]>(Array(6).fill(null));
  const [files, setFiles] = useState<(File | null)[]>(Array(6).fill(null));
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState('');

  const handleUpload = (index: number, file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      setImages(prev => prev.map((img, i) => i === index ? url : img));
      setFiles(prev => prev.map((f, i) => i === index ? file : f));
    };
    reader.readAsDataURL(file);
  };

  const uploadedCount = images.filter(Boolean).length;

  const analyze = async () => {
    if (uploadedCount < 2) { toast.error('Upload at least 2 views'); return; }
    setAnalyzing(true);
    setResult('');

    try {
      const viewDescriptions = views.map((v, i) => images[i] ? `${v}: Image uploaded` : `${v}: Not provided`).join('\n');

      const systemPrompt = `You are Lumexa's IC & Wiring Integration specialist. The user has uploaded screenshots of their assembled CAD design from multiple angles.

Based on the views provided, generate a comprehensive wiring and IC placement guide:

1. **Component Placement Map** — Where each electronic component should sit inside the assembly
2. **Wire Routing Paths** — Optimal paths for wires between components
3. **Connection Diagram** — Which pins connect to which (text-based schematic)
4. **Clearance Warnings** — Any potential issues with component placement
5. **Assembly Sequence** — Order to install electronics

Use clear numbered steps. Include specific measurements where relevant.
Never use LaTeX. Use Unicode symbols only.
Format with markdown headers and bullet points.`;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `I have uploaded ${uploadedCount} views of my assembled design:\n${viewDescriptions}\n\nGenerate a complete IC integration and wiring diagram guide for assembly.` }],
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
    } catch {
      toast.error('Analysis failed. Please try again.');
    }
    setAnalyzing(false);
  };

  return (
    <div className="space-y-6 animate-slide-up max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Cpu className="w-6 h-6 text-primary" /> IC & Wire Integration</h1>
        <p className="text-sm text-muted-foreground mt-1">Upload assembly views for AI-generated wiring diagram</p>
      </div>

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
        {analyzing ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyzing Assembly...</> : <><Cpu className="w-4 h-4" /> Generate Wiring Diagram</>}
      </Button>

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
