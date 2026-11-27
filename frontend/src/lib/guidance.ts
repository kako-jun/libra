// 画面下の固定案内(.screen-notes: 緊急中の振動だけ)と、介助者用メニュー「スキャン」タブの
// 原因の設定の下に出す動作の説明の文言。
// 正本: docs/requirements.md §4.1.2 の「常時案内」表 / Issue #58
//
// 方針: 暗黙の操作は作らない。ただし画面を見れば分かることは書かず、見ても分からない挙動だけを書く
// (本人画面は緊急中の振動、介助者用メニューは設定に応じた動作の説明。上部の固定帯は Issue #138 で削除した)。
// 本人や介助者が任意に隠せる操作は設けない。副作用なし(テストしやすいよう文字列だけ返す)。
// compact は低い画面(高さ500px以下)か狭い画面(幅480px以下)用の短縮形。出す・出さないは変えず、
// 省くのは「理由」の語だけ。操作に関わる事実(何が起きるか・何をしても反応しない条件)は短縮形でも残す
// (本人は画面をスクロールできないため、帯が格子を押し潰さないようにする)。

import { EMERGENCY_REPEAT_MS } from './feedback'
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

/** 見ても分からない設定依存の挙動を、介助者用メニューに出すための文脈 */
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
const SCREEN_CHANGE_NOTE_FULL =
  '押下中に画面や項目の並びが変わると無効です。モールス入力は除きます。'

/**
 * 本人画面の下に常時出す案内。緊急中の周期振動まわりだけ(Issue #79)。
 * 順序は固定: 周期振動 → 再起動後は触れるまで振動なし / 振動できない端末。通常時は空配列(帯ごと出さない)。
 * 設定の細かい説明は buildBehaviorNotes で介助者用メニューへ出す。
 */
export function buildScreenNotes(context: ScreenNotesContext): string[] {
  const { emergencyActive, vibrationAwaitsTouch, settings } = context
  const compact = context.compact === true
  const canVibrate = context.canVibrate !== false
  const notes: string[] = []

  if (emergencyActive && settings.hapticsEnabled) {
    if (canVibrate) {
      // Issue #110: 操作に要らない補足(呼び出し継続の合図・入力直後は休む)は書かない
      const every = `${EMERGENCY_REPEAT_MS / 1000}秒ごと`
      notes.push(compact ? `緊急中は${every}に振動。` : `緊急中は${every}に振動します。`)
      if (vibrationAwaitsTouch) {
        // 再起動後に振動を再開するための操作。これは必要なので残す
        notes.push(
          compact ? 'タッチかキーで振動を再開。' : '画面に触れるかキーを押すと、振動を再開します。',
        )
      }
    } else {
      notes.push('この端末は振動できません。')
    }
  }
  return notes
}

/** 設定に応じた挙動の説明を、原因の設定ごとに分けたもの。該当しない項目は持たない */
export interface BehaviorNoteMap {
  /** 連打無視(スキャンタブの「連打無視」の下) */
  debounce?: string
  /** 押し方(「押下時間の下限」「決定のタイミング」の下) */
  hold?: string
  /** 読み上げの割り込み(「聴覚スキャン」の下) */
  speech?: string
}

/**
 * 見ても分からない、設定に応じた挙動の説明。介助者用メニューでは、原因の設定のすぐ下に出す(Issue #111。
 * 以前は旧「状態」タブの「いまの動作」にまとめていた)。スクロールできるので短縮形は持たない。
 */
export function buildBehaviorNoteMap(context: BehaviorNotesContext): BehaviorNoteMap {
  const { settings } = context
  const map: BehaviorNoteMap = {}

  if (settings.debounceMs > 0) {
    const s = formatSeconds(settings.debounceMs)
    map.debounce = `誤作動を防ぐため、${s}以内の連打は画面遷移直後も数えません。モールス入力は除きます。`
  }
  if (settings.minHoldMs > 0) {
    const s = formatSeconds(settings.minHoldMs)
    map.hold =
      settings.activateOn === 'release'
        ? `${s}以上押し続けて離すと決まります。短押しは数えません。${SCREEN_CHANGE_NOTE_FULL}`
        : `${s}以上押し続けると決まります。短押しは数えません。${SCREEN_CHANGE_NOTE_FULL}`
  } else if (settings.activateOn === 'release') {
    map.hold = `押して離すと決まります。押した瞬間は決まりません。${SCREEN_CHANGE_NOTE_FULL}`
  }
  // 伝達の読み上げは、直後の1回だけ次のスキャン読み上げに割り込まれない(App.tsx の messageAnnounceGrace)。
  // 読み上げ自体が出るのは音声モードが「短く/全部」のときだけ
  if (settings.auditoryScan && (settings.voiceMode === 'short' || settings.voiceMode === 'full')) {
    map.speech =
      '伝達の読み上げは、直後の1項目分は割り込まれません。その後は次の読み上げで切れることがあります。'
  }
  return map
}

/** buildBehaviorNoteMap を固定順(連打無視 → 押し方 → 読み上げの割り込み)の配列にしたもの。該当しなければ空配列 */
export function buildBehaviorNotes(context: BehaviorNotesContext): string[] {
  const map = buildBehaviorNoteMap(context)
  return [map.debounce, map.hold, map.speech].filter((note): note is string => note !== undefined)
}
