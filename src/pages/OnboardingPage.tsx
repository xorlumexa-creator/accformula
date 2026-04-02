import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ChevronRight, ChevronLeft, User, GraduationCap, Wrench } from 'lucide-react';
import lumexaLogo from '@/assets/lumexa-logo.webp';

const occupations = [
  'Student', 'Teacher / Educator', 'Hobbyist / Maker',
  'Engineer / Professional', 'Startup Founder', 'Researcher', 'Other',
];

const experienceLevels = [
  { value: 'beginner', label: 'Complete Beginner', desc: 'Never built anything' },
  { value: 'basic', label: 'Basic', desc: 'Built small projects, basic electronics' },
  { value: 'intermediate', label: 'Intermediate', desc: 'Comfortable with CAD and coding' },
  { value: 'advanced', label: 'Advanced', desc: 'Professional or near-professional' },
];

const purposes = [
  'Personal hobby project', 'School/university assignment',
  'Science fair or competition', 'Startup / commercial product',
  'Research project', 'Learning engineering',
];

const cadSoftware = [
  'Fusion 360', 'SolidWorks', 'FreeCAD', 'Blender',
  'TinkerCAD', 'Onshape', 'SketchUp', "I don't know yet",
];

export default function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    name: '',
    date_of_birth: '',
    country: '',
    occupation: '',
    experience_level: '',
    primary_purpose: '',
    cad_software: '',
    cad_other: '',
  });

  const update = (key: string, value: string) => setForm(p => ({ ...p, [key]: value }));

  const canNext = () => {
    if (step === 1) return form.name && form.country && form.occupation;
    if (step === 2) return form.experience_level && form.primary_purpose;
    if (step === 3) return form.cad_software;
    return false;
  };

  const handleSubmit = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const cadValue = form.cad_software === 'Other' ? form.cad_other : form.cad_software;

      // Update profile with extended fields
      const { error: profileError } = await supabase.from('profiles').update({
        name: form.name,
        date_of_birth: form.date_of_birth || null,
        country: form.country,
        occupation: form.occupation,
        experience_level: form.experience_level,
        primary_purpose: form.primary_purpose,
        cad_software: cadValue,
      }).eq('user_id', user.id);

      if (profileError) throw profileError;

      toast({ title: 'Profile saved! Let\'s create your first project.' });
      navigate('/');
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const stepIcons = [User, GraduationCap, Wrench];
  const StepIcon = stepIcons[step - 1];

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg border-border/50 bg-card/80 backdrop-blur-xl">
        <CardHeader className="items-center text-center space-y-3">
          <img src={lumexaLogo} alt="Lumexa" className="w-16 h-16 rounded-2xl object-cover" />
          <div>
            <CardTitle className="text-2xl flex items-center justify-center gap-2">
              <StepIcon className="w-5 h-5 text-primary" />
              {step === 1 && 'About You'}
              {step === 2 && 'Your Experience'}
              {step === 3 && 'CAD Software'}
            </CardTitle>
            <CardDescription>Step {step} of 3</CardDescription>
          </div>
          {/* Progress dots */}
          <div className="flex gap-2">
            {[1, 2, 3].map(s => (
              <div key={s} className={`w-8 h-1 rounded-full transition-colors ${s <= step ? 'bg-primary' : 'bg-border'}`} />
            ))}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {step === 1 && (
            <>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Full Name *</label>
                <Input value={form.name} onChange={e => update('name', e.target.value)} placeholder="Your full name" required />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Date of Birth</label>
                <Input type="date" value={form.date_of_birth} onChange={e => update('date_of_birth', e.target.value)} />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Country *</label>
                <Input value={form.country} onChange={e => update('country', e.target.value)} placeholder="e.g. United States, India, Germany" required />
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Occupation *</label>
                <div className="grid grid-cols-2 gap-2">
                  {occupations.map(o => (
                    <button key={o} type="button" onClick={() => update('occupation', o)}
                      className={`text-left text-sm px-3 py-2.5 rounded-lg border transition-all ${form.occupation === o ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
                      {o}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Engineering Knowledge *</label>
                <div className="space-y-2">
                  {experienceLevels.map(l => (
                    <button key={l.value} type="button" onClick={() => update('experience_level', l.value)}
                      className={`w-full text-left px-4 py-3 rounded-lg border transition-all ${form.experience_level === l.value ? 'border-primary bg-primary/10' : 'border-border/30 hover:border-primary/30'}`}>
                      <p className={`text-sm font-medium ${form.experience_level === l.value ? 'text-primary' : 'text-foreground'}`}>{l.label}</p>
                      <p className="text-xs text-muted-foreground">{l.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Primary Purpose *</label>
                <div className="grid grid-cols-2 gap-2">
                  {purposes.map(p => (
                    <button key={p} type="button" onClick={() => update('primary_purpose', p)}
                      className={`text-left text-sm px-3 py-2.5 rounded-lg border transition-all ${form.primary_purpose === p ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
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
                <label className="text-sm text-muted-foreground mb-1 block">Which CAD software do you use? *</label>
                <div className="grid grid-cols-2 gap-2">
                  {cadSoftware.map(s => (
                    <button key={s} type="button" onClick={() => update('cad_software', s)}
                      className={`text-left text-sm px-3 py-2.5 rounded-lg border transition-all ${form.cad_software === s ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
                      {s}
                    </button>
                  ))}
                  <button type="button" onClick={() => update('cad_software', 'Other')}
                    className={`text-left text-sm px-3 py-2.5 rounded-lg border transition-all ${form.cad_software === 'Other' ? 'border-primary bg-primary/10 text-primary' : 'border-border/30 text-muted-foreground hover:border-primary/30'}`}>
                    Other
                  </button>
                </div>
                {form.cad_software === 'Other' && (
                  <Input className="mt-2" value={form.cad_other} onChange={e => update('cad_other', e.target.value)} placeholder="Enter your CAD software" />
                )}
              </div>
              {form.cad_software === "I don't know yet" && (
                <p className="text-xs text-muted-foreground bg-primary/5 border border-primary/20 rounded-lg p-3">
                  No worries! Lumexa will recommend the best CAD software based on your project requirements.
                </p>
              )}
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
              <Button onClick={handleSubmit} disabled={loading || !canNext()} className="flex-1">
                {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                Complete Setup
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
