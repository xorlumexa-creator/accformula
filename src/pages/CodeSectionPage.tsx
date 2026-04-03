import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Code2, ChevronDown, ChevronUp, CheckCircle2, Circle, Loader2, Copy, Terminal, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

const platforms = [
  'Arduino IDE (C++)', 'MicroPython', 'Python (Raspberry Pi)',
  'ArduPilot / PX4', 'ROS', 'ESP-IDF', 'Scratch / Blockly', 'Other'
];

interface Module {
  id: number;
  title: string;
  description: string;
  guide: string;
  status: 'locked' | 'available' | 'complete';
}

export default function CodeSectionPage() {
  const { user } = useAuth();
  const [project, setProject] = useState<any>(null);
  const [electronics, setElectronics] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [platform, setPlatform] = useState('');
  const [modules, setModules] = useState<Module[]>([]);
  const [expandedModule, setExpandedModule] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingModule, setGeneratingModule] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    const { data: proj } = await supabase.from('projects').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1);
    if (proj?.[0]) {
      setProject(proj[0]);
      const { data: elec } = await supabase.from('project_electronics').select('*').eq('project_id', proj[0].id);
      if (elec) setElectronics(elec);
    }
    const { data: prof } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
    setProfile(prof);
    setLoading(false);
  };

  const generateRoadmap = async () => {
    if (!platform || !project) return;
    setGenerating(true);
    try {
      const systemPrompt = `You are Lumexa's coding guide. Generate a module-by-module code roadmap for the project "${project.project_name}" (${project.description}).

Platform: ${platform}
User level: ${profile?.experience_level || 'beginner'}
Electronics: ${electronics.map(e => e.component_name).join(', ') || 'Not specified'}
Microcontroller: ${project.microcontroller || 'Not specified'}

Return EXACTLY a JSON array of 5-7 modules. Each module:
{"id": 1, "title": "Module Name", "description": "One paragraph what this does"}

Example modules: Basic Setup & Hardware Test, Sensor Integration, Main Control Logic, Motor/Actuator Control, Safety & Failsafe, Testing & Calibration.

Return ONLY the JSON array, no markdown fences.`;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: 'Generate code roadmap modules' }],
          systemOverride: systemPrompt,
        }),
      });
      if (!resp.ok) throw new Error('Failed');

      const full = await streamToText(resp);
      const cleaned = full.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      setModules(parsed.map((m: any, i: number) => ({
        ...m, id: m.id || i + 1, guide: '', status: i === 0 ? 'available' : 'locked',
      })));
    } catch (e) {
      console.error(e);
      toast.error('Failed to generate roadmap');
    }
    setGenerating(false);
  };

  const generateModuleGuide = async (moduleId: number) => {
    const mod = modules.find(m => m.id === moduleId);
    if (!mod || mod.guide) { setExpandedModule(moduleId); return; }

    setGeneratingModule(moduleId);
    setExpandedModule(moduleId);
    try {
      const systemPrompt = `You are Lumexa's coding tutor. Generate a baby-step code guide for Module: "${mod.title}" — ${mod.description}.

Platform: ${platform}
Project: ${project?.project_name} — ${project?.description}
Electronics: ${electronics.map(e => `${e.component_name} (${e.model_recommendation})`).join(', ')}
Microcontroller: ${project?.microcontroller || 'Not specified'}
User level: ${profile?.experience_level || 'beginner'}

Format:
1. What file to create/open
2. Exact code block (formatted, with copy button markers)
3. Where to paste it
4. What each line does (brief)
5. Test command and expected output

Use numbered steps. Each step: Action → Why → Expected Result.
Never use LaTeX. Use Unicode: σ ε τ Δ π ≈ ² ³ √ × ° μ
Keep language at ${profile?.experience_level || 'beginner'} level.`;

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Generate step-by-step code guide for: ${mod.title}` }],
          systemOverride: systemPrompt,
        }),
      });
      if (!resp.ok) throw new Error('Failed');

      const full = await streamToText(resp);
      setModules(prev => prev.map(m => m.id === moduleId ? { ...m, guide: full } : m));
    } catch {
      toast.error('Failed to generate module guide');
    }
    setGeneratingModule(null);
  };

  const markComplete = (moduleId: number) => {
    setModules(prev => prev.map((m, i) => {
      if (m.id === moduleId) return { ...m, status: 'complete' as const };
      if (i > 0 && prev[i - 1]?.id === moduleId) return { ...m, status: 'available' as const };
      return m;
    }));
    toast.success('Module completed!');
  };

  const completedCount = modules.filter(m => m.status === 'complete').length;
  const progress = modules.length > 0 ? Math.round((completedCount / modules.length) * 100) : 0;

  if (loading) return <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-6 animate-slide-up max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Code2 className="w-6 h-6 text-primary" /> Code Section</h1>
        <p className="text-sm text-muted-foreground mt-1">Step-by-step coding guide for your hardware project</p>
      </div>

      {!project && (
        <div className="text-center py-12 text-muted-foreground">
          <AlertCircle className="w-10 h-10 mx-auto mb-3 text-primary/50" />
          <p>Create a project first from the Dashboard.</p>
        </div>
      )}

      {project && modules.length === 0 && (
        <div className="rounded-xl border border-border/30 p-6" style={{ background: '#111111' }}>
          <h2 className="text-lg font-bold mb-4">Select Your Coding Platform</h2>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {platforms.map(p => (
              <button key={p} onClick={() => setPlatform(p)}
                className={`p-3 rounded-lg border text-sm text-left transition-all ${platform === p ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 hover:border-primary/30'}`}
                style={{ background: platform === p ? undefined : '#0a0a0a' }}>
                {p}
              </button>
            ))}
          </div>
          <Button onClick={generateRoadmap} disabled={!platform || generating} className="w-full gap-2">
            {generating ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Roadmap...</> : <><Terminal className="w-4 h-4" /> Generate Code Roadmap</>}
          </Button>
        </div>
      )}

      {modules.length > 0 && (
        <>
          <div className="rounded-xl border border-border/30 p-4" style={{ background: '#111111' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Progress: {completedCount}/{modules.length} modules</span>
              <Badge variant="outline" className="border-primary/30 text-primary">{platform}</Badge>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          <div className="space-y-3">
            {modules.map(mod => (
              <div key={mod.id} className="rounded-xl border border-border/30 overflow-hidden" style={{ background: '#111111' }}>
                <button onClick={() => mod.status !== 'locked' ? generateModuleGuide(mod.id) : null}
                  className={`w-full flex items-center gap-3 p-4 text-left transition-all ${mod.status === 'locked' ? 'opacity-40 cursor-not-allowed' : 'hover:bg-secondary/20'}`}>
                  {mod.status === 'complete' ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" /> :
                    mod.status === 'available' ? <Circle className="w-5 h-5 text-primary shrink-0" /> :
                      <Circle className="w-5 h-5 text-muted-foreground/30 shrink-0" />}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold">Module {mod.id}: {mod.title}</p>
                    <p className="text-xs text-muted-foreground line-clamp-1">{mod.description}</p>
                  </div>
                  {expandedModule === mod.id ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                </button>

                {expandedModule === mod.id && (
                  <div className="border-t border-border/20 p-4">
                    {generatingModule === mod.id ? (
                      <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
                        <Loader2 className="w-5 h-5 animate-spin" /> Generating guide...
                      </div>
                    ) : mod.guide ? (
                      <>
                        <div className="prose prose-sm prose-invert max-w-none mb-4">
                          <ReactMarkdown>{mod.guide}</ReactMarkdown>
                        </div>
                        {mod.status !== 'complete' && (
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => markComplete(mod.id)} className="gap-2">
                              <CheckCircle2 className="w-4 h-4" /> Mark Complete
                            </Button>
                          </div>
                        )}
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground text-center">
        Code guides are AI-generated and should be reviewed before use in production.
      </p>
    </div>
  );
}

async function streamToText(resp: Response): Promise<string> {
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
      try { const p = JSON.parse(json); const c = p.choices?.[0]?.delta?.content; if (c) full += c; } catch {}
    }
  }
  return full;
}
