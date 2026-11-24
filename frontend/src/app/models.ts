export interface Segment {
  text: string;
  language: string | null;
  start: number;
  end: number;
}

export interface Transcription {
  id: number;
  title: string;
  text: string;
  language: string | null;
  provider: string | null;
  duration_sec: number;
  segments: Segment[];
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface Stats {
  total: number;
  total_duration_sec: number;
  total_words: number;
  by_language: { language: string; count: number }[];
}

export type StreamEvent =
  | { type: 'ready'; provider: string }
  | { type: 'partial'; text: string }
  | ({ type: 'final' } & Segment)
  | { type: 'done' }
  | { type: 'saved'; transcription: Transcription | null }
  | { type: 'error'; message: string };

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'auto', label: 'Auto-detect (mixed)' },
  { code: 'hi', label: 'Hindi / Hinglish (Devanagari)' },
  { code: 'en', label: 'English / Hinglish (Roman)' },
  { code: 'ta', label: 'Tamil' },
  { code: 'te', label: 'Telugu' },
  { code: 'mr', label: 'Marathi' },
  { code: 'bn', label: 'Bengali' },
  { code: 'ar', label: 'Arabic' },
];

export const LANGUAGE_NAMES: Record<string, string> = {
  hi: 'Hindi', en: 'English', mixed: 'Mixed', ta: 'Tamil', te: 'Telugu',
  mr: 'Marathi', bn: 'Bengali', ar: 'Arabic', ur: 'Urdu',
};
