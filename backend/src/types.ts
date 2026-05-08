/**
 * Libra API 共通型定義
 */

export interface PhrasePresets {
  urgent: string[];
  slow: {
    pain: string[];
    discomfort: string[];
    mood: string[];
  };
  voiceModes: string[];
}

export interface Env {
  CORS_ORIGINS: string;
}
