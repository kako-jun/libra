// 本人へのフィードバック(触覚出力)。入力の結果を、他人の反応なしに本人が知るための層。
// 正本: docs/requirements.md §7.1 / Issue #13
//
// パターンはここに集約する。Vibration API に非対応の端末(iOS Safari など)では、
// 同じパターンを短い効果音で代替する(音声 OFF のときに鳴らすかは介助者設定)。

import { playTonePattern } from './alarm'
import type { VoiceMode } from './settings'

export type FeedbackEvent =
  /** 入力が受理された(項目を実行した) */
  | 'accepted'
  /** 伝達した(はい・いいえ・緊急以外) */
  | 'message'
  | 'yes'
  | 'no'
  /** 緊急色の伝達(痛い場所の「胸」、緊急の詳細など) */
  | 'urgentMessage'
  /** 緊急を呼び出した */
  | 'emergency'
  /** 緊急の呼び出し中。警告音と同じ周期で繰り返し、まだ続いていることを知らせる */
  | 'emergencyActive'
  /** 介助者が緊急を解除した */
  | 'cleared'
  /** 伝達済み(介助者の応答を受信したとき。#9 で使う) */
  | 'delivered'

/** 振動の強さ。パターンの「振動する長さ」だけを伸縮する(合間は変えない) */
export type HapticStrength = 'light' | 'standard' | 'strong'

export const HAPTIC_STRENGTHS: HapticStrength[] = ['light', 'standard', 'strong']

const STRENGTH_SCALE: Record<HapticStrength, number> = {
  light: 0.6,
  standard: 1,
  strong: 1.6,
}

/**
 * 標準の強さでのパターン(ms。振動・休止・振動…の順)。
 * 受理は軽く短く、はい=長め1回、いいえ=長め2回、緊急は長く3回、解除は長い1回、のように
 * どれも互いに区別できるようにする(feedback.test.ts で重複がないことを確認)。
 */
export const HAPTIC_PATTERNS: Record<FeedbackEvent, number[]> = {
  accepted: [20],
  message: [40],
  yes: [80],
  no: [80, 100, 80],
  urgentMessage: [60, 40, 60],
  emergency: [300, 120, 300, 120, 300],
  emergencyActive: [150, 100, 150],
  cleared: [500],
  delivered: [60, 60, 60, 60, 200],
}

/** 強さに応じたパターン。振動する長さ(偶数番目)だけを伸縮し、最低 10ms を保つ */
export function feedbackPattern(event: FeedbackEvent, strength: HapticStrength): number[] {
  const scale = STRENGTH_SCALE[strength]
  return HAPTIC_PATTERNS[event].map((ms, index) =>
    index % 2 === 0 ? Math.max(10, Math.round(ms * scale)) : ms,
  )
}

export interface FeedbackOptions {
  enabled: boolean
  strength: HapticStrength
  /** 振動が使えない端末の効果音代替を、音声モード OFF のときも鳴らすか */
  soundWhenVoiceOff: boolean
  voiceMode: VoiceMode
}

/** 振動できる端末か。非対応(iOS Safari など)なら効果音で代替する */
function canVibrate(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

/** イベントに対応するフィードバックを出す。新しい呼び出しは直前の振動を置き換える。 */
export function playFeedback(event: FeedbackEvent, options: FeedbackOptions): void {
  if (!options.enabled) return
  const pattern = feedbackPattern(event, options.strength)
  if (canVibrate()) {
    navigator.vibrate(pattern)
    return
  }
  // 非対応端末: 効果音で代替。音声 OFF のときは、設定で許したときだけ鳴らす
  if (options.voiceMode === 'off' && !options.soundWhenVoiceOff) return
  playTonePattern(pattern)
}
