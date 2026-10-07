// Issue #38: タイルの直接タップ/クリック(押したタイルを実行)・キー/外部スイッチ(スキャン対象を実行)・
// 背景タップ(何も実行しない)の入力経路を固定するテスト。
//
// デシジョンテーブル(入力 × メニュー × 入力モード × 画面 → 実行されるもの):
//   入力                 | 介助者メニュー | モード         | 画面            | 実行
//   タイル pointerdown   | 閉             | 即時           | 通常            | 押したタイル(スキャン位置は無関係)
//   タイル pointerdown   | 閉             | 長押し/離して  | 通常            | 押し始めのタイル(下限到達 / 離した時点)
//   タイル pointerdown   | 閉             | 長押し・画面変 | 通常            | 無視(別項目を実行しない)
//   タイル pointerdown   | 閉             | 連打           | 通常            | 2回目は無視(連打無視区間)
//   タイル pointerdown   | 閉             | -              | 緊急詳細        | 押したタイル(戻る/詳細)
//   タイル pointerdown   | 閉             | -              | モールス        | (タイル非表示。符号は押下の長さ。背景は無効)
//   タイル pointerdown   | 開             | -              | 通常            | 何も実行しない(メニューは閉じる)
//   タイル click 単独    | 閉             | -              | 通常            | 押したタイル(支援技術の合成 click)
//   タイル click 単独    | 開             | -              | 通常            | 何も実行しない
//   pointerdown→click    | 閉             | -              | 通常            | pointerdown の1回だけ(click は捨てる)
//   背景 pointerdown/click| 閉            | -              | 通常/緊急       | 何も実行しない
//   キー/外部スイッチ    | 閉             | 各モード       | 通常            | 現在のスキャン対象
//   キー                 | 開             | -              | 通常            | 何も実行しない(閉じる)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import * as offlineReadyModule from '../lib/offlineReady'

const HEAD_HOLD_MS = 3000
const INTERVAL_MS = 1500

class MockAudioContext {
  state: 'running' | 'suspended' = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  createOscillator() {
    return {
      type: '',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
  }
}

const EMERGENCY = '緊急です。来てください。'

function scanningLabel(container: HTMLElement): string | null {
  return container.querySelector('.tile.scanning .tile-label')?.textContent ?? null
}
function h1Text(container: HTMLElement): string | null {
  const emergency = container.querySelector('.emergency-status-message')
  if (emergency) return emergency.textContent
  return container.querySelector('h1')?.textContent ?? null
}
function tile(container: HTMLElement, label: string): HTMLElement {
  const found = Array.from(container.querySelectorAll<HTMLElement>('.grid-board .tile')).find(
    (el) => el.querySelector('.tile-label')?.textContent === label,
  )
  expect(found, `tile ${label}`).toBeTruthy()
  return found as HTMLElement
}
function screenLabel(container: HTMLElement): string {
  return container.querySelector('.grid-board')?.getAttribute('aria-label') ?? ''
}
// click に pointerId を載せる(本番の Chrome と同じ pointerId 一致経路)。fireEvent.click は pointerId が undefined
const pointerClick = (el: Element, pointerId: number) =>
  fireEvent(el, new PointerEvent('click', { pointerId, bubbles: true, cancelable: true }))
const setSettings = (value: object) => window.localStorage.setItem('libra', JSON.stringify(value))

describe('Issue #38: タイル直接選択', () => {
  let vibrate: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    window.localStorage.clear()
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = MockAudioContext
    vibrate = vi.fn()
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = vibrate
    ;(window as unknown as { speechSynthesis?: unknown }).speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
    }
    ;(globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance =
      class {
        lang = ''
        rate = 1
        pitch = 1
        constructor(public text: string) {}
      }
    vi.spyOn(offlineReadyModule, 'recheckOfflineReady').mockResolvedValue(undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  describe('タイルの pointerdown / click', () => {
    it('押したタイルが実行され、スキャン位置のタイルは実行されない', () => {
      const { container } = render(() => <App />)
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      expect(scanningLabel(container)).toBe('はい')
      fireEvent.pointerDown(tile(container, 'いいえ'), { pointerId: 1 })
      expect(h1Text(container)).toBe('いいえ。')
    })

    it('スキャン位置が先頭(緊急)でも、別タイルを押せば緊急は実行されない', () => {
      const { container } = render(() => <App />)
      expect(scanningLabel(container)).toBe('緊急')
      fireEvent.pointerDown(tile(container, 'はい'), { pointerId: 1 })
      expect(h1Text(container)).toBe('はい。')
      expect(container.querySelector('.emergency-status-message')).toBeNull()
    })

    it('pointerdown に続く pointerId 付き click も捨てられ、二重実行しない(受理の振動が1回だけ)', () => {
      const { container } = render(() => <App />)
      const yes = tile(container, 'はい')
      fireEvent.pointerDown(yes, { pointerId: 1 })
      fireEvent.pointerUp(yes, { pointerId: 1 })
      const afterDown = vibrate.mock.calls.length
      expect(afterDown).toBeGreaterThan(0)
      vi.advanceTimersByTime(1000)
      pointerClick(yes, 1)
      expect(vibrate.mock.calls.length).toBe(afterDown)
    })

    it('pointerdown に続く click は捨てられ、二重実行しない(受理の振動が1回だけ)', () => {
      const { container } = render(() => <App />)
      const yes = tile(container, 'はい')
      fireEvent.pointerDown(yes, { pointerId: 1 })
      fireEvent.pointerUp(yes, { pointerId: 1 })
      const afterDown = vibrate.mock.calls.length
      expect(afterDown).toBeGreaterThan(0)
      vi.advanceTimersByTime(1000) // 連打無視区間の外でも二重に実行されない
      fireEvent.click(yes)
      expect(vibrate.mock.calls.length).toBe(afterDown)
    })

    it('pointerdown なしの click 単独(支援技術の合成)は押したタイルを実行する', () => {
      const { container } = render(() => <App />)
      expect(scanningLabel(container)).toBe('緊急')
      fireEvent.click(tile(container, 'いいえ'))
      expect(h1Text(container)).toBe('いいえ。')
    })

    it('click 単独の実行は、直前の pointerdown+click の捨て分を持ち越さない', () => {
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, 'はい'), { pointerId: 1 })
      fireEvent.click(tile(container, 'はい')) // 捨てられる
      vi.advanceTimersByTime(1000)
      fireEvent.click(tile(container, 'いいえ')) // 単独の click は実行される
      expect(h1Text(container)).toBe('いいえ。')
    })

    it('pointercancel で押下状態が残らない(離して決定でも決定されず、その後の click は単独扱い)', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      const yes = tile(container, 'はい')
      fireEvent.pointerDown(yes, { pointerId: 1 })
      fireEvent.pointerCancel(window, { pointerId: 1 })
      fireEvent.pointerUp(window, { pointerId: 1 })
      expect(h1Text(container)).not.toBe('はい。')
      // 取り消し後は pending が残らず、続く click は支援技術の合成として実行される
      fireEvent.click(yes)
      expect(h1Text(container)).toBe('はい。')
    })

    it('下限付き: pointerdown 後に pointercancel すると下限に達しても決定されない', () => {
      setSettings({ minHoldMs: 500 })
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, 'はい'), { pointerId: 1 })
      vi.advanceTimersByTime(200)
      fireEvent.pointerCancel(window, { pointerId: 1 })
      vi.advanceTimersByTime(2000)
      expect(h1Text(container)).not.toBe('はい。')
    })

    it('連打: 連打無視区間内の2回目の押下は無視される', () => {
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, '不快'), { pointerId: 1 })
      expect(screenLabel(container)).toContain('不快')
      // 遷移先の「緊急」(index1)を直後に押しても、連打無視で実行されない
      fireEvent.pointerDown(tile(container, '緊急'), { pointerId: 2 })
      expect(container.querySelector('.emergency-status-message')).toBeNull()
    })

    it('下限付き: スキャンが進んでも、押し始めのタイルが下限到達時点で実行される', () => {
      setSettings({ minHoldMs: 1500 })
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, 'いいえ'), { pointerId: 1 })
      vi.advanceTimersByTime(1499)
      expect(h1Text(container)).not.toBe('いいえ。')
      vi.advanceTimersByTime(1) // この間にカーソルは「はい」へ進んでいる
      expect(h1Text(container)).toBe('いいえ。')
    })

    it('離して決定: 押下中は実行されず、スキャンが進んだ後に離しても押し始めのタイルが実行される', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      const no = tile(container, 'いいえ')
      fireEvent.pointerDown(no, { pointerId: 1 })
      expect(h1Text(container)).not.toBe('いいえ。')
      vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 3) // カーソルは別項目
      fireEvent.pointerUp(window, { pointerId: 1 })
      expect(h1Text(container)).toBe('いいえ。')
    })

    it('押下時間の下限未満のタップは何も実行しない', () => {
      setSettings({ minHoldMs: 500 })
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, 'はい'), { pointerId: 1 })
      vi.advanceTimersByTime(300)
      fireEvent.pointerUp(window, { pointerId: 1 })
      vi.advanceTimersByTime(2000)
      expect(h1Text(container)).not.toBe('はい。')
    })

    it('押している間に画面が変わったら、押し始めのタイルは実行されず無視される', () => {
      setSettings({ minHoldMs: 1500 })
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, '不快'), { pointerId: 1 })
      vi.advanceTimersByTime(100)
      fireEvent.pointerDown(tile(container, 'はい'), { pointerId: 2 })
      vi.advanceTimersByTime(1400) // 不快が決定 → 不快画面
      expect(screenLabel(container)).toContain('不快')
      vi.advanceTimersByTime(200) // 「はい」の決定時刻だが画面が違うので無視
      expect(screenLabel(container)).toContain('不快')
      expect(h1Text(container)).not.toBe('はい。')
    })
  })

  describe('背景・メッセージ欄・緊急パネルのタップは何も実行しない', () => {
    it('.grid-board / body / メッセージ欄 の pointerdown と click は何も実行しない', () => {
      const { container } = render(() => <App />)
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      const before = h1Text(container)
      const targets: Element[] = [
        container.querySelector('.grid-board') as Element,
        document.body,
        container.querySelector('.message-panel, h1') as Element,
      ]
      for (const el of targets) {
        fireEvent.pointerDown(el, { pointerId: 1 })
        fireEvent.pointerUp(el, { pointerId: 1 })
        fireEvent.click(el)
      }
      expect(h1Text(container)).toBe(before)
      expect(container.querySelector('.emergency-status-message')).toBeNull()
      expect(screenLabel(container)).toContain('ホーム')
    })

    it('下限・離して決定モードでも背景の押下は決定されない', () => {
      setSettings({ minHoldMs: 300, activateOn: 'release' })
      const { container } = render(() => <App />)
      const board = container.querySelector('.grid-board') as HTMLElement
      fireEvent.pointerDown(board, { pointerId: 1 })
      vi.advanceTimersByTime(1000)
      fireEvent.pointerUp(board, { pointerId: 1 })
      expect(container.querySelector('.emergency-status-message')).toBeNull()
      expect(screenLabel(container)).toContain('ホーム')
    })

    it('緊急パネルのタップは何も実行しない(緊急状態も変わらない)', () => {
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, '緊急'), { pointerId: 1 })
      expect(h1Text(container)).toBe(EMERGENCY)
      const panel = container.querySelector('.emergency-status-message') as HTMLElement
      const screenBefore = screenLabel(container)
      vi.advanceTimersByTime(1000)
      fireEvent.pointerDown(panel, { pointerId: 2 })
      fireEvent.pointerUp(panel, { pointerId: 2 })
      fireEvent.click(panel)
      expect(h1Text(container)).toBe(EMERGENCY)
      expect(screenLabel(container)).toBe(screenBefore)
    })

    it('背景の pointerdown に続くタイルの click は実行されない(同じ操作の click)', () => {
      const { container } = render(() => <App />)
      fireEvent.pointerDown(container.querySelector('.grid-board') as HTMLElement, {
        pointerId: 1,
      })
      fireEvent.pointerUp(container.querySelector('.grid-board') as HTMLElement, { pointerId: 1 })
      fireEvent.click(tile(container, 'はい'))
      expect(h1Text(container)).not.toBe('はい。')
      // 消費済みなので、次の pointerdown なしの click は合成として実行される
      fireEvent.click(tile(container, 'いいえ'))
      expect(h1Text(container)).toBe('いいえ。')
    })

    it('マルチタッチ: 1と2を押し、2を離して id2 の click を消費しても、id1 の記録は残る', () => {
      const { container } = render(() => <App />)
      const board = container.querySelector('.grid-board') as HTMLElement
      fireEvent.pointerDown(board, { pointerId: 1 })
      fireEvent.pointerDown(board, { pointerId: 2 })
      fireEvent.pointerUp(board, { pointerId: 2 })
      pointerClick(tile(container, 'はい'), 2)
      expect(h1Text(container)).not.toBe('はい。')
      // id1 はまだ押下中(記録が残っている)。その click は消費される
      pointerClick(tile(container, 'いいえ'), 1)
      expect(h1Text(container)).not.toBe('いいえ。')
      // 記録は尽きた。次の click は合成として実行される
      pointerClick(tile(container, 'いいえ'), 1)
      expect(h1Text(container)).toBe('いいえ。')
    })

    it('マルチタッチ: id2 を cancel しても、id1 の click は消費される(id2 の記録だけが消える)', () => {
      const { container } = render(() => <App />)
      const board = container.querySelector('.grid-board') as HTMLElement
      fireEvent.pointerDown(board, { pointerId: 1 })
      fireEvent.pointerDown(board, { pointerId: 2 })
      fireEvent.pointerCancel(window, { pointerId: 2 })
      pointerClick(tile(container, 'はい'), 2) // id2 の記録は無い → 合成として実行される
      expect(h1Text(container)).toBe('はい。')
      vi.advanceTimersByTime(1000)
      fireEvent.pointerUp(board, { pointerId: 1 })
      pointerClick(tile(container, 'いいえ'), 1) // id1 の記録は残っている → 消費
      expect(h1Text(container)).not.toBe('いいえ。')
    })

    it('記録されていない pointerId(-1)の click は合成として実行される', () => {
      const { container } = render(() => <App />)
      const board = container.querySelector('.grid-board') as HTMLElement
      fireEvent.pointerDown(board, { pointerId: 1 }) // 別ポインターの記録があっても消費しない
      pointerClick(tile(container, 'はい'), -1)
      expect(h1Text(container)).toBe('はい。')
    })

    it('pointerup 後に1秒以上経っても、同じ pointerId の click は消費される(合成扱いで二重実行しない)', () => {
      const { container } = render(() => <App />)
      const board = container.querySelector('.grid-board') as HTMLElement
      fireEvent.pointerDown(board, { pointerId: 1 })
      fireEvent.pointerUp(board, { pointerId: 1 })
      vi.advanceTimersByTime(2500) // メインスレッドが止まった想定
      pointerClick(tile(container, 'はい'), 1)
      expect(h1Text(container)).not.toBe('はい。')
    })

    it('pointerup が届かなかった記録も、10秒を超えれば次の合成 click を捨てない', () => {
      const { container } = render(() => <App />)
      const board = container.querySelector('.grid-board') as HTMLElement
      fireEvent.pointerDown(board, { pointerId: 1 })
      vi.advanceTimersByTime(11000)
      fireEvent.click(tile(container, 'はい')) // pointerId なし → 期限切れ破棄後に合成として実行
      expect(h1Text(container)).toBe('はい。')
    })

    it('右/中クリック・ペンのバレルボタンの pointerdown ではタイルを実行しない', () => {
      const { container } = render(() => <App />)
      for (const button of [1, 2, 5]) {
        fireEvent.pointerDown(tile(container, 'はい'), { pointerId: 1, button })
        fireEvent.pointerUp(window, { pointerId: 1, button })
      }
      expect(h1Text(container)).not.toBe('はい。')
      fireEvent.pointerDown(tile(container, 'はい'), { pointerId: 1, button: 0 })
      expect(h1Text(container)).toBe('はい。')
    })

    it('pointercancel した押下の記録は残らず、次の合成 click は捨てられない', () => {
      const { container } = render(() => <App />)
      const board = container.querySelector('.grid-board') as HTMLElement
      fireEvent.pointerDown(board, { pointerId: 1 })
      fireEvent.pointerCancel(window, { pointerId: 1 })
      fireEvent.click(tile(container, 'はい'))
      expect(h1Text(container)).toBe('はい。')
    })

    it('click が届かなかった押下の記録は、時間が経てば次の合成 click を捨てない', () => {
      const { container } = render(() => <App />)
      const board = container.querySelector('.grid-board') as HTMLElement
      fireEvent.pointerDown(board, { pointerId: 1 })
      fireEvent.pointerUp(board, { pointerId: 1 }) // click は祖先にも来ず消費されなかった
      vi.advanceTimersByTime(2000)
      fireEvent.click(tile(container, 'はい'))
      expect(h1Text(container)).toBe('はい。')
    })
  })

  describe('キー / 外部スイッチは現在のスキャン対象を実行する(回帰)', () => {
    it.each([
      ['a', 'KeyA'],
      ['AudioVolumeUp', 'AudioVolumeUp'],
      ['Enter', 'Enter'],
      [' ', 'Space'],
    ])('キー %s はスキャン対象(先頭の緊急)を実行する', (key, code) => {
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key, code })
      expect(h1Text(container)).toBe(EMERGENCY)
    })

    it('キーはスキャン位置を実行し、カーソルが進んだ後は進んだ先を実行する', () => {
      const { container } = render(() => <App />)
      vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS)
      expect(scanningLabel(container)).toBe('いいえ')
      fireEvent.keyDown(window, { key: 'Enter', code: 'Enter' })
      expect(h1Text(container)).toBe('いいえ。')
    })

    it('離して決定のキーも押し始めのスキャン対象を実行する', () => {
      setSettings({ activateOn: 'release' })
      const { container } = render(() => <App />)
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      fireEvent.keyDown(window, { key: ' ', code: 'Space' })
      vi.advanceTimersByTime(INTERVAL_MS * 2)
      fireEvent.keyUp(window, { key: ' ', code: 'Space' })
      expect(h1Text(container)).toBe('はい。')
    })
  })

  describe('介助者メニュー', () => {
    const open = (container: HTMLElement) =>
      fireEvent.click(container.querySelector('.caregiver-button') as HTMLElement)

    it('オーバーレイの pointerdown でメニューが閉じ、続くタイルの click は実行されない', () => {
      const { container } = render(() => <App />)
      open(container)
      const overlay = container.querySelector('.caregiver-overlay') as HTMLElement
      fireEvent.pointerDown(overlay, { pointerId: 1 })
      fireEvent.pointerUp(overlay, { pointerId: 1 })
      expect(container.querySelector('.caregiver-overlay')).toBeNull()
      fireEvent.click(tile(container, 'はい')) // 指を離した位置の下のタイルへ届く click
      expect(h1Text(container)).not.toBe('はい。')
      expect(scanningLabel(container)).toBe('緊急') // ホーム先頭から再開
      fireEvent.click(tile(container, 'いいえ')) // 次の合成 click は実行される
      expect(h1Text(container)).toBe('いいえ。')
    })

    it('オーバーレイの pointerdown でメニューが閉じ、続く pointerId 付きタイル click は実行されない', () => {
      const { container } = render(() => <App />)
      open(container)
      const overlay = container.querySelector('.caregiver-overlay') as HTMLElement
      fireEvent.pointerDown(overlay, { pointerId: 1 })
      fireEvent.pointerUp(overlay, { pointerId: 1 })
      expect(container.querySelector('.caregiver-overlay')).toBeNull()
      pointerClick(tile(container, 'はい'), 1)
      expect(h1Text(container)).not.toBe('はい。')
      expect(scanningLabel(container)).toBe('緊急')
      pointerClick(tile(container, 'いいえ'), 1) // 記録は消費済み。次の pointerdown なし click は合成として実行
      expect(h1Text(container)).toBe('いいえ。')
    })

    it('表示中のタイル click 単独も何も実行しない', () => {
      const { container } = render(() => <App />)
      open(container)
      fireEvent.click(tile(container, 'はい'))
      expect(h1Text(container)).not.toBe('はい。')
      expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
    })

    it('メニュー表示中のタイル pointerdown+click も実行されない', () => {
      const { container } = render(() => <App />)
      open(container)
      fireEvent.pointerDown(tile(container, 'はい'), { pointerId: 1 })
      fireEvent.click(tile(container, 'はい'))
      expect(container.querySelector('.caregiver-overlay')).toBeNull()
      expect(h1Text(container)).not.toBe('はい。')
    })

    it('介助者ボタン上の Enter / Space は本人入力にならず、タイル実行も起こさない(#30/#31)', () => {
      const { container } = render(() => <App />)
      const button = container.querySelector('.caregiver-button') as HTMLButtonElement
      button.focus()
      fireEvent.keyDown(button, { key: 'Enter', code: 'Enter' })
      fireEvent.keyDown(button, { key: ' ', code: 'Space' })
      expect(container.querySelector('.emergency-status-message')).toBeNull()
      fireEvent.click(button)
      expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
    })
  })

  describe('モールス画面はキーのみ・背景は無効', () => {
    const enterMorseByTile = () => {
      setSettings({ morseEnabled: true })
      const view = render(() => <App />)
      fireEvent.pointerDown(tile(view.container, 'モールス'), { pointerId: 1 })
      expect(view.container.querySelector('.morse-panel')).not.toBeNull()
      fireEvent.pointerUp(window, { pointerId: 1 })
      return view
    }

    it('タイルの直接タップでモールス画面へ入れ、格子は非表示になる', () => {
      const { container } = enterMorseByTile()
      expect(container.querySelector('.grid-board.is-hidden')).not.toBeNull()
    })

    it('キーの押下が符号になり、背景・パネルの押下は符号にならない', () => {
      const { container } = enterMorseByTile()
      vi.advanceTimersByTime(500)
      const panel = container.querySelector('.morse-panel') as HTMLElement
      fireEvent.pointerDown(panel, { pointerId: 2 })
      vi.advanceTimersByTime(100)
      fireEvent.pointerUp(panel, { pointerId: 2 })
      fireEvent.pointerDown(document.body, { pointerId: 3 })
      fireEvent.pointerUp(document.body, { pointerId: 3 })
      vi.advanceTimersByTime(200)
      expect(container.querySelector('.morse-code')?.textContent?.trim()).toBe('')

      fireEvent.keyDown(window, { key: ' ', code: 'Space' })
      vi.advanceTimersByTime(100)
      fireEvent.keyUp(window, { key: ' ', code: 'Space' })
      expect(container.querySelector('.morse-code')?.textContent).toContain('・')
    })
  })

  describe('緊急タイルの直接タップ(現状仕様)', () => {
    it('緊急タイルの押下で即緊急表示・緊急詳細画面へ遷移する', () => {
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, '緊急'), { pointerId: 1 })
      expect(h1Text(container)).toBe(EMERGENCY)
      expect(screenLabel(container)).toContain('緊急')
    })

    it('緊急詳細の戻るを直接タップでホームへ戻っても、緊急状態が残る', () => {
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, '緊急'), { pointerId: 1 })
      vi.advanceTimersByTime(1000)
      fireEvent.pointerDown(tile(container, '戻る'), { pointerId: 2 })
      expect(screenLabel(container)).toContain('ホーム')
      expect(h1Text(container)).toBe(EMERGENCY)
    })

    it('緊急→戻る→はい(直接タップ)でも緊急状態は残り、はいは直前の伝達に出る', () => {
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, '緊急'), { pointerId: 1 })
      vi.advanceTimersByTime(1000)
      fireEvent.pointerDown(tile(container, '戻る'), { pointerId: 2 })
      vi.advanceTimersByTime(1000)
      fireEvent.pointerDown(tile(container, 'はい'), { pointerId: 3 })
      expect(h1Text(container)).toBe(EMERGENCY)
      expect(container.querySelector('.message-panel h1')?.textContent).toBe('はい。')
    })

    it('緊急状態は再マウント(リロード)後もホーム起動で上部表示が保持される(#39/#41)', () => {
      const first = render(() => <App />)
      fireEvent.pointerDown(tile(first.container, '緊急'), { pointerId: 1 })
      expect(h1Text(first.container)).toBe(EMERGENCY)
      first.unmount()
      cleanup()
      const second = render(() => <App />)
      expect(h1Text(second.container)).toBe(EMERGENCY)
      expect(screenLabel(second.container)).toContain('ホーム')
    })
  })

  describe('直接選択後の表示とアクセシビリティ', () => {
    it('直接選択すると採用表示(#37)とパンくずが更新される', () => {
      const { container } = render(() => <App />)
      fireEvent.pointerDown(tile(container, '不快'), { pointerId: 1 })
      expect(container.querySelector('.selection-confirmation')?.textContent).toContain('不快')
      expect(container.querySelector('.screen-breadcrumb')?.textContent).toContain('不快')
    })

    it('全タイルが role=button + aria-label を持ち、aria-hidden / tabindex を持たない', () => {
      const { container } = render(() => <App />)
      const tiles = Array.from(container.querySelectorAll<HTMLElement>('.grid-board .tile'))
      expect(tiles.length).toBeGreaterThan(3)
      for (const el of tiles) {
        expect(el.getAttribute('role')).toBe('button')
        expect(el.getAttribute('aria-label')).toBe(el.querySelector('.tile-label')?.textContent)
        expect(el.hasAttribute('aria-hidden')).toBe(false)
        expect(el.hasAttribute('tabindex')).toBe(false)
      }
    })
  })
})
