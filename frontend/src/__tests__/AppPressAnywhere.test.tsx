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
      expect(historyButton(container, '次').disabled).toBe(true)
      press(historyButton(container, '次'))
      expect(isEmergency(container)).toBe(false)
      press(historyButton(container, '前').querySelector('path') as Element)
      expect(panelLabel(container)).toBe('過去に伝えたこと（1件前）')
      expect(isEmergency(container)).toBe(false)
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
