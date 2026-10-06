import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMorseInput, type MorseInputConfig } from '../morseInput'
import { MORSE_WORD_SEPARATOR, type MorseEvent, type MorseState, type MorseSymbol } from '../morse'

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

// Issue #57: SOS の断片列による判定を、実際の押下/解放と時計(createMorseInput)でも確認する
describe('morseInput: SOS は文字の切れ目から始まる場合だけ(Issue #57)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  const sendSymbols = (h: ReturnType<typeof setup>, code: string, gapMs = 150) => {
    for (const symbol of code) {
      h.press(symbol === '-' ? 600 : 100)
      vi.advanceTimersByTime(gapMs)
    }
  }

  it('8押下では緊急にならず、9押下目を離した時点で即 emergency(確定を待たない)', () => {
    const h = setup()
    h.input.start('')
    sendSymbols(h, '...---..')
    expect(h.events).toEqual([])
    h.press(100)
    expect(h.events).toEqual([{ type: 'emergency' }])
  })

  it('「...」が「ら」として確定済み(間が1.5秒超)でも、後続の「---...」で発火する', () => {
    const h = setup()
    h.input.start('')
    sendSymbols(h, '...')
    vi.advanceTimersByTime(2000)
    expect(h.last().text).toBe('ら')
    sendSymbols(h, '---...')
    expect(h.events).toEqual([{ type: 'emergency' }])
  })

  it('前に誤符号があっても、SOS が文字の切れ目(確定のあと)から始まれば発火する', () => {
    const h = setup()
    h.input.start('')
    sendSymbols(h, '-.')
    vi.advanceTimersByTime(2000) // 誤符号を確定
    sendSymbols(h, '...---...')
    expect(h.events).toEqual([{ type: 'emergency' }])
  })

  it('前の文字から休まず続けた「誤符号+SOS」は文字の途中から始まるので発火しない', () => {
    const h = setup()
    h.input.start('')
    sendSymbols(h, '-.')
    sendSymbols(h, '...---...')
    expect(h.events).toEqual([])
  })

  it('「ら」「れ」「ら」と3文字に確定しながら打った SOS で緊急になり、SOS 由来の文字は消える', () => {
    const h = setup()
    h.input.start('あ')
    for (const code of ['...', '---', '...']) {
      sendSymbols(h, code)
      vi.advanceTimersByTime(2000)
      if (h.events.length === 0) expect(h.last().text.length).toBeGreaterThan(1)
    }
    expect(h.events).toEqual([{ type: 'emergency' }])
    expect(h.last().text.replace(MORSE_WORD_SEPARATOR, '')).toBe('あ')
  })

  it('「かぜ」を打っても(符号の連結が SOS を含んでも)緊急にならない', () => {
    const h = setup()
    h.input.start('')
    for (const code of ['.-..', '.---.', '..']) {
      sendSymbols(h, code)
      vi.advanceTimersByTime(2000)
    }
    expect(h.last().text.trim()).toBe('かぜ')
    expect(h.events).toEqual([])
  })

  it('旧・緊急の「－」5つでは緊急にならない', () => {
    const h = setup()
    h.input.start('')
    sendSymbols(h, '-----')
    vi.advanceTimersByTime(2000)
    expect(h.events).toEqual([])
  })

  it('緊急のあと断片列が空になり、続く「---...」では再発火しない', () => {
    const h = setup()
    h.input.start('')
    sendSymbols(h, '...---...')
    expect(h.events).toHaveLength(1)
    sendSymbols(h, '---...')
    expect(h.events).toHaveLength(1)
    expect(h.last().segments).toEqual([])
    expect(h.last().code).toBe('---...')
  })

  describe('15秒の断片リセット', () => {
    it('14秒空けても残りの「---...」で発火する', () => {
      const h = setup()
      h.input.start('')
      sendSymbols(h, '...', 0)
      vi.advanceTimersByTime(14000)
      sendSymbols(h, '---...')
      expect(h.events).toEqual([{ type: 'emergency' }])
    })

    it('16秒空けると断片は捨てられ、「---...」だけでは発火しない', () => {
      const h = setup()
      h.input.start('')
      sendSymbols(h, '...', 0)
      vi.advanceTimersByTime(16000)
      expect(h.last().segments).toEqual([])
      sendSymbols(h, '---...')
      expect(h.events).toEqual([])
    })

    it('押している最中は時計が進んでも断片を捨てない(離してから数える)', () => {
      const h = setup()
      h.input.start('')
      sendSymbols(h, '...', 0)
      vi.advanceTimersByTime(14500)
      h.input.down('k')
      vi.advanceTimersByTime(1000) // 15秒を超えるが押している間
      h.input.up('k') // 長押し(－)
      expect(h.last().code).toBe('-')
      expect(h.last().segments.length).toBe(1)
      sendSymbols(h, '--...')
      expect(h.events).toEqual([{ type: 'emergency' }])
    })
  })

  describe('操作の符号のあとは断片列が空', () => {
    it('・6つ(1字消す)を確定した直後の「---...」では緊急にならない', () => {
      const h = setup()
      h.input.start('あい')
      sendSymbols(h, '......')
      vi.advanceTimersByTime(1600)
      expect(h.last().text).toBe('あ')
      expect(h.last().segments).toEqual([])
      sendSymbols(h, '---...')
      expect(h.events).toEqual([])
    })

    it('・5つは確定待ちのあと exit(緊急と衝突せず、断片列は空)', () => {
      const h = setup()
      h.input.start('')
      sendSymbols(h, '.....')
      expect(h.events).toEqual([])
      vi.advanceTimersByTime(1600)
      expect(h.events).toEqual([{ type: 'exit' }])
      expect(h.last().segments).toEqual([])
    })

    it('確定の符号(・－・－・－)のあとは send が出て断片列は空', () => {
      const h = setup()
      h.input.start('あ')
      sendSymbols(h, '.-.-.-')
      vi.advanceTimersByTime(1600)
      expect(h.events).toEqual([{ type: 'send', text: 'あ' }])
      expect(h.last().segments).toEqual([])
    })
  })

  it('入り直し(start)で断片列は空から始まる', () => {
    const h = setup()
    h.input.start('')
    sendSymbols(h, '...---..')
    h.input.stop()
    h.input.start('')
    h.press(100)
    expect(h.events).toEqual([])
    expect(h.last().segments).toEqual([])
    expect(h.last().code).toBe('.')
  })
})
