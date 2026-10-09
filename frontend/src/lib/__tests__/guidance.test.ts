// Issue #58/#79: 常時案内(guidance.ts)の表引きテスト。
//
// 本人画面の常時案内 buildScreenNotes は「緊急中の周期振動まわり」だけ(通常時は空配列=帯ごと出さない)。
//   緊急 | 振動設定 | 端末 | 触れる前 | 出る行
//    -   |   -      |  -   |   -      | なし
//    o   |  ON      | 可   |   -      | V 周期振動
//    o   |  ON      | 可   |   o      | V T(再起動後は触れるまで振動なし)
//    o   |  ON      | 不可 |   -      | 「この端末は振動できません」(T は出ない)
//    o   |  OFF     |  -   |   -      | なし
//    -   |  -       |  -   |   o      | T は出ない(緊急でない)
//   compact は同じ行を短縮文言で出す(出る/出ないは不変)。画面(morse を含む)によらず同一。
//
// 設定依存の挙動 buildBehaviorNotes(介助者メニュー「状態」タブの「いまの動作」)。順序: D → H → A
//   連打無視 0 / >0      | D は >0 のときだけ
//   押下下限 0, press    | H なし
//   押下下限 0, release  | H=「押して離すと決まります」
//   押下下限>0, press    | H=「◯秒以上押し続けると」(いずれの H も末尾に「押下中に画面や項目の並びが変わると無効」)
//   押下下限>0, release  | H=「◯秒以上押し続けて離すと」
//   聴覚スキャン ON/OFF  | A は ON かつ音声モード short/full のときだけ(off/tone なら出ない)
//   先頭待機・取り消し・緊急中の取り消しなしは、見れば分かるのでどこにも書かない
import { describe, expect, it } from 'vitest'
import { PATIENT_SCREEN_IDS, type ScreenId } from '../menus'
import { DEFAULT_SETTINGS } from '../settings'
import { EMERGENCY_REPEAT_MS } from '../feedback'
import {
  buildBehaviorNotes,
  buildCaregiverMenuNotes,
  buildScreenNotes,
  formatSeconds,
  type BehaviorNotesContext,
  type ScreenNotesContext,
} from '../guidance'

const NO_VIBRATE = 'この端末は振動できません（緊急中の周期振動なし）。'
const VIBRATION = '緊急中は3秒ごとに振動（呼び出し継続の合図。本人の入力直後は休む）。'
const AWAIT_TOUCH = '再起動後は、画面に触れるかキーを押すまで振動しません。'
const DEBOUNCE_DEFAULT = '0.5秒以内の連打は数えません（画面遷移直後も。誤作動防止）。'
const AUDITORY =
  '伝達の読み上げは、直後の1項目分は割り込まれません（その後は次の読み上げで切れることがあります）。'
const SCREEN_CHANGE = '押下中に画面や項目の並びが変わると無効'

type SettingsOverride = Partial<ScreenNotesContext['settings'] & BehaviorNotesContext['settings']>
type BehaviorOverride = Partial<BehaviorNotesContext['settings']>

function notes(
  screen: ScreenId,
  state: Partial<Omit<ScreenNotesContext, 'screen' | 'settings'>> = {},
  settings: SettingsOverride = {},
): string[] {
  return buildScreenNotes({
    screen,
    emergencyActive: false,
    ...state,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  })
}

function behavior(settings: BehaviorOverride = {}, compact = false): string[] {
  return buildBehaviorNotes({ compact, settings: { ...DEFAULT_SETTINGS, ...settings } })
}

const SPEAKING = { auditoryScan: true, voiceMode: 'short' as const }

describe('buildScreenNotes: 状態の表引き', () => {
  it('通常時(緊急なし)は、どの画面でも空(帯ごと出さない)', () => {
    for (const screen of PATIENT_SCREEN_IDS) expect(notes(screen)).toEqual([])
  })

  it('既定設定以外(連打無視・押し方・聴覚スキャン)でも、通常時は空', () => {
    for (const screen of PATIENT_SCREEN_IDS) {
      expect(
        notes(screen, {}, { ...SPEAKING, debounceMs: 1000, minHoldMs: 500, activateOn: 'release' }),
      ).toEqual([])
    }
  })

  it('緊急中は周期振動の1行だけ(取り消しなし・押し方・先頭待機は出ない)。全画面共通', () => {
    for (const screen of PATIENT_SCREEN_IDS) {
      expect(notes(screen, { emergencyActive: true })).toEqual([VIBRATION])
    }
  })

  it('緊急中かつ振動OFFなら何も出ない', () => {
    expect(notes('home', { emergencyActive: true }, { hapticsEnabled: false })).toEqual([])
  })

  it('緊急復元(触れる前)かつ振動ONのときだけ、再起動後の振動注意が振動の直後に出る', () => {
    expect(notes('home', { emergencyActive: true, vibrationAwaitsTouch: true })).toEqual([
      VIBRATION,
      AWAIT_TOUCH,
    ])
    expect(
      notes(
        'home',
        { emergencyActive: true, vibrationAwaitsTouch: true },
        { hapticsEnabled: false },
      ),
    ).toEqual([])
    expect(notes('home', { emergencyActive: true, vibrationAwaitsTouch: false })).toEqual([
      VIBRATION,
    ])
  })

  it('緊急でなければ「触れる前」でも再起動後の振動注意は出ない', () => {
    expect(notes('home', { vibrationAwaitsTouch: true })).toEqual([])
  })

  it('緊急の振動間隔は EMERGENCY_REPEAT_MS(秒数)と一致する', () => {
    expect(EMERGENCY_REPEAT_MS).toBe(3000)
    expect(notes('home', { emergencyActive: true })).toContain(
      `緊急中は${EMERGENCY_REPEAT_MS / 1000}秒ごとに振動（呼び出し継続の合図。本人の入力直後は休む）。`,
    )
  })

  it('どの組み合わせでも絵文字・空文字を含まない', () => {
    const emoji = /\p{Extended_Pictographic}/u
    for (const screen of PATIENT_SCREEN_IDS) {
      for (const emergencyActive of [false, true]) {
        for (const canVibrate of [false, true]) {
          for (const compact of [false, true]) {
            for (const note of notes(screen, {
              emergencyActive,
              canVibrate,
              compact,
              vibrationAwaitsTouch: true,
            })) {
              expect(note.length).toBeGreaterThan(0)
              expect(emoji.test(note)).toBe(false)
            }
          }
        }
      }
    }
  })
})

describe('buildScreenNotes: 低い画面の短縮形・振動できない端末', () => {
  it('compact でも出る行の数と順序は同じで、文言だけが短い', () => {
    const state = { emergencyActive: true, vibrationAwaitsTouch: true }
    const full = notes('home', state)
    const compact = notes('home', { ...state, compact: true })
    expect(compact).toHaveLength(full.length)
    expect(compact).toHaveLength(2)
    for (let i = 0; i < full.length; i += 1) expect(compact[i].length).toBeLessThan(full[i].length)
    expect(compact.join('\n')).toContain('3秒ごと')
    expect(compact.join('\n')).toContain('入力直後は休む')
  })

  it('振動できない端末では、緊急中の振動案内を出さず「振動できません」という事実を出す', () => {
    const result = notes('home', {
      emergencyActive: true,
      canVibrate: false,
      vibrationAwaitsTouch: true,
    })
    expect(result).toEqual([NO_VIBRATE])
    expect(
      notes('home', { emergencyActive: true, canVibrate: false }, { hapticsEnabled: false }),
    ).toEqual([])
  })
})

describe('buildBehaviorNotes: 設定の表引き', () => {
  it('既定設定は連打無視の1行だけ', () => {
    expect(behavior()).toEqual([DEBOUNCE_DEFAULT])
  })

  it('連打無視 0 なら出ず、>0 なら秒数に追従する(0.05 秒刻みも丸めない)', () => {
    expect(behavior({ debounceMs: 0 })).toEqual([])
    expect(behavior({ debounceMs: 1200 })[0]).toBe(
      '1.2秒以内の連打は数えません（画面遷移直後も。誤作動防止）。',
    )
    expect(behavior({ debounceMs: 1 })[0]).toContain('0.01秒未満以内')
    expect(behavior({ debounceMs: 50 })[0]).toContain('0.05秒以内')
    expect(behavior({ debounceMs: 250 })[0]).toContain('0.25秒以内')
  })

  const holdCases: Array<[number, 'press' | 'release', string | null]> = [
    [0, 'press', null],
    [0, 'release', `押して離すと決まります（押した瞬間は決まりません。${SCREEN_CHANGE}）。`],
    [500, 'press', `0.5秒以上押し続けると決まります（短押しは数えません。${SCREEN_CHANGE}）。`],
    [
      500,
      'release',
      `0.5秒以上押し続けて離すと決まります（短押しは数えません。${SCREEN_CHANGE}）。`,
    ],
    [
      2000,
      'release',
      `2.0秒以上押し続けて離すと決まります（短押しは数えません。${SCREEN_CHANGE}）。`,
    ],
    [1, 'press', `0.01秒未満以上押し続けると決まります（短押しは数えません。${SCREEN_CHANGE}）。`],
  ]
  for (const [minHoldMs, activateOn, expected] of holdCases) {
    it(`押下下限 ${minHoldMs}ms × ${activateOn}: ${expected ?? '行なし'}`, () => {
      expect(behavior({ debounceMs: 0, minHoldMs, activateOn })).toEqual(expected ? [expected] : [])
    })
  }

  it('聴覚スキャンONのときだけ読み上げ割り込み抑止の案内が出る', () => {
    expect(behavior({ debounceMs: 0, ...SPEAKING })).toEqual([AUDITORY])
    expect(behavior({ debounceMs: 0, auditoryScan: true, voiceMode: 'full' })).toEqual([AUDITORY])
    expect(behavior({ auditoryScan: false, voiceMode: 'short' })).not.toContain(AUDITORY)
  })

  it('音声モードが OFF・効果音だけのときは、聴覚スキャン ON でも読み上げ案内は出ない(読み上げが無いため)', () => {
    for (const voiceMode of ['off', 'tone'] as const) {
      expect(behavior({ auditoryScan: true, voiceMode })).not.toContain(AUDITORY)
    }
  })

  it('先頭待機・取り消し・緊急中の取り消しなしは、どの設定でも書かない', () => {
    const all = behavior({ debounceMs: 300, minHoldMs: 400, activateOn: 'release', ...SPEAKING })
    expect(all.join('')).not.toContain('先頭')
    expect(all.join('')).not.toContain('取り消し')
  })

  it('全部入りの順序: 連打 → 押し方 → 聴覚', () => {
    expect(
      behavior({ debounceMs: 300, minHoldMs: 400, activateOn: 'release', ...SPEAKING }),
    ).toEqual([
      '0.3秒以内の連打は数えません（画面遷移直後も。誤作動防止）。',
      `0.4秒以上押し続けて離すと決まります（短押しは数えません。${SCREEN_CHANGE}）。`,
      AUDITORY,
    ])
  })

  it('compact でも出る行数と順序は同じで、文言だけが短い', () => {
    const settings = { minHoldMs: 800, activateOn: 'release' as const, ...SPEAKING }
    const full = behavior(settings)
    const compact = behavior(settings, true)
    expect(compact).toHaveLength(full.length)
    expect(compact).toHaveLength(3)
    for (let i = 0; i < full.length; i += 1) expect(compact[i].length).toBeLessThan(full[i].length)
  })

  it('compact にも操作・条件の事実が残る', () => {
    expect(behavior({}, true).join('\n')).toContain('連打は無視（遷移直後も）')
    const press = behavior({ minHoldMs: 800, activateOn: 'press' }, true).join('\n')
    expect(press).toContain('0.8秒以上押し続けると決定')
    expect(press).toContain('短押しは数えません')
    expect(press).toContain(SCREEN_CHANGE)
    const release = behavior({ minHoldMs: 800, activateOn: 'release' }, true).join('\n')
    expect(release).toContain('押し続けて離すと決定')
    const releaseOnly = behavior({ minHoldMs: 0, activateOn: 'release' }, true).join('\n')
    expect(releaseOnly).toContain('押して離すと決定')
    expect(releaseOnly).toContain('押した瞬間は決まりません')
    const speak = behavior({ ...SPEAKING }, true).join('\n')
    expect(speak).toContain('直後の1項目分は割り込まれません')
    expect(speak).toContain('その後は切れることがあります')
  })
})

describe('buildCaregiverMenuNotes', () => {
  it('所定の4行が固定順で出る(60秒タップ・キーで閉じる・スキャン停止・無入力でホームへ)', () => {
    expect(buildCaregiverMenuNotes(60000)).toEqual([
      '60秒タップしないと、自動で閉じてホームに戻ります（打鍵では延びません）。',
      'キー入力で閉じ、ホーム先頭から再開（入力欄・スライダー・チェックボックス操作中の文字/矢印/Home/Endキーと、タブ上の←/→/Home/Endは閉じません）。',
      '開いている間は、スキャンが止まります。',
      '入力がないまま3周すると、ホームに戻ります（モールス入力・ホームを除く）。',
    ])
  })

  it('モールス入力が有効なときだけ、モールス入力の時間停止も出す', () => {
    expect(buildCaregiverMenuNotes(60000, { morseEnabled: true })[2]).toBe(
      '開いている間は、スキャンとモールス入力の時間が止まります。',
    )
    expect(buildCaregiverMenuNotes(60000, { morseEnabled: false })[2]).not.toContain('モールス')
  })

  it('短縮形も同じ行数・同じ事実を保つ(出る行数は変わらない)', () => {
    const full = buildCaregiverMenuNotes(60000, { morseEnabled: true })
    const compact = buildCaregiverMenuNotes(60000, { morseEnabled: true, compact: true })
    expect(compact).toHaveLength(full.length)
    expect(compact[0]).toContain('60秒タップ')
    expect(compact[0]).toContain('打鍵では延びず')
    expect(compact[1]).toContain('入力欄の編集')
    expect(compact[2]).toContain('モールス')
    expect(compact[3]).toContain('3周無入力でホームへ')
    for (let i = 0; i < full.length; i += 1) expect(compact[i].length).toBeLessThan(full[i].length)
  })

  it('自動で閉じる秒数は引数に追従し、他の行は変わらない', () => {
    const a = buildCaregiverMenuNotes(60000)
    const b = buildCaregiverMenuNotes(30000)
    expect(b[0]).toBe('30秒タップしないと、自動で閉じてホームに戻ります（打鍵では延びません）。')
    expect(b.slice(1)).toEqual(a.slice(1))
  })

  it('絵文字を含まない', () => {
    for (const note of buildCaregiverMenuNotes(60000, { morseEnabled: true })) {
      expect(/\p{Extended_Pictographic}/u.test(note)).toBe(false)
    }
  })
})

describe('formatSeconds', () => {
  it('100ms 刻みは小数1桁、それ以外は小数2桁で丸めない', () => {
    expect(formatSeconds(500)).toBe('0.5秒')
    expect(formatSeconds(2000)).toBe('2.0秒')
    expect(formatSeconds(50)).toBe('0.05秒')
    expect(formatSeconds(1050)).toBe('1.05秒')
    expect(formatSeconds(0)).toBe('0.0秒')
    expect(formatSeconds(5)).toBe('0.01秒未満')
  })
})

describe('介助者メニューの短縮形(compact)', () => {
  it('介助者メニュー: タップで延びる/打鍵では延びない/閉じるとホーム先頭から再開/停止するもの', () => {
    const [idle, outside, stops] = buildCaregiverMenuNotes(60000, {
      morseEnabled: true,
      compact: true,
    })
    expect(idle).toContain('60秒タップなしで閉じてホームへ')
    expect(idle).toContain('打鍵では延びず')
    expect(outside).toContain('キーで閉じ')
    expect(outside).not.toContain('外側')
    expect(outside).toContain('ホーム先頭から再開')
    expect(outside).toContain('入力欄の編集・タブ移動キーは除く')
    expect(stops).toContain('スキャン')
    expect(stops).toContain('モールス')
  })
})
