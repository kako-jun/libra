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

  it('かな1文字の符号に、SOS(緊急)を含むものはない(文字をまたぐ偶然一致は別: SOSの履歴判定を参照)', () => {
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

    it('直前に誤って別の符号が入って確定されていても、続けてSOSで緊急になる', () => {
      let state = startMorse(0)
      state = pushSymbol(state, '-', 100).state
      state = tickMorse(state, 100 + config.letterGapMs, config).state // 「む」として確定
      expect(state.text).toBe('む')
      let event = null as ReturnType<typeof pushSymbol>['event']
      for (let i = 0; i < 9; i += 1) {
        const out = pushSymbol(state, '...---...'[i] as '.' | '-', 2000 + i * 100)
        state = out.state
        event = out.event
      }
      expect(event).toEqual({ type: 'emergency' })
      expect(state.code).toBe('')
      expect(state.text).toBe('む') // SOS より前の無関係な確定文字は残る
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

// Issue #57: 緊急=SOS。休まず続けて入力中の(確定前の)1つの符号の末尾が SOS なら、9つ目を離した時点で即緊急。
// 休みを挟んで確定した文字をまたぐ並びは数えない(かな複数字の符号の連結が偶然 SOS になる語で鳴らさない)。
//
// デシジョンテーブル(押下列 × 休み(確定)の有無 → 結果)
//   ...---... を休まず連続(9押下)        | 休みなし                    | 9押下目で emergency
//   ...---.. (8押下)                      | 休みなし                    | なし
//   誤符号 + ...---... を休まず連打       | 休みなし(入力中は1符号)     | emergency(6押下超の符号はかな・操作になりえない)
//   誤符号 → 休み(確定) → ...---...      | 誤符号は確定済み            | emergency(確定文字列は汚れない)
//   ... → 休み(ら確定) → ---...          | 休みを挟む                  | なし(確定をまたぐ並びは数えない)
//   ...---... を休み1.5秒を挟んで1押下ずつ | 毎押下確定                  | なし
//   かぜ・おそく等(連結が SOS を含む)     | 各文字を休んで確定          | なし
//   -----(旧)                             | 休みなし                    | なし
//   .....(5つ) → 待つ                     | 確定                        | exit(緊急と衝突しない)
describe('SOSは休まず続けて入力中の符号の末尾だけを見る(Issue #57)', () => {
  const SOS = '...---...'

  /** 符号列('.-' 表記)を、1押下ずつ間隔 gap で入れる(休まず続けて)。途中で event が出たらそこで止める */
  function pushAll(state: MorseState, code: string, start: number, gap = 200) {
    let current = state
    let now = start
    let events = 0
    let event: MorseResult['event'] = null
    for (const symbol of code) {
      now += gap
      const out = pushSymbol(current, symbol as '.' | '-', now)
      current = out.state
      event = out.event
      if (event) {
        events += 1
        break
      }
    }
    return { state: current, event, at: now, events }
  }

  /** 各文字(符号の配列)を、文字ごとに休んで確定させながら入れる。緊急が出たらそこで止める */
  function typeChars(codes: string[], initial: MorseState = startMorse(0)) {
    let state = initial
    let at = 0
    let events = 0
    for (const code of codes) {
      const out = pushAll(state, code, at)
      state = out.state
      at = out.at
      if (out.event) {
        events += 1
        break
      }
      at += config.letterGapMs
      state = tickMorse(state, at, config).state // 休んで文字を確定
    }
    return { state, at, events }
  }

  /** かな文字列を符号の配列にする(濁点・半濁点は「清音 + ゛」の2文字で打つ) */
  function encode(word: string): string[] {
    const codes: string[] = []
    for (const ch of word) {
      const nfd = ch.normalize('NFD')
      codes.push(MORSE_TABLE[nfd[0]])
      if (nfd.slice(1) === '\u3099') codes.push(MORSE_TABLE['゛'])
      if (nfd.slice(1) === '\u309a') codes.push(MORSE_TABLE['゜'])
    }
    return codes
  }

  describe('境界: 8押下目まではならず、9押下目を離した時点で即緊急', () => {
    it('どの接頭辞(1〜8押下)でも緊急にならず、9押下で緊急になる(確定を待たない)', () => {
      for (let n = 1; n <= 8; n += 1) {
        expect(pushAll(startMorse(0), SOS.slice(0, n), 0).events).toBe(0)
      }
      const out = pushAll(startMorse(0), SOS, 0)
      expect(out.events).toBe(1)
      expect(out.event).toEqual({ type: 'emergency' })
      expect(out.state.code).toBe('')
      expect(out.state.text).toBe('')
    })

    it('SOS に近い列(1押下ちがい)では緊急にならない', () => {
      for (const near of [
        '..----...',
        '...--....',
        '....--...',
        '...-.-...',
        '..---....',
        '.........',
      ]) {
        expect(pushAll(startMorse(0), near, 0).events).toBe(0)
      }
    })
  })

  describe('前に誤符号があっても、休まず続けた符号の末尾が SOS なら緊急', () => {
    it('誤符号 + SOS を休まず連打(入力中の符号が6押下を超える)で緊急になり、確定文字列は汚れない', () => {
      for (const prefix of ['.-', '-', '.-.-', '--', '.-..', '-....', '.'.repeat(12)]) {
        const out = pushAll(startMorse(0, 'あ'), prefix + SOS, 0)
        expect(out.events, prefix).toBe(1)
        expect(out.state.code).toBe('')
        expect(out.state.text).toBe('あ') // 巻き戻しは不要(SOS は確定前の符号)
      }
    })

    it('誤符号を休んで確定したあとの SOS でも緊急になり、誤符号の文字は残る', () => {
      const typed = typeChars(['-'])
      expect(typed.state.text).toBe('む')
      const out = pushAll(typed.state, SOS, typed.at)
      expect(out.events).toBe(1)
      expect(out.state.text).toBe('む')
    })
  })

  describe('休みを挟んで確定した文字をまたぐ並びは数えない', () => {
    it('「...」が「ら」で確定済みなら、続く「---...」では緊急にならない', () => {
      const typed = typeChars(['...'])
      expect(typed.state.text).toBe('ら')
      expect(pushAll(typed.state, '---...', typed.at).events).toBe(0)
    })

    it('SOS を文字ごとに休んで打っても(ら・れ・ら、へ・へ・へ・れ・ら 等)緊急にならない', () => {
      for (const codes of [
        ['...', '---', '...'],
        ['.', '..', '---', '...'],
        ['...-', '--...'],
        ['.', '.', '.', '-', '-', '-', '.', '.', '.'],
      ]) {
        expect(codes.join('')).toBe(SOS)
        expect(typeChars(codes).events, codes.join('|')).toBe(0)
      }
    })

    it('SOS の9押下を、1押下ごとに文字の確定時間(1.5秒)を挟んで打っても緊急にならない', () => {
      let state = startMorse(0)
      let at = 0
      for (const symbol of SOS) {
        at += config.letterGapMs
        state = tickMorse(state, at, config).state
        const out = pushSymbol(state, symbol as '.' | '-', at)
        expect(out.event).toBeNull()
        state = out.state
      }
    })

    // かぜ=か せ ゛ など。各文字を休んで確定しながら打つ(実際のかな入力)。符号の連結は SOS を含む
    const WORDS = [
      'かぜ',
      'かぜぐすり',
      'かぜです',
      'おそく',
      'おぞましい',
      'おせう',
      'くよくよ',
      'られぬ',
    ]
    for (const word of WORDS) {
      it(`「${word}」は符号の連結が SOS を含むが、緊急にならない`, () => {
        const codes = encode(word)
        const joined = codes.join('')
        expect(joined).toContain(SOS) // 連結が SOS を含む語だけを並べている
        const out = typeChars(codes)
        expect(out.events).toBe(0)
        expect(tickMorse(out.state, out.at + config.letterGapMs, config).event).toBeNull()
      })
    }
  })

  describe('他の符号と衝突しない', () => {
    it('旧・緊急の「－」5つでは緊急にならず、文字としても該当なしで捨てられる', () => {
      const out = pushAll(startMorse(0), '-----', 0)
      expect(out.events).toBe(0)
      const ticked = tickMorse(out.state, out.at + config.letterGapMs, config)
      expect(ticked.event).toBeNull()
      expect(ticked.state.text).toBe('')
    })

    it('「・」5つは緊急にならず、確定待ちのあと exit になる', () => {
      const out = pushAll(startMorse(0), '.....', 0)
      expect(out.events).toBe(0)
      expect(tickMorse(out.state, out.at + config.letterGapMs - 1, config).event).toBeNull()
      expect(tickMorse(out.state, out.at + config.letterGapMs, config).event).toEqual({
        type: 'exit',
      })
    })

    it('「・」を9つまで続けても緊急にならない', () => {
      expect(pushAll(startMorse(0), '.'.repeat(9), 0).events).toBe(0)
    })

    it('・6つ(1字消す)・・5つ(exit)・確定(send)のあとの「---...」では緊急にならない', () => {
      for (const control of Object.values(MORSE_CONTROL_CODES)) {
        const { result, at } = type(startMorse(0, 'あい'), control, 0)
        expect(pushAll(result.state, '---...', at).events, control).toBe(0)
      }
    })
  })

  describe('誤発火ゼロの根拠(和文符号表から機械的に列挙)', () => {
    const codes = Object.values(MORSE_TABLE)
    const controls = Object.values(MORSE_CONTROL_CODES)

    it('かな・操作の符号は最長6押下で、確定前の符号が6押下を超えれば、どれにもなりえない', () => {
      for (const code of [...codes, ...controls]) expect(code.length).toBeLessThanOrEqual(6)
      expect(Math.max(...codes.map((c) => c.length))).toBe(5)
      expect(SOS.length).toBeGreaterThan(6)
    })

    it('1文字の符号(かな・操作)の単独入力で、緊急にならない', () => {
      for (const code of [...codes, ...controls]) {
        expect(pushAll(startMorse(0), code, 0).events, code).toBe(0)
      }
    })

    const combos: string[][] = []
    for (const a of codes) {
      for (const b of codes) {
        combos.push([a, b])
        for (const c of codes) combos.push([a, b, c])
      }
    }
    const withSos = combos.filter((seq) => seq.join('').includes(SOS))

    it('確定をまたぐ2〜3文字の全組(連結が SOS を含む組を含む)で、発火は0', () => {
      expect(combos.length).toBe(codes.length ** 2 + codes.length ** 3)
      expect(withSos.length).toBeGreaterThan(0)
      let fired = 0
      for (const seq of combos) fired += typeChars(seq).events
      expect(fired).toBe(0)
    })

    it('同じ組を、休まず続けて(確定をまたがず)入力すると、末尾が SOS の組だけが発火する', () => {
      let expected = 0
      let fired = 0
      for (const seq of combos) {
        const joined = seq.join('')
        if (joined.length > 5 && joined.endsWith(SOS)) expected += 1
        // 末尾 SOS でなくても、途中に SOS を含む組はその時点で(末尾が SOS になった押下で)発火する
        const out = pushAll(startMorse(0), joined, 0)
        if (out.events > 0) {
          fired += 1
          expect(joined.slice(0, out.at / 200).endsWith(SOS), joined).toBe(true)
        } else {
          expect(joined.includes(SOS), joined).toBe(false)
        }
      }
      expect(fired).toBeGreaterThanOrEqual(expected)
    })
  })
})
