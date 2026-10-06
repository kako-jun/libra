// 画面下の固定案内(.screen-notes)と介助者メニュー上部の固定帯(.caregiver-notes)の文言。
// 正本: docs/requirements.md §4.1.2 の「常時案内」表 / Issue #58
//
// 方針: 暗黙の操作・自動挙動を1つも作らない。該当する状況・設定のときは必ず出し、
// 本人や介助者が任意に隠せる操作は設けない。副作用なし(テストしやすいよう文字列だけ返す)。

import type { ScreenId } from './menus'
import type { Settings } from './settings'

/** 緊急中の周期振動の間隔(ms)。App.tsx の振動タイマーと案内文の秒数をここで一致させる */
export const EMERGENCY_REPEAT_MS = 3000

export interface ScreenNotesContext {
  screen: ScreenId
  /** 伝達直後の1周だけ「取り消し」が出ている状態 */
  showUndo: boolean
  emergencyActive: boolean
  settings: Pick<
    Settings,
    | 'intervalMs'
    | 'headHoldMultiplier'
    | 'debounceMs'
    | 'minHoldMs'
    | 'activateOn'
    | 'hapticsEnabled'
  >
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}秒`
}

/**
 * 現在の状態で必ず出す案内。順序は固定: 取り消し → 緊急 → 押し方 → 先頭待機。
 * モールス画面にはスキャンも連打無視も離して決定も無いため、緊急中の振動だけを出す
 * (押下時間の下限はモールスの凡例側に出る)。
 */
export function buildScreenNotes(context: ScreenNotesContext): string[] {
  const { screen, showUndo, emergencyActive, settings } = context
  const notes: string[] = []

  if (screen === 'home') {
    if (showUndo) {
      notes.push('「取り消し」は伝えた直後の1周だけ出ます。')
    }
    if (emergencyActive) {
      notes.push('緊急中は「取り消し」を出しません（緊急は取り消せないため）。')
    }
  }
  if (emergencyActive && settings.hapticsEnabled) {
    notes.push(`緊急中は${EMERGENCY_REPEAT_MS / 1000}秒ごとに振動します（呼び出し継続の合図）。`)
  }
  if (screen === 'morse') return notes

  if (settings.debounceMs > 0) {
    notes.push(`${seconds(settings.debounceMs)}以内の連打は数えません（誤作動防止）。`)
  }
  if (settings.minHoldMs > 0) {
    notes.push(
      settings.activateOn === 'release'
        ? `${seconds(settings.minHoldMs)}以上押し続けて離すと決まります（短押しは数えません）。`
        : `${seconds(settings.minHoldMs)}以上押し続けると決まります（短押しは数えません）。`,
    )
  } else if (settings.activateOn === 'release') {
    notes.push('押して離すと決まります（押した瞬間は決まりません）。')
  }
  notes.push(
    `画面を開くと先頭に${seconds(settings.intervalMs * settings.headHoldMultiplier)}とどまります。`,
  )
  return notes
}

/** 介助者メニュー上部の固定帯の文言(常時表示。設定や状態で隠さない) */
export function buildCaregiverMenuNotes(idleTimeoutMs: number): string[] {
  return [
    `${idleTimeoutMs / 1000}秒操作しないと、自動で閉じてホームに戻ります。`,
    '開いている間は、モールス入力の時間が止まります。',
  ]
}
