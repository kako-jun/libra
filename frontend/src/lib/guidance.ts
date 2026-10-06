// 画面下の固定案内(.screen-notes)と介助者メニュー上部の固定帯(.caregiver-notes)の文言。
// 正本: docs/requirements.md §4.1.2 の「常時案内」表 / Issue #58
//
// 方針: 暗黙の操作・自動挙動を1つも作らない。該当する状況・設定のときは必ず出し、
// 本人や介助者が任意に隠せる操作は設けない。副作用なし(テストしやすいよう文字列だけ返す)。
// compact は低い画面(高さ500px以下)用の短縮形。文言を詰めるだけで、出す・出さないは変えない
// (本人は画面をスクロールできないため、帯が格子を押し潰さないようにする)。

import { EMERGENCY_REPEAT_MS } from './feedback'
import type { ScreenId } from './menus'
import type { Settings } from './settings'

export interface ScreenNotesContext {
  screen: ScreenId
  /** 伝達直後の1周だけ「取り消し」が出ている状態 */
  showUndo: boolean
  emergencyActive: boolean
  /** 再起動で復元した緊急で、ブラウザがまだ振動を許していない(画面に一度も触れていない)状態 */
  vibrationAwaitsTouch?: boolean
  /** 端末が振動できるか(navigator.vibrate の有無)。省略時は振動できるものとして扱う */
  canVibrate?: boolean
  /** 低い画面用の短縮文言 */
  compact?: boolean
  settings: Pick<
    Settings,
    | 'intervalMs'
    | 'headHoldMultiplier'
    | 'debounceMs'
    | 'minHoldMs'
    | 'activateOn'
    | 'hapticsEnabled'
    | 'auditoryScan'
    | 'voiceMode'
  >
}

/**
 * 秒数の表示。100ms 刻みは小数1桁、それ以外(0.05 秒刻みなど)は小数2桁にして、
 * 丸めで実際の設定値とずれないようにする(0.05 秒が「0.1秒」と出ない)。
 */
export function formatSeconds(ms: number): string {
  const rounded = Math.round(ms)
  if (rounded > 0 && rounded < 10) return '0.01秒未満'
  return `${(rounded / 1000).toFixed(rounded % 100 === 0 ? 1 : 2)}秒`
}

const SCREEN_CHANGE_NOTE_FULL = '押下中に画面や項目の並びが変わると無効'

/**
 * 現在の状態で必ず出す案内。順序は固定: 取り消し → 緊急 → 押し方 → 読み上げ → 先頭待機。
 * モールス画面にはスキャンも連打無視も離して決定も無いため、緊急中の振動まわりだけを出す
 * (押下時間の下限はモールスの凡例側に出る)。
 */
export function buildScreenNotes(context: ScreenNotesContext): string[] {
  const { screen, showUndo, emergencyActive, vibrationAwaitsTouch, settings } = context
  const compact = context.compact === true
  const canVibrate = context.canVibrate !== false
  const notes: string[] = []

  if (screen === 'home') {
    if (showUndo) {
      notes.push(
        compact ? '「取り消し」は1周だけ出ます。' : '「取り消し」は伝えた直後の1周だけ出ます。',
      )
    }
    if (emergencyActive) {
      notes.push(
        compact
          ? '緊急中は「取り消し」なし（取り消せないため）。'
          : '緊急中は「取り消し」なし（緊急は取り消せないため）。',
      )
    }
  }
  if (emergencyActive && settings.hapticsEnabled) {
    if (canVibrate) {
      const every = `${EMERGENCY_REPEAT_MS / 1000}秒ごと`
      notes.push(
        compact
          ? `緊急中は${every}に振動（入力直後は休む）。`
          : `緊急中は${every}に振動（呼び出し継続の合図。本人の入力直後は休む）。`,
      )
      if (vibrationAwaitsTouch) {
        notes.push(
          compact
            ? '再起動後はタッチかキーまで振動なし。'
            : '再起動後は、画面に触れるかキーを押すまで振動しません。',
        )
      }
    } else {
      notes.push('この端末は振動できません（緊急中の周期振動なし）。')
    }
  }
  if (screen === 'morse') return notes

  if (settings.debounceMs > 0) {
    const s = formatSeconds(settings.debounceMs)
    notes.push(
      compact
        ? `${s}以内の連打は無視（遷移直後も）。`
        : `${s}以内の連打は数えません（画面遷移直後も。誤作動防止）。`,
    )
  }
  if (settings.minHoldMs > 0) {
    const s = formatSeconds(settings.minHoldMs)
    if (settings.activateOn === 'release') {
      notes.push(
        compact
          ? `${s}以上押して離すと決定（${SCREEN_CHANGE_NOTE_FULL}）。`
          : `${s}以上押し続けて離すと決まります（短押しは数えません。${SCREEN_CHANGE_NOTE_FULL}）。`,
      )
    } else {
      notes.push(
        compact
          ? `${s}以上押し続けると決定（${SCREEN_CHANGE_NOTE_FULL}）。`
          : `${s}以上押し続けると決まります（短押しは数えません。${SCREEN_CHANGE_NOTE_FULL}）。`,
      )
    }
  } else if (settings.activateOn === 'release') {
    notes.push(
      compact
        ? `押して離すと決定（${SCREEN_CHANGE_NOTE_FULL}）。`
        : `押して離すと決まります（押した瞬間は決まりません。${SCREEN_CHANGE_NOTE_FULL}）。`,
    )
  }
  // 伝達の読み上げは、直後の1回だけ次のスキャン読み上げに割り込まれない(App.tsx の messageAnnounceGrace)。
  // 読み上げ自体が出るのは音声モードが「短く/全部」のときだけ
  if (settings.auditoryScan && (settings.voiceMode === 'short' || settings.voiceMode === 'full')) {
    notes.push(
      compact
        ? '伝達の読み上げは直後の1項目分だけ割り込まれません。'
        : '伝達の読み上げは、直後の1項目分は割り込まれません（その後は次の読み上げで切れることがあります）。',
    )
  }
  const head = formatSeconds(settings.intervalMs * settings.headHoldMultiplier)
  notes.push(compact ? `先頭に${head}とどまります。` : `画面を開くと先頭に${head}とどまります。`)
  return notes
}

/**
 * 介助者メニュー上部の固定帯の文言(常時表示。設定や状態で隠さない)。
 * morseEnabled=false のときモールス入力は使えないので、モールスの時間停止は出さない。
 */
export function buildCaregiverMenuNotes(
  idleTimeoutMs: number,
  options: { morseEnabled?: boolean; compact?: boolean } = {},
): string[] {
  const seconds = idleTimeoutMs / 1000
  const compact = options.compact === true
  const stops = options.morseEnabled ? 'スキャンとモールス入力の時間' : 'スキャン'
  return [
    compact
      ? `${seconds}秒タップしないと閉じてホームへ（打鍵では延びず）。`
      : `${seconds}秒タップしないと、自動で閉じてホームに戻ります（打鍵では延びません）。`,
    compact
      ? '外側タップ・キーでも閉じる（入力欄等の編集キー・タブ移動キーは除く）。'
      : '外側のタップやキー入力で閉じ、ホーム先頭から再開（入力欄・スライダー・チェックボックス操作中の文字/矢印/Home/Endキーと、タブ上の←/→/Home/Endは閉じません）。',
    compact
      ? `開く間は${options.morseEnabled ? 'スキャン・モールス時間' : 'スキャン'}停止。`
      : `開いている間は、${stops}が止まります。`,
  ]
}
