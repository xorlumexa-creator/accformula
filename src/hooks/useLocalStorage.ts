import { useState, useEffect, useCallback } from 'react';

// ─── Types ───
export interface TelemetryAttempt {
  attemptNumber: number;
  timestamp: string;
  rawData: string;
  analysisText: string;
  chartData: Record<string, any>[];
  severityCards: { severity: string; title: string; description: string }[];
  fileName?: string;
  columns?: string[];
  rowCount?: number;
}

export interface DesignAnalysis {
  partName: string;
  filename: string;
  timestamp: string;
  designScore: number;
  annotationsArray: any[];
  analysisText: string;
  geometryData: any;
  severityCards: { severity: string; title: string; description: string }[];
  dimensions?: { x: number; y: number; z: number };
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  contextUsed?: string[];
}

export interface UserProfile {
  projectContext?: string;
  budget?: string;
  userName?: string;
}

// ─── Keys ───
const KEYS = {
  telemetry: 'lumexa_telemetry_attempts',
  designs: 'lumexa_design_analyses',
  chat: 'lumexa_chat_history',
  profile: 'lumexa_user_profile',
} as const;

const MAX_TELEMETRY = 30;

// ─── Safe localStorage ───
function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: any): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Storage full — try trimming telemetry
    try {
      const attempts = safeGet<TelemetryAttempt[]>(KEYS.telemetry, []);
      if (attempts.length > 5) {
        localStorage.setItem(KEYS.telemetry, JSON.stringify(attempts.slice(-10)));
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      }
    } catch {}
    return false;
  }
}

// ─── Telemetry Attempts Hook ───
export function useTelemetryAttempts() {
  const [attempts, setAttempts] = useState<TelemetryAttempt[]>(() => safeGet(KEYS.telemetry, []));

  const saveAttempt = useCallback((attempt: Omit<TelemetryAttempt, 'attemptNumber'>) => {
    setAttempts(prev => {
      const nextNumber = prev.length > 0 ? Math.max(...prev.map(a => a.attemptNumber)) + 1 : 1;
      const newAttempt: TelemetryAttempt = { ...attempt, attemptNumber: nextNumber };
      let updated = [...prev, newAttempt];
      // Cap at MAX_TELEMETRY
      if (updated.length > MAX_TELEMETRY) {
        updated = updated.slice(updated.length - MAX_TELEMETRY);
        // Renumber
        updated = updated.map((a, i) => ({ ...a, attemptNumber: i + 1 }));
      }
      safeSet(KEYS.telemetry, updated);
      return updated;
    });
  }, []);

  const getAttempt = useCallback((num: number) => {
    return attempts.find(a => a.attemptNumber === num) || null;
  }, [attempts]);

  return { attempts, saveAttempt, getAttempt };
}

// ─── Design Analyses Hook ───
export function useDesignAnalyses() {
  const [analyses, setAnalyses] = useState<DesignAnalysis[]>(() => safeGet(KEYS.designs, []));

  const saveAnalysis = useCallback((analysis: DesignAnalysis) => {
    setAnalyses(prev => {
      const updated = [...prev, analysis];
      safeSet(KEYS.designs, updated);
      return updated;
    });
  }, []);

  const getAnalysisByPartName = useCallback((name: string) => {
    return analyses.filter(a => a.partName.toLowerCase() === name.toLowerCase());
  }, [analyses]);

  return { analyses, saveAnalysis, getAnalysisByPartName };
}

// ─── Chat History Hook ───
export function useChatHistory() {
  const [history, setHistory] = useState<ChatMessage[]>(() => safeGet(KEYS.chat, []));

  const addMessage = useCallback((msg: ChatMessage) => {
    setHistory(prev => {
      const updated = [...prev, msg];
      safeSet(KEYS.chat, updated);
      return updated;
    });
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    localStorage.removeItem(KEYS.chat);
  }, []);

  const syncMessages = useCallback((msgs: ChatMessage[]) => {
    setHistory(msgs);
    safeSet(KEYS.chat, msgs);
  }, []);

  return { history, addMessage, clearHistory, syncMessages };
}

// ─── User Profile Hook ───
export function useUserProfile() {
  const [profile, setProfile] = useState<UserProfile>(() => safeGet(KEYS.profile, {}));

  const updateProfile = useCallback((updates: Partial<UserProfile>) => {
    setProfile(prev => {
      const updated = { ...prev, ...updates };
      safeSet(KEYS.profile, updated);
      return updated;
    });
  }, []);

  return { profile, updateProfile };
}
