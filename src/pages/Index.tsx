import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { Link, useNavigate } from 'react-router-dom';
import {
  Flame, Plus, CheckCircle2, Circle, ArrowRight, Clock,
  FileInput, MessageSquare, Upload, Sparkles, Search
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';

const phases = ['Planning', 'Design', 'Analysis', 'Code', 'Assembly', 'Testing'];

interface Project {
  id: string;
  project_name: string;
  description: string;
  category: string;
  current_phase: number;
  progress_percent: number;
}

interface Task {
  id: string;
  task_number: number;
  title: string;
  estimated_hours: number;
  status: string;
  phase: number;
}

interface Streak {
  current_streak: number;
  longest_streak: number;
  last_active_date: string | null;
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [streak, setStreak] = useState<Streak>({ current_streak: 0, longest_streak: 0, last_active_date: null });
  const [loading, setLoading] = useState(true);
  const [hasOnboarded, setHasOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!user) return;
    loadData();
  }, [user]);

  const loadData = async () => {
    if (!user) return;
    const { data: profileData } = await supabase.from('profiles')
      .select('*').eq('user_id', user.id).single();

    if (!profileData?.country) {
      navigate('/onboarding', { replace: true });
      return;
    }
    setProfile(profileData);
    setHasOnboarded(true);

    const { data: projects } = await supabase.from('projects')
      .select('*').eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(1);

    if (projects?.[0]) {
      setProject(projects[0] as Project);
      const { data: taskData } = await supabase.from('project_tasks')
        .select('*').eq('project_id', projects[0].id)
        .order('sort_order', { ascending: true });
      if (taskData) setTasks(taskData as Task[]);
    }

    const { data: streakData } = await supabase.from('user_streaks')
      .select('*').eq('user_id', user.id).single();
    if (streakData) setStreak(streakData as Streak);

    await updateStreak();
    setLoading(false);
  };

  const updateStreak = async () => {
    if (!user) return;
    const today = new Date().toISOString().split('T')[0];
    const { data: existing } = await supabase.from('user_streaks')
      .select('*').eq('user_id', user.id).single();

    if (!existing) {
      await supabase.from('user_streaks').insert({
        user_id: user.id, current_streak: 1, longest_streak: 1, last_active_date: today,
      });
      setStreak({ current_streak: 1, longest_streak: 1, last_active_date: today });
      return;
    }
    if (existing.last_active_date === today) return;
    const lastDate = existing.last_active_date ? new Date(existing.last_active_date) : null;
    const todayDate = new Date(today);
    const diffDays = lastDate ? Math.floor((todayDate.getTime() - lastDate.getTime()) / 86400000) : 999;
    let newStreak = diffDays === 1 ? existing.current_streak + 1 : 1;
    const newLongest = Math.max(newStreak, existing.longest_streak);
    await supabase.from('user_streaks').update({
      current_streak: newStreak, longest_streak: newLongest, last_active_date: today,
    }).eq('user_id', user.id);
    setStreak({ current_streak: newStreak, longest_streak: newLongest, last_active_date: today });
  };

  const toggleTask = async (taskId: string, currentStatus: string) => {
    const newStatus = currentStatus === 'Complete' ? 'Not Started' : 'Complete';
    await supabase.from('project_tasks').update({ status: newStatus }).eq('id', taskId);
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    if (project) {
      const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t);
      const completed = updatedTasks.filter(t => t.status === 'Complete').length;
      const progress = updatedTasks.length > 0 ? Math.round((completed / updatedTasks.length) * 100) : 0;
      await supabase.from('projects').update({ progress_percent: progress }).eq('id', project.id);
      setProject(p => p ? { ...p, progress_percent: progress } : null);
    }
  };

  if (loading || hasOnboarded === null) {
    return <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            Welcome back, <span className="text-primary">{profile?.name || 'Builder'}</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Let's keep building.</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-xl border border-primary/20" style={{ background: '#111111' }}>
          <Flame className="w-5 h-5 text-orange-500" />
          <span className="text-lg font-bold text-orange-500">{streak.current_streak}</span>
          <span className="text-xs text-muted-foreground">day streak</span>
        </div>
      </div>

      {!project && (
        <div className="flex flex-col items-center justify-center min-h-[50vh] text-center gap-6">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-10 h-10 text-primary animate-pulse" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">Welcome to Lumexa!</h2>
            <p className="text-muted-foreground max-w-md">
              Start by creating your first project. Lumexa will generate a personalized build plan.
            </p>
          </div>
          <Button size="lg" onClick={() => navigate('/project-plan')} className="gap-2">
            <Plus className="w-5 h-5" /> Create Project
          </Button>
        </div>
      )}

      {project && (
        <div className="rounded-xl border border-border/30 overflow-hidden" style={{ background: '#111111' }}>
          <div className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold">{project.project_name}</h2>
                <p className="text-xs text-muted-foreground">{project.category} · {project.description?.slice(0, 60)}</p>
              </div>
              <Badge variant="outline" className="border-primary/30 text-primary">
                Phase {project.current_phase}: {phases[(project.current_phase || 1) - 1]}
              </Badge>
            </div>
            <Progress value={project.progress_percent || 0} className="h-2 mb-2" />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{project.progress_percent || 0}% complete</span>
              <Link to="/parts" className="text-xs text-primary hover:underline flex items-center gap-1">
                View Parts <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {project && tasks.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" /> Task Schedule
          </h3>
          <div className="space-y-2">
            {tasks.slice(0, 8).map(task => (
              <button key={task.id} onClick={() => toggleTask(task.id, task.status)}
                className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/20 hover:border-primary/20 transition-all text-left"
                style={{ background: '#111111' }}>
                {task.status === 'Complete'
                  ? <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />
                  : <Circle className="w-5 h-5 text-muted-foreground shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${task.status === 'Complete' ? 'line-through text-muted-foreground' : ''}`}>
                    Task {task.task_number}: {task.title}
                  </p>
                  <p className="text-xs text-muted-foreground">~{task.estimated_hours}h · Phase {task.phase}</p>
                </div>
              </button>
            ))}
            {tasks.length > 8 && (
              <p className="text-xs text-muted-foreground text-center">+{tasks.length - 8} more tasks</p>
            )}
          </div>
        </div>
      )}

      {project && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { to: '/parts', icon: FileInput, label: 'Parts & Materials' },
            { to: '/import-design', icon: Search, label: 'CAD Analysis' },
            { to: '/chat', icon: MessageSquare, label: 'AI Coach' },
            { to: '/upload', icon: Upload, label: 'Telemetry' },
          ].map(({ to, icon: Icon, label }) => (
            <Link key={to} to={to}
              className="flex items-center gap-2 p-3 rounded-lg border border-border/20 hover:border-primary/20 transition-all"
              style={{ background: '#111111' }}>
              <Icon className="w-4 h-4 text-primary" />
              <span className="text-sm">{label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
