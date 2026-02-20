import { useState } from 'react';
import { useTelemetry } from '@/context/TelemetryContext';
import { Link } from 'react-router-dom';
import { BarChart3, Upload } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, ReferenceLine
} from 'recharts';

type Metric = 'speed' | 'acceleration' | 'temperature';

const metricConfig: Record<Metric, { color: string; unit: string; label: string }> = {
  speed: { color: 'hsl(200, 85%, 55%)', unit: 'km/h', label: 'Speed' },
  acceleration: { color: 'hsl(0, 85%, 55%)', unit: 'g', label: 'Acceleration' },
  temperature: { color: 'hsl(30, 95%, 55%)', unit: '°C', label: 'Temperature' },
};

export default function AnalysisPage() {
  const { data, stats } = useTelemetry();
  const [activeMetric, setActiveMetric] = useState<Metric>('speed');
  const [chartType, setChartType] = useState<'line' | 'area' | 'bar'>('area');

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <BarChart3 className="w-16 h-16 text-muted-foreground/30" />
        <p className="text-muted-foreground">Upload data to see analysis</p>
        <Link to="/upload" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
          <Upload className="w-4 h-4" /> Upload CSV
        </Link>
      </div>
    );
  }

  const chartData = data.slice(0, 500);
  const cfg = metricConfig[activeMetric];
  const maxVal = activeMetric === 'speed' ? stats.maxSpeed : activeMetric === 'acceleration' ? stats.maxAcceleration : stats.maxTemperature;
  const avgVal = activeMetric === 'speed' ? stats.avgSpeed : activeMetric === 'acceleration' ? stats.avgAcceleration : stats.avgTemperature;

  const tooltipStyle = {
    contentStyle: { background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 20%)', borderRadius: 8, fontSize: 12 },
    labelStyle: { color: 'hsl(0, 0%, 60%)' },
  };

  const renderChart = () => {
    const common = {
      data: chartData,
      children: [
        <CartesianGrid key="g" strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />,
        <XAxis key="x" dataKey="time" stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} label={{ value: 'Time (s)', position: 'insideBottom', offset: -5, fill: 'hsl(220, 10%, 40%)', fontSize: 11 }} />,
        <YAxis key="y" stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} label={{ value: `${cfg.label} (${cfg.unit})`, angle: -90, position: 'insideLeft', fill: 'hsl(220, 10%, 40%)', fontSize: 11 }} />,
        <Tooltip key="t" {...tooltipStyle} />,
        <ReferenceLine key="avg" y={avgVal} stroke={cfg.color} strokeDasharray="5 5" strokeOpacity={0.5} label={{ value: `Avg: ${avgVal.toFixed(2)}`, fill: cfg.color, fontSize: 10 }} />,
      ],
    };

    if (chartType === 'bar') {
      return (
        <BarChart data={common.data}>
          {common.children}
          <Bar dataKey={activeMetric} fill={cfg.color} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
        </BarChart>
      );
    }
    if (chartType === 'area') {
      return (
        <AreaChart data={common.data}>
          <defs>
            <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={cfg.color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={cfg.color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {common.children}
          <Area type="monotone" dataKey={activeMetric} stroke={cfg.color} fill="url(#aGrad)" strokeWidth={2} dot={false} />
        </AreaChart>
      );
    }
    return (
      <LineChart data={common.data}>
        {common.children}
        <Line type="monotone" dataKey={activeMetric} stroke={cfg.color} strokeWidth={2} dot={false} />
      </LineChart>
    );
  };

  return (
    <div className="space-y-5 animate-slide-up">
      <h2 className="text-xl font-bold">Analysis</h2>

      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(metricConfig) as Metric[]).map((m) => (
          <button
            key={m}
            onClick={() => setActiveMetric(m)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
              activeMetric === m ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
            }`}
          >
            {metricConfig[m].label}
          </button>
        ))}
        <div className="ml-auto flex gap-1">
          {(['area', 'line', 'bar'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setChartType(t)}
              className={`px-3 py-1.5 rounded-md text-xs capitalize transition-colors ${
                chartType === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Peak info */}
      <div className="flex items-center gap-4 text-sm">
        <span className="text-muted-foreground">Peak:</span>
        <span className="data-display font-bold" style={{ color: cfg.color }}>{maxVal.toFixed(2)} {cfg.unit}</span>
        <span className="text-muted-foreground">Avg:</span>
        <span className="data-display">{avgVal.toFixed(2)} {cfg.unit}</span>
      </div>

      {/* Chart */}
      <div className="gradient-card border border-border rounded-lg p-4">
        <div className="h-80 md:h-96">
          <ResponsiveContainer width="100%" height="100%">
            {renderChart()}
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
