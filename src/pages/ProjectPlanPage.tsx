import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Rocket, Bot, User, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { callDesignGenerator } from '@/lib/designGenerator';

const DESIGN_GENERATOR_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/design-generator`;
const AUTH_HEADER = `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`;

interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
}

// Streams the interview turn from design-generator (Groq, streamed as SSE) and reports
// each text delta as it arrives, same as before — just server-side now instead of Puter.
async function streamInterview(chatMessages: { role: string; content: string }[], onChunk: (delta: string) => void): Promise<string> {
  const resp = await fetch(DESIGN_GENERATOR_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: AUTH_HEADER },
    body: JSON.stringify({ messages: chatMessages, mode: 'interview' }),
  });
  if (!resp.ok) {
    const errBody = await resp.json().catch(() => ({}));
    throw new Error(errBody.error || 'Chat failed');
  }
  const reader = resp.body?.getReader();
  const decoder = new TextDecoder();
  let full = '';
  let buffer = '';
  if (!reader) return full;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]' || !data) continue;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content || '';
        if (delta) { full += delta; onChunk(delta); }
      } catch { /* ignore partial/incomplete SSE lines */ }
    }
  }
  return full;
}

export default function ProjectPlanPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [profile, setProfile] = useState<any>(null);
  const [pendingBrief, setPendingBrief] = useState<{ brief: any; history: ChatMsg[] } | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('*').eq('user_id', user.id).single()
      .then(({ data }) => { if (data) setProfile(data); });
  }, [user]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  // Auto-start interview on first load
  useEffect(() => {
    if (messages.length === 0 && !streaming) {
      sendMessage('', true);
    }
  }, []);

  const sendMessage = async (text: string, isInit = false) => {
    if (streaming || generating) return;
    if (!isInit && !text.trim()) return;

    const newMessages: ChatMsg[] = isInit
      ? []
      : [...messages, { role: 'user' as const, content: text.trim() }];

    if (!isInit) {
      setMessages(newMessages);
      setInput('');
    }

    setStreaming(true);

    try {
      let liveFull = '';
      const full = await streamInterview(
        newMessages.map(m => ({ role: m.role, content: m.content })),
        (chunk) => {
          liveFull += chunk;
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last?.role === 'assistant') {
              return prev.map((m, i) => i === prev.length - 1 ? { ...m, content: liveFull } : m);
            }
            return [...prev, { role: 'assistant', content: liveFull }];
          });
        }
      );

      // Check if AI wants to generate
      if (full.includes('GENERATE_BRIEF_NOW')) {
        const jsonMatch = full.match(/GENERATE_BRIEF_NOW\s*(\{[\s\S]*\})/);
        if (jsonMatch) {
          try {
            const briefData = JSON.parse(jsonMatch[1]);
            // Remove the GENERATE_BRIEF_NOW from displayed message
            const cleanMsg = full.replace(/GENERATE_BRIEF_NOW[\s\S]*$/, '').trim();
            const history = [...newMessages, { role: 'assistant' as const, content: cleanMsg }];

            if (briefData.feasible === false) {
              // Gemini thinks this isn't physically buildable — stop and let the user decide.
              setMessages(prev => {
                const updated = [...prev];
                if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                  updated[updated.length - 1].content = cleanMsg || "Here's what I found:";
                }
                return [...updated, {
                  role: 'assistant',
                  content: `⚠️ **This might not be physically buildable.**\n\n${briefData.feasibilityReason || "The requirements as described conflict with real-world physics or materials."}\n\nYou can adjust the idea, or tell me to build it anyway and I'll proceed regardless.`,
                }];
              });
              setPendingBrief({ brief: briefData, history });
            } else {
              setMessages(prev => {
                const updated = [...prev];
                if (updated.length > 0 && updated[updated.length - 1].role === 'assistant') {
                  updated[updated.length - 1].content = cleanMsg || "Great! Generating your full engineering package now...";
                }
                return updated;
              });
              await handleGenerate(briefData, history);
            }
          } catch (e) {
            console.error('Failed to parse brief JSON:', e);
          }
        }
      }
    } catch (err: any) {
      toast({ title: err.message || 'Chat failed', variant: 'destructive' });
    }
    setStreaming(false);
  };

  const handleGenerate = async (briefData: any, chatHistory: ChatMsg[]) => {
    if (!user || !profile) return;
    setGenerating(true);

    // Show generating message
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: '🚀 **Generating your build plan...** This includes your major assemblies, electronics, assembly sequence, and testing checklist. Individual part breakdowns are generated on the Parts page, one assembly at a time. Hold tight!'
    }]);

    try {
      const enrichedBrief = {
        ...briefData,
        cadSoftware: profile.cad_software,
        experienceLevel: profile.experience_level || briefData.userLevel,
        country: profile.country,
      };

      // Stage 1 of 2: only the MACRO assemblies (e.g. "Frame", "Arms") plus the full
      // electronics list get generated now — individual manufacturable parts are generated
      // later, one macro assembly at a time, only once the user opens it on the Parts page
      // (see PartsPage.tsx's handleExpandMacro). This is what keeps every single LLM call
      // small and focused instead of asking for an entire 25-40 part project in one shot.
      // Electronics pricing/sourcing/dimensions enrichment (real datasheet lookups via Groq's
      // web-search-enabled compound model) already happens server-side inside this call.
      const result = await callDesignGenerator('generate_macro_parts', {
        briefData: enrichedBrief,
        messages: [{ role: 'user', content: 'Generate the project plan now.' }],
      });

      // Create project — brief_json keeps the FULL original brief (including fields with no
      // dedicated column, e.g. connectivity/specialRequirements/assumptions) so a micro-parts
      // generation call, potentially much later in a different session, has the complete
      // original context to reason with, not just the subset stored in dedicated columns below.
      const { data: projectData, error: projError } = await supabase.from('projects').insert({
        user_id: user.id,
        project_name: briefData.projectName || 'My Project',
        description: briefData.description || briefData.purpose || '',
        category: briefData.category || '',
        purpose: briefData.purpose || '',
        budget_range: briefData.budget || '',
        environment: briefData.environment || '',
        power_source: briefData.powerSource || '',
        control_method: briefData.controlMethod || '',
        microcontroller: briefData.microcontroller || '',
        has_3d_printer: briefData.has3dPrinter || false,
        target_weight: briefData.targetWeight || '',
        target_size: briefData.targetSize || '',
        budget_currency: briefData.budgetCurrency || 'USD',
        brief_json: enrichedBrief,
      }).select('id').single();

      if (projError) throw projError;

      // Save macro parts (status 'pending' — micro parts get generated on demand per assembly)
      if (result.macroParts?.length) {
        const macroToInsert = result.macroParts.map((m: any, i: number) => ({
          project_id: projectData.id,
          user_id: user.id,
          name: m.name || `Assembly ${i + 1}`,
          purpose: m.purpose || '',
          subsystem: m.subsystem || '',
          status: 'pending',
          sort_order: i,
        }));
        await supabase.from('project_macro_parts').insert(macroToInsert);
      }

      // Save electronics
      if (result.electronics?.length) {
        const elecToInsert = result.electronics.map((e: any, i: number) => ({
          project_id: projectData.id,
          user_id: user.id,
          component_name: e.componentName || `Component ${i + 1}`,
          model_recommendation: e.modelRecommendation || '',
          where_to_buy: e.whereToBuy || '',
          price: e.price || 0,
          quantity: e.quantity || 1,
          purpose: e.purpose || '',
          dimensions: e.dimensions || '',
          sort_order: i,
        }));
        await supabase.from('project_electronics').insert(elecToInsert);
      }

      // Generate tasks — scoped to macro assemblies, since individual parts don't exist yet
      // (they're generated later, per assembly, on the Parts page).
      const allMacroParts = result.macroParts || [];
      const taskInserts: any[] = [];
      let taskNum = 1;
      for (const macro of allMacroParts) {
        const name = macro.name || 'Assembly';
        taskInserts.push({ project_id: projectData.id, user_id: user.id, task_number: taskNum++, title: `Design ${name}`, estimated_hours: 2, phase: 2, sort_order: taskNum });
        taskInserts.push({ project_id: projectData.id, user_id: user.id, task_number: taskNum++, title: `Analyse ${name}`, estimated_hours: 1, phase: 3, sort_order: taskNum });
      }
      taskInserts.push({ project_id: projectData.id, user_id: user.id, task_number: taskNum++, title: 'Write Control Code', estimated_hours: 4, phase: 4, sort_order: taskNum });
      taskInserts.push({ project_id: projectData.id, user_id: user.id, task_number: taskNum++, title: 'Complete Assembly', estimated_hours: 3, phase: 5, sort_order: taskNum });
      taskInserts.push({ project_id: projectData.id, user_id: user.id, task_number: taskNum++, title: 'Test & Calibrate', estimated_hours: 2, phase: 6, sort_order: taskNum });
      await supabase.from('project_tasks').insert(taskInserts);

      // Show feasibility summary
      if (result.feasibility) {
        const f = result.feasibility;
        const icon = (v: string) => v === 'pass' ? '✅' : v === 'warning' ? '⚠️' : '❌';
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `## 📊 Feasibility Scorecard\n\n| Check | Status |\n|---|---|\n| Physics | ${icon(f.physics)} |\n| Materials | ${icon(f.materials)} |\n| Buildability | ${icon(f.buildability)} |\n| Budget | ${icon(f.budget)} |\n| Safety | ${icon(f.safety)} |\n\n**Confidence:** ${f.confidence || 'Medium'}\n\n${f.issues?.length ? '**Issues:** ' + f.issues.join(', ') : ''}\n\n✅ **Your project "${briefData.projectName}" has been created!** Redirecting to your parts list...`
        }]);
      } else {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `✅ **Your project "${briefData.projectName}" has been created!** Redirecting to your parts list...`
        }]);
      }

      setTimeout(() => navigate('/parts'), 2500);
    } catch (err: any) {
      toast({ title: err.message || 'Generation failed', variant: 'destructive' });
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '❌ Something went wrong during generation. Please try again.'
      }]);
    }
    setGenerating(false);
  };

  const buildAnyway = () => {
    if (!pendingBrief) return;
    const { brief, history } = pendingBrief;
    setPendingBrief(null);
    setMessages(prev => [...prev, { role: 'user', content: "Build it anyway." }]);
    handleGenerate(brief, history);
  };

  const refineIdea = () => {
    setPendingBrief(null);
    setMessages(prev => [...prev, { role: 'assistant', content: "No problem — tell me what you'd like to change about the idea." }]);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-slide-up flex flex-col" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Rocket className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Project Plan</h1>
          <p className="text-sm text-muted-foreground">Chat with Lumexa to design your project</p>
        </div>
      </div>

      {/* Chat Area */}
      <div ref={chatRef} className="flex-1 overflow-y-auto space-y-3 rounded-xl border border-border/30 p-4" style={{ background: '#111111' }}>
        {messages.length === 0 && !streaming && (
          <div className="flex items-center justify-center h-full text-muted-foreground/50">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Starting interview...
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
                <Bot className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary/30 prose prose-sm prose-invert max-w-none'
            }`}>
              {msg.role === 'assistant' ? <ReactMarkdown>{msg.content}</ReactMarkdown> : msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-secondary/50 flex items-center justify-center shrink-0 mt-1">
                <User className="w-4 h-4" />
              </div>
            )}
          </div>
        ))}
        {streaming && (
          <div className="flex gap-2 items-center text-muted-foreground/50 text-xs pl-9">
            <Loader2 className="w-3 h-3 animate-spin" /> Thinking...
          </div>
        )}
      </div>

      {/* Feasibility choice */}
      {pendingBrief && !generating && (
        <div className="flex gap-2 shrink-0">
          <Button variant="outline" className="flex-1" onClick={refineIdea}>Let's adjust it</Button>
          <Button className="flex-1" onClick={buildAnyway}>Build anyway</Button>
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 shrink-0">
        <Input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage(input)}
          placeholder={generating ? "Generating your build plan..." : "Describe your project..."}
          disabled={streaming || generating || !!pendingBrief}
          className="flex-1"
        />
        <Button size="icon" onClick={() => sendMessage(input)} disabled={streaming || generating || !!pendingBrief || !input.trim()}>
          {streaming || generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
    </div>
  );
}
