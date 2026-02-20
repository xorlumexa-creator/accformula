import { useTelemetry } from '@/context/TelemetryContext';
import MetricCard from '@/components/MetricCard';
import { Gauge, Zap, Thermometer, Clock, Database, Activity } from 'lucide-react';
import { Link } from 'react-router-dom';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';

export default function DashboardPage() {
  const { data, stats, fileName } = useTelemetry();

  if (!stats) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center gap-6">
        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center">
          <Activity className="w-10 h-10 text-primary animate-pulse-glow" />
        </div>
        <div>
          <h2 className="text-2xl font-bold mb-2">No Telemetry Data</h2>
          <p className="text-muted-foreground max-w-md">
            Upload a CSV file with your car's sensor data to see live metrics, charts, and analysis.
          </p>
        </div>
        <Link
          to="/upload"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-2.5 rounded-lg font-medium hover:bg-primary/90 transition-colors"
        >
          Upload Data
        </Link>
      </div>
    );
  }

  const chartData = data.slice(0, 200); // limit for performance

  return (
    <div className="space-y-6 animate-slide-up">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Dashboard</h2>
          <p className="text-sm text-muted-foreground">{fileName} · {stats.dataPoints} data points</p>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Max Speed" value={stats.maxSpeed.toFixed(1)} unit="km/h" icon={Gauge} variant="primary" />
        <MetricCard label="Avg Speed" value={stats.avgSpeed.toFixed(1)} unit="km/h" icon={Gauge} />
        <MetricCard label="Max Accel" value={stats.maxAcceleration.toFixed(2)} unit="g" icon={Zap} variant="accent" />
        <MetricCard label="Max Temp" value={stats.maxTemperature.toFixed(1)} unit="°C" icon={Thermometer} variant="success" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Avg Accel" value={stats.avgAcceleration.toFixed(2)} unit="g" icon={Zap} />
        <MetricCard label="Avg Temp" value={stats.avgTemperature.toFixed(1)} unit="°C" icon={Thermometer} />
        <MetricCard label="Duration" value={stats.totalTime.toFixed(1)} unit="s" icon={Clock} />
        <MetricCard label="Samples" value={stats.dataPoints.toString()} unit="pts" icon={Database} />
      </div>

      {/* Speed Chart */}
      <div className="gradient-card rounded-lg border border-border p-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Speed Over Time</h3>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="speedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(200, 85%, 55%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(200, 85%, 55%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
              <XAxis dataKey="time" stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} />
              <YAxis stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 11 }} />
              <Tooltip
                contentStyle={{ background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 20%)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: 'hsl(0, 0%, 60%)' }}
              />
              <Area type="monotone" dataKey="speed" stroke="hsl(200, 85%, 55%)" fill="url(#speedGrad)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Accel + Temp mini charts */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="gradient-card rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Acceleration</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
                <XAxis dataKey="time" stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 20%)', borderRadius: 8, fontSize: 12 }} />
                <Line type="monotone" dataKey="acceleration" stroke="hsl(0, 85%, 55%)" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="gradient-card rounded-lg border border-border p-4">
          <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-4">Temperature</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(30, 95%, 55%)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="hsl(30, 95%, 55%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(220, 15%, 18%)" />
                <XAxis dataKey="time" stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 10 }} />
                <YAxis stroke="hsl(220, 10%, 40%)" tick={{ fontSize: 10 }} />
                <Tooltip contentStyle={{ background: 'hsl(220, 18%, 12%)', border: '1px solid hsl(220, 15%, 20%)', borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="temperature" stroke="hsl(30, 95%, 55%)" fill="url(#tempGrad)" strokeWidth={1.5} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
