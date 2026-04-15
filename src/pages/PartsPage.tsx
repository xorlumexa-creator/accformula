import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Link, useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Box, CheckCircle2, Circle, ArrowRight, DollarSign
} from 'lucide-react';

interface Part {
  id: string; part_name: string; material: string; manufacturing_method: string;
  estimated_cost: number; complexity: string; status: string; sort_order: number;
}

interface Electronic {
  id: string; component_name: string; model_recommendation: string;
  where_to_buy: string; price: number; quantity: number; purpose: string;
  status: string; sort_order: number;
}

const statusColors: Record<string, string> = {
  'Not Started': 'border-border/30 text-muted-foreground',
  'In Design': 'border-blue-500/30 text-blue-400',
  'Analysed': 'border-yellow-500/30 text-yellow-400',
  'Fixed': 'border-orange-500/30 text-orange-400',
  'Complete': 'border-green-500/30 text-green-400',
  'Not Purchased': 'border-border/30 text-muted-foreground',
  'Purchased': 'border-green-500/30 text-green-400',
  'Installed': 'border-primary/30 text-primary',
};

export default function PartsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'body' | 'electronics'>('body');
  const [parts, setParts] = useState<Part[]>([]);
  const [electronics, setElectronics] = useState<Electronic[]>([]);
  const [project, setProject] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    const { data: projects } = await supabase.from('projects')
      .select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1);

    if (!projects?.[0]) { navigate('/project-plan'); return; }
    setProject(projects[0]);

    const { data: partsData } = await supabase.from('project_parts')
      .select('*').eq('project_id', projects[0].id).order('sort_order', { ascending: true });
    if (partsData) setParts(partsData as Part[]);

    const { data: elecData } = await supabase.from('project_electronics')
      .select('*').eq('project_id', projects[0].id).order('sort_order', { ascending: true });
    if (elecData) setElectronics(elecData as Electronic[]);
  };

  const toggleElectronicStatus = async (id: string, current: string) => {
    const next = current === 'Not Purchased' ? 'Purchased' : current === 'Purchased' ? 'Installed' : 'Not Purchased';
    await supabase.from('project_electronics').update({ status: next }).eq('id', id);
    setElectronics(prev => prev.map(e => e.id === id ? { ...e, status: next } : e));
  };

  const bodyTotal = parts.reduce((s, p) => s + (p.estimated_cost || 0), 0);
  const elecTotal = electronics.reduce((s, e) => s + (e.price || 0) * (e.quantity || 1), 0);
  const grandTotal = bodyTotal + elecTotal;
  const budgetNum = parseFloat(project?.budget_range?.replace(/[^0-9.]/g, '') || '0');

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Box className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">Parts & Materials</h1>
          <p className="text-sm text-muted-foreground">{project?.project_name}</p>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setActiveTab('body')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'body' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground'}`}>
          Body Parts ({parts.length})
        </button>
        <button onClick={() => setActiveTab('electronics')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'electronics' ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground'}`}>
          Electronics ({electronics.length})
        </button>
      </div>

      {activeTab === 'body' && (
        <div className="space-y-2">
          {parts.map(part => (
            <Link key={part.id} to={`/design-guide/${part.id}`}
              className="flex items-center gap-3 p-4 rounded-lg border border-border/20 hover:border-primary/20 transition-all"
              style={{ background: '#111111' }}>
              <div className="w-12 h-12 rounded-lg flex items-center justify-center shrink-0 border border-border/20" style={{ background: '#0a0a0a' }}>
                <Box className="w-5 h-5 text-muted-foreground/30" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="font-medium text-sm">{part.part_name}</h3>
                  <Badge variant="outline" className={statusColors[part.status] || ''}>
                    {part.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{part.material}</span>
                  <span>{part.manufacturing_method}</span>
                  <span className="text-primary">${part.estimated_cost}</span>
                  <ArrowRight className="w-3 h-3 ml-auto text-primary" />
                </div>
              </div>
            </Link>
          ))}
          {parts.length === 0 && (
            <p className="text-center text-muted-foreground py-12">No body parts generated yet.</p>
          )}
        </div>
      )}

      {activeTab === 'electronics' && (
        <div className="space-y-2">
          {electronics.map(e => (
            <button key={e.id} onClick={() => toggleElectronicStatus(e.id, e.status)}
              className="w-full text-left p-4 rounded-lg border border-border/20 hover:border-primary/20 transition-all"
              style={{ background: '#111111' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-medium">{e.component_name}</h3>
                <Badge variant="outline" className={statusColors[e.status] || ''}>
                  {e.status === 'Not Purchased' ? <Circle className="w-3 h-3 mr-1" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}
                  {e.status}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mb-1">{e.model_recommendation}</p>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {e.where_to_buy && <span>{e.where_to_buy}</span>}
                <span className="text-primary">${e.price} × {e.quantity}</span>
                <span>{e.purpose}</span>
              </div>
            </button>
          ))}
          {electronics.length === 0 && (
            <p className="text-center text-muted-foreground py-12">No electronics generated yet.</p>
          )}
        </div>
      )}

      <div className="rounded-xl border border-border/30 p-4" style={{ background: '#111111' }}>
        <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
          <DollarSign className="w-4 h-4 text-primary" /> Budget Tracker
        </h3>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Body Parts</span>
            <span>${bodyTotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Electronics</span>
            <span>${elecTotal.toFixed(2)}</span>
          </div>
          <div className="border-t border-border/20 pt-2 flex justify-between font-bold">
            <span>Total</span>
            <span className={grandTotal > budgetNum && budgetNum > 0 ? 'text-destructive' : 'text-primary'}>
              ${grandTotal.toFixed(2)}
              {budgetNum > 0 && <span className="text-xs text-muted-foreground font-normal ml-1">/ ${budgetNum}</span>}
            </span>
          </div>
        </div>
        {budgetNum > 0 && (
          <Progress value={Math.min((grandTotal / budgetNum) * 100, 100)} className="h-1.5 mt-3" />
        )}
      </div>
    </div>
  );
}
