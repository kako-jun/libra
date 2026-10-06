import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMorseInput, type MorseInputConfig } from '../morseInput'
import type { MorseEvent, MorseState, MorseSymbol } from '../morse'

const config: MorseInputConfig = {
  noiseMs: 30,
  dashMs: 500,
  letterGapMs: 1500,
  wordGapMs: 4000,
}

function setup(cfg: MorseInputConfig = config, paused: () => boolean = () => false) {
  const states: MorseState[] = []
  const events: Exclude<MorseEvent, null>[] = []
  const holds: (MorseSymbol | null)[] = []
  const input = createMorseInput({
    getConfig: () => cfg,
    isPaused: paused,
    onState: (s) => states.push(s),
    onEvent: (e) => events.push(e),
    onHold: (h) => holds.push(h),
  })
  const press = (ms: number, id = 'k') => {
    input.down(id)
    vi.advanceTimersByTime(ms)
    input.up(id)
  }
  return { input, states, events, holds, press, last: () => states[states.length - 1] }
}

describe('morseInput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  it('短押しは短点、押下時間の境目以上は長点になる', () => {
    const { input, press, last } = setup()
    input.start('')
    press(100)
    expect(last().code).toBe('.')
    vi.advanceTimersByTime(100)
    press(499)
    expect(last().code).toBe('..')
    vi.advanceTimersByTime(100)
    press(500)
    expect(last().code).toBe('..-')
  })

  it('雑音(下限未満)の押下は符号にしない', () => {
    const { input, press, last } = setup()
    input.start('')
    press(10)
    expect(last().code).toBe('')
  })

  it('無入力が続くと文字を確定し、さらに続くと語の区切りを入れる', () => {
    const { input, press, last } = setup()
    input.start('')
    press(100) // .
    vi.advanceTimersByTime(100)
    press(600) // -   → い
    vi.advanceTimersByTime(1500)
    expect(last().text).toBe('い')
    vi.advanceTimersByTime(4000)
    expect(last().text).toBe('い　')
  })

  it('SOSで緊急イベントが出る', () => {
    const { input, press, events } = setup()
    input.start('')
    for (const symbol of '...---...') {
      press(symbol === '-' ? 600 : 100)
      vi.advanceTimersByTime(100)
    }
    expect(events).toEqual([{ type: 'emergency' }])
  })

  it('無操作 30 秒で exit イベントが出る', () => {
    const { input, events } = setup()
    input.start('')
    vi.advanceTimersByTime(29900)
    expect(events).toEqual([])
    vi.advanceTimersByTime(300)
    expect(events).toEqual([{ type: 'exit' }])
  })

  it('押している間、短点/長点の見込みを知らせ、離すと null に戻る', () => {
    const { input, holds } = setup()
    input.start('')
    input.down('k')
    vi.advanceTimersByTime(100)
    expect(holds.at(-1)).toBe('.')
    vi.advanceTimersByTime(500)
    expect(holds.at(-1)).toBe('-')
    input.up('k')
    expect(holds.at(-1)).toBeNull()
  })

  it('cancel / cancelAll した押下は符号にしない', () => {
    const { input, last } = setup()
    input.start('')
    input.down('a')
    input.down('b')
    vi.advanceTimersByTime(100)
    input.cancel('a')
    input.up('a')
    input.cancelAll()
    input.up('b')
    expect(last().code).toBe('')
  })

  it('stop するとタイマーが止まり、以後の押下・時間経過は何も起こさない', () => {
    const { input, events, states } = setup()
    input.start('')
    input.stop()
    const count = states.length
    input.down('k')
    vi.advanceTimersByTime(60000)
    input.up('k')
    expect(events).toEqual([])
    expect(states.length).toBe(count)
  })

  it('start の text を引き継ぐ', () => {
    const { input, last } = setup()
    input.start('めか')
    expect(last().text).toBe('めか')
  })

  describe('ゆっくり押す人でも緊急に届く(押している間は確定・復帰を進めない)', () => {
    it('長点を900ms 押して 700ms 空ける、SOS でも緊急になる(押す+空ける > 文字の確定時間)', () => {
      const { input, events, last } = setup()
      input.start('')
      for (const symbol of '...---...') {
        input.down('k')
        vi.advanceTimersByTime(symbol === '-' ? 900 : 100)
        input.up('k')
        vi.advanceTimersByTime(700)
      }
      expect(events).toEqual([{ type: 'emergency' }])
      expect(last().text).toBe('') // 途中で「ら」などが確定していない
    })

    it('長押しの境目 1.5 秒・文字の確定 0.5 秒という極端な設定でも、SOSで緊急になる', () => {
      const extreme: MorseInputConfig = {
        ...config,
        dashMs: 1500,
        letterGapMs: 500,
        wordGapMs: 1500,
      }
      const { input, events } = setup(extreme)
      input.start('')
      for (const symbol of '...---...') {
        input.down('k')
        vi.advanceTimersByTime(symbol === '-' ? 1600 : 100)
        input.up('k')
        vi.advanceTimersByTime(300)
      }
      expect(events).toEqual([{ type: 'emergency' }])
    })

    it('押している間は文字が確定せず、離してから確定までの時間を数える', () => {
      const { input, last, press } = setup()
      input.start('')
      press(100) // .
      vi.advanceTimersByTime(1000)
      input.down('k')
      vi.advanceTimersByTime(5000) // 押しっぱなしの間に確定されない
      expect(last().text).toBe('')
      expect(last().code).toBe('.')
      input.up('k') // - → .-  (い)
      vi.advanceTimersByTime(1400)
      expect(last().text).toBe('')
      vi.advanceTimersByTime(200)
      expect(last().text).toBe('い')
    })

    it('解放を取りこぼした押しっぱなしは 10 秒で捨てられ、無操作 30 秒でスキャンへ戻れる', () => {
      const { input, events, last } = setup()
      input.start('')
      input.down('stuck')
      vi.advanceTimersByTime(10500)
      expect(last().code).toBe('') // 符号にはしない
      expect(events).toEqual([])
      vi.advanceTimersByTime(20000)
      expect(events).toEqual([{ type: 'exit' }])
    })
  })

  it('isPaused の間(介助者メニュー表示中など)は、文字確定も無操作での復帰も進めない', () => {
    let paused = true
    const { input, events, last, press } = setup(config, () => paused)
    input.start('')
    press(100)
    vi.advanceTimersByTime(60000)
    expect(last().code).toBe('.')
    expect(events).toEqual([])
    paused = false
    vi.advanceTimersByTime(100)
    expect(last().text).toBe('へ')
  })
})
