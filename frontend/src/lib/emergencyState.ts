// 緊急状態の localStorage 保存・復元。
// 正本: docs/requirements.md §4.3 — 緊急表示は介助者が解除するまで残る。
// ページの再読み込み・PWA の再起動・バックグラウンド破棄後の復帰でも、未解除なら復元する。

const STORAGE_KEY = 'libra-emergency'

/** これより古い緊急は復元しない(取り残された古い状態が、いつまでも鳴り続けるのを防ぐ) */
export const EMERGENCY_RESTORE_TTL_MS = 12 * 60 * 60 * 1000

export interface EmergencyState {
  /** 緊急が発生した時刻(epoch ms) */
  since: number
  /** 追加された詳細（苦しい/痛い等） */
  details: string[]
}

/** 緊急状態を保存する。例外は握りつぶす。 */
export function saveEmergency(state: EmergencyState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // 保存できなくても、メモリ上の緊急表示は動き続ける
  }
}

/** 緊急状態の保存を消す。介助者の緊急解除で呼ぶ。 */
export function clearSavedEmergency(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 何もしない
  }
}

/** 未解除の緊急を読む。なし・壊れている・期限切れなら null(期限切れは保存も消す)。 */
export function loadEmergency(now = Date.now()): EmergencyState | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<EmergencyState> | null
    if (!parsed || typeof parsed.since !== 'number' || !Number.isFinite(parsed.since)) {
      clearSavedEmergency()
      return null
    }
    if (now - parsed.since > EMERGENCY_RESTORE_TTL_MS) {
      clearSavedEmergency()
      return null
    }
    const details = Array.isArray(parsed.details)
      ? parsed.details.filter((d): d is string => typeof d === 'string')
      : []
    return { since: parsed.since, details }
  } catch {
    return null
  }
}
