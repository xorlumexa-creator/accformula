import { useEffect, useState } from 'react';
import { useTelemetry } from '@/context/TelemetryContext';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useTelemetryAttempts, useDesignAnalyses, type TelemetryAttempt, type DesignAnalysis } from '@/hooks/useLocalStorage';
import MetricCard from '@/components/MetricCard';
import { Link, useNavigate } from 'react-router-dom';
import {
  Gauge, Zap, Thermometer, Clock, Database, Activity,
  Upload, FileInput, MessageSquare, Timer, Search, BarChart3, Eye, X
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import ReactMarkdown from 'react-markdown';

const navCards = [
  { to: '/upload', icon: Upload, label: 'Sensor Telemetry', desc: 'Import CSV / telemetry files' },
  { to: '/import-design', icon: FileInput, label: 'Insert Design', desc: 'CAD data & analysis' },
  { to: '/assembly', icon: Search, label: 'Inspector', desc: 'Assembly inspection' },
  { to: '/chat', icon: MessageSquare, label: 'AI Chat', desc: 'Engineering assistant' },
  { to: '/lap-calculator', icon: Timer, label: 'Lap Calculator', desc: 'Track lap times' },
];

export default function DashboardPage() {
  const { data, stats, fileName, sessions, loadSession } = useTelemetry();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [hasProject, setHasProject] = useState<boolean | null>(null);
  const { attempts } = useTelemetryAttempts();
  const { analyses } = useDesignAnalyses();
  const [telPage, setTelPage] = useState(0);
  const [viewAttempt, setViewAttempt] = useState<TelemetryAttempt | null>(null);
  const [viewDesign, setViewDesign] = useState<DesignAnalysis | null>(null);

  const PER_PAGE = 10;

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

  const sortedAttempts = [...attempts].reverse();
  const pagedAttempts = sortedAttempts.slice(telPage * PER_PAGE, (telPage + 1) * PER_PAGE);
  const totalTelPages = Math.ceil(sortedAttempts.length / PER_PAGE);

  const sortedDesigns = [...analyses].reverse();

  const getScoreColor = (s: number) => {
    if (s >= 90) return 'bg-green-600';
    if (s >= 80) return 'bg-yellow-600';
    if (s >= 60) return 'bg-orange-600';
    return 'bg-destructive';
  };

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Navigation Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {navCards.map(({ to, icon: Icon, label, desc }) => (
          <Link key={to} to={to}
            className="gradient-card rounded-lg border border-border p-4 hover:border-primary/30 hover:glow-red transition-all group cursor-pointer">
            <Icon className="w-6 h-6 text-primary mb-2 group-hover:scale-110 transition-transform" />
            <p className="text-sm font-semibold">{label}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>
          </Link>
        ))}
      </div>

      {/* TELEMETRY ATTEMPTS SECTION */}
      {sortedAttempts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-primary font-display tracking-wide flex items-center gap-2">
            <BarChart3 className="w-5 h-5" /> Telemetry Attempts
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pagedAttempts.map(a => (
              <div key={a.attemptNumber} className="rounded-lg border border-border/30 p-4" style={{ background: '#111111' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-primary font-bold font-display text-sm">Attempt {a.attemptNumber}</span>
                  <span className="text-xs text-muted-foreground">{new Date(a.timestamp).toLocaleString()}</span>
                </div>
                <p className="text-xs text-muted-foreground italic truncate mb-3">
                  {a.rawData.slice(0, 50)}...
                </p>
                <button
                  onClick={() => setViewAttempt(a)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-colors font-medium"
                >
                  Analytics
                </button>
              </div>
            ))}
          </div>
          {/* Pagination */}
          {totalTelPages > 1 && (
            <div className="flex items-center justify-center gap-2">
              {Array.from({ length: totalTelPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => setTelPage(i)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${i === telPage ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:bg-secondary/80'}`}
                >
                  {i + 1}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* DESIGN ANALYSES SECTION */}
      {sortedDesigns.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-bold text-primary font-display tracking-wide flex items-center gap-2">
            <FileInput className="w-5 h-5" /> Part Analyses
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {sortedDesigns.map((d, i) => (
              <div key={i} className="rounded-lg border border-border/30 p-4" style={{ background: '#111111' }}>
                <p className="text-primary font-bold text-lg mb-1">{d.partName}</p>
                <p className="text-xs text-muted-foreground mb-1">{d.filename}</p>
                <p className="text-xs text-muted-foreground mb-3">{new Date(d.timestamp).toLocaleDateString()}</p>
                <div className="flex items-center justify-between">
                  <Badge className={`${getScoreColor(d.designScore)} text-foreground text-xs`}>
                    Score: {d.designScore}
                  </Badge>
                  <button
                    onClick={() => setViewDesign(d)}
                    className="text-xs px-3 py-1.5 rounded-lg border border-primary/30 text-primary hover:bg-primary/10 transition-colors font-medium"
                  >
                    View Analysis
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {sortedAttempts.length === 0 && sortedDesigns.length === 0 && (
        <div className="flex flex-col items-center justify-center min-h-[40vh] text-center gap-6">
          <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Activity className="w-10 h-10 text-primary animate-pulse" />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">Welcome to Lumexa</h2>
            <p className="text-muted-foreground max-w-md">
              Upload telemetry data or import a 3D design to get started with AI-powered engineering analysis.
            </p>
          </div>
          <div className="flex gap-3">
            <Link to="/upload" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 rounded-lg font-medium hover:bg-primary/90 transition-colors">
              Upload Telemetry
            </Link>
            <Link to="/import-design" className="inline-flex items-center gap-2 border border-primary/30 text-primary px-6 py-2.5 rounded-lg font-medium hover:bg-primary/10 transition-colors">
              Insert Design
            </Link>
          </div>
        </div>
      )}

      {/* Telemetry Attempt Modal */}
      <Dialog open={!!viewAttempt} onOpenChange={() => setViewAttempt(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-display">
              <BarChart3 className="w-5 h-5" />
              Attempt {viewAttempt?.attemptNumber} — {viewAttempt && new Date(viewAttempt.timestamp).toLocaleString()}
            </DialogTitle>
          </DialogHeader>
          {viewAttempt && (
            <div className="space-y-4">
              {viewAttempt.severityCards.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Issues Found</h4>
                  {viewAttempt.severityCards.map((c, i) => (
                    <div key={i} className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                      <Badge className={`text-xs mb-1 ${c.severity === 'CRITICAL' ? 'bg-destructive' : c.severity === 'HIGH' ? 'bg-orange-600' : c.severity === 'MEDIUM' ? 'bg-yellow-600' : 'bg-muted'}`}>
                        {c.severity}
                      </Badge>
                      <p className="text-sm font-bold">{c.title}</p>
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    </div>
                  ))}
                </div>
              )}
              {viewAttempt.analysisText && (
                <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown>{viewAttempt.analysisText}</ReactMarkdown>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Design Analysis Modal */}
      <Dialog open={!!viewDesign} onOpenChange={() => setViewDesign(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary font-display">
              <FileInput className="w-5 h-5" />
              {viewDesign?.partName} — Score: {viewDesign?.designScore}
            </DialogTitle>
          </DialogHeader>
          {viewDesign && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-secondary/50 p-3">
                  <p className="text-muted-foreground text-xs">Filename</p>
                  <p className="font-mono text-xs">{viewDesign.filename}</p>
                </div>
                <div className="rounded-lg bg-secondary/50 p-3">
                  <p className="text-muted-foreground text-xs">Date</p>
                  <p className="text-xs">{new Date(viewDesign.timestamp).toLocaleString()}</p>
                </div>
                {viewDesign.dimensions && (
                  <div className="rounded-lg bg-secondary/50 p-3 col-span-2">
                    <p className="text-muted-foreground text-xs">Dimensions</p>
                    <p className="font-mono text-xs text-primary">
                      {viewDesign.dimensions.x.toFixed(1)} × {viewDesign.dimensions.y.toFixed(1)} × {viewDesign.dimensions.z.toFixed(1)} mm
                    </p>
                  </div>
                )}
              </div>
              {viewDesign.severityCards.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Annotations</h4>
                  {viewDesign.severityCards.map((c, i) => (
                    <div key={i} className="rounded-lg border border-border/30 p-3" style={{ background: '#111111' }}>
                      <Badge className={`text-xs mb-1 ${c.severity === 'CRITICAL' ? 'bg-destructive' : c.severity === 'HIGH' ? 'bg-orange-600' : c.severity === 'MEDIUM' ? 'bg-yellow-600' : 'bg-muted'}`}>
                        {c.severity}
                      </Badge>
                      <p className="text-sm font-bold">{c.title}</p>
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    </div>
                  ))}
                </div>
              )}
              {viewDesign.analysisText && (
                <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown>{viewDesign.analysisText.replace(/```annotations-json[\s\S]*?```/g, '').trim()}</ReactMarkdown>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
