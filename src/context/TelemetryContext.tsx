import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import Papa from 'papaparse';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface TelemetryRow {
  [key: string]: number | string;
}

export interface TelemetryStats {
  columns: string[];
  numericColumns: string[];
  rowCount: number;
  summary: Record<string, { min: number; max: number; avg: number; unit?: string }>;
}

interface TelemetryContextType {
  data: TelemetryRow[];
  stats: TelemetryStats | null;
  fileName: string | null;
  isLoading: boolean;
  error: string | null;
  sessions: { id: string; file_name: string; row_count: number; columns: string[]; created_at: string }[];
  uploadCSV: (file: File) => void;
  uploadText: (text: string) => void;
  clearData: () => void;
  loadSession: (sessionId: string) => void;
  refreshSessions: () => void;
}

const TelemetryContext = createContext<TelemetryContextType | undefined>(undefined);

const UNIT_PATTERNS: Record<string, RegExp> = {
  '°C': /temp|°c|celsius/i,
  'kPa': /press|kpa/i,
  'RPM': /rpm|revolution/i,
  'm/s²': /accel|m\/s/i,
  'km/h': /speed|km\/h|velocity/i,
  'mph': /mph/i,
  'V': /volt|voltage/i,
  'A': /amp|current/i,
  'W': /watt|power/i,
  '%': /humid|percent|battery|soc/i,
  's': /^time$|^t$/i,
  'g': /^g$|g-force/i,
  'Hz': /freq|hertz|hz/i,
  'm/s': /m\/s(?!²)/i,
};

function detectUnit(colName: string): string | undefined {
  // Check if column name contains unit in parentheses e.g. "Temperature (°C)"
  const parenMatch = colName.match(/\(([^)]+)\)/);
  if (parenMatch) return parenMatch[1];

  for (const [unit, pattern] of Object.entries(UNIT_PATTERNS)) {
    if (pattern.test(colName)) return unit;
  }
  return undefined;
}

function computeStats(data: TelemetryRow[], columns: string[]): TelemetryStats {
  const numericColumns: string[] = [];
  const summary: Record<string, { min: number; max: number; avg: number; unit?: string }> = {};

  for (const col of columns) {
    const values = data.map(r => Number(r[col])).filter(v => !isNaN(v));
    if (values.length > 0) {
      numericColumns.push(col);
      const unit = detectUnit(col);
      summary[col] = {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        unit,
      };
    }
  }

  return { columns, numericColumns, rowCount: data.length, summary };
}

function parseResults(results: Papa.ParseResult<Record<string, any>>): { rows: TelemetryRow[]; columns: string[] } {
  const columns = results.meta.fields || [];
  const rows: TelemetryRow[] = [];

  for (const row of results.data as Record<string, any>[]) {
    const parsed: TelemetryRow = {};
    let hasValue = false;
    for (const col of columns) {
      const val = row[col];
      const num = parseFloat(val);
      if (!isNaN(num)) {
        parsed[col] = num;
        hasValue = true;
      } else if (val !== undefined && val !== null && val !== '') {
        parsed[col] = String(val);
        hasValue = true;
      }
    }
    if (hasValue) rows.push(parsed);
  }

  return { rows, columns };
}

export function TelemetryProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [data, setData] = useState<TelemetryRow[]>([]);
  const [stats, setStats] = useState<TelemetryStats | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);

  const refreshSessions = useCallback(async () => {
    if (!user) return;
    const { data: s } = await supabase
      .from('telemetry_sessions')
      .select('id, file_name, row_count, columns, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (s) setSessions(s);
  }, [user]);

  useEffect(() => {
    refreshSessions();
  }, [refreshSessions]);

  const saveSession = useCallback(async (name: string, columns: string[], rows: TelemetryRow[], rowCount: number) => {
    if (!user) return;
    // Limit stored data to 5000 rows for DB performance
    const limitedData = rows.slice(0, 5000);
    await supabase.from('telemetry_sessions').insert({
      user_id: user.id,
      file_name: name,
      columns: columns as any,
      data: limitedData as any,
      row_count: rowCount,
    });
    refreshSessions();
  }, [user, refreshSessions]);

  const processData = useCallback((results: Papa.ParseResult<Record<string, any>>, name: string) => {
    try {
      const { rows, columns } = parseResults(results);
      if (rows.length === 0) {
        setError('No valid data found in the file.');
        setData([]);
        setStats(null);
      } else {
        setData(rows);
        setStats(computeStats(rows, columns));
        setFileName(name);
        saveSession(name, columns, rows, rows.length);
      }
    } catch {
      setError('Failed to parse data');
    }
    setIsLoading(false);
  }, [saveSession]);

  const uploadCSV = useCallback((file: File) => {
    setIsLoading(true);
    setError(null);
    setFileName(file.name);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => processData(results, file.name),
      error: () => { setError('Failed to read file'); setIsLoading(false); },
    });
  }, [processData]);

  const uploadText = useCallback((text: string) => {
    setIsLoading(true);
    setError(null);

    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: (results) => processData(results, 'Pasted data'),
      error: () => { setError('Failed to parse text'); setIsLoading(false); },
    });
  }, [processData]);

  const loadSession = useCallback(async (sessionId: string) => {
    setIsLoading(true);
    setError(null);
    const { data: session } = await supabase
      .from('telemetry_sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (session) {
      const rows = (session.data as any) as TelemetryRow[];
      const cols = (session.columns as any) as string[];
      setData(rows);
      setStats(computeStats(rows, cols));
      setFileName(session.file_name);
    }
    setIsLoading(false);
  }, []);

  const clearData = useCallback(() => {
    setData([]);
    setStats(null);
    setFileName(null);
    setError(null);
  }, []);

  return (
    <TelemetryContext.Provider value={{ data, stats, fileName, isLoading, error, sessions, uploadCSV, uploadText, clearData, loadSession, refreshSessions }}>
      {children}
    </TelemetryContext.Provider>
  );
}

export function useTelemetry() {
  const ctx = useContext(TelemetryContext);
  if (!ctx) throw new Error('useTelemetry must be used within TelemetryProvider');
  return ctx;
}
