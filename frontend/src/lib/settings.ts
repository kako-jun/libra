// 介助者設定の localStorage 読み書き・検証。
// 正本: docs/requirements.md §3.3, §6

import { PHRASES_VERSION, normalizePhraseSets, type PhraseSets } from './phrases'
import type { ActivateOn } from './switchInput'
import { HAPTIC_STRENGTHS, type HapticStrength } from './feedback'

export type VoiceMode = 'off' | 'tone' | 'short' | 'full'

/** Issue #3: 介助者設定の文字サイズ。タイル・見出しの clamp() 基準値を切り替える */
export type FontSize = 'standard' | 'large' | 'xlarge'

/** Issue #3: 表示(明暗)テーマ。auto は端末の prefers-color-scheme に追従する */
export type Theme = 'light' | 'dark' | 'auto'

export interface Settings {
  /** スキャン間隔(ms)。既定 1500、範囲 500〜5000 */
  intervalMs: number
  /** 先頭待機の倍率（先頭待機 = intervalMs * headHoldMultiplier）。既定 2、範囲 1〜5 */
  headHoldMultiplier: number
  /** 連打無視(ms)。既定 500、範囲 0〜3000 */
  debounceMs: number
  /** Issue #6: 押下時間の下限(ms)。この時間以上押し続けたときだけオン。既定 0、範囲 0〜2000 */
  minHoldMs: number
  /** Issue #6: 決定のタイミング。既定 press(押した瞬間) */
  activateOn: ActivateOn
  /** Issue #13: 本人への触覚フィードバック(振動)。既定 ON */
  hapticsEnabled: boolean
  /** 振動の強さ(パターンの振動する長さ)。既定 standard */
  hapticsStrength: HapticStrength
  /** 振動できない端末の効果音代替を、音声 OFF のときも鳴らすか。既定 OFF */
  hapticSoundWhenVoiceOff: boolean
  /** 振動に加えて、いつも短い効果音でも返すか。振動モーターのない端末向け。既定 OFF */
  hapticSoundAlso: boolean
  /** Issue #14: モールス入力を使うか。既定 OFF(上級者向け。ホームに入口が出るのは ON のときだけ) */
  morseEnabled: boolean
  /** モールス: 長押し(－)とみなす押下時間(ms)。既定 500、範囲 150〜1500 */
  morseDashMs: number
  /** モールス: 無入力でこの時間が経つと1文字を確定する(ms)。既定 1500、範囲 500〜3000 */
  morseLetterGapMs: number
  /** モールス: 無入力でこの時間が経つと語の区切りを入れる(ms)。既定 4000、範囲 1500〜8000 */
  morseWordGapMs: number
  /** 聴覚スキャン（カーソル移動ごとに項目名を読む）。既定 OFF */
  auditoryScan: boolean
  /** 読み上げモード。既定 OFF */
  voiceMode: VoiceMode
  /** 文字サイズ。既定 standard */
  fontSize: FontSize
  /** 高コントラスト。既定 OFF。明るい/夜間いずれのテーマにも重ねて効く */
  highContrast: boolean
  /** 表示(明暗)テーマ。既定 auto(端末の設定に追従) */
  theme: Theme
  /** Issue #8: 介助者が編集した定型フレーズ。キーが無いグループは既定のプリセット */
  phrases: PhraseSets
  /**
   * フレーズ保存値の世代の印(Issue #46)。印が古い・無い保存値と取り込みJSONだけを一度だけ昇格し、
   * 昇格後は PHRASES_VERSION を保存・書き出しして、以降は昇格しない
   */
  phrasesVersion: number
}

export const DEFAULT_SETTINGS: Settings = {
  intervalMs: 1500,
  headHoldMultiplier: 2,
  debounceMs: 500,
  minHoldMs: 0,
  activateOn: 'press',
  hapticsEnabled: true,
  hapticsStrength: 'standard',
  hapticSoundWhenVoiceOff: false,
  hapticSoundAlso: false,
  morseEnabled: false,
  morseDashMs: 500,
  morseLetterGapMs: 1500,
  morseWordGapMs: 4000,
  auditoryScan: false,
  voiceMode: 'off',
  fontSize: 'standard',
  highContrast: false,
  theme: 'auto',
  phrases: {},
  phrasesVersion: PHRASES_VERSION,
}

const STORAGE_KEY = 'libra'

const INTERVAL_MS_MIN = 500
const INTERVAL_MS_MAX = 5000
const HEAD_HOLD_MULTIPLIER_MIN = 1
const HEAD_HOLD_MULTIPLIER_MAX = 5
const DEBOUNCE_MS_MIN = 0
const DEBOUNCE_MS_MAX = 3000
const MIN_HOLD_MS_MIN = 0
const MIN_HOLD_MS_MAX = 2000
const MORSE_DASH_MS_MIN = 150
const MORSE_DASH_MS_MAX = 1500
const MORSE_LETTER_GAP_MS_MIN = 500
const MORSE_LETTER_GAP_MS_MAX = 3000
const MORSE_WORD_GAP_MS_MIN = 1500
const MORSE_WORD_GAP_MS_MAX = 8000
/** 語の区切りは、文字の確定よりこれだけ長くする(ms) */
export const MORSE_WORD_GAP_MARGIN_MS = 500

const VOICE_MODES: VoiceMode[] = ['off', 'tone', 'short', 'full']
const FONT_SIZES: FontSize[] = ['standard', 'large', 'xlarge']
const ACTIVATE_ONS: ActivateOn[] = ['press', 'release']
const THEMES: Theme[] = ['light', 'dark', 'auto']

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  if (value < min || value > max) return fallback
  return value
}

/** 保存値・取り込みJSONのフレーズが、昇格済み(印が現行以上)か */
function hasCurrentPhrasesMark(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value >= PHRASES_VERSION
}

/** 未知の値を安全な Settings へ丸める。壊れた値・範囲外は base(既定では既定値)にする。 */
export function normalizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const raw = (input ?? {}) as Partial<Record<keyof Settings, unknown>>
  const result: Settings = {
    intervalMs: clampNumber(raw.intervalMs, INTERVAL_MS_MIN, INTERVAL_MS_MAX, base.intervalMs),
    headHoldMultiplier: clampNumber(
      raw.headHoldMultiplier,
      HEAD_HOLD_MULTIPLIER_MIN,
      HEAD_HOLD_MULTIPLIER_MAX,
      base.headHoldMultiplier,
    ),
    debounceMs: clampNumber(raw.debounceMs, DEBOUNCE_MS_MIN, DEBOUNCE_MS_MAX, base.debounceMs),
    minHoldMs: clampNumber(raw.minHoldMs, MIN_HOLD_MS_MIN, MIN_HOLD_MS_MAX, base.minHoldMs),
    activateOn: ACTIVATE_ONS.includes(raw.activateOn as ActivateOn)
      ? (raw.activateOn as ActivateOn)
      : base.activateOn,
    hapticsEnabled:
      typeof raw.hapticsEnabled === 'boolean' ? raw.hapticsEnabled : base.hapticsEnabled,
    hapticsStrength: HAPTIC_STRENGTHS.includes(raw.hapticsStrength as HapticStrength)
      ? (raw.hapticsStrength as HapticStrength)
      : base.hapticsStrength,
    hapticSoundWhenVoiceOff:
      typeof raw.hapticSoundWhenVoiceOff === 'boolean'
        ? raw.hapticSoundWhenVoiceOff
        : base.hapticSoundWhenVoiceOff,
    hapticSoundAlso:
      typeof raw.hapticSoundAlso === 'boolean' ? raw.hapticSoundAlso : base.hapticSoundAlso,
    morseEnabled: typeof raw.morseEnabled === 'boolean' ? raw.morseEnabled : base.morseEnabled,
    morseDashMs: clampNumber(
      raw.morseDashMs,
      MORSE_DASH_MS_MIN,
      MORSE_DASH_MS_MAX,
      base.morseDashMs,
    ),
    morseLetterGapMs: clampNumber(
      raw.morseLetterGapMs,
      MORSE_LETTER_GAP_MS_MIN,
      MORSE_LETTER_GAP_MS_MAX,
      base.morseLetterGapMs,
    ),
    morseWordGapMs: clampNumber(
      raw.morseWordGapMs,
      MORSE_WORD_GAP_MS_MIN,
      MORSE_WORD_GAP_MS_MAX,
      base.morseWordGapMs,
    ),
    auditoryScan: typeof raw.auditoryScan === 'boolean' ? raw.auditoryScan : base.auditoryScan,
    voiceMode: VOICE_MODES.includes(raw.voiceMode as VoiceMode)
      ? (raw.voiceMode as VoiceMode)
      : base.voiceMode,
    fontSize: FONT_SIZES.includes(raw.fontSize as FontSize)
      ? (raw.fontSize as FontSize)
      : base.fontSize,
    highContrast: typeof raw.highContrast === 'boolean' ? raw.highContrast : base.highContrast,
    theme: THEMES.includes(raw.theme as Theme) ? (raw.theme as Theme) : base.theme,
    // 項目が無い取り込みでは、今のフレーズを消さずに残す
    phrases:
      raw.phrases === undefined
        ? base.phrases
        : normalizePhraseSets(raw.phrases, !hasCurrentPhrasesMark(raw.phrasesVersion)),
    // フレーズを受け取ったら昇格済みの印を付ける。受け取らないときは今の印のまま
    phrasesVersion: raw.phrases === undefined ? base.phrasesVersion : PHRASES_VERSION,
  }
  // 語の区切りは文字の確定より常に長くする(画面の表示と実際の動作をずらさないため、保存値で保証する)
  result.morseWordGapMs = Math.max(
    result.morseWordGapMs,
    result.morseLetterGapMs + MORSE_WORD_GAP_MARGIN_MS,
  )
  return result
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

/** 書き出した JSON であることを示す識別子。他アプリの JSON を取り込まないための印 */
const EXPORT_APP = 'libra'
const EXPORT_VERSION = 1

/** Issue #8: 設定(フレーズ編集を含む)を端末の入れ替え用の JSON 文字列にする。 */
export function exportSettingsJson(settings: Settings): string {
  return JSON.stringify({ app: EXPORT_APP, version: EXPORT_VERSION, ...settings }, null, 2)
}

/**
 * 書き出した JSON 文字列を設定へ戻す。libra の書き出しでない(識別子・バージョンが合わない)、
 * JSON として読めない、オブジェクトでない場合は null(呼び出し側は今の設定を変えない)。
 * 値は検証し、欠けている・範囲外の項目は base(今の設定)のまま残す。本人に合わせた
 * スキャン間隔などが、取り込みで黙って既定値に戻らないようにする。
 */
export function parseSettingsJson(
  text: string,
  base: Settings = DEFAULT_SETTINGS,
): Settings | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const raw = parsed as Record<string, unknown>
    if (raw.app !== EXPORT_APP || raw.version !== EXPORT_VERSION) return null
    return normalizeSettings(raw, base)
  } catch {
    return null
  }
}
