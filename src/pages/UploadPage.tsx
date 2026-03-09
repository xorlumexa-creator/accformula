import { useCallback, useRef, useState } from 'react';
import { useTelemetry } from '@/context/TelemetryContext';
import { useTelemetryAttempts, type TelemetryAttempt } from '@/hooks/useLocalStorage';
import { Upload, FileText, CheckCircle2, AlertCircle, Trash2, ClipboardPaste, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import ReactMarkdown from 'react-markdown';

export default function UploadPage() {
  const { uploadCSV, uploadText, fileName, stats, isLoading, error, clearData } = useTelemetry();
  const { attempts, saveAttempt } = useTelemetryAttempts();
  const [dragOver, setDragOver] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [viewAttempt, setViewAttempt] = useState<TelemetryAttempt | null>(null);

  const handleFile = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (['csv', 'txt'].includes(ext || '') || file.type.includes('csv') || file.type.includes('text')) {
      uploadCSV(file);
    }
  }, [uploadCSV]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // Auto-save attempt when stats are available
  // (handled via effect would cause loops — we save manually on "View Dashboard")
  const handleViewDashboard = () => {
    if (stats) {
      saveAttempt({
        timestamp: new Date().toISOString(),
        rawData: pasteText || fileName || 'CSV upload',
        analysisText: '',
        chartData: [],
        severityCards: [],
        fileName: fileName || undefined,
        columns: stats.columns,
        rowCount: stats.rowCount,
      });
    }
    navigate('/');
  };

  const sortedAttempts = [...attempts].reverse();

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-slide-up">
      <div>
        <h2 className="text-xl font-bold font-display tracking-wide">Sensor Telemetry</h2>
        <p className="text-sm text-muted-foreground">Import any CSV file with sensor data — all columns are auto-detected</p>
      </div>

      {/* Drop Zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`gradient-card border-2 border-dashed rounded-xl p-12 text-center cursor-pointer transition-all ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-muted-foreground/30'
        }`}
      >
        <input ref={inputRef} type="file" accept=".csv,.txt,text/csv,text/plain,application/vnd.ms-excel" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }} />
        <Upload className={`w-10 h-10 mx-auto mb-4 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
        <p className="font-medium mb-1">
          {isLoading ? 'Processing...' : 'Drop your CSV file here or click to browse'}
        </p>
        <p className="text-sm text-muted-foreground">Any CSV with headers — columns auto-detected</p>
      </div>

      {/* Paste Text */}
      <div className="gradient-card border border-border rounded-lg p-5 space-y-3">
        <div className="flex items-center gap-2">
          <ClipboardPaste className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Or paste data directly</h3>
        </div>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder={"Sensor,Value,Unit,Timestamp\nEngineTemp,95,°C,0.0\nSpeed,120,km/h,0.1\nPressure,101.3,kPa,0.2"}
          className="w-full h-32 bg-background/50 border border-border rounded-md p-3 font-mono text-xs resize-y outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
        />
        <button
          onClick={() => { if (pasteText.trim()) { uploadText(pasteText.trim()); } }}
          disabled={!pasteText.trim() || isLoading}
          className="w-full bg-secondary text-secondary-foreground rounded-lg py-2 font-medium hover:bg-secondary/80 transition-colors disabled:opacity-50"
        >
          Parse Pasted Data
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 p-4 rounded-lg bg-destructive/10 border border-destructive/20">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}

      {/* Success */}
      {stats && (
        <div className="gradient-card border border-primary/20 rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-400" />
            <div>
              <p className="font-medium">File loaded successfully</p>
              <p className="text-sm text-muted-foreground">{fileName}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-secondary/50 rounded-md p-3">
              <p className="text-lg font-bold data-display">{stats.rowCount}</p>
              <p className="text-xs text-muted-foreground">Data Points</p>
            </div>
            <div className="bg-secondary/50 rounded-md p-3">
              <p className="text-lg font-bold data-display">{stats.numericColumns.length}</p>
              <p className="text-xs text-muted-foreground">Metrics</p>
            </div>
            <div className="bg-secondary/50 rounded-md p-3">
              <p className="text-lg font-bold data-display">{stats.columns.length}</p>
              <p className="text-xs text-muted-foreground">Columns</p>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            <span className="font-medium">Detected columns:</span> {stats.columns.join(', ')}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleViewDashboard}
              className="flex-1 bg-primary text-primary-foreground rounded-lg py-2 font-medium hover:bg-primary/90 transition-colors"
            >
              View Dashboard
            </button>
            <button
              onClick={clearData}
              className="px-4 bg-secondary text-secondary-foreground rounded-lg py-2 hover:bg-secondary/80 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Previous Attempts */}
      {sortedAttempts.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-bold text-primary uppercase tracking-wider flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Previous Attempts
          </h3>
          <div className="space-y-2">
            {sortedAttempts.map(a => (
              <div key={a.attemptNumber} className="rounded-lg border border-border/30 p-3 flex items-center justify-between" style={{ background: '#111111' }}>
                <div className="min-w-0 flex-1">
                  <span className="text-primary font-bold text-sm">Attempt {a.attemptNumber}</span>
                  <span className="text-xs text-muted-foreground ml-2">{new Date(a.timestamp).toLocaleString()}</span>
                  <p className="text-xs text-muted-foreground italic truncate mt-0.5">{a.rawData.slice(0, 50)}...</p>
                </div>
                <button
                  onClick={() => setViewAttempt(a)}
                  className="text-xs px-3 py-1.5 rounded-lg bg-green-600/20 text-green-400 border border-green-600/30 hover:bg-green-600/30 transition-colors font-medium shrink-0 ml-3"
                >
                  Analytics
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Format Help */}
      <div className="gradient-card border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">CSV Format</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-3">Any CSV with headers works. Units are auto-detected from column names:</p>
        <div className="bg-background/50 rounded-md p-3 font-mono text-xs overflow-x-auto space-y-1">
          <p className="text-muted-foreground">Time,Speed (km/h),Temperature (°C),Pressure (kPa)</p>
          <p>0.0,0.0,25.3,101.3</p>
          <p>0.1,5.2,25.8,101.1</p>
          <p>0.2,12.1,26.4,100.9</p>
        </div>
      </div>

      {/* Attempt Analytics Modal */}
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
              {!viewAttempt.analysisText && viewAttempt.severityCards.length === 0 && (
                <p className="text-muted-foreground text-sm text-center py-4">
                  Raw data uploaded. Run AI analysis on the dashboard to see detailed results.
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
