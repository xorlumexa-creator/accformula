import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Rocket, Bot, User, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { streamPuterChat, puterChatJSON, stripJsonFences } from '@/lib/puterAI';
import { MASTER_INTERVIEW_PROMPT, buildGeneratePartsPrompt, buildRefinePartsPrompt } from '@/lib/prompts';

const ENRICH_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/enrich-electronics`;


interface ChatMsg {
  role: 'user' | 'assistant';
  content: string;
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
      const full = await streamPuterChat(
        [
          { role: 'system', content: MASTER_INTERVIEW_PROMPT },
          ...newMessages.map(m => ({ role: m.role, content: m.content })),
        ],
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
      content: '🚀 **Generating your complete build plan...** This includes parts, electronics, assembly sequence, and testing checklist. Hold tight!'
    }]);

    try {
      const enrichedBrief = {
        ...briefData,
        cadSoftware: profile.cad_software,
        experienceLevel: profile.experience_level || briefData.userLevel,
        country: profile.country,
      };

      const resp = await puterChatJSON([
        { role: 'system', content: buildGeneratePartsPrompt(enrichedBrief) },
        { role: 'user', content: 'Generate the complete build plan now.' },
      ]);

      let result: any;
      try {
        result = JSON.parse(stripJsonFences(resp));
      } catch {
        throw new Error('Failed to generate parts list');
      }
      if (result.error) throw new Error(result.error);

      // Electronics pricing/dimensions enrichment needs the Groq secret, so that
      // one step still runs server-side — everything else already happened client-side.
      if (result.electronics?.length) {
        try {
          const enrichResp = await fetch(ENRICH_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            },
            body: JSON.stringify({ electronics: result.electronics, country: profile.country }),
          });
          if (enrichResp.ok) {
            const enrichData = await enrichResp.json();
            if (enrichData.electronics?.length) result.electronics = enrichData.electronics;
          }
        } catch (e) {
          console.error('Electronics enrichment failed, using original estimates:', e);
        }
      }

      // Fuse the now-real, verified component dimensions/specs back into the mechanical
      // parts — enclosures, brackets, standoffs and wire runs get corrected to actually
      // fit and support what will really be used, instead of the first-pass guesses.
      if (result.parts?.length && result.electronics?.length) {
        try {
          const refineResp = await puterChatJSON([
            { role: 'user', content: buildRefinePartsPrompt(result.parts, result.electronics, enrichedBrief) },
          ]);
          const refinedParts = JSON.parse(stripJsonFences(refineResp));
          if (Array.isArray(refinedParts) && refinedParts.length) result.parts = refinedParts;
        } catch (e) {
          console.error('Part-fit refinement failed, keeping original part dimensions:', e);
        }
      }

      // Create project
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
      }).select('id').single();

      if (projError) throw projError;

      // Save parts
      if (result.parts?.length) {
        const partsToInsert = result.parts.map((p: any, i: number) => ({
          project_id: projectData.id,
          user_id: user.id,
          part_name: p.partName || p.part_name || `Part ${i + 1}`,
          material: p.material || '',
          manufacturing_method: p.manufacturingMethod || '',
          estimated_cost: p.estimatedCostUSD || p.estimatedCost || 0,
          complexity: p.complexity || 'Beginner',
          dimensions: p.dimensions || '',
          sort_order: i,
        }));
        await supabase.from('project_parts').insert(partsToInsert);
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

      // Generate tasks
      const allParts = result.parts || [];
      const taskInserts: any[] = [];
      let taskNum = 1;
      for (const part of allParts) {
        const name = part.partName || part.part_name || 'Part';
        taskInserts.push({ project_id: projectData.id, user_id: user.id, task_number: taskNum++, title: `Design ${name}`, estimated_hours: 2, phase: 2, sort_order: taskNum });
        taskInserts.push({ project_id: projectData.id, user_id: user.id, task_number: taskNum++, title: `Analyse ${name}`, estimated_hours: 1, phase: 3, sort_order: taskNum });
      }
      taskInserts.push({ project_id: projectData.id, user_id: user.id, task_number: taskNum++, title: 'Write Control Code', estimated_hours: 4, phase: 4, sort_order: taskNum });
      taskInserts.push({ project_id: projectData.id, user_id: user.id, task_number: taskNum++, title: 'Complete Assembly', estimated_hours: 3, phase: 5, sort_order: taskNum });
      taskInserts.push({ project_id: projectData.id, user_id: user.id, task_number: taskNum++, title: 'Test & Calibrate', estimated_hours: 2, phase: 6, sort_order: taskNum });
      await supabase.from('project_tasks').insert(taskInserts);

      // Hero image generation removed — no image generation in v7

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
