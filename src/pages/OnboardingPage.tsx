import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Rocket } from 'lucide-react';
import lumexaLogo from '@/assets/lumexa-logo.jpeg';

const categories = [
  'Robot', 'IoT Device', 'Car / Automotive', 'Drone', 'Industrial Machine',
  'Smart Home System', 'Electronics Circuit', 'Mechanical Tool', 'Other',
];
const budgets = ['Under $100', '$100–$500', '$500–$2000', '$2000+'];
const complexities = ['Beginner', 'Intermediate', 'Advanced'];

export default function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    project_name: '',
    description: '',
    category: '',
    purpose: '',
    budget_range: '',
    complexity: '',
  });

  const update = (key: string, value: string) => setForm((p) => ({ ...p, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    try {
      const { error } = await supabase.from('projects').insert({
        user_id: user.id,
        ...form,
      });
      if (error) throw error;
      toast({ title: 'Project created! Welcome to Lumexa.' });
      navigate('/');
    } catch (err: any) {
      toast({ title: err.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-lg border-border/50 bg-card/80 backdrop-blur-xl">
        <CardHeader className="items-center text-center space-y-3">
          <img src={lumexaLogo} alt="Lumexa" className="w-16 h-16 rounded-2xl object-cover" />
          <div>
            <CardTitle className="text-2xl">What project are you building?</CardTitle>
            <CardDescription>Tell us about your project so Lumexa can assist you better.</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Project Name</label>
              <Input value={form.project_name} onChange={(e) => update('project_name', e.target.value)} placeholder="e.g. Autonomous Rover v2" required />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Description</label>
              <Textarea value={form.description} onChange={(e) => update('description', e.target.value)} placeholder="Brief description of your project" rows={3} />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Category</label>
              <Select value={form.category} onValueChange={(v) => update('category', v)}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Purpose</label>
              <Input value={form.purpose} onChange={(e) => update('purpose', e.target.value)} placeholder="e.g. Competition entry, research prototype" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Budget</label>
                <Select value={form.budget_range} onValueChange={(v) => update('budget_range', v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {budgets.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm text-muted-foreground mb-1 block">Complexity</label>
                <Select value={form.complexity} onValueChange={(v) => update('complexity', v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {complexities.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Rocket className="w-4 h-4 mr-2" />}
              Launch Project
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
