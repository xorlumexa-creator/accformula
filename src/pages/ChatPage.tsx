import { useState, useRef, useEffect } from 'react';
import { useTelemetry } from '@/context/TelemetryContext';
import { Send, Bot, User, Sparkles } from 'lucide-react';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

function analyzeLocally(question: string, stats: ReturnType<typeof useTelemetry>['stats'], data: ReturnType<typeof useTelemetry>['data']): string {
  if (!stats) return "No telemetry data loaded. Please upload a CSV file first.";
  const q = question.toLowerCase();

  if (q.includes('max speed') || q.includes('top speed') || q.includes('fastest')) {
    return `The maximum speed recorded is **${stats.maxSpeed.toFixed(1)} km/h**. The average speed across all data points is ${stats.avgSpeed.toFixed(1)} km/h.`;
  }
  if (q.includes('avg speed') || q.includes('average speed')) {
    return `The average speed is **${stats.avgSpeed.toFixed(1)} km/h** across ${stats.dataPoints} data points.`;
  }
  if (q.includes('max accel') || q.includes('peak accel') || q.includes('fastest accel')) {
    return `Peak acceleration recorded is **${stats.maxAcceleration.toFixed(2)} g**. Average acceleration is ${stats.avgAcceleration.toFixed(2)} g.`;
  }
  if (q.includes('temp') || q.includes('hot') || q.includes('heat')) {
    return `Maximum temperature recorded is **${stats.maxTemperature.toFixed(1)}°C**. Average temperature is ${stats.avgTemperature.toFixed(1)}°C. ${stats.maxTemperature > 80 ? '⚠️ This is quite high — check cooling systems.' : 'Temperature looks within normal range.'}`;
  }
  if (q.includes('summary') || q.includes('overview') || q.includes('tell me about')) {
    return `**Telemetry Summary:**\n- Max Speed: ${stats.maxSpeed.toFixed(1)} km/h\n- Avg Speed: ${stats.avgSpeed.toFixed(1)} km/h\n- Max Accel: ${stats.maxAcceleration.toFixed(2)} g\n- Max Temp: ${stats.maxTemperature.toFixed(1)}°C\n- Duration: ${stats.totalTime.toFixed(1)}s\n- Data Points: ${stats.dataPoints}`;
  }
  if (q.includes('speed drop') || q.includes('deceleration') || q.includes('braking')) {
    const drops = data.filter((_, i) => i > 0 && data[i].speed < data[i - 1].speed - 5);
    if (drops.length > 0) {
      return `Found **${drops.length} significant speed drops** (>5 km/h). The largest was at t=${drops.reduce((a, b) => (a.speed < b.speed ? a : b)).time.toFixed(1)}s. These could indicate braking zones or track corners.`;
    }
    return "No significant speed drops detected in the data.";
  }
  if (q.includes('lap time') || q.includes('predict')) {
    const estimatedLapTime = stats.totalTime;
    return `Based on the recorded session of **${estimatedLapTime.toFixed(1)}s** with an average speed of ${stats.avgSpeed.toFixed(1)} km/h, you can use the Lap Calculator page for specific track distance predictions.`;
  }

  return `Based on your data: Max Speed is ${stats.maxSpeed.toFixed(1)} km/h, Max Accel is ${stats.maxAcceleration.toFixed(2)} g, and Max Temp is ${stats.maxTemperature.toFixed(1)}°C over ${stats.totalTime.toFixed(1)}s. Try asking about specific metrics like "max speed" or "temperature analysis".`;
}

const suggestions = [
  "What is the max speed?",
  "Give me a summary",
  "Any speed drops?",
  "Temperature analysis",
];

export default function ChatPage() {
  const { stats, data } = useTelemetry();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { role: 'user', content: text.trim() };
    const response = analyzeLocally(text, stats, data);
    setMessages(prev => [...prev, userMsg, { role: 'assistant', content: response }]);
    setInput('');
  };

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] max-w-2xl mx-auto animate-slide-up">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-bold">AI Assistant</h2>
        <span className="text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded">Local Analysis</span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-3 mb-4 pr-1">
        {messages.length === 0 && (
          <div className="text-center py-12 space-y-4">
            <Bot className="w-12 h-12 text-muted-foreground/30 mx-auto" />
            <p className="text-muted-foreground text-sm">Ask me about your telemetry data</p>
            <div className="flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-xs bg-secondary text-secondary-foreground px-3 py-1.5 rounded-full hover:bg-secondary/80 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : ''}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <Bot className="w-4 h-4 text-primary" />
              </div>
            )}
            <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
              msg.role === 'user'
                ? 'bg-primary text-primary-foreground'
                : 'gradient-card border border-border'
            }`}>
              {msg.content}
            </div>
            {msg.role === 'user' && (
              <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center shrink-0 mt-0.5">
                <User className="w-4 h-4 text-muted-foreground" />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send(input)}
          placeholder="Ask about your telemetry data..."
          className="flex-1 bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground"
        />
        <button
          onClick={() => send(input)}
          className="bg-primary text-primary-foreground p-2.5 rounded-lg hover:bg-primary/90 transition-colors"
        >
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
