import { describe, expect, it } from 'vitest'
import {
  MORSE_CONTROL_CODES,
  MORSE_EMERGENCY_CODE,
  MORSE_IDLE_EXIT_MS,
  MORSE_TABLE,
  MORSE_WORD_SEPARATOR,
  decodeMorse,
  effectiveDashMs,
  morseNoiseMs,
  formatMorseCode,
  pushSymbol,
  startMorse,
  tickMorse,
  type MorseConfig,
  type MorseResult,
  type MorseState,
} from '../morse'

const config: MorseConfig = { dashMs: 500, letterGapMs: 1500, wordGapMs: 4000 }

/** 符号列('.-' 表記)を、そのあと文字の確定まで待って入力する */
function type(state: MorseState, code: string, at: number): { result: MorseResult; at: number } {
  let current = state
  let now = at
  let last: MorseResult = { state, event: null }
  for (const symbol of code) {
    now += 200
    last = pushSymbol(current, symbol as '.' | '-', now)
    current = last.state
    if (last.event) return { result: last, at: now }
  }
  now += config.letterGapMs
  last = tickMorse(current, now, config)
  return { result: last, at: now }
}

describe('和文モールスの符号表', () => {
  it('かな・濁点・半濁点・長音で符号が重複しない', () => {
    const codes = Object.values(MORSE_TABLE)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('符号は短点(.)と長点(-)だけで、1〜5つ', () => {
    for (const code of Object.values(MORSE_TABLE)) {
      expect(code).toMatch(/^[.-]{1,5}$/)
    }
  })

  it('清音46字 + 長音「ー」+ 濁点・半濁点 + ゐ・ゑ を持つ', () => {
    const kana =
      'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん'
    for (const char of kana) expect(MORSE_TABLE[char]).toBeDefined()
    expect(MORSE_TABLE['ー']).toBeDefined()
    expect(MORSE_TABLE['゛']).toBe('..')
    expect(MORSE_TABLE['゜']).toBe('..--.')
  })

  it('代表的な符号(い・め・か・ね・わ)が和文モールスどおり', () => {
    expect(MORSE_TABLE['い']).toBe('.-')
    expect(MORSE_TABLE['め']).toBe('-...-')
    expect(MORSE_TABLE['か']).toBe('.-..')
    expect(MORSE_TABLE['ね']).toBe('--.-')
    expect(MORSE_TABLE['わ']).toBe('-.-')
  })

  it('緊急の符号・操作の符号は、かなの符号と重ならない', () => {
    const codes = new Set(Object.values(MORSE_TABLE))
    expect(codes.has(MORSE_EMERGENCY_CODE)).toBe(false)
    for (const code of Object.values(MORSE_CONTROL_CODES)) expect(codes.has(code)).toBe(false)
    const controls = Object.values(MORSE_CONTROL_CODES)
    expect(new Set(controls).size).toBe(controls.length)
    expect(controls).not.toContain(MORSE_EMERGENCY_CODE)
  })

  it('かなの符号に、SOS(緊急)を含むものはない', () => {
    for (const code of Object.values(MORSE_TABLE)) {
      expect(code.includes(MORSE_EMERGENCY_CODE)).toBe(false)
    }
  })

  it('decode と表示用の整形', () => {
    expect(decodeMorse('.-')).toBe('い')
    expect(decodeMorse('.......')).toBeNull()
    expect(formatMorseCode('.-')).toBe('・ －')
  })
})

describe('モールス入力の状態遷移', () => {
  it('符号を入れて無入力が続くと1文字として確定する(「めかね」)', () => {
    let state = startMorse(0)
    let at = 0
    for (const code of ['-...-', '.-..', '--.-']) {
      const out = type(state, code, at)
      state = out.result.state
      at = out.at
    }
    expect(state.text).toBe('めかね')
    expect(state.code).toBe('')
  })

  it('確定の前は入力中の符号として残り、文字にはならない', () => {
    let state = startMorse(0)
    state = pushSymbol(state, '.', 200).state
    state = pushSymbol(state, '-', 400).state
    expect(state.code).toBe('.-')
    expect(tickMorse(state, 400 + config.letterGapMs - 1, config).state.text).toBe('')
    expect(tickMorse(state, 400 + config.letterGapMs, config).state.text).toBe('い')
  })

  it('さらに無入力が続くと語の区切りが入る(1回だけ)', () => {
    let { result, at } = type(startMorse(0), '.-', 0)
    let state = result.state
    state = tickMorse(state, at + config.wordGapMs, config).state
    expect(state.text).toBe('い' + MORSE_WORD_SEPARATOR)
    state = tickMorse(state, at + config.wordGapMs + 1000, config).state
    expect(state.text).toBe('い' + MORSE_WORD_SEPARATOR)
  })

  it('文字がないうちは語の区切りを入れない', () => {
    const state = tickMorse(startMorse(0), config.wordGapMs + 1, config).state
    expect(state.text).toBe('')
  })

  it('濁点・半濁点は直前の文字に付く', () => {
    let { result, at } = type(startMorse(0), '.-..', 0) // か
    ;({ result, at } = type(result.state, MORSE_TABLE['゛'], at))
    expect(result.state.text).toBe('が')
    ;({ result, at } = type(result.state, '-...', at)) // は
    ;({ result, at } = type(result.state, MORSE_TABLE['゜'], at))
    expect(result.state.text).toBe('がぱ')
  })

  it('付けられない濁点は捨てる', () => {
    const { result } = type(startMorse(0), MORSE_TABLE['゛'], 0)
    expect(result.state.text).toBe('')
  })

  it('該当なしの符号は捨てて、文字列を変えない', () => {
    const { result } = type(startMorse(0, 'あ'), '.......', 0)
    expect(result.state.text).toBe('あ')
    expect(result.state.code).toBe('')
    expect(result.event).toBeNull()
  })

  it('短点6つ(1字消す)で最後の1字が消える', () => {
    const { result } = type(startMorse(0, 'めかね'), MORSE_CONTROL_CODES.backspace, 0)
    expect(result.state.text).toBe('めか')
  })

  it('確定の符号で、入力した文字列を伝達として出す(前後の区切りは除く)', () => {
    const { result } = type(startMorse(0, 'めがね　'), MORSE_CONTROL_CODES.send, 0)
    expect(result.event).toEqual({ type: 'send', text: 'めがね' })
  })

  it('文字列が空なら確定しても何も起きない', () => {
    const { result } = type(startMorse(0), MORSE_CONTROL_CODES.send, 0)
    expect(result.event).toBeNull()
  })

  it('短点5つ(スキャンへ戻る)で exit', () => {
    const { result } = type(startMorse(0, 'あ'), MORSE_CONTROL_CODES.exit, 0)
    expect(result.event).toEqual({ type: 'exit' })
    expect(result.state.text).toBe('あ') // 入力途中の文字列は残る
  })

  describe('緊急(SOS・・・－－－・・・)', () => {
    it('9つ目を入れた時点で、確定を待たず即 emergency', () => {
      let state = startMorse(0)
      for (let i = 0; i < 8; i += 1) {
        const out = pushSymbol(state, '...---...'[i] as '.' | '-', 100 * (i + 1))
        expect(out.event).toBeNull()
        state = out.state
      }
      const out = pushSymbol(state, '.', 900)
      expect(out.event).toEqual({ type: 'emergency' })
      expect(out.state.code).toBe('')
    })

    it('直前に誤って別の符号が入っていても、続けてSOSで緊急になる', () => {
      let state = startMorse(0)
      state = pushSymbol(state, '-', 100).state
      let event = null as ReturnType<typeof pushSymbol>['event']
      for (let i = 0; i < 9; i += 1) {
        const out = pushSymbol(state, '...---...'[i] as '.' | '-', 200 + i * 100)
        state = out.state
        event = out.event
      }
      expect(event).toEqual({ type: 'emergency' })
      expect(state.code).toBe('')
    })

    it('長押し5つ(旧・緊急の符号)では緊急にならない', () => {
      let state = startMorse(0)
      for (let i = 0; i < 4; i += 1) state = pushSymbol(state, '-', 100 * (i + 1)).state
      expect(pushSymbol(state, '-', 500).event).toBeNull()
    })
  })

  describe('無操作でスキャンへ戻る', () => {
    it('符号の合間でなく無操作が続くと exit', () => {
      const state = startMorse(0)
      expect(tickMorse(state, MORSE_IDLE_EXIT_MS - 1, config).event).toBeNull()
      expect(tickMorse(state, MORSE_IDLE_EXIT_MS, config).event).toEqual({ type: 'exit' })
    })

    it('入力のたびに無操作の計測は仕切り直される', () => {
      let state = startMorse(0)
      state = pushSymbol(state, '.', MORSE_IDLE_EXIT_MS - 100).state
      state = tickMorse(state, MORSE_IDLE_EXIT_MS + config.letterGapMs, config).state
      expect(tickMorse(state, MORSE_IDLE_EXIT_MS + 5000, config).event).toBeNull()
    })
  })

  describe('語の区切りを勝手に入れない', () => {
    it('1字消したあとは、次の入力まで語の区切りを入れない', () => {
      let { result, at } = type(startMorse(0, 'あい'), MORSE_CONTROL_CODES.backspace, 0)
      const state = tickMorse(result.state, at + config.wordGapMs * 3, config).state
      expect(state.text).toBe('あ')
      ;({ result, at } = type(state, '..-', at + config.wordGapMs * 3)) // う
      expect(result.state.text).toBe('あう')
    })

    it('該当なしの符号を捨てたあとも入れない', () => {
      const { result, at } = type(startMorse(0, 'あ'), '.......', 0)
      expect(tickMorse(result.state, at + config.wordGapMs * 3, config).state.text).toBe('あ')
    })

    it('既存の文字列を持って入り直した直後も入れない', () => {
      const state = tickMorse(startMorse(0, 'あい'), config.wordGapMs + 1, config).state
      expect(state.text).toBe('あい')
    })

    it('文字を足したあとは、無入力が続くと入れる', () => {
      const { result, at } = type(startMorse(0, 'あ'), '.-', 0)
      expect(tickMorse(result.state, at + config.wordGapMs, config).state.text).toBe('あい　')
    })
  })

  it('半濁点・濁点は付け替えもできる(ば→ぱ、ぱ→ば)', () => {
    let { result, at } = type(startMorse(0, 'ば'), MORSE_TABLE['゜'], 0)
    expect(result.state.text).toBe('ぱ')
    ;({ result, at } = type(result.state, MORSE_TABLE['゛'], at))
    expect(result.state.text).toBe('ば')
  })

  it('長押しの境目は押下時間の下限より必ず長く、雑音の下限は 10ms 以上', () => {
    expect(effectiveDashMs(500, 0)).toBe(500)
    expect(effectiveDashMs(500, 600)).toBe(700)
    expect(effectiveDashMs(150, 2000)).toBe(2100)
    expect(morseNoiseMs(0)).toBe(10)
    expect(morseNoiseMs(800)).toBe(800)
  })

  it('符号表を全件固定値で照合する(誤った書き換えを検出)', () => {
    const expected: Record<string, string> = {
      あ: '--.--',
      い: '.-',
      う: '..-',
      え: '-.---',
      お: '.-...',
      か: '.-..',
      き: '-.-..',
      く: '...-',
      け: '-.--',
      こ: '----',
      さ: '-.-.-',
      し: '--.-.',
      す: '---.-',
      せ: '.---.',
      そ: '---.',
      た: '-.',
      ち: '..-.',
      つ: '.--.',
      て: '.-.--',
      と: '..-..',
      な: '.-.',
      に: '-.-.',
      ぬ: '....',
      ね: '--.-',
      の: '..--',
      は: '-...',
      ひ: '--..-',
      ふ: '--..',
      へ: '.',
      ほ: '-..',
      ま: '-..-',
      み: '..-.-',
      む: '-',
      め: '-...-',
      も: '-..-.',
      や: '.--',
      ゆ: '-..--',
      よ: '--',
      ら: '...',
      り: '--.',
      る: '-.--.',
      れ: '---',
      ろ: '.-.-',
      わ: '-.-',
      ゐ: '.-..-',
      ゑ: '.--..',
      を: '.---',
      ん: '.-.-.',
      '゛': '..',
      '゜': '..--.',
      ー: '.--.-',
    }
    expect(MORSE_TABLE).toEqual(expected)
  })
})
