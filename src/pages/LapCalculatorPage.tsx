import { useState } from 'react';
import { useTelemetry } from '@/context/TelemetryContext';
import { Timer, RotateCcw, Calculator } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function LapCalculatorPage() {
  const { stats } = useTelemetry();
  const [distance, setDistance] = useState('');
  const [result, setResult] = useState<{ time: number; minutes: number; seconds: number } | null>(null);

  // Find speed column if exists
  const speedCol = stats?.numericColumns.find(c => /speed|velocity|km\/h|mph/i.test(c));
  const avgSpeed = speedCol ? stats!.summary[speedCol].avg : null;

  const calculate = () => {
    if (!avgSpeed || !distance) return;
    const d = parseFloat(distance);
    if (isNaN(d) || d <= 0) return;
    const avgSpeedMs = (avgSpeed * 1000) / 3600; // km/h to m/s
    const lapTime = d / avgSpeedMs;
    setResult({ time: lapTime, minutes: Math.floor(lapTime / 60), seconds: lapTime % 60 });
  };

  const reset = () => {
    setDistance('');
    setResult(null);
  };

  return (
    <div className="max-w-lg mx-auto space-y-6 animate-slide-up">
      <div className="flex items-center gap-2">
        <Timer className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-bold">Lap Time Calculator</h2>
      </div>

      {!avgSpeed ? (
        <div className="gradient-card border border-border rounded-lg p-8 text-center space-y-3">
          <Calculator className="w-10 h-10 text-muted-foreground/30 mx-auto" />
          <p className="text-muted-foreground text-sm">Upload telemetry data with a speed column to use the calculator</p>
          <Link to="/upload" className="inline-block bg-primary text-primary-foreground px-5 py-2 rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            Upload Data
          </Link>
        </div>
      ) : (
        <>
          <div className="gradient-card border border-border rounded-lg p-5 space-y-4">
            <div className="text-sm text-muted-foreground">
              Using average {speedCol}: <span className="data-display font-bold text-foreground">{avgSpeed.toFixed(1)} {stats!.summary[speedCol!].unit || 'km/h'}</span>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1.5">Track Distance (meters)</label>
              <input
                type="number"
                value={distance}
                onChange={(e) => setDistance(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && calculate()}
                placeholder="e.g. 1000"
                className="w-full bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={calculate} disabled={!distance}
                className="flex-1 bg-primary text-primary-foreground rounded-lg py-2.5 font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                Calculate
              </button>
              <button onClick={reset}
                className="px-4 bg-secondary text-secondary-foreground rounded-lg py-2.5 hover:bg-secondary/80 transition-colors">
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {result && (
            <div className="gradient-card border border-primary/20 glow-red rounded-lg p-6 text-center space-y-2">
              <p className="text-sm text-muted-foreground uppercase tracking-wider">Predicted Lap Time</p>
              <p className="text-4xl font-bold data-display">
                {result.minutes > 0 && <span>{result.minutes}<span className="text-lg text-muted-foreground">m </span></span>}
                {result.seconds.toFixed(2)}<span className="text-lg text-muted-foreground">s</span>
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
