import { useState } from 'react';
import AdSenseBanner from '@/components/AdSenseBanner';
import { useTelemetry } from '@/context/TelemetryContext';
import { Link } from 'react-router-dom';
import { BarChart3, Upload } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, ReferenceLine
} from 'recharts';

const CHART_COLORS = [
  'hsl(0, 85%, 55%)', 'hsl(200, 85%, 55%)', 'hsl(30, 95%, 55%)',
  'hsl(145, 65%, 42%)', 'hsl(270, 70%, 60%)', 'hsl(50, 90%, 55%)',
];

export default function AnalysisPage() {
  const { data, stats } = useTelemetry();
  const [activeMetric, setActiveMetric] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar'>('area');

  if (!stats || stats.numericColumns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <BarChart3 className="w-16 h-16 text-muted-foreground/30" />
        <p className="text-muted-foreground">Upload data to see analysis</p>
        <Link to="/upload" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          <Upload className="w-4 h-4" /> Upload Data
        </Link>
      </div>
    );
  }

  const metric = activeMetric || stats.numericColumns[0];
  const chartData = data.slice(0, 500);
  const s = stats.summary[metric];
  const xCol = stats.numericColumns[0] !== metric ? stats.numericColumns[0] : (stats.numericColumns[1] || stats.columns[0]);
  const colorIdx = stats.numericColumns.indexOf(metric);
  const color = CHART_COLORS[colorIdx % CHART_COLORS.length];

  const tooltipStyle = {
    contentStyle: { background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 20%)', borderRadius: 8, fontSize: 12 },
    labelStyle: { color: 'hsl(0, 0%, 60%)' },
  };

  const renderChart = () => {
    if (chartType === 'bar') {
      return (
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
          <XAxis dataKey={xCol} stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} />
          <YAxis stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} />
          <Tooltip {...tooltipStyle} />
          <ReferenceLine y={s?.avg} stroke={color} strokeDasharray="5 5" strokeOpacity={0.5} />
          <Bar dataKey={metric} fill={color} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
        </BarChart>
      );
    }
    if (chartType === 'area') {
      return (
        <AreaChart data={chartData}>
          <defs>
            <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
          <XAxis dataKey={xCol} stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} />
          <YAxis stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} />
          <Tooltip {...tooltipStyle} />
          <ReferenceLine y={s?.avg} stroke={color} strokeDasharray="5 5" strokeOpacity={0.5} />
          <Area type="monotone" dataKey={metric} stroke={color} fill="url(#aGrad)" strokeWidth={2} dot={false} />
        </AreaChart>
      );
    }
    return (
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
        <XAxis dataKey={xCol} stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} />
        <YAxis stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} />
        <Tooltip {...tooltipStyle} />
        <ReferenceLine y={s?.avg} stroke={color} strokeDasharray="5 5" strokeOpacity={0.5} />
        <Line type="monotone" dataKey={metric} stroke={color} strokeWidth={2} dot={false} />
      </LineChart>
    );
  };

  return (
    <div className="space-y-5 animate-slide-up">
      <h2 className="text-xl font-bold">Analysis</h2>

      {/* Metric Selection */}
      <div className="flex flex-wrap gap-2">
        {stats.numericColumns.map((col, i) => (
          <button key={col} onClick={() => setActiveMetric(col)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              metric === col ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}>
            {col}{stats.summary[col]?.unit ? ` (${stats.summary[col].unit})` : ''}
          </button>
        ))}
        <div className="ml-auto flex gap-1">
          {(['area', 'line', 'bar'] as const).map((t) => (
            <button key={t} onClick={() => setChartType(t)}
              className={`px-3 py-1.5 rounded-md text-xs capitalize transition-colors ${
                chartType === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      {s && (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">Peak:</span>
          <span className="data-display font-bold" style={{ color }}>{s.max.toFixed(2)} {s.unit || ''}</span>
          <span className="text-muted-foreground">Avg:</span>
          <span className="data-display">{s.avg.toFixed(2)} {s.unit || ''}</span>
          <span className="text-muted-foreground">Min:</span>
          <span className="data-display">{s.min.toFixed(2)} {s.unit || ''}</span>
        </div>
      )}

      {/* Chart */}
      <div className="gradient-card border border-border rounded-lg p-4">
        <div className="h-80 md:h-96">
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        </div>
      </div>
      <AdSenseBanner />
    </div>
  );
}
