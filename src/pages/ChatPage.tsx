import { useState, useRef, useEffect, useMemo } from 'react';
import { useTelemetry } from '@/context/TelemetryContext';
import { useAuth } from '@/hooks/useAuth';
import { useTelemetryAttempts, useDesignAnalyses } from '@/hooks/useLocalStorage';
import { supabase } from '@/integrations/supabase/client';
import { Send, Bot, User, Sparkles, Loader2, History, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

interface Message { role: 'user' | 'assistant'; content: string; }

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

const suggestions = [
  "Analyze my design for structural risks",
  "Give me a full telemetry summary",
  "What optimizations do you recommend?",
  "Check thermal limits and safety margins",
];

export default function ChatPage() {
  const { stats } = useTelemetry();
  const { user } = useAuth();
  const { attempts, getAttempt } = useTelemetryAttempts();
  const { analyses, getAnalysisByPartName } = useDesignAnalyses();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [projectContext, setProjectContext] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [activeContextPills, setActiveContextPills] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

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
    supabase.from('chat_sessions').select('id, title, created_at')
      .eq('user_id', user.id).order('created_at', { ascending: false }).limit(20)
      .then(({ data }) => { if (data) setChatSessions(data); });
  }, [user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Detect available context from input
  const detectedContext = useMemo(() => {
    const ctx: { label: string; type: 'attempt' | 'part'; key: string }[] = [];
    const text = input.toLowerCase();
    // Detect attempt references
    const attemptMatch = text.match(/attempt\s*(\d+)/g);
    if (attemptMatch) {
      attemptMatch.forEach(m => {
        const num = parseInt(m.replace(/attempt\s*/, ''));
        if (getAttempt(num)) ctx.push({ label: `Attempt ${num}`, type: 'attempt', key: `attempt_${num}` });
      });
    }
    // Detect part name references
    analyses.forEach(a => {
      if (text.includes(a.partName.toLowerCase())) {
        const key = `part_${a.partName}`;
        if (!ctx.find(c => c.key === key)) ctx.push({ label: a.partName, type: 'part', key });
      }
    });
    return ctx;
  }, [input, analyses, getAttempt]);

  // Available context pills (all known data)
  const availableContext = useMemo(() => {
    const ctx: { label: string; type: 'attempt' | 'part'; key: string }[] = [];
    attempts.forEach(a => ctx.push({ label: `Attempt ${a.attemptNumber}`, type: 'attempt', key: `attempt_${a.attemptNumber}` }));
    const seen = new Set<string>();
    analyses.forEach(a => {
      if (!seen.has(a.partName.toLowerCase())) {
        seen.add(a.partName.toLowerCase());
        ctx.push({ label: a.partName, type: 'part', key: `part_${a.partName}` });
      }
    });
    return ctx;
  }, [attempts, analyses]);

  const togglePill = (key: string) => {
    setActiveContextPills(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const buildContextInjection = (text: string): string => {
    let contextStr = '';
    const allKeys = new Set([...activeContextPills, ...detectedContext.map(c => c.key)]);

    allKeys.forEach(key => {
      if (key.startsWith('attempt_')) {
        const num = parseInt(key.replace('attempt_', ''));
        const att = getAttempt(num);
        if (att) {
          contextStr += `\n\n--- TELEMETRY ATTEMPT ${num} DATA ---\nTimestamp: ${att.timestamp}\nRaw Data Preview: ${att.rawData.slice(0, 500)}\nAnalysis Summary: ${att.analysisText.slice(0, 1000)}\nIssues: ${att.severityCards.map(c => `${c.severity}: ${c.title}`).join(', ')}\n---\n`;
        }
      } else if (key.startsWith('part_')) {
        const name = key.replace('part_', '');
        const parts = getAnalysisByPartName(name);
        if (parts.length > 0) {
          const p = parts[parts.length - 1];
          contextStr += `\n\n--- PART ANALYSIS: ${p.partName} ---\nFilename: ${p.filename}\nDimensions: ${p.dimensions ? `${p.dimensions.x.toFixed(1)}×${p.dimensions.y.toFixed(1)}×${p.dimensions.z.toFixed(1)}mm` : 'N/A'}\nDesign Score: ${p.designScore}\nIssues: ${p.severityCards.map(c => `${c.severity}: ${c.title} - ${c.description}`).join('\n')}\nAnalysis: ${p.analysisText.slice(0, 1500)}\n---\n`;
        }
      }
    });

    return contextStr ? `${text}\n\n[CONTEXT DATA INJECTED]${contextStr}` : text;
  };

  const loadChatSession = async (sid: string) => {
    const { data } = await supabase.from('chat_messages')
      .select('role, content').eq('session_id', sid)
      .order('created_at', { ascending: true });
    if (data) {
      setMessages(data as Message[]);
      setSessionId(sid);
      setShowHistory(false);
    }
  };

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const { data, error } = await supabase.from('chat_sessions').insert({
      user_id: user!.id, title: 'New Chat',
    }).select('id').single();
    if (error || !data) throw new Error('Failed to create chat session');
    setSessionId(data.id);
    setChatSessions(prev => [{ id: data.id, title: 'New Chat', created_at: new Date().toISOString() }, ...prev]);
    return data.id;
  };

  const send = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMsg: Message = { role: 'user', content: text.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setIsLoading(true);

    try {
      const sid = await ensureSession();
      await supabase.from('chat_messages').insert({
        user_id: user!.id, session_id: sid, role: 'user', content: text.trim(),
      });

      let telemetryData: any = null;
      if (stats) {
        telemetryData = { rowCount: stats.rowCount, columns: stats.numericColumns, summary: stats.summary };
      }

      // Build messages with context injection on last user message
      const enrichedMessages = newMessages.map((m, i) => {
        if (i === newMessages.length - 1 && m.role === 'user') {
          return { role: m.role, content: buildContextInjection(m.content) };
        }
        return { role: m.role, content: m.content };
      });

      let assistantSoFar = '';
      const upsertAssistant = (chunk: string) => {
        assistantSoFar += chunk;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant') {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantSoFar } : m));
          }
          return [...prev, { role: 'assistant', content: assistantSoFar }];
        });
      };

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: enrichedMessages,
          telemetryStats: telemetryData,
          projectContext,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Request failed' }));
        toast.error(err.error || 'Request failed');
        setIsLoading(false);
        return;
      }

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
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
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      if (assistantSoFar) {
        await supabase.from('chat_messages').insert({
          user_id: user!.id, session_id: sid, role: 'assistant', content: assistantSoFar,
        });
        if (newMessages.length <= 2) {
          const title = text.trim().slice(0, 60);
          await supabase.from('chat_sessions').update({ title }).eq('id', sid);
          setChatSessions(prev => prev.map(s => s.id === sid ? { ...s, title } : s));
        }
      }
      setActiveContextPills([]);
    } catch (e) {
      console.error(e);
      toast.error('Failed to connect');
    }
    setIsLoading(false);
  };

  const newChat = () => { setMessages([]); setSessionId(null); setActiveContextPills([]); };

  const deleteSession = async (sid: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await supabase.from('chat_messages').delete().eq('session_id', sid);
    await supabase.from('chat_sessions').delete().eq('id', sid);
    setChatSessions(prev => prev.filter(s => s.id !== sid));
    if (sessionId === sid) newChat();
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-2xl mx-auto animate-slide-up">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center border-glow">
          <Sparkles className="w-4 h-4 text-primary" />
        </div>
        <h2 className="text-xl font-bold font-display tracking-wide">Engineering AI</h2>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setShowHistory(!showHistory)}
            className="p-2 rounded-lg glass hover:bg-primary/10 transition-colors">
            <History className="w-4 h-4 text-muted-foreground" />
          </button>
          <button onClick={newChat}
            className="px-3 py-1.5 rounded-lg glass text-xs font-medium hover:bg-primary/10 transition-colors text-muted-foreground">
            New Chat
          </button>
        </div>
      </div>

      {showHistory && chatSessions.length > 0 && (
        <div className="glass-strong border-glow rounded-lg p-3 mb-4 max-h-48 overflow-y-auto space-y-1">
          {chatSessions.map(s => (
            <div key={s.id} className="flex items-center gap-1">
              <button onClick={() => loadChatSession(s.id)}
                className={`flex-1 text-left p-2 rounded-lg text-sm hover:bg-primary/10 transition-colors ${s.id === sessionId ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>
                <p className="truncate font-medium">{s.title}</p>
                <p className="text-xs opacity-60">{new Date(s.created_at).toLocaleDateString()}</p>
              </button>
              <button onClick={(e) => deleteSession(s.id, e)} className="p-1.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
        {messages.length === 0 && (
          <div className="text-center py-12 space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto border-glow">
              <Bot className="w-8 h-8 text-primary/50" />
            </div>
            <p className="text-muted-foreground text-sm">
              {stats ? 'Ask about your telemetry or design data' : 'Upload data or import a design to start analysis'}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button key={s} onClick={() => send(s)}
                  className="text-xs glass px-3 py-1.5 rounded-full hover:bg-primary/10 hover:text-primary transition-all">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'glass-strong border-glow prose prose-sm prose-invert max-w-none'}`}>
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

      {/* Context Pills */}
      {availableContext.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          <span className="text-[10px] text-muted-foreground self-center mr-1">Context:</span>
          {availableContext.slice(0, 8).map(c => (
            <button key={c.key} onClick={() => togglePill(c.key)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${activeContextPills.includes(c.key) || detectedContext.some(d => d.key === c.key) ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(input)}
          placeholder="Ask about your engineering data..."
          className="flex-1 glass rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
        />
        <button onClick={() => send(input)} disabled={isLoading}
          className="bg-primary text-primary-foreground p-2.5 rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 glow-red">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
