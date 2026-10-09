// 画面下の固定案内(.screen-notes: 緊急中の振動だけ)・介助者メニュー上部の固定帯(.caregiver-notes)・
// 「状態」タブの「いまの動作」の文言。
// 正本: docs/requirements.md §4.1.2 の「常時案内」表 / Issue #58
//
// 方針: 暗黙の操作は作らない。ただし画面を見れば分かることは書かず、見ても分からない挙動だけを書く
// (本人画面は緊急中の振動、介助者メニューは「いまの動作」と上部の固定帯)。
// 本人や介助者が任意に隠せる操作は設けない。副作用なし(テストしやすいよう文字列だけ返す)。
// compact は低い画面(高さ500px以下)か狭い画面(幅480px以下)用の短縮形。出す・出さないは変えず、
// 省くのは「理由」の語だけ。操作に関わる事実(何が起きるか・何をしても反応しない条件)は短縮形でも残す
// (本人は画面をスクロールできないため、帯が格子を押し潰さないようにする)。

import { EMERGENCY_REPEAT_MS } from './feedback'
import { IDLE_LAPS_BEFORE_HOME } from './idleLaps'
import type { Settings } from './settings'

export interface ScreenNotesContext {
  emergencyActive: boolean
  /** 再起動で復元した緊急で、ブラウザがまだ振動を許していない(画面に一度も触れていない)状態 */
  vibrationAwaitsTouch?: boolean
  /** 端末が振動できるか(navigator.vibrate の有無)。省略時は振動できるものとして扱う */
  canVibrate?: boolean
  /** 低い画面(高さ500px以下)・狭い画面(幅480px以下)用の短縮文言。理由は省くが、操作と条件の事実は残す */
  compact?: boolean
  settings: Pick<Settings, 'hapticsEnabled'>
}

/** 見ても分からない設定依存の挙動を、介助者メニューの「いまの動作」に出すための文脈 */
export interface BehaviorNotesContext {
  settings: Pick<Settings, 'debounceMs' | 'minHoldMs' | 'activateOn' | 'auditoryScan' | 'voiceMode'>
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

// 連打無視・押し方はモールス入力には当てはまらない(モールスの凡例に独自の規則がある)
const SCREEN_CHANGE_NOTE_FULL = '押下中に画面や項目の並びが変わると無効。モールス入力を除く'

/**
 * 本人画面の下に常時出す案内。緊急中の周期振動まわりだけ(Issue #79)。
 * 順序は固定: 周期振動 → 再起動後は触れるまで振動なし / 振動できない端末。通常時は空配列(帯ごと出さない)。
 * 設定の細かい説明は buildBehaviorNotes で介助者メニューへ出す。
 */
export function buildScreenNotes(context: ScreenNotesContext): string[] {
  const { emergencyActive, vibrationAwaitsTouch, settings } = context
  const compact = context.compact === true
  const canVibrate = context.canVibrate !== false
  const notes: string[] = []

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
  return notes
}

/**
 * 介助者メニュー「状態」タブの「いまの動作」。見ても分からない、設定に応じた挙動だけを現在の設定値で出す(スクロールできるので短縮形は持たない)。
 * 順序は固定: 連打無視 → 押し方 → 読み上げの割り込み。該当しなければ空配列。
 */
export function buildBehaviorNotes(context: BehaviorNotesContext): string[] {
  const { settings } = context
  const notes: string[] = []

  if (settings.debounceMs > 0) {
    const s = formatSeconds(settings.debounceMs)
    notes.push(`${s}以内の連打は数えません（画面遷移直後も。誤作動防止。モールス入力を除く）。`)
  }
  if (settings.minHoldMs > 0) {
    const s = formatSeconds(settings.minHoldMs)
    if (settings.activateOn === 'release') {
      notes.push(
        `${s}以上押し続けて離すと決まります（短押しは数えません。${SCREEN_CHANGE_NOTE_FULL}）。`,
      )
    } else {
      notes.push(
        `${s}以上押し続けると決まります（短押しは数えません。${SCREEN_CHANGE_NOTE_FULL}）。`,
      )
    }
  } else if (settings.activateOn === 'release') {
    notes.push(`押して離すと決まります（押した瞬間は決まりません。${SCREEN_CHANGE_NOTE_FULL}）。`)
  }
  // 伝達の読み上げは、直後の1回だけ次のスキャン読み上げに割り込まれない(App.tsx の messageAnnounceGrace)。
  // 読み上げ自体が出るのは音声モードが「短く/全部」のときだけ
  if (settings.auditoryScan && (settings.voiceMode === 'short' || settings.voiceMode === 'full')) {
    notes.push(
      '伝達の読み上げは、直後の1項目分は割り込まれません（その後は次の読み上げで切れることがあります）。',
    )
  }
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
      ? `${seconds}秒タップなしで閉じてホームへ（打鍵では延びず）。`
      : `${seconds}秒タップしないと、自動で閉じてホームに戻ります（打鍵では延びません）。`,
    compact
      ? 'キーで閉じ、ホーム先頭から再開（入力欄の編集・タブ移動キーは除く）。'
      : 'キー入力で閉じ、ホーム先頭から再開（入力欄・スライダー・チェックボックス操作中の文字/矢印/Home/Endキーと、タブ上の←/→/Home/Endは閉じません）。',
    compact
      ? `開く間は${options.morseEnabled ? 'スキャン・モールス時間' : 'スキャン'}停止。`
      : `開いている間は、${stops}が止まります。`,
    // 自動で起きること(Issue #76)。本人画面の常時案内ではなく、介助者メニューに置く
    compact
      ? `${IDLE_LAPS_BEFORE_HOME}周無入力でホームへ（モールス・ホームを除く）。`
      : `入力がないまま${IDLE_LAPS_BEFORE_HOME}周すると、ホームに戻ります（モールス入力・ホームを除く）。`,
  ]
}
