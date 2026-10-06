// Issue #58: 常時案内(guidance.ts)の表引きテスト。
//
// デシジョンテーブル(buildScreenNotes)。出る行は次の固定順で並ぶ:
//   U 取り消し → E1 緊急の取り消しなし → V 緊急の振動 → T 再起動後は触れるまで振動なし
//   → D 連打無視 → H 押下下限/離して決定 → A 聴覚スキャン → P 先頭待機
//
//   画面     | showUndo | 緊急 | 振動 | 触れる前 | 出る行
//   home     |   o      |  -   |  -   |   -      | U
//   home     |   -      |  o   |  o   |   -      | E1 V
//   home     |   -      |  o   |  -   |   -      | E1 (振動OFFなら V なし)
//   home     |   -      |  o   |  o   |   o      | E1 V T
//   home     |   -      |  -   |  o   |   o      | T は出ない(緊急でない)
//   他画面   |   o      |  -   |  -   |   -      | U は出ない(取り消しはホーム専用)
//   他画面   |   -      |  o   |  o   |   -      | V (E1 はホーム専用)
//   morse    |  どれも  |      |      |          | 緊急+振動ONのときの V(+T)だけ。D/H/A/P は出ない
//
//   設定(home・状態なし) | 追加される行
//   連打無視 0 / >0      | D は >0 のときだけ
//   押下下限 0, press    | H なし
//   押下下限 0, release  | H=「押して離すと決まります」
//   押下下限>0, press    | H=「◯秒以上押し続けると」
//   押下下限>0, release  | H=「◯秒以上押し続けて離すと」
//   聴覚スキャン ON/OFF  | A は ON のときだけ
//   先頭待機             | P は常に末尾。秒数=間隔×倍率(toFixed(1))
import { describe, expect, it } from 'vitest'
import { PATIENT_SCREEN_IDS, type ScreenId } from '../menus'
import { DEFAULT_SETTINGS } from '../settings'
import {
  EMERGENCY_REPEAT_MS,
  buildCaregiverMenuNotes,
  buildScreenNotes,
  type ScreenNotesContext,
} from '../guidance'

const UNDO = '「取り消し」は伝えた直後の1周だけ出ます。'
const NO_UNDO_IN_EMERGENCY = '緊急中は「取り消し」なし（緊急は取り消せないため）。'
const VIBRATION = '緊急中は3秒ごとに振動（呼び出し継続の合図。本人の入力直後は休む）。'
const AWAIT_TOUCH = '再起動後は、一度画面に触れるまで振動しません。'
const DEBOUNCE_DEFAULT = '0.5秒以内の連打は数えません（画面遷移直後も。誤作動防止）。'
const AUDITORY = '伝達の読み上げは、次項目の読み上げで途切れません。'
const HEAD_DEFAULT = '画面を開くと先頭に3.0秒とどまります。'

type SettingsOverride = Partial<ScreenNotesContext['settings']>

function notes(
  screen: ScreenId,
  state: Partial<Omit<ScreenNotesContext, 'screen' | 'settings'>> = {},
  settings: SettingsOverride = {},
): string[] {
  return buildScreenNotes({
    screen,
    showUndo: false,
    emergencyActive: false,
    ...state,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  })
}

describe('buildScreenNotes: 状態の表引き(既定設定)', () => {
  it('何もない既定のホームは連打無視と先頭待機だけ', () => {
    expect(notes('home')).toEqual([DEBOUNCE_DEFAULT, HEAD_DEFAULT])
  })

  it('ホームで伝達直後なら取り消しの案内が先頭に出る', () => {
    expect(notes('home', { showUndo: true })).toEqual([UNDO, DEBOUNCE_DEFAULT, HEAD_DEFAULT])
  })

  it('ホームで緊急中は取り消しなし+振動の案内が、押し方より前に出る', () => {
    expect(notes('home', { emergencyActive: true })).toEqual([
      NO_UNDO_IN_EMERGENCY,
      VIBRATION,
      DEBOUNCE_DEFAULT,
      HEAD_DEFAULT,
    ])
  })

  it('緊急中かつ振動OFFなら振動の案内は出ない(取り消しなしは出る)', () => {
    expect(notes('home', { emergencyActive: true }, { hapticsEnabled: false })).toEqual([
      NO_UNDO_IN_EMERGENCY,
      DEBOUNCE_DEFAULT,
      HEAD_DEFAULT,
    ])
  })

  it('緊急復元(触れる前)かつ振動ONのときだけ、再起動後の振動注意が振動の直後に出る', () => {
    expect(notes('home', { emergencyActive: true, vibrationAwaitsTouch: true })).toEqual([
      NO_UNDO_IN_EMERGENCY,
      VIBRATION,
      AWAIT_TOUCH,
      DEBOUNCE_DEFAULT,
      HEAD_DEFAULT,
    ])
    // 振動OFFなら振動しないので注意も不要
    expect(
      notes(
        'home',
        { emergencyActive: true, vibrationAwaitsTouch: true },
        { hapticsEnabled: false },
      ),
    ).not.toContain(AWAIT_TOUCH)
    // 触れた後(false/未指定)は出ない
    expect(notes('home', { emergencyActive: true, vibrationAwaitsTouch: false })).not.toContain(
      AWAIT_TOUCH,
    )
  })

  it('緊急でなければ「触れる前」でも再起動後の振動注意は出ない', () => {
    expect(notes('home', { vibrationAwaitsTouch: true })).toEqual([DEBOUNCE_DEFAULT, HEAD_DEFAULT])
  })

  it('home 以外の画面では取り消し系(伝えた直後の取り消し・緊急中の取り消しなし)は出ない', () => {
    for (const screen of PATIENT_SCREEN_IDS.filter((s) => s !== 'home' && s !== 'morse')) {
      expect(notes(screen, { showUndo: true })).not.toContain(UNDO)
      const emergency = notes(screen, { emergencyActive: true })
      expect(emergency).not.toContain(NO_UNDO_IN_EMERGENCY)
      expect(emergency).toContain(VIBRATION) // 振動は全画面で出る
    }
  })

  it('全スキャン画面で、押し方と先頭待機の案内は home と同一(場所だけでなく文言も全画面共通)', () => {
    const base = notes('home')
    for (const screen of PATIENT_SCREEN_IDS.filter((s) => s !== 'morse')) {
      expect(notes(screen)).toEqual(base)
    }
  })
})

describe('buildScreenNotes: モールス画面', () => {
  it('通常時は何も出ない(押し方はモールス凡例側)', () => {
    expect(notes('morse')).toEqual([])
  })

  it('連打無視・離して決定・押下下限・聴覚スキャンの設定があっても出ない', () => {
    expect(
      notes(
        'morse',
        {},
        { debounceMs: 1000, minHoldMs: 500, activateOn: 'release', auditoryScan: true },
      ),
    ).toEqual([])
  })

  it('緊急中は(振動ONなら)振動だけ。取り消し系・押し方・先頭待機は出ない', () => {
    expect(notes('morse', { showUndo: true, emergencyActive: true })).toEqual([VIBRATION])
    expect(
      notes('morse', { emergencyActive: true, vibrationAwaitsTouch: true }, { debounceMs: 800 }),
    ).toEqual([VIBRATION, AWAIT_TOUCH])
    expect(notes('morse', { emergencyActive: true }, { hapticsEnabled: false })).toEqual([])
  })
})

describe('buildScreenNotes: 設定の表引き(ホーム・状態なし)', () => {
  it('連打無視 0 なら出ず、>0 なら秒数に追従する(最小の境界 1ms も 0.0秒表記)', () => {
    expect(notes('home', {}, { debounceMs: 0 })).toEqual([HEAD_DEFAULT])
    expect(notes('home', {}, { debounceMs: 1200 })[0]).toBe(
      '1.2秒以内の連打は数えません（画面遷移直後も。誤作動防止）。',
    )
    expect(notes('home', {}, { debounceMs: 1 })[0]).toContain('0.0秒以内')
  })

  const holdCases: Array<[number, 'press' | 'release', string | null]> = [
    [0, 'press', null],
    [0, 'release', '押して離すと決まります（押した瞬間は決まりません）。'],
    [500, 'press', '0.5秒以上押し続けると決まります（短押しは数えません）。'],
    [500, 'release', '0.5秒以上押し続けて離すと決まります（短押しは数えません）。'],
    [2000, 'release', '2.0秒以上押し続けて離すと決まります（短押しは数えません）。'],
    [1, 'press', '0.0秒以上押し続けると決まります（短押しは数えません）。'],
  ]
  for (const [minHoldMs, activateOn, expected] of holdCases) {
    it(`押下下限 ${minHoldMs}ms × ${activateOn}: ${expected ?? '行なし'}`, () => {
      const result = notes('home', {}, { debounceMs: 0, minHoldMs, activateOn })
      expect(result).toEqual(expected ? [expected, HEAD_DEFAULT] : [HEAD_DEFAULT])
    })
  }

  it('聴覚スキャンONのときだけ読み上げ割り込み抑止の案内が、先頭待機の直前に出る', () => {
    expect(notes('home', {}, { debounceMs: 0, auditoryScan: true })).toEqual([
      AUDITORY,
      HEAD_DEFAULT,
    ])
    expect(notes('home', {}, { auditoryScan: false })).not.toContain(AUDITORY)
  })

  it('先頭待機の秒数は 間隔×倍率 に追従する(toFixed(1))', () => {
    const head = (intervalMs: number, headHoldMultiplier: number) =>
      notes('home', {}, { debounceMs: 0, intervalMs, headHoldMultiplier })
    expect(head(500, 1)).toEqual(['画面を開くと先頭に0.5秒とどまります。'])
    expect(head(5000, 5)).toEqual(['画面を開くと先頭に25.0秒とどまります。'])
    expect(head(1500, 3)).toEqual(['画面を開くと先頭に4.5秒とどまります。'])
    expect(head(700, 1.5)).toEqual(['画面を開くと先頭に1.1秒とどまります。']) // 1050ms → 1.1(丸め)
  })

  it('全部入りの順序: 取り消し → 緊急 → 振動 → 触れる前 → 連打 → 押し方 → 聴覚 → 先頭待機', () => {
    expect(
      notes(
        'home',
        { showUndo: true, emergencyActive: true, vibrationAwaitsTouch: true },
        { debounceMs: 300, minHoldMs: 400, activateOn: 'release', auditoryScan: true },
      ),
    ).toEqual([
      UNDO,
      NO_UNDO_IN_EMERGENCY,
      VIBRATION,
      AWAIT_TOUCH,
      '0.3秒以内の連打は数えません（画面遷移直後も。誤作動防止）。',
      '0.4秒以上押し続けて離すと決まります（短押しは数えません）。',
      AUDITORY,
      HEAD_DEFAULT,
    ])
  })
})

describe('案内の共通性質', () => {
  it('緊急の振動間隔は EMERGENCY_REPEAT_MS(秒数)と一致する', () => {
    expect(EMERGENCY_REPEAT_MS).toBe(3000)
    expect(notes('home', { emergencyActive: true })).toContain(
      `緊急中は${EMERGENCY_REPEAT_MS / 1000}秒ごとに振動（呼び出し継続の合図。本人の入力直後は休む）。`,
    )
  })

  it('どの組み合わせでも絵文字・空文字を含まない', () => {
    const emoji = /\p{Extended_Pictographic}/u
    for (const screen of PATIENT_SCREEN_IDS) {
      for (const showUndo of [false, true]) {
        for (const emergencyActive of [false, true]) {
          for (const activateOn of ['press', 'release'] as const) {
            for (const minHoldMs of [0, 500]) {
              for (const auditoryScan of [false, true]) {
                const result = notes(
                  screen,
                  { showUndo, emergencyActive, vibrationAwaitsTouch: true },
                  { activateOn, minHoldMs, auditoryScan },
                )
                for (const note of result) {
                  expect(note.length).toBeGreaterThan(0)
                  expect(emoji.test(note)).toBe(false)
                }
              }
            }
          }
        }
      }
    }
  })
})

describe('buildCaregiverMenuNotes', () => {
  it('所定の3行が固定順で出る(60秒・外側タップ/キー・モールス時間停止)', () => {
    expect(buildCaregiverMenuNotes(60000)).toEqual([
      '60秒操作しないと、自動で閉じてホームに戻ります。',
      '外側のタップやキー入力（タブ上の←/→/Home/Endはタブ移動）で閉じ、ホーム先頭から再開。',
      '開いている間は、モールス入力の時間が止まります。',
    ])
  })

  it('自動で閉じる秒数は引数に追従し、他の行は変わらない', () => {
    const a = buildCaregiverMenuNotes(60000)
    const b = buildCaregiverMenuNotes(30000)
    expect(b[0]).toBe('30秒操作しないと、自動で閉じてホームに戻ります。')
    expect(b.slice(1)).toEqual(a.slice(1))
  })

  it('絵文字を含まない', () => {
    for (const note of buildCaregiverMenuNotes(60000)) {
      expect(/\p{Extended_Pictographic}/u.test(note)).toBe(false)
    }
  })
})
