import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import Papa from 'papaparse';

export interface TelemetryRow {
  time: number;
  speed: number;
  acceleration: number;
  temperature: number;
}

export interface TelemetryStats {
  maxSpeed: number;
  avgSpeed: number;
  maxAcceleration: number;
  avgAcceleration: number;
  maxTemperature: number;
  avgTemperature: number;
  totalTime: number;
  dataPoints: number;
}

interface TelemetryContextType {
  data: TelemetryRow[];
  stats: TelemetryStats | null;
  fileName: string | null;
  isLoading: boolean;
  error: string | null;
  uploadCSV: (file: File) => void;
  uploadText: (text: string) => void;
  clearData: () => void;
}

const TelemetryContext = createContext<TelemetryContextType | undefined>(undefined);

function computeStats(data: TelemetryRow[]): TelemetryStats {
  const speeds = data.map(d => d.speed);
  const accels = data.map(d => d.acceleration);
  const temps = data.map(d => d.temperature);
  return {
    maxSpeed: Math.max(...speeds),
    avgSpeed: speeds.reduce((a, b) => a + b, 0) / speeds.length,
    maxAcceleration: Math.max(...accels),
    avgAcceleration: accels.reduce((a, b) => a + b, 0) / accels.length,
    maxTemperature: Math.max(...temps),
    avgTemperature: temps.reduce((a, b) => a + b, 0) / temps.length,
    totalTime: Math.max(...data.map(d => d.time)) - Math.min(...data.map(d => d.time)),
    dataPoints: data.length,
  };
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<TelemetryRow[]>([]);
  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const uploadCSV = useCallback((file: File) => {
    setIsLoading(true);
    setError(null);
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        try {
          const rows: TelemetryRow[] = [];
          for (const row of results.data as Record<string, any>[]) {
            const time = parseFloat(row.Time ?? row.time ?? row.TIME ?? '');
            const speed = parseFloat(row.Speed ?? row.speed ?? row.SPEED ?? '');
            const acceleration = parseFloat(row.Acceleration ?? row.acceleration ?? row.ACCELERATION ?? row.Accel ?? row.accel ?? '');
            const temperature = parseFloat(row.Temperature ?? row.temperature ?? row.TEMPERATURE ?? row.Temp ?? row.temp ?? '');

            if (!isNaN(time) && !isNaN(speed) && !isNaN(acceleration) && !isNaN(temperature)) {
              rows.push({ time, speed, acceleration, temperature });
            }
          }

          if (rows.length === 0) {
            setError('No valid data found. Ensure CSV has columns: Time, Speed, Acceleration, Temperature');
            setData([]);
            setStats(null);
          } else {
            rows.sort((a, b) => a.time - b.time);
            setData(rows);
            setStats(computeStats(rows));
          }
        } catch {
          setError('Failed to parse CSV file');
        }
        setIsLoading(false);
      },
      error: () => {
        setError('Failed to read CSV file');
        setIsLoading(false);
      },
    });
  }, []);

  const uploadText = useCallback((text: string) => {
    setIsLoading(true);
    setError(null);
    setFileName('Pasted text data');

    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => {
        try {
          const rows: TelemetryRow[] = [];
          for (const row of results.data as Record<string, any>[]) {
            const time = parseFloat(row.Time ?? row.time ?? row.TIME ?? '');
            const speed = parseFloat(row.Speed ?? row.speed ?? row.SPEED ?? '');
            const acceleration = parseFloat(row.Acceleration ?? row.acceleration ?? row.ACCELERATION ?? row.Accel ?? row.accel ?? '');
            const temperature = parseFloat(row.Temperature ?? row.temperature ?? row.TEMPERATURE ?? row.Temp ?? row.temp ?? '');

            if (!isNaN(time) && !isNaN(speed) && !isNaN(acceleration) && !isNaN(temperature)) {
              rows.push({ time, speed, acceleration, temperature });
            }
          }

          if (rows.length === 0) {
            setError('No valid data found. Ensure text has columns: Time, Speed, Acceleration, Temperature');
            setData([]);
            setStats(null);
          } else {
            rows.sort((a, b) => a.time - b.time);
            setData(rows);
            setStats(computeStats(rows));
          }
        } catch {
          setError('Failed to parse text data');
        }
        setIsLoading(false);
      },
      error: () => {
        setError('Failed to parse text data');
        setIsLoading(false);
      },
    });
  }, []);

  const clearData = useCallback(() => {
    setData([]);
    setStats(null);
    setFileName(null);
    setError(null);
  }, []);

  return (
    <TelemetryContext.Provider value={{ data, stats, fileName, isLoading, error, uploadCSV, uploadText, clearData }}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry must be used within TelemetryProvider');
  return ctx;
}
