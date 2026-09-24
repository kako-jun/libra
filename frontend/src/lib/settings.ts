// 介助者設定の localStorage 読み書き・検証。
// 正本: docs/requirements.md §3.3, §6

export type VoiceMode = 'off' | 'tone' | 'short' | 'full'

/** Issue #3: 介助者設定の文字サイズ。タイル・見出しの clamp() 基準値を切り替える */
export type FontSize = 'standard' | 'large' | 'xlarge'

export interface Settings {
  /** スキャン間隔(ms)。既定 1500、範囲 500〜5000 */
  intervalMs: number
  /** 先頭待機の倍率（先頭待機 = intervalMs * headHoldMultiplier）。既定 2、範囲 1〜5 */
  headHoldMultiplier: number
  /** 連打無視(ms)。既定 500、範囲 0〜3000 */
  debounceMs: number
  /** 聴覚スキャン（カーソル移動ごとに項目名を読む）。既定 OFF */
  auditoryScan: boolean
  /** 読み上げモード。既定 OFF */
  voiceMode: VoiceMode
  /** 文字サイズ。既定 standard */
  fontSize: FontSize
  /** 高コントラスト。既定 OFF。A/B いずれのデザインにも重ねて効く */
  highContrast: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  intervalMs: 1500,
  headHoldMultiplier: 2,
  debounceMs: 500,
  auditoryScan: false,
  voiceMode: 'off',
  fontSize: 'standard',
  highContrast: false,
}

const STORAGE_KEY = 'libra'

const INTERVAL_MS_MIN = 500
const INTERVAL_MS_MAX = 5000
const HEAD_HOLD_MULTIPLIER_MIN = 1
const HEAD_HOLD_MULTIPLIER_MAX = 5
const DEBOUNCE_MS_MIN = 0
const DEBOUNCE_MS_MAX = 3000

const VOICE_MODES: VoiceMode[] = ['off', 'tone', 'short', 'full']
const FONT_SIZES: FontSize[] = ['standard', 'large', 'xlarge']

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < min || value > max) return fallback
  return value
}

/** 未知の値を安全な Settings へ丸める。壊れた値・範囲外は既定値にする。 */
export function normalizeSettings(input: unknown): Settings {
  const raw = (input ?? {}) as Partial<Record<keyof Settings, unknown>>
  return {
    intervalMs: clampNumber(
      raw.intervalMs,
      INTERVAL_MS_MIN,
      INTERVAL_MS_MAX,
      DEFAULT_SETTINGS.intervalMs,
    ),
    headHoldMultiplier: clampNumber(
      raw.headHoldMultiplier,
      HEAD_HOLD_MULTIPLIER_MIN,
      HEAD_HOLD_MULTIPLIER_MAX,
      DEFAULT_SETTINGS.headHoldMultiplier,
    ),
    debounceMs: clampNumber(
      raw.debounceMs,
      DEBOUNCE_MS_MIN,
      DEBOUNCE_MS_MAX,
      DEFAULT_SETTINGS.debounceMs,
    ),
    auditoryScan:
      typeof raw.auditoryScan === 'boolean' ? raw.auditoryScan : DEFAULT_SETTINGS.auditoryScan,
    voiceMode: VOICE_MODES.includes(raw.voiceMode as VoiceMode)
      ? (raw.voiceMode as VoiceMode)
      : DEFAULT_SETTINGS.voiceMode,
    fontSize: FONT_SIZES.includes(raw.fontSize as FontSize)
      ? (raw.fontSize as FontSize)
      : DEFAULT_SETTINGS.fontSize,
    highContrast:
      typeof raw.highContrast === 'boolean' ? raw.highContrast : DEFAULT_SETTINGS.highContrast,
  }
}

/** localStorage から設定を読む。壊れている・例外が出る場合は既定値を返す。 */
export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** localStorage に設定を保存する。例外は握りつぶす。 */
export function saveSettings(settings: Settings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 保存できなくても既定値で動き続ける
  }
}
