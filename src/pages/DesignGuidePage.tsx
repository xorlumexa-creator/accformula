import { useEffect, useState, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ArrowLeft, Loader2, Bot, Send, AlertTriangle, CheckCircle2, Wrench
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export default function DesignGuidePage() {
  const { partId } = useParams<{ partId: string }>();
  const { user } = useAuth();
  const [part, setPart] = useState<any>(null);
  const [project, setProject] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user || !partId) return;
    loadPart();
  }, [user, partId]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [chatMessages]);

  const loadPart = async () => {
    if (!user) return;
    const { data: partData } = await supabase.from('project_parts').select('*').eq('id', partId).single();
    if (!partData) return;
    setPart(partData);

    const { data: projData } = await supabase.from('projects').select('*').eq('id', partData.project_id).single();
    setProject(projData);

    const { data: profData } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
    setProfile(profData);

    // Generate design guide if not exists
    if (!partData.design_guide) {
      await generateDesignGuide(partData, projData, profData);
    }

    setLoading(false);
  };

  const generateDesignGuide = async (partData: any, projData: any, profData: any) => {
    setGenerating(true);
    try {
      const systemPrompt = `You are Lumexa's engineering guide. Generate a step-by-step baby guide for designing "${partData.part_name}" in ${profData?.cad_software || 'their CAD software'}. 
User level: ${profData?.experience_level || 'beginner'}
Project: ${projData?.project_name} — ${projData?.description}
Material: ${partData.material}

Format as numbered steps. Each step must have:
- Action (what to do)
- Why (brief reason)
- Expected result

Keep language at ${profData?.experience_level || 'beginner'} level.
Last step must be: "Export as STL and go to CAD Analysis"
Never use LaTeX. Use Unicode symbols: σ ε τ Δ π ≈ ² ³ √ × ° μ`;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Generate a complete step-by-step design guide for: ${partData.part_name} (${partData.material}). This is for ${projData?.project_name}: ${projData?.description}` }],
          systemOverride: systemPrompt,
        }),
      });

      if (!resp.ok) throw new Error('Failed to generate guide');

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let buf = '';

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
            const parsed = JSON.parse(json);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) full += c;
          } catch {}
        }
      }

      await supabase.from('project_parts').update({ design_guide: full }).eq('id', partData.id);
      setPart((p: any) => ({ ...p, design_guide: full }));
    } catch (e) {
      console.error(e);
      toast.error('Failed to generate design guide');
    }
    setGenerating(false);
  };

  const sendChat = async (text: string) => {
    if (!text.trim() || chatLoading) return;
    const userMsg = { role: 'user', content: text.trim() };
    const msgs = [...chatMessages, userMsg];
    setChatMessages(msgs);
    setChatInput('');
    setChatLoading(true);

    try {
      const systemPrompt = `You are Lumexa's engineering coach helping with "${part?.part_name}" for the project "${project?.project_name}". User's CAD software: ${profile?.cad_software}. Experience: ${profile?.experience_level}. Be helpful, use simple language, never LaTeX.`;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: msgs, systemOverride: systemPrompt }),
      });

      if (!resp.ok) throw new Error('Chat failed');

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let full = '';
      let buf = '';

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
            const parsed = JSON.parse(json);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) {
              full += c;
              setChatMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.role === 'assistant') {
                  return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: full } : m);
                }
                return [...prev, { role: 'assistant', content: full }];
              });
            }
          } catch {}
        }
      }
    } catch {
      toast.error('Chat failed');
    }
    setChatLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">Loading...</div>;
  if (!part) return <div className="text-center py-12 text-muted-foreground">Part not found</div>;

  return (
    <div className="space-y-6 animate-slide-up max-w-3xl mx-auto">
      <div className="flex items-center gap-3">
        <Link to="/parts" className="p-2 rounded-lg hover:bg-secondary/50 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-xl font-bold">{part.part_name}</h1>
          <p className="text-xs text-muted-foreground">{part.material} · {part.complexity}</p>
        </div>
        <Badge variant="outline" className="border-primary/30 text-primary">{part.status}</Badge>
      </div>

      {/* Fix Guide (shown if exists) */}
      {part.fix_guide && (
        <div className="rounded-xl border border-orange-500/30 p-5" style={{ background: '#111111' }}>
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            <h2 className="text-lg font-bold text-orange-500">Fix Required</h2>
          </div>
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown>{part.fix_guide}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Design Guide */}
      <div className="rounded-xl border border-border/30 p-5" style={{ background: '#111111' }}>
        <div className="flex items-center gap-2 mb-3">
          <Wrench className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-bold">How to Design This Part</h2>
        </div>
        {generating ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Generating design guide...</span>
          </div>
        ) : part.design_guide ? (
          <div className="prose prose-sm prose-invert max-w-none">
            <ReactMarkdown>{part.design_guide}</ReactMarkdown>
          </div>
        ) : (
          <p className="text-muted-foreground text-center py-8">No guide available yet.</p>
        )}
      </div>

      {/* Chat */}
      <div className="rounded-xl border border-border/30 p-4" style={{ background: '#111111' }}>
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
          <Bot className="w-4 h-4 text-primary" /> Ask about this step
        </h3>
        <div ref={chatRef} className="max-h-60 overflow-y-auto space-y-2 mb-3">
          {chatMessages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 prose prose-sm prose-invert max-w-none'}`}>
                {msg.role === 'assistant' ? <ReactMarkdown>{msg.content}</ReactMarkdown> : msg.content}
              </div>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <Input value={chatInput} onChange={e => setChatInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && sendChat(chatInput)}
            placeholder="Ask anything about this step..." className="flex-1" />
          <Button size="icon" onClick={() => sendChat(chatInput)} disabled={chatLoading}>
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
