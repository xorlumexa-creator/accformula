import { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDesignAnalyses } from '@/hooks/useLocalStorage';
import { useNavigate } from 'react-router-dom';
import { Send, Bot, User, Sparkles, Loader2, Clipboard, FileInput, Package, AlertTriangle, CheckCircle, Wrench, ShoppingCart, Box, X, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import CADViewer from '@/components/CADViewer';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface Part {
  partNumber: number;
  partName: string;
  function: string;
  material: string;
  dimensions: { x: number; y: number; z: number };
  quantity: number;
  fabricateOrBuy: string;
  estimatedCostUSD: number;
  assemblyOrder: number;
  analysisRequired: boolean;
  analysisReason: string;
}

interface Brief {
  projectName: string;
  summary: string;
  specs: Record<string, string>;
  parts: Part[];
  recommendations: {
    criticalConsiderations: string[];
    topRisks: string[];
    analysisOrder: string[];
    feaLoadCases: string[];
  };
}

const GEN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/design-generator`;
const STL_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-part-stl`;
const OPENING_MSG = "Hello! I'm your Lumexa Design Engineer. I'll help you plan your build from scratch by asking the right engineering questions.\n\nLet's start simple — **what do you want to build?** Describe it in your own words, no technical knowledge needed.";

export default function DesignGeneratorPage() {
  const { user } = useAuth();
  const { analyses } = useDesignAnalyses();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<Message[]>([{ role: 'assistant', content: OPENING_MSG }]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [checkedParts, setCheckedParts] = useState<Set<number>>(new Set());
  const [generatingPart, setGeneratingPart] = useState<number | null>(null);
  const [partStls, setPartStls] = useState<Record<number, { url: string; source: string }>>({});
  const [viewerPart, setViewerPart] = useState<Part | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const generatePartSTL = async (part: Part) => {
    setGeneratingPart(part.partNumber);
    try {
      const prompt = `${part.partName}: ${part.function}. Material: ${part.material}. Dimensions: ${part.dimensions?.x}x${part.dimensions?.y}x${part.dimensions?.z}mm.`;
      const r = await fetch(STL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ prompt, material: part.material }),
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: 'Failed' }));
        throw new Error(err.detail || err.error || 'Generation failed');
      }
      const source = r.headers.get('x-source') || 'template';
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      setPartStls(prev => ({ ...prev, [part.partNumber]: { url, source } }));
      setViewerPart(part);
      toast.success(`Generated ${part.partName} (${source})`);
    } catch (e: any) {
      toast.error(e.message || 'Generation failed');
    }
    setGeneratingPart(null);
  };

  const generateAllParts = async () => {
    if (!brief) return;
    for (const p of brief.parts) {
      if (!partStls[p.partNumber]) {
        await generatePartSTL(p);
      }
    }
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const isPartAnalysed = (partName: string) => {
    return analyses.some(a => a.partName.toLowerCase() === partName.toLowerCase());
  };

  const send = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Message = { role: 'user', content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const resp = await fetch(GEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          mode: 'interview',
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        toast.error(err.error || 'Request failed');
        setIsLoading(false);
        return;
      }

      let assistantSoFar = '';
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let ni: number;
        while ((ni = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, ni);
          textBuffer = textBuffer.slice(ni + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantSoFar += content;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant' && prev.length === newMessages.length + 1) {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: assistantSoFar } : m);
                }
                return [...prev, { role: 'assistant', content: assistantSoFar }];
              });
            }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Check for GENERATE_BRIEF_NOW trigger
      if (assistantSoFar.includes('GENERATE_BRIEF_NOW')) {
        const jsonMatch = assistantSoFar.match(/GENERATE_BRIEF_NOW\s*(\{[\s\S]*\})/);
        if (jsonMatch) {
          try {
            const briefData = JSON.parse(jsonMatch[1]);
            // Remove the trigger from displayed message
            const cleanMsg = assistantSoFar.split('GENERATE_BRIEF_NOW')[0].trim() + "\n\n✅ **Got it! Generating your complete engineering brief now...**";
            setMessages(prev => prev.map((m, i) => i === prev.length - 1 ? { ...m, content: cleanMsg } : m));
            generateBrief(briefData);
          } catch {
            // If JSON parse fails, continue conversation
          }
        }
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to connect');
    }
    setIsLoading(false);
  };

  const generateBrief = async (briefData: any) => {
    setGeneratingBrief(true);
    try {
      const resp = await fetch(GEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Generate complete parts list and engineering brief.' }],
          mode: 'generate_parts',
          briefData,
        }),
      });

      if (!resp.ok) throw new Error('Failed to generate brief');
      const data = await resp.json();
      if (data.error) throw new Error(data.error);
      setBrief(data);
    } catch (e: any) {
      toast.error(e.message || 'Failed to generate brief');
    }
    setGeneratingBrief(false);
  };

  const copyBrief = () => {
    if (!brief) return;
    const text = `# ${brief.projectName}\n\n${brief.summary}\n\n## Specifications\n${Object.entries(brief.specs).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n## Parts List\n${brief.parts.map(p => `${p.partNumber}. ${p.partName} — ${p.material} (${p.fabricateOrBuy}) $${p.estimatedCostUSD}`).join('\n')}\n\n## Recommendations\n### Critical Considerations\n${brief.recommendations.criticalConsiderations.map(c => `- ${c}`).join('\n')}\n### Top Risks\n${brief.recommendations.topRisks.map(r => `- ${r}`).join('\n')}`;
    navigator.clipboard.writeText(text);
    toast.success('Brief copied to clipboard');
  };

  const totalCost = brief?.parts.reduce((s, p) => s + p.estimatedCostUSD * p.quantity, 0) || 0;

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border-glow">
          <Sparkles className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold font-display tracking-wide">Design Generator</h2>
          <p className="text-sm text-muted-foreground">Describe what you want to build. AI will guide you through engineering requirements.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4" style={{ minHeight: 'calc(100vh - 14rem)' }}>
        {/* LEFT — Interview Chat */}
        <div className="lg:col-span-5 flex flex-col rounded-lg border border-border/30 overflow-hidden" style={{ background: '#0a0a0a' }}>
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary" />
                  </div>
                )}
                <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'glass-strong border-glow prose prose-sm prose-invert max-w-none'}`}>
                  {msg.role === 'assistant' ? <ReactMarkdown>{msg.content}</ReactMarkdown> : msg.content}
                </div>
                {msg.role === 'user' && (
                  <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex gap-2.5">
                <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="glass-strong border-glow rounded-xl px-4 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                </div>
              </div>
            )}
          </div>
          <div className="p-3 border-t border-border/30 flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send(input)}
              placeholder="Describe your project..."
              className="flex-1 glass rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              disabled={isLoading || generatingBrief}
            />
            <button onClick={() => send(input)} disabled={isLoading || generatingBrief}
              className="bg-primary text-primary-foreground p-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* RIGHT — Generated Results */}
        <div className="lg:col-span-7 space-y-4 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 14rem)' }}>
          {generatingBrief && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 className="w-10 h-10 animate-spin text-primary" />
              <p className="text-muted-foreground text-sm">Generating engineering brief...</p>
            </div>
          )}

          {!brief && !generatingBrief && (
            <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center border-glow">
                <Package className="w-8 h-8 text-primary/50" />
              </div>
              <p className="text-muted-foreground text-sm max-w-md">
                Answer the interview questions on the left. Once complete, a full engineering brief with parts list will appear here.
              </p>
            </div>
          )}

          {brief && (
            <div className="space-y-4 animate-slide-up">
              {/* Project Overview */}
              <div className="rounded-lg border border-primary/30 p-5" style={{ background: '#111111' }}>
                <h3 className="text-lg font-bold text-primary font-display mb-2">{brief.projectName}</h3>
                <p className="text-sm text-muted-foreground mb-4">{brief.summary}</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.entries(brief.specs).map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-secondary/30 p-2">
                      <p className="text-[10px] text-muted-foreground uppercase">{k}</p>
                      <p className="text-xs font-medium">{v}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Parts List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-primary font-display uppercase tracking-wider">
                    Required Parts & Components
                  </h3>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Est. Total: ${totalCost.toFixed(0)}</span>
                    <button onClick={generateAllParts} disabled={generatingPart !== null}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50">
                      {generatingPart !== null ? <Loader2 className="w-3 h-3 animate-spin" /> : <Box className="w-3 h-3" />}
                      Generate All 3D
                    </button>
                  </div>
                </div>
                {brief.parts.map(p => {
                  const analysed = isPartAnalysed(p.partName);
                  const stl = partStls[p.partNumber];
                  const isGen = generatingPart === p.partNumber;
                  return (
                    <div key={p.partNumber} className="rounded-lg border border-border/30 p-3 flex items-start gap-3" style={{ background: '#111111' }}>
                      <input type="checkbox"
                        checked={checkedParts.has(p.partNumber) || analysed}
                        onChange={() => {
                          setCheckedParts(prev => {
                            const next = new Set(prev);
                            next.has(p.partNumber) ? next.delete(p.partNumber) : next.add(p.partNumber);
                            return next;
                          });
                        }}
                        className="mt-1 accent-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold">{p.partNumber}. {p.partName}</span>
                          <Badge className={`text-[10px] ${p.fabricateOrBuy === 'buy' ? 'bg-blue-600/20 text-blue-400' : 'bg-orange-600/20 text-orange-400'}`}>
                            {p.fabricateOrBuy === 'buy' ? <><ShoppingCart className="w-3 h-3 mr-1" />Buy</> : <><Wrench className="w-3 h-3 mr-1" />Fabricate</>}
                          </Badge>
                          {analysed && <Badge className="bg-green-600/20 text-green-400 text-[10px]"><CheckCircle className="w-3 h-3 mr-1" />Analysed</Badge>}
                          {stl && <Badge className="bg-primary/20 text-primary text-[10px]"><Box className="w-3 h-3 mr-1" />3D Ready</Badge>}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{p.function}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
                          <span className="text-primary">{p.material}</span>
                          {p.dimensions && <span>{p.dimensions.x}×{p.dimensions.y}×{p.dimensions.z}mm</span>}
                          <span>Qty: {p.quantity}</span>
                          <span>${p.estimatedCostUSD}</span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {stl ? (
                          <button onClick={() => setViewerPart(p)}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-primary/20 text-primary text-[10px] font-medium hover:bg-primary/30">
                            <Box className="w-3 h-3" /> View 3D
                          </button>
                        ) : (
                          <button onClick={() => generatePartSTL(p)} disabled={isGen || generatingPart !== null}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-secondary text-foreground text-[10px] font-medium hover:bg-secondary/80 disabled:opacity-50">
                            {isGen ? <Loader2 className="w-3 h-3 animate-spin" /> : <Box className="w-3 h-3" />}
                            Generate 3D
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Recommendations */}
              <div className="rounded-lg border border-border/30 p-4 space-y-3" style={{ background: '#111111' }}>
                <h3 className="text-sm font-bold text-primary font-display uppercase tracking-wider">Engineering Recommendations</h3>
                {brief.recommendations.criticalConsiderations?.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-muted-foreground mb-1">Critical Considerations</p>
                    <ul className="space-y-1">{brief.recommendations.criticalConsiderations.map((c, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-2"><AlertTriangle className="w-3 h-3 text-primary shrink-0 mt-0.5" />{c}</li>
                    ))}</ul>
                  </div>
                )}
                {brief.recommendations.topRisks?.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-muted-foreground mb-1">Top Risks</p>
                    <ul className="space-y-1">{brief.recommendations.topRisks.map((r, i) => (
                      <li key={i} className="text-xs text-muted-foreground flex gap-2"><AlertTriangle className="w-3 h-3 text-orange-400 shrink-0 mt-0.5" />{r}</li>
                    ))}</ul>
                  </div>
                )}
                {brief.recommendations.analysisOrder?.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-muted-foreground mb-1">Suggested Analysis Order</p>
                    <ol className="space-y-1">{brief.recommendations.analysisOrder.map((a, i) => (
                      <li key={i} className="text-xs text-muted-foreground">{i + 1}. {a}</li>
                    ))}</ol>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button onClick={copyBrief} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors">
                  <Clipboard className="w-4 h-4" /> Copy Full Brief
                </button>
                <button onClick={() => navigate('/import-design')} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-primary/30 text-primary text-sm font-medium hover:bg-primary/10 transition-colors">
                  <FileInput className="w-4 h-4" /> Start Analysing Parts
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 3D Viewer Modal */}
      {viewerPart && partStls[viewerPart.partNumber] && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setViewerPart(null)}>
          <div className="w-full max-w-5xl h-[80vh] rounded-xl border border-primary/30 flex flex-col overflow-hidden" style={{ background: '#0a0a0a' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-border/30">
              <div>
                <h3 className="text-base font-bold text-primary font-display">{viewerPart.partName}</h3>
                <p className="text-xs text-muted-foreground">
                  {viewerPart.material} · {viewerPart.dimensions?.x}×{viewerPart.dimensions?.y}×{viewerPart.dimensions?.z}mm · Source: {partStls[viewerPart.partNumber].source}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a href={partStls[viewerPart.partNumber].url} download={`${viewerPart.partName.replace(/\s+/g, '_')}.stl`}
                  className="flex items-center gap-1 px-3 py-1.5 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90">
                  <Download className="w-3 h-3" /> STL
                </a>
                <button onClick={() => setViewerPart(null)} className="p-1.5 rounded hover:bg-secondary">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 relative">
              <CADViewer fileUrl={partStls[viewerPart.partNumber].url} fileType="stl" className="h-full" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
