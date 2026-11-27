// Issue #134: パネル・ボタン・矢印・パンくずのリンク以外を押すと、黄色のパネルを選ぶ。
//
// デシジョンテーブル(押した場所・状態 → 起きること。1回の押下で操作は1つ):
//   場所                              | 状態                 | 起きること
//   背景・伝達欄・案内欄・空きマス等    | 通常                 | 黄色のパネル
//   パネル(中の要素を含む)            | 通常                 | 押したパネルだけ
//   介助者用ボタン・矢印(押せない側も)| 通常                 | そのボタンの操作だけ
//   パンくずの祖先(中のアイコンを含む)| 通常                 | その画面へ移動するだけ
//   パンくずの現在地(リンクでない)    | 通常                 | 黄色のパネル
//   背景                              | 主ボタン以外         | 何も起きない
//   背景の click だけ(押下なし)       | 通常                 | 何も起きない
//   背景                              | 下限・離して決定・連打| キーと同じ判定(押し始めの黄色)
//   どこでも                          | 介助者用メニュー表示中 | 黄色は選ばない。閉じた押下の click は背後へ届かない
//   背景の押下に続く click が別のボタンへ | 通常             | そのボタンは動かない
//   背景                              | モールス             | 符号
//   背景(別の指などが触れたまま)      | 通常・モールス       | 何もしない(全部離れた次の接触は効く)
//   パネル(背景の押下中)              | 通常                 | 何もしない
//   click の pointerId が違う          | 同じ位置・直後       | 同じ押下の続きとみなす(別のボタン・パネルは動かない)
//   click の出なかった押下の記録       | pointerId の無い環境 | 次の click を止めない
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import {
  breadcrumb,
  isEmergency,
  menuOpen,
  openCaregiverMenu,
  panelLabel,
  pointerClick,
  scanningLabel,
  setSettings,
  setupApp,
  shownMessage,
  tap,
  teardownApp,
  tile,
  vibrations,
} from './appTestKit'

const HINT = 'ボタン以外を押すと、黄色を選びます'
const MORSE_HINT = 'ボタン以外を押すと、符号を入力します'
const HEAD_HOLD_MS = 2000
const INTERVAL_MS = 1500

const $ = (c: HTMLElement, selector: string): Element => {
  const found = c.querySelector(selector)
  expect(found, selector).not.toBeNull()
  return found as Element
}

/** 黄色が「はい」に来るまで待つ(ホーム) */
function scanToYes(c: HTMLElement) {
  vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS)
  expect(scanningLabel(c)).toBe('はい')
}

/** 実ブラウザの 1 回の押下: pointerdown → pointerup → click(同じ pointerId) */
function press(el: Element, pointerId = 1) {
  fireEvent.pointerDown(el, { pointerId })
  const releasedOn = el.isConnected ? el : document.body
  fireEvent.pointerUp(releasedOn, { pointerId })
  pointerClick(releasedOn, pointerId)
}

const historyButton = (c: HTMLElement, name: '前' | '次') =>
  $(c, `.history-nav[aria-label="${name}の伝達を表示"]`) as HTMLButtonElement

describe('Issue #134: ボタン以外を押すと黄色のパネルを選ぶ', () => {
  beforeEach(setupApp)
  afterEach(teardownApp)

  describe('どこを押しても黄色を 1 回だけ選ぶ', () => {
    it.each([
      ['画面の外枠', '.app-shell'],
      ['格子の隙間(盤そのもの)', '.grid-board'],
      ['空きマス', '.tile-empty'],
      ['伝達欄(空のとき)', '.message-panel'],
      ['案内欄', '.screen-guide'],
      ['指示文', '.screen-guide h2'],
      ['押し方の案内', '.screen-guide-hint'],
      ['パンくずの現在地(リンクでない)', '.screen-breadcrumb li'],
    ])('%s', (_name, selector) => {
      // ホームの空きマスはモールス使用の 9 項目のときだけある(Issue #127)
      if (selector === '.tile-empty') setSettings({ morseEnabled: true })
      const { container } = render(() => <App />)
      scanToYes(container)
      const before = vibrations().length
      press($(container, selector))
      expect(shownMessage(container)).toBe('はい。')
      // 受理の振動と、はいの振動の 2 回だけ(二重実行していない)
      expect(vibrations().length - before).toBe(2)
    })

    it('document.body', () => {
      const { container } = render(() => <App />)
      scanToYes(container)
      press(document.body)
      expect(shownMessage(container)).toBe('はい。')
    })

    it('伝達があるときの伝達欄の文字と、矢印の無い場所', () => {
      const { container } = render(() => <App />)
      tap(container, 'いいえ')
      scanToYes(container)
      press($(container, '.message-panel h1'))
      expect(shownMessage(container)).toBe('はい。')
    })

    it('緊急の帯', () => {
      const { container } = render(() => <App />)
      tap(container, '緊急')
      tap(container, '戻る')
      scanToYes(container)
      press($(container, '.emergency-status-message'))
      expect(shownMessage(container)).toBe('はい。')
      expect(isEmergency(container)).toBe(true)
    })

    it('好きな画像', () => {
      window.localStorage.setItem('libra:photo', 'data:image/png;base64,iVBORw0KGgo=')
      const { container } = render(() => <App />)
      scanToYes(container)
      press($(container, '.guide-photo'))
      expect(shownMessage(container)).toBe('はい。')
    })
  })

  describe('パネル・ボタンはそれ自身の操作だけ', () => {
    it('パネル(中のラベル)を押すと、黄色ではなく押したパネルだけを実行する', () => {
      const { container } = render(() => <App />)
      scanToYes(container)
      const before = vibrations().length
      press(tile(container, 'いいえ').querySelector('.tile-label') as Element)
      expect(shownMessage(container)).toBe('いいえ。')
      expect(vibrations().length - before).toBe(2)
    })

    it('パネルのアイコン(SVG)を押しても、押したパネルだけ', () => {
      const { container } = render(() => <App />)
      scanToYes(container)
      press($(tile(container, 'いいえ') as HTMLElement, 'svg.tile-icon'))
      expect(shownMessage(container)).toBe('いいえ。')
    })

    it('介助者用ボタンはメニューを開くだけ。黄色(緊急)は選ばない', () => {
      const { container } = render(() => <App />)
      expect(scanningLabel(container)).toBe('緊急')
      press($(container, '.caregiver-button'))
      expect(menuOpen(container)).toBe(true)
      expect(isEmergency(container)).toBe(false)
    })

    it('矢印は伝達を振り返るだけ。押せない側の矢印でも黄色は選ばない', () => {
      const { container } = render(() => <App />)
      tap(container, 'はい')
      tap(container, 'いいえ')
      vi.advanceTimersByTime(600)
      expect(scanningLabel(container)).toBe('緊急')
      // #129: 押せない側の矢印は出さない。反対側が出ている間、その場所は押しても何も起きない
      expect(container.querySelector('.history-nav[aria-label="次の伝達を表示"]')).toBeNull()
      expect(container.querySelectorAll('.history-gap')).toHaveLength(1)
      press($(container, '.history-gap'))
      expect(isEmergency(container)).toBe(false)
      press(historyButton(container, '前').querySelector('path') as Element)
      expect(panelLabel(container)).toBe('1件前に伝えたこと')
      expect(isEmergency(container)).toBe(false)
      // 押した矢印が消えた場所を続けて押しても、黄色(緊急)は選ばない
      expect(container.querySelector('.history-nav[aria-label="前の伝達を表示"]')).toBeNull()
      vi.advanceTimersByTime(600)
      press($(container, '.history-gap'))
      expect(isEmergency(container)).toBe(false)
      expect(panelLabel(container)).toBe('1件前に伝えたこと')
    })

    it('戻れる伝達が無いときの矢印の場所は背景で、黄色を選ぶ', () => {
      const { container } = render(() => <App />)
      scanToYes(container)
      expect(container.querySelector('.history-gap')).toBeNull()
      press($(container, '.history-slot'))
      expect(shownMessage(container)).toBe('はい。')
    })

    it('パンくずのリンク(家アイコン)はその画面へ移るだけ。黄色(戻る以外)は選ばない', () => {
      const { container } = render(() => <App />)
      tap(container, '不快')
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      expect(scanningLabel(container)).toBe('緊急')
      press($(container, '.breadcrumb-link svg path'))
      expect(breadcrumb(container)).toEqual(['ホーム'])
      expect(isEmergency(container)).toBe(false)
    })
  })

  describe('押下の判定はキーと同じ', () => {
    it.each([1, 2, 5])('主ボタン以外(button=%i)では何も起きない', (button) => {
      const { container } = render(() => <App />)
      scanToYes(container)
      fireEvent.pointerDown($(container, '.grid-board'), { pointerId: 1, button })
      fireEvent.pointerUp(window, { pointerId: 1, button })
      expect(shownMessage(container)).toBeNull()
    })

    it('背景の click だけ(押下なし)では何も起きない', () => {
      const { container } = render(() => <App />)
      scanToYes(container)
      fireEvent.click($(container, '.grid-board'))
      expect(shownMessage(container)).toBeNull()
    })

    it('下限: 下限未満の押下は選ばない', () => {
      setSettings({ minHoldMs: 500 })
      const { container } = render(() => <App />)
      scanToYes(container)
      const target = $(container, '.grid-board')
      fireEvent.pointerDown(target, { pointerId: 1 })
      vi.advanceTimersByTime(499)
      fireEvent.pointerUp(target, { pointerId: 1 })
      vi.advanceTimersByTime(1000)
      expect(shownMessage(container)).toBeNull()
    })

    it('下限: 押している間に黄色が進んでも、押し始めの黄色を選ぶ。進捗も出る', () => {
      setSettings({ minHoldMs: 2000 })
      const { container } = render(() => <App />)
      scanToYes(container)
      fireEvent.pointerDown($(container, '.grid-board'), { pointerId: 1 })
      vi.advanceTimersByTime(100)
      expect(container.querySelector('.hold-progress')).not.toBeNull()
      vi.advanceTimersByTime(1800)
      expect(scanningLabel(container)).not.toBe('はい')
      expect(shownMessage(container)).toBeNull()
      vi.advanceTimersByTime(100)
      expect(shownMessage(container)).toBe('はい。')
    })

    it('離して決定: 離すまで選ばず、離したら押し始めの黄色を選ぶ。続く click で重ねて実行しない', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      scanToYes(container)
      const target = $(container, '.grid-board')
      fireEvent.pointerDown(target, { pointerId: 1 })
      vi.advanceTimersByTime(INTERVAL_MS)
      expect(scanningLabel(container)).not.toBe('はい')
      expect(shownMessage(container)).toBeNull()
      const before = vibrations().length
      fireEvent.pointerUp(target, { pointerId: 1 })
      pointerClick(target, 1)
      expect(shownMessage(container)).toBe('はい。')
      expect(vibrations().length - before).toBe(2)
    })

    it('取り消された押下(pointercancel)は選ばない', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      scanToYes(container)
      fireEvent.pointerDown($(container, '.grid-board'), { pointerId: 1 })
      fireEvent.pointerCancel(window, { pointerId: 1 })
      fireEvent.pointerUp(window, { pointerId: 1 })
      expect(shownMessage(container)).toBeNull()
    })

    it('連打無視: 直後の 2 回目は数えず、過ぎれば数える', () => {
      const { container } = render(() => <App />)
      scanToYes(container)
      press($(container, '.grid-board'), 1)
      expect(shownMessage(container)).toBe('はい。')
      press($(container, '.grid-board'), 2) // 黄色は緊急。連打無視で実行されない
      expect(isEmergency(container)).toBe(false)
      vi.advanceTimersByTime(600)
      press($(container, '.grid-board'), 3)
      expect(isEmergency(container)).toBe(true)
    })
  })

  describe('介助者用メニュー', () => {
    it('表示中は、パネル内を押しても黄色を選ばず、メニューも閉じない', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      press($(container, '.caregiver-panel'))
      expect(menuOpen(container)).toBe(true)
      expect(isEmergency(container)).toBe(false)
    })

    it('外側を押して閉じた押下は黄色を選ばず、続く click は背後のパネル・ボタンへ届かない', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      const overlay = $(container, '.caregiver-overlay')
      fireEvent.pointerDown(overlay, { pointerId: 1 })
      fireEvent.pointerUp(document.body, { pointerId: 1 })
      expect(menuOpen(container)).toBe(false)
      expect(isEmergency(container)).toBe(false) // 黄色(緊急)を選んでいない
      pointerClick($(container, '.caregiver-button'), 1)
      expect(menuOpen(container)).toBe(false)
      expect(isEmergency(container)).toBe(false)
    })

    it('「閉じる」の押下は閉じるだけ。黄色は選ばない', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      press($(container, '.caregiver-close'))
      expect(menuOpen(container)).toBe(false)
      expect(isEmergency(container)).toBe(false)
    })

    it('背景を押したままメニューを開くと、その押下は取り消される(離して決定)', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      fireEvent.pointerDown($(container, '.grid-board'), { pointerId: 1 })
      openCaregiverMenu(container)
      fireEvent.pointerUp(window, { pointerId: 1 })
      expect(isEmergency(container)).toBe(false)
    })
  })

  describe('背景の押下で画面が変わっても、同じ押下の click は別のボタンを動かさない', () => {
    /** 背景を押して黄色(不快)を選ぶと下位画面になる */
    function openDiscomfortByBackground(c: HTMLElement) {
      for (let i = 0; i < 400 && scanningLabel(c) !== '不快'; i += 1) vi.advanceTimersByTime(100)
      fireEvent.pointerDown($(c, '.grid-board'), { pointerId: 1 })
      expect(breadcrumb(c)).toEqual(['ホーム', '不快'])
      fireEvent.pointerUp(document.body, { pointerId: 1 })
    }

    it('現れたパンくずのリンクへ届く click は無視し、次の押下の click は効く', () => {
      const { container } = render(() => <App />)
      openDiscomfortByBackground(container)
      pointerClick($(container, '.breadcrumb-link'), 1)
      expect(breadcrumb(container)).toEqual(['ホーム', '不快'])
      press($(container, '.breadcrumb-link'), 1)
      expect(breadcrumb(container)).toEqual(['ホーム'])
    })

    it('pointerId の無い click(古い環境)も同じく無視する', () => {
      const { container } = render(() => <App />)
      openDiscomfortByBackground(container)
      fireEvent.click($(container, '.breadcrumb-link'))
      expect(breadcrumb(container)).toEqual(['ホーム', '不快'])
    })

    it('介助者用ボタンへ届く click ではメニューが開かない', () => {
      const { container } = render(() => <App />)
      openDiscomfortByBackground(container)
      pointerClick($(container, '.caregiver-button'), 1)
      expect(menuOpen(container)).toBe(false)
    })

    it('指の下のボタンにフォーカスが移っていたら外し、続くキーは黄色を選ぶ', () => {
      const { container } = render(() => <App />)
      openDiscomfortByBackground(container)
      const link = $(container, '.breadcrumb-link') as HTMLButtonElement
      link.focus()
      pointerClick(link, 1)
      expect(document.activeElement).not.toBe(link)
    })

    it('離したあとに現れた矢印へ届く click では、伝達を振り返らない', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      // 矢印は伝達が 2 件になって初めて現れる
      for (const [i, label] of ['はい', 'いいえ'].entries()) {
        vi.advanceTimersByTime(600)
        for (let t = 0; t < 400 && scanningLabel(container) !== label; t += 1)
          vi.advanceTimersByTime(100)
        fireEvent.pointerDown($(container, '.grid-board'), { pointerId: i + 1 })
        fireEvent.pointerUp(document.body, { pointerId: i + 1 })
        if (i === 0) pointerClick(document.body, 1)
      }
      pointerClick(historyButton(container, '前'), 2)
      expect(panelLabel(container)).toBe('直前に伝えたこと')
      expect(shownMessage(container)).toBe('いいえ。')
    })
  })

  describe('モールス', () => {
    function enterMorse() {
      setSettings({ morseEnabled: true })
      const view = render(() => <App />)
      press(tile(view.container, 'モールス'))
      expect(view.container.querySelector('.morse-panel')).not.toBeNull()
      return view
    }
    function symbol(target: Element, heldMs: number, pointerId: number) {
      fireEvent.pointerDown(target, { pointerId })
      vi.advanceTimersByTime(heldMs)
      fireEvent.pointerUp(target, { pointerId })
      pointerClick(target, pointerId)
      vi.advanceTimersByTime(100)
    }

    it('背景の短押しは短点、長押しは長点になる', () => {
      const { container } = enterMorse()
      const panel = $(container, '.morse-panel')
      symbol(panel, 100, 2)
      symbol(panel, 700, 3)
      expect($(container, '.morse-code').textContent?.trim()).toBe('・ －')
    })

    it('背景だけで SOS を打つと緊急になる', () => {
      const { container } = enterMorse()
      const panel = $(container, '.morse-panel')
      ;[100, 100, 100, 700, 700, 700, 100, 100, 100].forEach((ms, i) => symbol(panel, ms, i + 2))
      expect(isEmergency(container)).toBe(true)
    })

    it('介助者用ボタンの押下は符号にならない', () => {
      const { container } = enterMorse()
      symbol($(container, '.caregiver-button'), 100, 2)
      expect(menuOpen(container)).toBe(true)
      expect($(container, '.morse-code').textContent?.trim()).toBe('')
    })
  })

  describe('複数の指が同時に触れても、操作は 1 つ', () => {
    const finger = (pointerId: number, isPrimary = false) => ({
      pointerId,
      pointerType: 'touch',
      isPrimary,
    })
    /** 下限の 0.1 秒を過ぎてから次の指が着くまでの時間。同時刻だと連打無視が防ぎ、接触の対策を検査できない */
    const LATER_MS = 150
    const later = () => vi.advanceTimersByTime(LATER_MS)
    /** 連打無視を下限にして、黄色を「はい」にする */
    function renderMinDebounce(extra: object = {}) {
      setSettings({ debounceMs: 100, ...extra })
      const view = render(() => <App />)
      scanToYes(view.container)
      return view
    }
    const board = (c: HTMLElement) => $(c, '.grid-board')
    const guide = (c: HTMLElement) => $(c, '.screen-guide h2')

    it.each([2, 3, 5])('背景に %i 本: 黄色の「はい」だけ。続けて緊急を選ばない', (count) => {
      const { container } = renderMinDebounce()
      const before = vibrations().length
      for (let i = 1; i <= count; i += 1) {
        if (i > 1) later()
        fireEvent.pointerDown(i % 2 ? board(container) : guide(container), finger(i, i === 1))
      }
      for (let i = 1; i <= count; i += 1) fireEvent.pointerUp(document.body, finger(i, i === 1))
      expect(shownMessage(container)).toBe('はい。')
      expect(isEmergency(container)).toBe(false)
      expect(vibrations().length - before).toBe(2)
    })

    it('黄色が「不快」: 2 本触れても、開いた画面の「戻る」を続けて選ばない', () => {
      setSettings({ debounceMs: 100 })
      const { container } = render(() => <App />)
      for (let i = 0; i < 400 && scanningLabel(container) !== '不快'; i += 1)
        vi.advanceTimersByTime(100)
      fireEvent.pointerDown(board(container), finger(1, true))
      later()
      fireEvent.pointerDown(guide(container), finger(2))
      expect(breadcrumb(container)).toEqual(['ホーム', '不快'])
    })

    it('離して決定: 2 本目を離しても、1 本目を離しても、決定は 1 本目の 1 回だけ', () => {
      const { container } = renderMinDebounce({ activateOn: 'release' })
      const before = vibrations().length
      fireEvent.pointerDown(board(container), finger(1, true))
      later()
      fireEvent.pointerDown(guide(container), finger(2))
      fireEvent.pointerUp(document.body, finger(2))
      expect(shownMessage(container)).toBeNull()
      fireEvent.pointerUp(document.body, finger(1, true))
      expect(shownMessage(container)).toBe('はい。')
      expect(isEmergency(container)).toBe(false)
      expect(vibrations().length - before).toBe(2)
    })

    it('1 本目を離しても、残った指がある間は次の背景の接触を数えない。全部離れれば効く', () => {
      const { container } = renderMinDebounce()
      fireEvent.pointerDown(board(container), finger(1, true))
      later()
      fireEvent.pointerDown(guide(container), finger(2))
      fireEvent.pointerUp(document.body, finger(1, true))
      later()
      fireEvent.pointerDown(board(container), finger(3))
      expect(isEmergency(container)).toBe(false)
      fireEvent.pointerUp(document.body, finger(3))
      fireEvent.pointerUp(document.body, finger(2))
      later()
      fireEvent.pointerDown(board(container), finger(4, true))
      expect(isEmergency(container)).toBe(true)
    })

    it('下限付きの長押し中に着いた別の指は、背景もパネルも数えない', () => {
      const { container } = renderMinDebounce({ minHoldMs: 500 })
      const before = vibrations().length
      fireEvent.pointerDown(board(container), finger(1, true))
      later()
      fireEvent.pointerDown(guide(container), finger(2))
      fireEvent.pointerDown(tile(container, 'いいえ'), finger(3))
      vi.advanceTimersByTime(1000)
      fireEvent.pointerUp(document.body, finger(2))
      fireEvent.pointerUp(document.body, finger(3))
      fireEvent.pointerUp(document.body, finger(1, true))
      expect(shownMessage(container)).toBe('はい。')
      expect(isEmergency(container)).toBe(false)
      // 受理と「はい」の振動の 2 回だけ(同じ「はい」を重ねて実行していない)
      expect(vibrations().length - before).toBe(2)
    })

    it('背景の押下中に触れたパネルは実行しない。その click も実行しない', () => {
      const { container } = renderMinDebounce()
      fireEvent.pointerDown(board(container), finger(1, true))
      const no = tile(container, 'いいえ')
      later()
      fireEvent.pointerDown(no, finger(2))
      fireEvent.pointerUp(no, finger(2))
      pointerClick(no, 2)
      expect(shownMessage(container)).toBe('はい。')
    })

    it('パネルの押下中に触れた背景は黄色を選ばない', () => {
      const { container } = renderMinDebounce()
      fireEvent.pointerDown(tile(container, 'いいえ'), finger(1, true))
      later()
      fireEvent.pointerDown(guide(container), finger(2))
      expect(shownMessage(container)).toBe('いいえ。')
      expect(isEmergency(container)).toBe(false)
    })

    it('メニューを閉じた指が触れたままなら、別の指の背景は黄色(緊急)を選ばない', () => {
      setSettings({ debounceMs: 100 })
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      fireEvent.pointerDown($(container, '.caregiver-overlay'), finger(1, true))
      later()
      fireEvent.pointerDown(document.body, finger(2))
      expect(menuOpen(container)).toBe(false)
      expect(isEmergency(container)).toBe(false)
    })

    it('背景の押下中でも「介助者用」は開ける', () => {
      const { container } = renderMinDebounce({ activateOn: 'release' })
      fireEvent.pointerDown(board(container), finger(1, true))
      later()
      fireEvent.pointerDown($(container, '.caregiver-button'), finger(2))
      expect(menuOpen(container)).toBe(true)
    })

    it.each([
      ['同じ種類の最初の接触が始まる', () => {}, true],
      ['時間が経つ(10 秒超)', () => vi.advanceTimersByTime(10001), false],
      ['画面からフォーカスが外れる', () => fireEvent.blur(window), false],
      ['pointercancel', () => fireEvent.pointerCancel(window, { pointerId: 1 }), false],
    ])(
      '離した通知を取りこぼしても、背景は効かないままにならない: %s',
      (_name, recover, primary) => {
        const { container } = renderMinDebounce()
        // 主ボタンでない押下で、離さないままの接触だけを残す
        fireEvent.pointerDown(board(container), { ...finger(1, true), button: 2 })
        recover()
        for (let i = 0; i < 400 && scanningLabel(container) !== 'はい'; i += 1)
          vi.advanceTimersByTime(100)
        later()
        fireEvent.pointerDown(board(container), finger(7, primary))
        expect(shownMessage(container)).toBe('はい。')
      },
    )

    it('モールス: 2 本目の背景は符号にならない', () => {
      setSettings({ morseEnabled: true })
      const { container } = render(() => <App />)
      press(tile(container, 'モールス'))
      const panel = $(container, '.morse-panel')
      later()
      fireEvent.pointerDown(panel, finger(2, true))
      later()
      fireEvent.pointerDown(panel, finger(3))
      vi.advanceTimersByTime(100)
      fireEvent.pointerUp(panel, finger(3))
      fireEvent.pointerUp(panel, finger(2, true))
      expect($(container, '.morse-code').textContent?.trim()).toBe('・')
    })
  })

  describe('click の pointerId と、click の出ない押下', () => {
    const at = { clientX: 40, clientY: 50 }
    const clickAs = (el: Element, init: PointerEventInit) =>
      fireEvent(el, new PointerEvent('click', { bubbles: true, cancelable: true, ...init }))
    function backgroundToDiscomfort(c: HTMLElement) {
      for (let i = 0; i < 400 && scanningLabel(c) !== '不快'; i += 1) vi.advanceTimersByTime(100)
      fireEvent.pointerDown($(c, '.grid-board'), { pointerId: 1, ...at })
      fireEvent.pointerUp(document.body, { pointerId: 1, ...at })
      expect(breadcrumb(c)).toEqual(['ホーム', '不快'])
    }

    it('pointerId が違っても、直後・同じ位置の実際の click は現れたリンクを動かさない', () => {
      const { container } = render(() => <App />)
      backgroundToDiscomfort(container)
      clickAs($(container, '.breadcrumb-link'), { pointerId: 99, detail: 1, ...at })
      expect(breadcrumb(container)).toEqual(['ホーム', '不快'])
    })

    it('pointerId が違うパネルの click で、重ねて実行しない', () => {
      setSettings({ debounceMs: 100 })
      const { container } = render(() => <App />)
      const yes = tile(container, 'はい')
      fireEvent.pointerDown(yes, { pointerId: 1, ...at })
      fireEvent.pointerUp(document.body, { pointerId: 1, ...at })
      const before = vibrations().length
      vi.advanceTimersByTime(150) // 連打無視を過ぎても重ねて実行しない
      clickAs(tile(container, 'いいえ'), { pointerId: 99, detail: 1, ...at })
      expect(vibrations().length).toBe(before)
      expect(shownMessage(container)).toBe('はい。')
    })

    it.each([
      ['キー操作・プログラムの click(detail=0)', { detail: 0, ...at }, 0],
      ['離れた位置', { detail: 1, clientX: 200, clientY: 50 }, 0],
      ['時間が経った', { detail: 1, ...at }, 800],
    ])('同じ押下とみなさない click は止めない: %s', (_name, init, wait) => {
      const { container } = render(() => <App />)
      backgroundToDiscomfort(container)
      vi.advanceTimersByTime(wait)
      clickAs($(container, '.breadcrumb-link'), { pointerId: 99, ...init })
      expect(breadcrumb(container)).toEqual(['ホーム'])
    })

    it('pointerId の無い環境: click の出なかった押下の記録は、次の押下の click を止めない', () => {
      const { container } = render(() => <App />)
      tap(container, '不快')
      vi.advanceTimersByTime(600)
      // click が出ない背景のタップ(主ボタン以外なので何も選ばない)
      fireEvent.pointerDown($(container, '.screen-guide'), { pointerId: 5, button: 2 })
      fireEvent.pointerUp(document.body, { pointerId: 5, button: 2 })
      vi.advanceTimersByTime(100)
      const link = $(container, '.breadcrumb-link')
      fireEvent.pointerDown(link, { pointerId: 6 })
      fireEvent.pointerUp(link, { pointerId: 6 })
      fireEvent.click(link) // pointerId の無い click
      expect(breadcrumb(container)).toEqual(['ホーム'])
    })
  })

  describe('押し方の案内', () => {
    it('指示文の隣に常に出る。下位画面でも出て、モールスでは符号の案内になる。かっこは使わない', () => {
      setSettings({ morseEnabled: true })
      const { container } = render(() => <App />)
      const hint = () => $(container, '.screen-guide-hint').textContent
      expect(hint()).toBe(HINT)
      expect($(container, '.screen-guide-hint').previousElementSibling?.tagName).toBe('H2')
      tap(container, '不快')
      expect(hint()).toBe(HINT)
      press($(container, '.breadcrumb-link'), 5)
      vi.advanceTimersByTime(600)
      tap(container, 'モールス')
      expect(hint()).toBe(MORSE_HINT)
      for (const text of [HINT, MORSE_HINT]) expect(text).not.toMatch(/[()（）]/)
    })
  })
})
