import { useEffect, useState } from 'react';
import { useTelemetry } from '@/context/TelemetryContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import MetricCard from '@/components/MetricCard';
import { Link, useNavigate } from 'react-router-dom';
import {
  Gauge, Zap, Thermometer, Clock, Database, Activity,
  Upload, FileInput, MessageSquare, Timer, Radio, BarChart3
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';

const navCards = [
  { to: '/upload', icon: Upload, label: 'Upload Data', desc: 'Import CSV / telemetry files' },
  { to: '/import-design', icon: FileInput, label: 'Design Import', desc: 'CAD data & analysis' },
  { to: '/sensors', icon: Radio, label: 'Sensors', desc: 'IoT sensor integration' },
  { to: '/analysis', icon: BarChart3, label: 'Analysis', desc: 'Charts & metrics' },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat', desc: 'Engineering assistant' },
  { to: '/lap-calculator', icon: Timer, label: 'Lap Calculator', desc: 'Track lap times' },
];

export default function DashboardPage() {
  const { data, stats, fileName, sessions, loadSession } = useTelemetry();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hasProject, setHasProject] = useState<boolean | null>(null);

  // Check onboarding
  useEffect(() => {
    if (!user) return;
    supabase.from('projects').select('id').eq('user_id', user.id).limit(1)
      .then(({ data: p }) => {
        if (!p || p.length === 0) {
          navigate('/onboarding', { replace: true });
        } else {
          setHasProject(true);
        }
      });
  }, [user, navigate]);

  if (hasProject === null) {
    return <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">Loading...</div>;
  }

  // Get first two numeric columns for chart preview
  const numericCols = stats?.numericColumns || [];
  const chartData = data.slice(0, 200);
  const xCol = numericCols[0];
  const yCol = numericCols.length > 1 ? numericCols[1] : numericCols[0];

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Navigation Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {navCards.map(({ to, icon: Icon, label, desc }) => (
          <Link key={to} to={to}
            className="gradient-card rounded-lg border border-border p-4 hover:border-primary/30 hover:glow-red transition-all group cursor-pointer">
            <Icon className="w-6 h-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </Link>
        ))}
      </div>

      {/* Past Sessions */}
      {sessions.length > 0 && !stats && (
        <div className="gradient-card rounded-lg border border-border p-4 space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Recent Telemetry Sessions</h3>
          <div className="space-y-2">
            {sessions.slice(0, 5).map(s => (
              <button key={s.id} onClick={() => loadSession(s.id)}
                className="w-full flex items-center justify-between p-3 rounded-lg bg-background/50 hover:bg-primary/5 hover:border-primary/20 border border-border/50 transition-all text-left">
                <div>
                  <p className="text-sm font-medium">{s.file_name}</p>
                  <p className="text-xs text-muted-foreground">{s.row_count} rows · {(s.columns as string[]).length} columns</p>
                </div>
                <p className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString()}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {!stats && sessions.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center gap-6">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Activity className="w-10 h-10 text-primary animate-pulse-glow" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">No Telemetry Data</h2>
            <p className="text-muted-foreground max-w-md">
              Upload a CSV file with your sensor data to see live metrics, charts, and analysis.
            </p>
          </div>
          <Link to="/upload"
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 rounded-lg font-medium hover:bg-primary/90 transition-colors">
            Upload Data
          </Link>
        </div>
      )}

      {stats && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold">Dashboard</h2>
              <p className="text-sm text-muted-foreground">{fileName} · {stats.rowCount} rows · {stats.numericColumns.length} metrics</p>
            </div>
          </div>

          {/* Dynamic Metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {numericCols.slice(0, 8).map((col, i) => {
              const s = stats.summary[col];
              const icons = [Gauge, Zap, Thermometer, Clock, Database, Activity, Gauge, Zap];
              const variants: ('primary' | 'accent' | 'success' | 'default')[] = ['primary', 'accent', 'success', 'default'];
              return (
                <MetricCard
                  key={col}
                  label={`${col}${s.unit ? ` (${s.unit})` : ''}`}
                  value={s.max.toFixed(2)}
                  unit={s.unit || ''}
                  icon={icons[i % icons.length]}
                  variant={variants[i % variants.length]}
                />
              );
            })}
          </div>

          {/* Chart */}
          {xCol && yCol && (
            <div className="gradient-card rounded-lg border border-border p-4">
              <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">
                {yCol} over {xCol}
              </h3>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(0, 85%, 55%)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="hsl(0, 85%, 55%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
                    <XAxis dataKey={xCol} stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} />
                    <YAxis stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 20%)', borderRadius: 8, fontSize: 12 }} />
                    <Area type="monotone" dataKey={yCol} stroke="hsl(0, 85%, 55%)" fill="url(#chartGrad)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
