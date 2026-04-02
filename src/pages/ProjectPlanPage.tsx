import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ChevronRight, ChevronLeft, Rocket, Bot, User, Send } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

const categories = [
  'Drone / UAV', 'Robot / Rover', 'RC Vehicle', 'Wearable Device',
  'Smart Home Device', 'Musical Instrument', 'Science Instrument', 'Custom Vehicle', 'Other',
];

const environments = ['Indoor only', 'Outdoor only', 'Both', 'Underwater', 'Aerial', 'Multi-medium'];
const powerSources = ['Battery (LiPo / Li-Ion)', 'Solar', 'Wired power', 'Multiple sources'];
const controlMethods = ['Remote controlled', 'Autonomous (AI / programmed)', 'Manual / physical', 'Smartphone app'];
const microcontrollers = ['Arduino', 'Raspberry Pi', 'ESP32', 'Pixhawk / ArduPilot', 'STM32', 'No preference'];

const GEN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/design-generator`;

interface GeneratedPart {
  partName: string;
  purpose: string;
  material: string;
  estimatedCost: number;
  manufacturingMethod: string;
  complexity: string;
}

interface GeneratedElectronic {
  componentName: string;
  modelRecommendation: string;
  whereToBuy: string;
  price: number;
  quantity: number;
  purpose: string;
}

export default function ProjectPlanPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [profile, setProfile] = useState<any>(null);

  const [form, setForm] = useState({
    project_name: '', description: '', category: '', other_category: '',
    what_should_it_do: '', environment: '', budget_range: '', budget_currency: 'USD',
    target_weight: '', target_size: '', power_source: '',
    control_method: '', microcontroller: '', has_3d_printer: '',
  });

  const update = (key: string, value: string) => setForm(p => ({ ...p, [key]: value }));

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('*').eq('user_id', user.id).single()
      .then(({ data }) => { if (data) setProfile(data); });
  }, [user]);

  const canNext = () => {
    if (step === 1) return form.project_name && form.description && form.category;
    if (step === 2) return form.what_should_it_do && form.environment;
    if (step === 3) return true;
    return false;
  };

  const handleGenerate = async () => {
    if (!user || !profile) return;
    setGenerating(true);

    try {
      const catValue = form.category === 'Other' ? form.other_category : form.category;

      // Create project in DB
      const { data: projectData, error: projError } = await supabase.from('projects').insert({
        user_id: user.id,
        project_name: form.project_name,
        description: form.description,
        category: catValue,
        purpose: form.what_should_it_do,
        budget_range: form.budget_range,
        environment: form.environment,
        power_source: form.power_source,
        control_method: form.control_method,
        microcontroller: form.microcontroller,
        has_3d_printer: form.has_3d_printer === 'yes',
        target_weight: form.target_weight,
        target_size: form.target_size,
        budget_currency: form.budget_currency || 'USD',
      }).select('id').single();

      if (projError) throw projError;

      // Call AI to generate parts list
      const briefData = {
        projectName: form.project_name,
        description: form.description,
        category: catValue,
        purpose: form.what_should_it_do,
        environment: form.environment,
        budget: form.budget_range,
        targetWeight: form.target_weight,
        targetSize: form.target_size,
        powerSource: form.power_source,
        controlMethod: form.control_method,
        microcontroller: form.microcontroller,
        has3dPrinter: form.has_3d_printer,
        cadSoftware: profile.cad_software,
        experienceLevel: profile.experience_level,
        country: profile.country,
      };

      const resp = await fetch(GEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: [], mode: 'generate_parts', briefData }),
      });

      if (!resp.ok) throw new Error('Failed to generate parts list');
      const result = await resp.json();

      // Save body parts
      if (result.parts && Array.isArray(result.parts)) {
        const partsToInsert = result.parts.map((p: any, i: number) => ({
          project_id: projectData.id,
          user_id: user.id,
          part_name: p.partName || p.part_name || `Part ${i + 1}`,
          material: p.material || '',
          manufacturing_method: p.fabricateOrBuy === 'fabricate' ? '3D Print / Custom' : 'Purchase',
          estimated_cost: p.estimatedCostUSD || 0,
          complexity: p.complexity || 'Beginner',
          sort_order: i,
        }));
        await supabase.from('project_parts').insert(partsToInsert);
      }

      // Save electronics
      if (result.electronics && Array.isArray(result.electronics)) {
        const electronicsToInsert = result.electronics.map((e: any, i: number) => ({
          project_id: projectData.id,
          user_id: user.id,
          component_name: e.componentName || e.component_name || `Component ${i + 1}`,
          model_recommendation: e.modelRecommendation || e.model || '',
          where_to_buy: e.whereToBuy || e.where_to_buy || '',
          price: e.price || 0,
          quantity: e.quantity || 1,
          purpose: e.purpose || '',
          sort_order: i,
        }));
        await supabase.from('project_electronics').insert(electronicsToInsert);
      }

      // Generate tasks from parts
      const allParts = result.parts || [];
      const taskInserts = [];
      let taskNum = 1;
      for (const part of allParts) {
        const name = part.partName || part.part_name || 'Part';
        taskInserts.push({
          project_id: projectData.id, user_id: user.id,
          task_number: taskNum++, title: `Design ${name}`, estimated_hours: 2, phase: 2, sort_order: taskNum,
        });
        taskInserts.push({
          project_id: projectData.id, user_id: user.id,
          task_number: taskNum++, title: `Analyse ${name}`, estimated_hours: 1, phase: 3, sort_order: taskNum,
        });
      }
      taskInserts.push({
        project_id: projectData.id, user_id: user.id,
        task_number: taskNum++, title: 'Write Control Code', estimated_hours: 4, phase: 4, sort_order: taskNum,
      });
      taskInserts.push({
        project_id: projectData.id, user_id: user.id,
        task_number: taskNum++, title: 'Complete Assembly', estimated_hours: 3, phase: 5, sort_order: taskNum,
      });
      taskInserts.push({
        project_id: projectData.id, user_id: user.id,
        task_number: taskNum++, title: 'Test & Calibrate', estimated_hours: 2, phase: 6, sort_order: taskNum,
      });

      await supabase.from('project_tasks').insert(taskInserts);

      toast({ title: 'Project created! Your build plan is ready.' });
      navigate('/parts');
    } catch (err: any) {
      toast({ title: err.message || 'Generation failed', variant: 'destructive' });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-slide-up">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Rocket className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Project Plan</h1>
          <p className="text-sm text-muted-foreground">Tell us about your project and we'll generate your build plan</p>
        </div>
      </div>

      {/* Progress */}
      <div className="flex gap-2">
        {[1, 2, 3].map(s => (
          <div key={s} className={`flex-1 h-1 rounded-full transition-colors ${s <= step ? 'bg-primary' : 'bg-border/30'}`} />
        ))}
      </div>

      <Card className="border-border/30" style={{ background: '#111111' }}>
        <CardHeader>
          <CardTitle className="text-lg">
            {step === 1 && 'Project Identity'}
            {step === 2 && 'Requirements'}
            {step === 3 && 'Technical Preferences'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Project Name *</label>
                <Input value={form.project_name} onChange={e => update('project_name', e.target.value)} placeholder="e.g. Racing Drone v1" />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">What are you building? *</label>
                <Textarea value={form.description} onChange={e => update('description', e.target.value)} placeholder="One-line description of your project" rows={2} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Category *</label>
                <div className="grid grid-cols-2 gap-2">
                  {categories.map(c => (
                    <button key={c} type="button" onClick={() => update('category', c)}
                      className={`text-left text-sm px-3 py-2.5 rounded-lg border transition-all ${form.category === c ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
                      {c}
                    </button>
                  ))}
                </div>
                {form.category === 'Other' && (
                  <Input className="mt-2" value={form.other_category} onChange={e => update('other_category', e.target.value)} placeholder="Describe your project category" />
                )}
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">What should it do? *</label>
                <Textarea value={form.what_should_it_do} onChange={e => update('what_should_it_do', e.target.value)} placeholder="Describe the functionality in detail" rows={3} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Operating Environment *</label>
                <div className="grid grid-cols-2 gap-2">
                  {environments.map(e => (
                    <button key={e} type="button" onClick={() => update('environment', e)}
                      className={`text-left text-sm px-3 py-2.5 rounded-lg border transition-all ${form.environment === e ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
                      {e}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Budget</label>
                  <Input value={form.budget_range} onChange={e => update('budget_range', e.target.value)} placeholder="e.g. $200" />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground mb-1 block">Target Weight</label>
                  <Input value={form.target_weight} onChange={e => update('target_weight', e.target.value)} placeholder="e.g. 500g" />
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Power Source</label>
                <div className="grid grid-cols-2 gap-2">
                  {powerSources.map(p => (
                    <button key={p} type="button" onClick={() => update('power_source', p)}
                      className={`text-left text-sm px-3 py-2.5 rounded-lg border transition-all ${form.power_source === p ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Control Method</label>
                <div className="grid grid-cols-2 gap-2">
                  {controlMethods.map(c => (
                    <button key={c} type="button" onClick={() => update('control_method', c)}
                      className={`text-left text-sm px-3 py-2.5 rounded-lg border transition-all ${form.control_method === c ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Microcontroller</label>
                <div className="grid grid-cols-3 gap-2">
                  {microcontrollers.map(m => (
                    <button key={m} type="button" onClick={() => update('microcontroller', m)}
                      className={`text-left text-sm px-3 py-2.5 rounded-lg border transition-all ${form.microcontroller === m ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Do you have a 3D printer?</label>
                <div className="flex gap-2">
                  {['Yes, I have a printer', 'Yes, using a service', 'No'].map(o => (
                    <button key={o} type="button" onClick={() => update('has_3d_printer', o === 'No' ? 'no' : 'yes')}
                      className={`flex-1 text-sm px-3 py-2.5 rounded-lg border transition-all ${(form.has_3d_printer === 'yes' && o !== 'No') || (form.has_3d_printer === 'no' && o === 'No') ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex gap-3 pt-2">
            {step > 1 && (
              <Button variant="outline" onClick={() => setStep(s => s - 1)} className="flex-1">
                <ChevronLeft className="w-4 h-4 mr-1" /> Back
              </Button>
            )}
            {step < 3 ? (
              <Button onClick={() => setStep(s => s + 1)} disabled={!canNext()} className="flex-1">
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            ) : (
              <Button onClick={handleGenerate} disabled={generating} className="flex-1">
                {generating ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
                {generating ? 'Generating Build Plan...' : 'Generate Build Plan'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
