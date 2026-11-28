// Issue #120: 伝達履歴の前後移動 / Issue #123: 「もう一度」
// 正本: docs/requirements.md §4.1(直前の伝達の履歴)・§4.2(もう一度)
//
// 観点(#120 履歴)
//   矢印の出し分け  | その方向に内容があるときだけ出す(#129)。無効状態では残さない。左右の枠は常に確保する
//   欄の常設(#131)  | 起動時から出し、何も伝えていないときは「まだ伝えたことはありません。」
//   背景色(#135)    | 表示中の内容の色(data-message-tone)。緊急の記録は赤、通常の伝達は通常の色
//   見出し          | 過去を表示中は「過去に伝えたこと　N件前」。最新に戻ると「直前に伝えたこと」
//   最新へ戻る契機  | 新しい伝達・緊急・もう一度(過去の表示が本人の新しい伝達を隠さない)
//   最新が空        | 介助者の緊急解除の後は、履歴ありなら「まだ伝えたことはありません。」で枠を残す
//   上限            | 50 件。51 件目で最古を捨てる(境界 49 件前まで戻れ、50 件前は無い)
//   ガード          | 介助者用メニューを開いている間は動かない / スキャン対象ではない / 押した後のキーはスキャン対象を実行
//   保存しない      | 再読み込みで履歴は残らない
//
// デシジョンテーブル(#123 もう一度。伝達の有無 × 緊急 → 結果)
//   伝達なし × 緊急なし → 何もしない(項目は常設・薄く表示・aria-disabled)
//   伝達あり × 緊急なし → 直前の伝達の振動(はい/いいえ/通常)と読み上げを出し直す。見出し「（もう一度）」
//   伝達なし × 緊急中   → 緊急の呼び出し(振動・読み上げ)を出し直し、緊急の帯を点滅させる
//   伝達あり × 緊急中   → 直前の伝達を出し直す(緊急の呼び出しではない)
//   どの場合も新しい伝達ではない → 履歴の件数は変えない
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import { HAPTIC_PATTERNS } from '../lib/feedback'
import {
  EMERGENCY_MESSAGE,
  clearDeviceCalls,
  closeCaregiverMenu,
  emergencyBand,
  isEmergency,
  isHome,
  lastVibration,
  messagePanel,
  openCaregiverMenu,
  panelLabel,
  pressSwitch,
  scanningLabel,
  setSettings,
  setupApp,
  shownMessage,
  spoken,
  tap,
  teardownApp,
  tile,
  tileLabels,
  vibrations,
} from './appTestKit'

const LATEST = '直前に伝えたこと'
const prevButton = (c: HTMLElement) =>
  c.querySelector<HTMLButtonElement>('.history-nav[aria-label="前の伝達を表示"]')
const nextButton = (c: HTMLElement) =>
  c.querySelector<HTMLButtonElement>('.history-nav[aria-label="次の伝達を表示"]')
const noneText = (c: HTMLElement) => c.querySelector('.message-panel-none')?.textContent ?? null

/** はい → いいえ → はい … のように n 件伝える(伝達のたびにホームへ戻る) */
function sendMessages(c: HTMLElement, labels: string[]) {
  for (const label of labels) tap(c, label)
}

describe('Issue #120: 伝達履歴を左右の矢印で振り返る', () => {
  beforeEach(setupApp)
  afterEach(teardownApp)

  /** 何も伝えていない状態の欄: 文は隠れ、「いまは…」を出し、戻れる伝達も無いので矢印も無い */
  const expectNothing = (c: HTMLElement) => {
    expect(shownMessage(c)).toBeNull()
    expect(noneText(c)).toBe('まだ伝えたことはありません。')
    expect(panelLabel(c)).toBe(LATEST)
    expect(c.querySelectorAll('.history-nav')).toHaveLength(0)
  }
  /** 矢印の有無にかかわらず確保する左右の枠 */
  const expectSlots = (c: HTMLElement) => {
    const kids = Array.from(messagePanel(c).children).map((el) => el.className)
    expect(kids).toEqual(['history-slot', 'message-panel-body', 'history-slot'])
  }

  it('伝達が 0 件のときは矢印を出さず、起動時から欄に「まだ伝えたことはありません。」を出す', () => {
    const { container } = render(() => <App />)
    expectNothing(container)
    expectSlots(container)
  })

  it('境界: 1 件だけでは矢印を出さない。2 件目で左向きだけ出る(最新では右向きを出さない)', () => {
    const { container } = render(() => <App />)
    tap(container, 'はい')
    expect(prevButton(container)).toBeNull()
    tap(container, 'いいえ')
    expect(prevButton(container)).not.toBeNull()
    expect(nextButton(container)).toBeNull()
    expectSlots(container)
    // 途中の位置では左右とも出る。どれも無効状態を持たない
    tap(container, 'はい')
    fireEvent.click(prevButton(container) as HTMLElement)
    expect(prevButton(container)).not.toBeNull()
    expect(nextButton(container)).not.toBeNull()
    expect(container.querySelectorAll('.history-nav:disabled')).toHaveLength(0)
  })

  it('「前」で 1 件ずつ古い伝達を表示し、見出しが「過去に伝えたこと　N件前」になる。最古で「前」は消える', () => {
    const { container } = render(() => <App />)
    sendMessages(container, ['はい', 'いいえ', 'はい'])
    expect(shownMessage(container)).toBe('はい。')
    expect(panelLabel(container)).toBe(LATEST)

    fireEvent.click(prevButton(container) as HTMLElement)
    expect(shownMessage(container)).toBe('いいえ。')
    expect(panelLabel(container)).toBe('過去に伝えたこと　1件前')
    expect(messagePanel(container).classList.contains('is-past')).toBe(true)

    fireEvent.click(prevButton(container) as HTMLElement)
    expect(shownMessage(container)).toBe('はい。')
    expect(panelLabel(container)).toBe('過去に伝えたこと　2件前')
    expect(prevButton(container)).toBeNull()
    expect(nextButton(container)).not.toBeNull()
    expectSlots(container)
  })

  it('「次」で新しい方へ戻り、最新に着くと見出しが「直前に伝えたこと」に戻って「次」が消える', () => {
    const { container } = render(() => <App />)
    sendMessages(container, ['はい', 'いいえ', 'はい'])
    fireEvent.click(prevButton(container) as HTMLElement)
    fireEvent.click(prevButton(container) as HTMLElement)
    fireEvent.click(nextButton(container) as HTMLElement)
    expect(panelLabel(container)).toBe('過去に伝えたこと　1件前')
    fireEvent.click(nextButton(container) as HTMLElement)
    expect(panelLabel(container)).toBe(LATEST)
    expect(shownMessage(container)).toBe('はい。')
    expect(nextButton(container)).toBeNull()
    expect(messagePanel(container).classList.contains('is-past')).toBe(false)
  })

  describe('過去の表示から最新へ戻る契機', () => {
    it('新しい伝達', () => {
      const { container } = render(() => <App />)
      sendMessages(container, ['はい', 'いいえ'])
      fireEvent.click(prevButton(container) as HTMLElement)
      expect(panelLabel(container)).toBe('過去に伝えたこと　1件前')
      tap(container, 'はい')
      expect(panelLabel(container)).toBe(LATEST)
      expect(shownMessage(container)).toBe('はい。')
    })

    it('緊急', () => {
      const { container } = render(() => <App />)
      sendMessages(container, ['はい', 'いいえ'])
      fireEvent.click(prevButton(container) as HTMLElement)
      tap(container, '緊急')
      expect(isEmergency(container)).toBe(true)
      expect(panelLabel(container)).not.toContain('過去に伝えたこと')
      expect(messagePanel(container).classList.contains('is-past')).toBe(false)
    })

    it('もう一度', () => {
      const { container } = render(() => <App />)
      sendMessages(container, ['はい', 'いいえ'])
      fireEvent.click(prevButton(container) as HTMLElement)
      expect(shownMessage(container)).toBe('はい。')
      tap(container, 'もう一度')
      expect(panelLabel(container)).toBe('直前に伝えたこと　もう一度')
      // 伝え直すのは過去の表示ではなく、直前の伝達
      expect(shownMessage(container)).toBe('いいえ。')
    })
  })

  it('最新が空で履歴が残るとき(緊急を介助者が解除した後)は、枠を残して「いまは…」を出し、矢印で振り返れる', () => {
    const { container } = render(() => <App />)
    sendMessages(container, ['はい', 'いいえ'])
    tap(container, '緊急')
    openCaregiverMenu(container)
    ;(container.querySelector('.caregiver-emergency-clear') as HTMLElement).click()
    closeCaregiverMenu(container)
    expect(panelLabel(container)).toBe(LATEST)
    // 最新が空・履歴は残る → 文を隠して「いまは…」を出し、枠は残す
    expect(shownMessage(container)).toBeNull()
    expect(noneText(container)).toBe('まだ伝えたことはありません。')
    expect(nextButton(container)).toBeNull()

    // 履歴は新しい順に 緊急の呼び出し → いいえ → はい
    fireEvent.click(prevButton(container) as HTMLElement)
    expect(shownMessage(container)).toBe(EMERGENCY_MESSAGE)
    expect(panelLabel(container)).toBe('過去に伝えたこと　1件前')
    fireEvent.click(prevButton(container) as HTMLElement)
    expect(shownMessage(container)).toBe('いいえ。')
    fireEvent.click(prevButton(container) as HTMLElement)
    expect(shownMessage(container)).toBe('はい。')
    expect(prevButton(container)).toBeNull()
  })

  it('境界: 50 件までは最古まで戻れ、51 件目を伝えると最古が捨てられる', () => {
    const { container } = render(() => <App />)
    // 文字盤を経ずに区別できる伝達を作るため、はい・いいえ を交互に 50 件(最古は「はい」)
    const fifty = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 'はい' : 'いいえ'))
    sendMessages(container, fifty)
    for (let i = 0; i < 49; i += 1) fireEvent.click(prevButton(container) as HTMLElement)
    expect(panelLabel(container)).toBe('過去に伝えたこと　49件前')
    expect(shownMessage(container)).toBe('はい。') // 最古
    expect(prevButton(container)).toBeNull()

    tap(container, 'はい') // 51 件目。最古(はい)が捨てられ、最古は 2 件目の「いいえ」になる
    let steps = 0
    for (; steps < 60 && prevButton(container); steps += 1)
      fireEvent.click(prevButton(container) as HTMLElement)
    expect(steps).toBe(49)
    expect(panelLabel(container)).toBe('過去に伝えたこと　49件前')
    expect(shownMessage(container)).toBe('いいえ。')
  })

  it('介助者用メニューを開いている間は、背後の矢印を押しても動かない', () => {
    const { container } = render(() => <App />)
    sendMessages(container, ['はい', 'いいえ'])
    openCaregiverMenu(container)
    fireEvent.click(prevButton(container) as HTMLElement)
    expect(panelLabel(container)).toBe(LATEST)
    closeCaregiverMenu(container)
    fireEvent.click(prevButton(container) as HTMLElement)
    expect(panelLabel(container)).toBe('過去に伝えたこと　1件前')
  })

  it('矢印はスキャン対象ではない(タイルに入らない)。矢印を押したあとのスイッチは、カーソルのある項目を実行する', () => {
    const { container } = render(() => <App />)
    // 3 件伝えると、1 件前を表示しても「前」が残る(フォーカスが残った状態を作れる)
    sendMessages(container, ['はい', 'いいえ', 'はい'])
    expect(tileLabels(container)).not.toContain('前の伝達を表示')
    const prev = prevButton(container) as HTMLElement
    prev.focus()
    fireEvent.click(prev)
    expect(panelLabel(container)).toBe('過去に伝えたこと　1件前')

    // カーソルが「はい」に来たらスイッチ(Space)。フォーカスが矢印に残っていても矢印は押されない
    vi.advanceTimersByTime(600)
    for (let i = 0; i < 400 && scanningLabel(container) !== 'はい'; i += 1)
      vi.advanceTimersByTime(100)
    fireEvent.keyDown(prev, { key: ' ' })
    fireEvent.keyUp(prev, { key: ' ' })
    expect(panelLabel(container)).toBe(LATEST)
    expect(shownMessage(container)).toBe('はい。')
  })

  it('押した矢印が消えたあと(#129)も、次のスイッチはカーソルのある項目を実行する', () => {
    const { container } = render(() => <App />)
    sendMessages(container, ['はい', 'いいえ'])
    const prev = prevButton(container) as HTMLElement
    prev.focus()
    fireEvent.click(prev)
    expect(prev.isConnected).toBe(false)
    vi.advanceTimersByTime(600)
    for (let i = 0; i < 400 && scanningLabel(container) !== 'はい'; i += 1)
      vi.advanceTimersByTime(100)
    fireEvent.keyDown(document.activeElement ?? window, { key: ' ' })
    fireEvent.keyUp(document.activeElement ?? window, { key: ' ' })
    expect(panelLabel(container)).toBe(LATEST)
    expect(shownMessage(container)).toBe('はい。')
  })

  it('履歴は保存しない: 再読み込みすると矢印も過去の伝達も残らない', () => {
    const first = render(() => <App />)
    sendMessages(first.container, ['はい', 'いいえ'])
    first.unmount()
    cleanup()
    const second = render(() => <App />)
    expect(prevButton(second.container)).toBeNull()
    expect(shownMessage(second.container)).toBeNull()
  })

  it('緊急中の伝達も履歴に入り、介助者が緊急を解除したあとも振り返れる', () => {
    const { container } = render(() => <App />)
    tap(container, 'はい')
    tap(container, '緊急')
    tap(container, '戻る')
    tap(container, 'いいえ') // 緊急中の伝達
    openCaregiverMenu(container)
    ;(container.querySelector('.caregiver-emergency-clear') as HTMLElement).click()
    closeCaregiverMenu(container)
    // 介助者の解除で最新は空。履歴(はい・いいえ)は残る
    expect(shownMessage(container)).toBeNull()
    expect(noneText(container)).toBe('まだ伝えたことはありません。')
    fireEvent.click(prevButton(container) as HTMLElement)
    expect(shownMessage(container)).toBe('いいえ。')
    expect(panelLabel(container)).toBe('過去に伝えたこと　1件前')
  })
})

describe('Issue #135: 背景色は表示中の内容が持つ色で決める', () => {
  beforeEach(setupApp)
  afterEach(teardownApp)

  /** 伝達欄の色調(globals.css は :root[data-message-tone='urgent'] のときだけ赤にする) */
  const tone = () => document.documentElement.dataset.messageTone
  /** 赤い内容「胸がとても痛いです。」を伝える */
  const sendRed = (c: HTMLElement) => {
    for (const label of ['不快', '痛い', '胸', 'とても']) tap(c, label)
    expect(shownMessage(c)).toBe('胸がとても痛いです。')
  }
  const click = (button: HTMLElement | null) => fireEvent.click(button as HTMLElement)

  it('赤 → 通常の順に伝え、矢印で往復すると赤は赤・通常は通常のまま', () => {
    const { container } = render(() => <App />)
    sendRed(container)
    expect(tone()).toBe('urgent')
    tap(container, 'はい')
    expect(tone()).toBe('neutral')
    for (let i = 0; i < 2; i += 1) {
      click(prevButton(container))
      expect(shownMessage(container)).toBe('胸がとても痛いです。')
      expect(tone()).toBe('urgent')
      click(nextButton(container))
      expect(shownMessage(container)).toBe('はい。')
      expect(tone()).toBe('neutral')
    }
  })

  it('通常 → 赤の順に伝え、矢印で往復すると通常は通常・赤は赤のまま', () => {
    const { container } = render(() => <App />)
    tap(container, 'はい')
    sendRed(container)
    for (let i = 0; i < 2; i += 1) {
      click(prevButton(container))
      expect(shownMessage(container)).toBe('はい。')
      expect(tone()).toBe('neutral')
      click(nextButton(container))
      expect(tone()).toBe('urgent')
    }
  })

  it('緊急解除の後の履歴: 解除文は通常、緊急の呼び出し・詳細は赤、緊急中の通常の伝達は通常', () => {
    const { container } = render(() => <App />)
    tap(container, '緊急')
    tap(container, '戻る')
    tap(container, 'はい')
    tap(container, '緊急')
    tap(container, '苦しい')
    tap(container, '緊急')
    tap(container, '緊急を解除')
    tap(container, '解除する')
    const seen: [string | null, string | undefined][] = [[shownMessage(container), tone()]]
    while (prevButton(container)) {
      click(prevButton(container))
      seen.push([shownMessage(container), tone()])
    }
    expect(seen).toEqual([
      ['緊急（苦しい）を解除しました。', 'neutral'],
      [`${EMERGENCY_MESSAGE}苦しい`, 'urgent'],
      ['はい。', 'neutral'],
      [EMERGENCY_MESSAGE, 'urgent'],
    ])
    // 戻りの方向でも同じ
    while (nextButton(container)) {
      click(nextButton(container))
      seen.pop()
      expect([shownMessage(container), tone()]).toEqual(seen.at(-1))
    }
  })

  it('介助者が緊急を解除して最新が空のときは通常の色。矢印で赤い過去を出すと赤', () => {
    const { container } = render(() => <App />)
    sendRed(container)
    tap(container, 'はい')
    tap(container, '緊急')
    openCaregiverMenu(container)
    ;(container.querySelector('.caregiver-emergency-clear') as HTMLElement).click()
    closeCaregiverMenu(container)
    expect(noneText(container)).toBe('まだ伝えたことはありません。')
    expect(tone()).toBe('neutral')
    // 緊急の呼び出し(赤) → はい(通常) → 赤の伝達(赤)
    for (const [text, expected] of [
      [EMERGENCY_MESSAGE, 'urgent'],
      ['はい。', 'neutral'],
      ['胸がとても痛いです。', 'urgent'],
    ]) {
      click(prevButton(container))
      expect(shownMessage(container)).toBe(text)
      expect(tone()).toBe(expected)
    }
    while (nextButton(container)) click(nextButton(container))
    expect(noneText(container)).toBe('まだ伝えたことはありません。')
    expect(tone()).toBe('neutral')
  })

  it('緊急中に伝えた赤い内容は、再読み込みの後も赤', () => {
    const first = render(() => <App />)
    tap(first.container, '緊急')
    tap(first.container, '戻る')
    sendRed(first.container)
    first.unmount()
    cleanup()
    delete document.documentElement.dataset.messageTone
    const second = render(() => <App />)
    expect(shownMessage(second.container)).toBe('胸がとても痛いです。')
    expect(tone()).toBe('urgent')
  })
})

describe('Issue #123: もう一度', () => {
  beforeEach(() => {
    setupApp()
    setSettings({ voiceMode: 'full' })
  })
  afterEach(teardownApp)

  const repeatTile = (c: HTMLElement) => tile(c, 'もう一度')

  describe('伝えるものが無いとき', () => {
    it('起動直後: 項目は常設で 2 番目、薄く表示(tile-unavailable)・aria-disabled', () => {
      const { container } = render(() => <App />)
      expect(tileLabels(container).slice(0, 4)).toEqual(['緊急', 'もう一度', 'はい', 'いいえ'])
      expect(repeatTile(container).classList.contains('tile-unavailable')).toBe(true)
      expect(repeatTile(container).getAttribute('aria-disabled')).toBe('true')
    })

    it('起動直後に選んでも何も伝えない(伝達パターンの振動・読み上げ・伝達欄の変化なし)', () => {
      const { container } = render(() => <App />)
      clearDeviceCalls()
      tap(container, 'もう一度')
      expect(spoken()).toEqual([])
      for (const event of ['message', 'yes', 'no', 'emergency'] as const) {
        expect(vibrations()).not.toContainEqual(HAPTIC_PATTERNS[event])
      }
      expect(shownMessage(container)).toBeNull()
      expect(noneText(container)).toBe('まだ伝えたことはありません。')
      expect(container.querySelectorAll('.history-nav')).toHaveLength(0)
      expect(isHome(container)).toBe(true)
    })

    it('押せない「もう一度」では、受け付けの軽い振動も出さない(受け付けたと誤解させない)', () => {
      const { container } = render(() => <App />)
      clearDeviceCalls()
      tap(container, 'もう一度')
      expect(vibrations()).not.toContainEqual(HAPTIC_PATTERNS.accepted)
      // 押せるようになれば受け付けの振動は出る
      tap(container, 'はい')
      clearDeviceCalls()
      tap(container, 'もう一度')
      expect(vibrations()).toContainEqual(HAPTIC_PATTERNS.accepted)
    })

    it('介助者が緊急を解除したあとも、何も伝えない', () => {
      const { container } = render(() => <App />)
      tap(container, '緊急')
      openCaregiverMenu(container)
      ;(container.querySelector('.caregiver-emergency-clear') as HTMLElement).click()
      closeCaregiverMenu(container)
      expect(repeatTile(container).classList.contains('tile-unavailable')).toBe(true)
      clearDeviceCalls()
      tap(container, 'もう一度')
      expect(spoken()).toEqual([])
      expect(vibrations()).not.toContainEqual(HAPTIC_PATTERNS.emergency)
    })
  })

  describe('直前の伝達があるとき', () => {
    it.each([
      ['はい', 'はい。', 'yes'],
      ['いいえ', 'いいえ。', 'no'],
    ] as const)('「%s」のあと: 同じ振動パターンと読み上げを出し直す', (label, text, event) => {
      const { container } = render(() => <App />)
      tap(container, label)
      expect(repeatTile(container).classList.contains('tile-unavailable')).toBe(false)
      expect(repeatTile(container).getAttribute('aria-disabled')).toBeNull()
      clearDeviceCalls()
      tap(container, 'もう一度')
      expect(lastVibration()).toEqual(HAPTIC_PATTERNS[event])
      expect(spoken()).toEqual([text])
      expect(shownMessage(container)).toBe(text)
      expect(panelLabel(container)).toBe('直前に伝えたこと　もう一度')
      expect(isHome(container)).toBe(true)
    })

    it('フレーズ(通常の伝達)のあとは、通常の伝達の振動を出し直す', () => {
      const { container } = render(() => <App />)
      tap(container, '快')
      tap(container, '続けて')
      const text = shownMessage(container)
      expect(text).toBeTruthy()
      clearDeviceCalls()
      tap(container, 'もう一度')
      expect(lastVibration()).toEqual(HAPTIC_PATTERNS.message)
      expect(spoken()).toEqual([text])
    })

    it('押すたびに点滅のクラスが a / b と入れ替わる(同じアニメーションを再生し直す)', () => {
      const { container } = render(() => <App />)
      tap(container, 'はい')
      const panel = () => messagePanel(container).classList
      expect(panel().contains('repeat-pulse-a') || panel().contains('repeat-pulse-b')).toBe(false)
      tap(container, 'もう一度')
      expect(panel().contains('repeat-pulse-a')).toBe(true)
      tap(container, 'もう一度')
      expect(panel().contains('repeat-pulse-b')).toBe(true)
      expect(panel().contains('repeat-pulse-a')).toBe(false)
      // 緊急の帯は点滅させない(緊急中でない)
      expect(emergencyBand(container)).toBeNull()
    })

    it('次の伝達で見出しが「直前に伝えたこと」に戻り、点滅も消える', () => {
      const { container } = render(() => <App />)
      tap(container, 'はい')
      tap(container, 'もう一度')
      tap(container, 'いいえ')
      expect(panelLabel(container)).toBe(LATEST)
      expect(messagePanel(container).classList.contains('repeat-pulse-a')).toBe(false)
      expect(messagePanel(container).classList.contains('repeat-pulse-b')).toBe(false)
    })

    it('新しい伝達ではない: 履歴は増えない(2 件のまま、2 件前は無い)', () => {
      const { container } = render(() => <App />)
      sendMessages(container, ['はい', 'いいえ'])
      tap(container, 'もう一度')
      tap(container, 'もう一度')
      fireEvent.click(prevButton(container) as HTMLElement)
      expect(shownMessage(container)).toBe('はい。')
      expect(prevButton(container)).toBeNull()
    })
  })

  describe('緊急中', () => {
    it('伝達が無ければ、緊急の呼び出し(振動・読み上げ)を出し直し、緊急の帯を点滅させる', () => {
      const { container } = render(() => <App />)
      tap(container, '緊急')
      tap(container, '戻る')
      expect(repeatTile(container).classList.contains('tile-unavailable')).toBe(false)
      clearDeviceCalls()
      tap(container, 'もう一度')
      expect(vibrations()).toContainEqual(HAPTIC_PATTERNS.emergency)
      expect(spoken()).toEqual([EMERGENCY_MESSAGE])
      expect(emergencyBand(container)?.classList.contains('repeat-pulse-a')).toBe(true)
      expect(messagePanel(container).classList.contains('repeat-pulse-a')).toBe(false)
      tap(container, 'もう一度')
      expect(emergencyBand(container)?.classList.contains('repeat-pulse-b')).toBe(true)
      expect(isEmergency(container)).toBe(true)
    })

    it('選んだ詳細があれば、詳細も続けて読み上げる', () => {
      const { container } = render(() => <App />)
      tap(container, '緊急')
      tap(container, '苦しい')
      tap(container, '緊急')
      tap(container, '痛い')
      clearDeviceCalls()
      tap(container, 'もう一度')
      expect(spoken()).toEqual([`${EMERGENCY_MESSAGE}苦しい、痛い`])
    })

    it('緊急中に伝達があれば、緊急の呼び出しではなく直前の伝達を出し直す', () => {
      const { container } = render(() => <App />)
      tap(container, '緊急')
      tap(container, '戻る')
      tap(container, 'はい')
      clearDeviceCalls()
      tap(container, 'もう一度')
      expect(lastVibration()).toEqual(HAPTIC_PATTERNS.yes)
      expect(vibrations()).not.toContainEqual(HAPTIC_PATTERNS.emergency)
      expect(spoken()).toEqual(['はい。'])
      expect(emergencyBand(container)?.classList.contains('repeat-pulse-a')).toBe(false)
      expect(messagePanel(container).classList.contains('repeat-pulse-a')).toBe(true)
    })

    it('もう一度では緊急は解除されない', () => {
      const { container } = render(() => <App />)
      tap(container, '緊急')
      tap(container, '戻る')
      tap(container, 'もう一度')
      tap(container, 'もう一度')
      expect(isEmergency(container)).toBe(true)
      expect(window.localStorage.getItem('libra:emergency')).not.toBeNull()
    })
  })

  it('スイッチ(キー)だけでも選べる(2 番目なので先頭の緊急の次に来る)', () => {
    const { container } = render(() => <App />)
    tap(container, 'はい')
    clearDeviceCalls()
    vi.advanceTimersByTime(600)
    for (let i = 0; i < 400 && scanningLabel(container) !== 'もう一度'; i += 1)
      vi.advanceTimersByTime(100)
    pressSwitch()
    expect(spoken()).toEqual(['はい。'])
    expect(panelLabel(container)).toBe('直前に伝えたこと　もう一度')
  })
})
