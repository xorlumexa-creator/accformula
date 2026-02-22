import { useState, useRef, useEffect } from 'react';
import { useTelemetry } from '@/context/TelemetryContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Send, Bot, User, Sparkles, Loader2, History } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [projectContext, setProjectContext] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatSessions, setChatSessions] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load project context & past sessions
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
      // Save user message to DB
      await supabase.from('chat_messages').insert({
        user_id: user!.id, session_id: sid, role: 'user', content: text.trim(),
      });

      // Build telemetry summary for context
      let telemetryData: any = null;
      if (stats) {
        telemetryData = {
          rowCount: stats.rowCount,
          columns: stats.numericColumns,
          summary: stats.summary,
        };
      }

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
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
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

      if (!resp.body) throw new Error('No response body');

      const reader = resp.body.getReader();
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

      // Save assistant message to DB
      if (assistantSoFar) {
        await supabase.from('chat_messages').insert({
          user_id: user!.id, session_id: sid, role: 'assistant', content: assistantSoFar,
        });
        // Update session title from first user message
        if (newMessages.length <= 2) {
          const title = text.trim().slice(0, 60);
          await supabase.from('chat_sessions').update({ title }).eq('id', sid);
          setChatSessions(prev => prev.map(s => s.id === sid ? { ...s, title } : s));
        }
      }
    } catch (e) {
      console.error(e);
      toast.error('Failed to connect');
    }
    setIsLoading(false);
  };

  const newChat = () => {
    setMessages([]);
    setSessionId(null);
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

      {/* Chat History Panel */}
      {showHistory && chatSessions.length > 0 && (
        <div className="glass-strong border-glow rounded-lg p-3 mb-4 max-h-48 overflow-y-auto space-y-1">
          {chatSessions.map(s => (
            <button key={s.id} onClick={() => loadChatSession(s.id)}
              className={`w-full text-left p-2 rounded-lg text-sm hover:bg-primary/10 transition-colors ${s.id === sessionId ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}>
              <p className="truncate font-medium">{s.title}</p>
              <p className="text-xs opacity-60">{new Date(s.created_at).toLocaleDateString()}</p>
            </button>
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
            <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${
              msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'glass-strong border-glow prose prose-sm prose-invert max-w-none'
            }`}>
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
