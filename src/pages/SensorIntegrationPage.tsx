import { useState, useRef, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useTelemetry } from '@/context/TelemetryContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import ReactMarkdown from 'react-markdown';
import {
  Radio, Upload, Loader2, ChevronDown, ChevronUp, Plus, Send, Sparkles
} from 'lucide-react';

const sensorTypes = ['Speed', 'Temperature', 'Pressure', 'RPM', 'Vibration', 'Voltage', 'Current', 'Humidity', 'Custom'];
const connectionTypes = ['HTTP POST', 'WebSocket', 'MQTT'];

const sensorGuidelines: Record<string, string[]> = {
  Speed: ['Mount sensor on wheel hub or use GPS module', 'Ensure line-of-sight for GPS-based sensors', 'Calibrate for wheel circumference if using hall effect'],
  Temperature: ['Place sensor close to heat source, avoid direct airflow', 'Use thermal paste for surface-mount sensors', 'Allow 30s warm-up for accurate readings'],
  Pressure: ['Install in clean, dry environment', 'Use correct pressure range for your application', 'Calibrate at known reference pressure'],
  RPM: ['Mount proximity sensor within 2mm of rotating target', 'Ensure target has clear reference marks', 'Shield wiring from EMI interference'],
  Vibration: ['Mount rigidly on the surface to be measured', 'Avoid mounting on flexible or damped surfaces', 'Orient axis correctly for measurement direction'],
  Voltage: ['Use voltage divider for high-voltage sources', 'Add filtering capacitor for noisy signals', 'Ensure ADC reference voltage is stable'],
  Current: ['Use hall-effect sensor for non-invasive measurement', 'Size sensor range to expected current draw', 'Keep sensor leads short to reduce noise'],
  Humidity: ['Avoid direct water splash on sensor', 'Allow airflow around sensor element', 'Recalibrate periodically with salt solution method'],
  Custom: ['Define your unit and data format', 'Ensure consistent sampling rate', 'Document pin connections and protocol'],
};

const deviceGuidelines: Record<string, string[]> = {
  'ESP32': ['Use WiFi for data transmission', 'Connect sensors to ADC pins (GPIO 32-39)', 'Flash with Arduino or PlatformIO', 'Set sampling rate in firmware loop'],
  'Arduino': ['Use serial or Ethernet shield for connectivity', 'Connect sensors to analog pins (A0-A5)', 'Use analogRead() for ADC sampling', 'Buffer data before transmission'],
  'Raspberry Pi': ['Use I2C or SPI for sensor communication', 'Install Python libraries for your sensor', 'Run data collection as systemd service', 'Use MQTT for real-time streaming'],
  'F1 Sensor Pod': ['Connect via CAN bus interface', 'Use standard F1 telemetry protocol', 'Ensure high-speed logging at 1kHz+', 'Sync timestamps across all channels'],
};

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export default function SensorIntegrationPage() {
  const { user } = useAuth();
  const { uploadCSV } = useTelemetry();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [sensorType, setSensorType] = useState('');
  const [connectionType, setConnectionType] = useState('HTTP POST');
  const [deviceAddress, setDeviceAddress] = useState('');
  const [unit, setUnit] = useState('');
  const [showSensorGuide, setShowSensorGuide] = useState(false);
  const [showDeviceGuide, setShowDeviceGuide] = useState('');

  const [pasteData, setPasteData] = useState('');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [savingSensor, setSavingSensor] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<string | null>(null);

  const handleFileUpload = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (['csv', 'txt', 'json'].includes(ext || '')) {
      setUploadedFile(file);
      if (ext === 'csv' || ext === 'txt') uploadCSV(file);
    } else {
      toast({ title: 'Unsupported file format. Use CSV, JSON, or TXT.', variant: 'destructive' });
    }
  }, [uploadCSV, toast]);

  const handleAnalyze = async () => {
    if (!pasteData.trim() && !uploadedFile) {
      toast({ title: 'Provide sensor data or upload a file first', variant: 'destructive' });
      return;
    }
    setAnalyzing(true);
    setAnalysisResult(null);

    try {
      let fileContent = '';
      if (uploadedFile) fileContent = await uploadedFile.text();

      const content = `Analyze this sensor/telemetry data for anomalies, predictions, and recommendations:\n\n${sensorType ? `**Sensor Type:** ${sensorType}\n` : ''}${unit ? `**Unit:** ${unit}\n` : ''}${connectionType ? `**Connection:** ${connectionType}\n` : ''}\n${pasteData ? `**Data:**\n\`\`\`\n${pasteData}\n\`\`\`\n` : ''}${fileContent ? `**File (${uploadedFile?.name}):**\n\`\`\`\n${fileContent.slice(0, 10000)}\n\`\`\`\n` : ''}\nFocus on: anomaly detection, threshold alerts, predictive maintenance, and optimization recommendations.`;

      const { data: projects } = await supabase
        .from('projects').select('*').eq('user_id', user!.id)
        .order('created_at', { ascending: false }).limit(1);
      const project = projects?.[0];

      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [{ role: 'user', content }],
          projectContext: project ? {
            name: project.project_name, category: project.category,
            purpose: project.purpose, budget: project.budget_range,
            complexity: project.complexity, description: project.description,
          } : null,
          telemetryStats: null,
        }),
      });

      if (!resp.ok) throw new Error('Analysis failed');

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let fullText = '';
      let textBuffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const c = parsed.choices?.[0]?.delta?.content;
            if (c) { fullText += c; setAnalysisResult(fullText); }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }
    } catch (err: any) {
      toast({ title: err.message || 'Analysis failed', variant: 'destructive' });
    } finally {
      setAnalyzing(false);
    }
  };

  const saveSensorConfig = async () => {
    if (!sensorType) { toast({ title: 'Select a sensor type', variant: 'destructive' }); return; }
    setSavingSensor(true);
    const { error } = await supabase.from('sensor_configs').insert({
      user_id: user!.id, sensor_name: `${sensorType} Sensor`, sensor_type: sensorType,
      connection_type: connectionType, device_address: deviceAddress, unit, status: 'offline',
    });
    if (error) toast({ title: error.message, variant: 'destructive' });
    else toast({ title: 'Sensor configuration saved' });
    setSavingSensor(false);
  };

  const sampleJSON = `{\n  "time": "${new Date().toISOString()}",\n  "sensor_type": "EngineTemp",\n  "value": 95,\n  "unit": "C",\n  "status": "OK"\n}`;

  return (
    <div className="space-y-6 animate-slide-up max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center border-glow">
          <Radio className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold font-display tracking-wide">Sensor Integration</h2>
          <p className="text-sm text-muted-foreground">Connect sensors or upload telemetry — units are automatically recognized</p>
        </div>
      </div>

      <Card className="glass-strong border-glow">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Live Sensor Connection</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Sensor Type</label>
              <Select value={sensorType} onValueChange={setSensorType}>
                <SelectTrigger className="bg-background/50 border-border/50"><SelectValue placeholder="Select sensor type" /></SelectTrigger>
                <SelectContent>{sensorTypes.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Connection Type</label>
              <Select value={connectionType} onValueChange={setConnectionType}>
                <SelectTrigger className="bg-background/50 border-border/50"><SelectValue /></SelectTrigger>
                <SelectContent>{connectionTypes.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Device Address / ID</label>
              <Input value={deviceAddress} onChange={e => setDeviceAddress(e.target.value)} placeholder="e.g. 192.168.1.100:8080" className="bg-background/50 border-border/50" />
            </div>
            <div>
              <label className="text-sm text-muted-foreground mb-1 block">Unit (auto-detected if empty)</label>
              <Input value={unit} onChange={e => setUnit(e.target.value)} placeholder="e.g. °C, kPa, RPM" className="bg-background/50 border-border/50" />
            </div>
          </div>
          <Button onClick={saveSensorConfig} disabled={savingSensor} variant="outline" className="w-full">
            {savingSensor ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            Save Sensor Configuration
          </Button>
        </CardContent>
      </Card>

      {sensorType && (
        <Card className="glass border-glow animate-slide-up">
          <CardHeader className="pb-0">
            <button onClick={() => setShowSensorGuide(!showSensorGuide)} className="flex items-center justify-between w-full text-left">
              <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">{sensorType} Sensor Guidelines</CardTitle>
              {showSensorGuide ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
            </button>
          </CardHeader>
          {showSensorGuide && (
            <CardContent className="pt-3 space-y-2">
              {(sensorGuidelines[sensorType] || sensorGuidelines.Custom).map((step, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <span className="text-foreground/80">{step}</span>
                </div>
              ))}
            </CardContent>
          )}
        </Card>
      )}

      <Card className="glass border-glow">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">Device Setup Guides</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.keys(deviceGuidelines).map(device => (
            <div key={device}>
              <button onClick={() => setShowDeviceGuide(showDeviceGuide === device ? '' : device)}
                className="flex items-center justify-between w-full text-left p-2 rounded-lg hover:bg-primary/5 transition-colors">
                <span className="text-sm font-medium">{device}</span>
                {showDeviceGuide === device ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
              </button>
              {showDeviceGuide === device && (
                <div className="pl-4 pb-2 space-y-1.5">
                  {deviceGuidelines[device].map((step, i) => (
                    <div key={i} className="flex items-start gap-2 text-sm text-foreground/70">
                      <span className="text-primary text-xs mt-0.5">•</span>
                      <span>{step}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="glass-strong border-glow">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground">File Upload / Data Input</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div onClick={() => fileRef.current?.click()}
            className="flex items-center gap-3 p-6 rounded-lg bg-background/30 border-2 border-dashed border-border/50 cursor-pointer hover:border-primary/30 hover:bg-primary/5 transition-all group text-center justify-center">
            <input ref={fileRef} type="file" accept=".csv,.json,.txt" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); }} />
            <Upload className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
            <div>
              <p className="text-sm font-medium">{uploadedFile ? uploadedFile.name : 'Drop CSV / JSON / TXT file here'}</p>
              <p className="text-xs text-muted-foreground">Any telemetry format with headers — units auto-detected</p>
            </div>
          </div>

          <Textarea value={pasteData} onChange={e => setPasteData(e.target.value)}
            placeholder={sampleJSON} className="min-h-[120px] bg-background/50 border-border/50 font-mono text-xs" rows={6} />

          {pasteData.trim() && (
            <div className="glass rounded-lg p-3">
              <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Preview</h4>
              <pre className="text-xs font-mono text-foreground/70 overflow-x-auto max-h-32">{pasteData.slice(0, 500)}</pre>
            </div>
          )}

          <Button onClick={handleAnalyze} disabled={analyzing} className="w-full glow-red">
            {analyzing ? <><Loader2 className="w-4 h-4 animate-spin mr-2" /> Analyzing Sensor Data...</> : <><Send className="w-4 h-4 mr-2" /> Analyze with AI</>}
          </Button>
        </CardContent>
      </Card>

      {analysisResult && (
        <div className="space-y-4 animate-slide-up">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h3 className="text-lg font-bold font-display tracking-wide">Sensor Analysis</h3>
          </div>
          <Card className="glass-strong border-glow">
            <CardContent className="pt-6 prose prose-sm prose-invert max-w-none">
              <ReactMarkdown>{analysisResult}</ReactMarkdown>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
