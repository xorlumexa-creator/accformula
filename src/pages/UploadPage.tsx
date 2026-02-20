import { useCallback, useRef, useState } from 'react';
import { useTelemetry } from '@/context/TelemetryContext';
import { Upload, FileText, CheckCircle2, AlertCircle, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function UploadPage() {
  const { uploadCSV, fileName, stats, isLoading, error, clearData } = useTelemetry();
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const handleFile = useCallback((file: File) => {
    if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
      uploadCSV(file);
    }
  }, [uploadCSV]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-slide-up">
      <div>
        <h2 className="text-xl font-bold">Upload Telemetry Data</h2>
        <p className="text-sm text-muted-foreground">Import CSV files from your car's sensors</p>
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
        <input ref={inputRef} type="file" accept=".csv" className="hidden" onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }} />
        <Upload className={`w-10 h-10 mx-auto mb-4 ${dragOver ? 'text-primary' : 'text-muted-foreground'}`} />
        <p className="font-medium mb-1">
          {isLoading ? 'Processing...' : 'Drop your CSV file here or click to browse'}
        </p>
        <p className="text-sm text-muted-foreground">Supports .csv files</p>
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
        <div className="gradient-card border border-success/20 rounded-lg p-5 space-y-4">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-success" />
            <div>
              <p className="font-medium">File loaded successfully</p>
              <p className="text-sm text-muted-foreground">{fileName}</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-secondary/50 rounded-md p-3">
              <p className="text-lg font-bold data-display">{stats.dataPoints}</p>
              <p className="text-xs text-muted-foreground">Data Points</p>
            </div>
            <div className="bg-secondary/50 rounded-md p-3">
              <p className="text-lg font-bold data-display">{stats.totalTime.toFixed(1)}s</p>
              <p className="text-xs text-muted-foreground">Duration</p>
            </div>
            <div className="bg-secondary/50 rounded-md p-3">
              <p className="text-lg font-bold data-display">{stats.maxSpeed.toFixed(1)}</p>
              <p className="text-xs text-muted-foreground">Max km/h</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => navigate('/')}
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

      {/* Format Help */}
      <div className="gradient-card border border-border rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">CSV Format</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-3">Your CSV file should contain these columns:</p>
        <div className="bg-background/50 rounded-md p-3 font-mono text-xs overflow-x-auto">
          <p className="text-muted-foreground">Time,Speed,Acceleration,Temperature</p>
          <p>0.0,0.0,0.5,25.3</p>
          <p>0.1,5.2,1.2,25.8</p>
          <p>0.2,12.1,1.8,26.4</p>
        </div>
      </div>
    </div>
  );
}
