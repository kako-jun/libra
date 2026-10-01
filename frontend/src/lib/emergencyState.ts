// 緊急状態の localStorage 保存・復元。再読み込み・再起動後も介助者の解除まで残すため。
// 正本: docs/requirements.md §4.3
// 設定用のルートキー `libra`（settings.ts）とは別キー。設定のリセット・検証と混ぜない。
// 有効期限は設けない（誤報の害より見逃しの害が大きい）。

import { URGENT_DETAIL_LABELS } from './menus'

export interface EmergencyState {
  /** 緊急が有効か。保存されるのは true のときだけ */
  active: true
  /** 緊急の詳細（苦しい/痛い等）。積み上げ式・重複なし */
  details: string[]
  /** 緊急中に選ばれた伝達の副表示 */
  sub: string | null
}

export const EMERGENCY_STORAGE_KEY = 'libra:emergency'

/** 未知の値を EmergencyState へ丸める。active が true でない・型違いは null（通常起動）。 */
export function normalizeEmergencyState(input: unknown): EmergencyState | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>
  if (raw.active !== true) return null
  const details = Array.isArray(raw.details)
    ? raw.details.filter(
        (d): d is string => typeof d === 'string' && URGENT_DETAIL_LABELS.includes(d),
      )
    : []
  return {
    active: true,
    details: details.filter((d, i) => details.indexOf(d) === i),
    sub: typeof raw.sub === 'string' ? raw.sub : null,
  }
}

/** 保存された緊急状態を読む。無い・壊れている・localStorage が使えない場合は null。 */
export function loadEmergencyState(): EmergencyState | null {
  try {
    const raw = window.localStorage.getItem(EMERGENCY_STORAGE_KEY)
    if (!raw) return null
    return normalizeEmergencyState(JSON.parse(raw))
  } catch {
    return null
  }
}

/** 緊急状態を保存する。例外は握りつぶす。 */
export function saveEmergencyState(state: { details: string[]; sub: string | null }): void {
  try {
    const value: EmergencyState = { active: true, details: state.details, sub: state.sub }
    window.localStorage.setItem(EMERGENCY_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // 保存できなくても緊急表示・警告音は動き続ける
  }
}

/** 保存された緊急状態を消す。緊急解除で呼ぶ。例外は握りつぶす。 */
export function clearEmergencyState(): void {
  try {
    window.localStorage.removeItem(EMERGENCY_STORAGE_KEY)
  } catch {
    // 消せなくても通常動作を続ける
  }
}
