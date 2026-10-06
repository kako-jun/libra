import { describe, expect, it } from 'vitest'
import {
  MORSE_CONTROL_CODES,
  MORSE_EMERGENCY_CODE,
  MORSE_HISTORY_RESET_MS,
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

// Issue #57: 緊急=SOS。SOS は「文字の切れ目から始まる」ときだけ緊急にする(A案)。
//
// アルゴリズム: 確定済みの断片列(SOS の連続部分列になる符号だけ覚える)の末尾 k 個の符号 +
// 入力中の符号(確定前)== SOS なら、その押下で即緊急。SOS の断片でない符号を確定すると列は切れる。
// 緊急時は、使った断片の文字を確定文字列から巻き戻す。
//
// デシジョンテーブル(押下列 × 確定タイミング × 断片列の状態 → 結果)
//   ...---... を1文字として連続(9押下)  | 切れ目なし(入力中のみ)    | 空               | 9押下目で emergency
//   ...---.. (8押下)                     | -                         | 空               | なし
//   ...(→ら確定) ---...                  | 3押下目と4押下目の間      | ['...']          | 9押下目で emergency、「ら」を巻き戻す
//   ...(ら) ---(れ) ...                  | 各切れ目で確定            | ['...','---']    | emergency、「られ」を巻き戻す
//   -(む確定) ...---...                  | 前の文字は無関係          | -は断片(－)だが  | emergency、「む」は残る
//                                        |                           | 末尾kに含めない  |
//   .-...---... (かぜ等・連続押下)       | 文字の途中から始まる      | -                | なし
//   かぜ/おそく等を確定しながら入力      | 各文字を確定              | 非断片で切れる   | なし
//   ...  +14,999ms+ ---...               | tick 後                   | 残る             | emergency
//   ...  +15,000/15,001ms+ ---...        | tick 後                   | 捨てる           | なし
//   ......(backspace) / .....(exit) / .-.-.-(send) の確定後 | -       | 空               | 以後 ---... では緊急にならない
//   -----(旧)                            | -                         | -                | なし
//   .....(5つ) → 待つ                    | 確定後                    | -                | exit(緊急と衝突しない)
describe('SOSは文字の切れ目から始まる場合だけ緊急(Issue #57)', () => {
  const SOS = '...---...'

  /** 符号列('.-' 表記)を、1押下ずつ間隔 gap で入れる。途中で event が出たらそこで止める */
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

  /** 各文字(符号の配列)を、文字ごとに確定させながら入れる。緊急が出たらそこで止める */
  function typeChars(codes: string[], initial: MorseState = startMorse(0)) {
    let state = initial
    let at = 0
    let events = 0
    let event: MorseResult['event'] = null
    for (const code of codes) {
      const out = pushAll(state, code, at)
      state = out.state
      at = out.at
      if (out.event) {
        events += 1
        event = out.event
        break
      }
      at += config.letterGapMs
      state = tickMorse(state, at, config).state // 文字の確定
    }
    return { state, at, events, event }
  }

  /** かな文字列を符号の配列にする(濁点・半濁点は「清音 + ゛」の2文字で打つ) */
  function encode(word: string): string[] {
    const codes: string[] = []
    for (const ch of word) {
      const base = ch.normalize('NFD')
      const [head, mark] = [base[0], base.slice(1)]
      codes.push(MORSE_TABLE[head])
      if (mark === '゙') codes.push(MORSE_TABLE['゛'])
      if (mark === '゚') codes.push(MORSE_TABLE['゜'])
    }
    return codes
  }

  it('8押下目まではどの接頭辞でも緊急にならず、9押下目だけで緊急になる', () => {
    for (let n = 1; n <= 8; n += 1) {
      expect(pushAll(startMorse(0), SOS.slice(0, n), 0).events).toBe(0)
    }
    const out = pushAll(startMorse(0), SOS, 0)
    expect(out.events).toBe(1)
    expect(out.event).toEqual({ type: 'emergency' })
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

  describe('文字の途中から始まる偶然一致は緊急にならない', () => {
    it('連続押下で、前の文字の末尾が SOS の先頭に続いても緊急にならない(入力中の符号は1文字)', () => {
      // か(.-..) の途中から ...---... が始まる列を休まず押す
      for (const prefix of ['.-', '-', '.-.-', '--']) {
        expect(pushAll(startMorse(0), prefix + SOS, 0).events).toBe(0)
      }
    })

    // かぜ=か せ ゛ など。各文字を確定しながら打つ(実際のかな入力)。符号の連結は SOS を含む
    const WORDS = ['かぜ', 'かぜぐすり', 'かぜです', 'おそく', 'おぞましい', 'おせう']
    for (const word of WORDS) {
      it(`「${word}」は符号の連結が SOS を含むが、緊急にならない`, () => {
        const codes = encode(word)
        expect(codes.join('')).toContain(SOS)
        const out = typeChars(codes)
        expect(out.events).toBe(0)
        // 最後の文字の確定待ちを経ても同じ
        const ticked = tickMorse(out.state, out.at + config.letterGapMs, config)
        expect(ticked.event).toBeNull()
      })
    }
  })

  describe('ゆっくり(確定をまたいで)打った SOS は緊急になり、SOS 由来の確定文字を巻き戻す', () => {
    it('「...」が「ら」で確定済みでも、続く「---...」で緊急になり「ら」が消える', () => {
      let { state, at } = pushAll(startMorse(0), '...', 0)
      state = tickMorse(state, at + config.letterGapMs, config).state
      expect(state.text).toBe('ら')
      expect(state.segments.map((seg) => seg.code)).toEqual(['...'])
      const out = pushAll(state, '---...', at + config.letterGapMs)
      expect(out.events).toBe(1)
      expect(out.event).toEqual({ type: 'emergency' })
      expect(out.state.text).toBe('')
      expect(out.state.segments).toEqual([])
    })

    it('全9押下が3文字(ら・れ・ら)に分かれても緊急になり、SOS 由来の「られ」が消える', () => {
      const out = typeChars(['...', '---', '...'])
      expect(out.events).toBe(1)
      expect(out.state.text).toBe('')
    })

    it('SOS の前の無関係な確定文字は残り、SOS 由来の文字だけが消える', () => {
      const out = typeChars(['.-', '...', '---', '...'], startMorse(0, 'あ'))
      expect(out.events).toBe(1)
      expect(out.state.text).toBe('あい')
    })

    it('断片は2押下+7押下などの任意の切れ目で成立する(へ・む・よ・ほ等の断片)', () => {
      const splits = [
        ['.', '..---...'],
        ['..', '.---...'],
        ['...-', '--...'],
        ['...--', '-...'],
        ['...---', '...'],
        ['...---.', '..'],
        ['.', '.', '.', '-', '-', '-', '.', '.', '.'],
      ]
      for (const codes of splits) {
        expect(codes.join('')).toBe(SOS)
        expect(typeChars(codes).events, codes.join('|')).toBe(1)
      }
    })

    it('入力中(確定前)の符号は最後の断片として扱う: 確定済み「---」+ 入力中「...」で緊急', () => {
      let state = typeChars(['...', '---']).state
      expect(state.code).toBe('')
      const out = pushAll(state, '...', 100000)
      expect(out.events).toBe(1)
    })

    it('断片でない文字(か)を確定すると断片列が切れ、その後の「---...」だけでは緊急にならない', () => {
      const out = typeChars(['...', '.-..', '---', '...'])
      expect(out.events).toBe(0)
    })

    it('前に無関係な文字があっても、SOS の先頭が文字境界から始まれば緊急になる', () => {
      const out = typeChars(['-.-.', '....', '.-', SOS])
      expect(out.events).toBe(1)
      expect(out.state.text).toBe('にぬい')
    })
  })

  describe('15秒で断片を捨てる(境目 MORSE_HISTORY_RESET_MS)', () => {
    const after = (gap: number) => {
      const first = pushAll(startMorse(0), '...', 0)
      const ticked = tickMorse(first.state, first.at + gap, config).state
      return { ticked, at: first.at + gap }
    }

    it('14,999ms 空けただけでは断片は残る', () => {
      expect(MORSE_HISTORY_RESET_MS).toBe(15000)
      expect(after(MORSE_HISTORY_RESET_MS - 1).ticked.segments.length).toBe(1)
    })

    it('15,000ms / 15,001ms で断片を捨てる', () => {
      expect(after(MORSE_HISTORY_RESET_MS).ticked.segments).toEqual([])
      expect(after(MORSE_HISTORY_RESET_MS + 1).ticked.segments).toEqual([])
    })

    it('14秒空けて残りの「---...」を押すと発火する', () => {
      const { ticked, at } = after(14000)
      expect(pushAll(ticked, '---...', at).event).toEqual({ type: 'emergency' })
    })

    it('離れた時間(15秒)をまたぐ偶然の一致では発火しない', () => {
      const { ticked, at } = after(MORSE_HISTORY_RESET_MS)
      expect(pushAll(ticked, '---...', at).events).toBe(0)
    })

    it('断片の破棄は文字列・入力中の符号を変えない', () => {
      const slow = { ...config, letterGapMs: 60000, wordGapMs: 61000 }
      const seeded = {
        ...startMorse(0, 'あ'),
        segments: [{ code: '...', textBefore: 'あ' }],
      }
      const first = pushAll(seeded, '-', 0)
      expect(first.state.code).toBe('-')
      const late = tickMorse(first.state, first.at + MORSE_HISTORY_RESET_MS, slow)
      expect(late.state.segments).toEqual([])
      expect(late.state.code).toBe('-')
      expect(late.state.text).toBe('あ')
      expect(late.event).toBeNull()
    })
  })

  describe('断片列を空にする契機', () => {
    it('緊急のあと断片は空で、続く「---...」では緊急にならず、SOS を入れ直せば1回ごとに発火する', () => {
      const first = pushAll(startMorse(0), SOS, 0)
      expect(first.state.segments).toEqual([])
      expect(pushAll(first.state, '---...', first.at).events).toBe(0)
      expect(pushAll(first.state, SOS, first.at).events).toBe(1)
    })

    it('・6つ(1字消す)を確定した直後の「---...」では緊急にならない', () => {
      const out = typeChars(['...', MORSE_CONTROL_CODES.backspace], startMorse(0, 'あい'))
      expect(out.state.segments).toEqual([])
      expect(out.state.text).toBe('あい')
      expect(typeChars(['---...'], out.state).events).toBe(0)
    })

    it('・5つ(exit)を確定した直後も断片は空で、「---...」では緊急にならない', () => {
      const { result, at } = type(startMorse(0), MORSE_CONTROL_CODES.exit, 0)
      expect(result.event).toEqual({ type: 'exit' })
      expect(result.state.segments).toEqual([])
      expect(pushAll(result.state, '---...', at).events).toBe(0)
    })

    it('確定(send)のあとも断片は空', () => {
      const { result } = type(startMorse(0, 'あ'), MORSE_CONTROL_CODES.send, 0)
      expect(result.event).toEqual({ type: 'send', text: 'あ' })
      expect(result.state.segments).toEqual([])
    })

    it('文字列が空で何も起きない確定(send)でも断片は空', () => {
      const { result } = type(startMorse(0), MORSE_CONTROL_CODES.send, 0)
      expect(result.event).toBeNull()
      expect(result.state.segments).toEqual([])
    })

    it('SOS の断片になる文字の確定では断片を覚え、そうでない文字の確定では空にする', () => {
      expect(type(startMorse(0), '...', 0).result.state.segments.length).toBe(1)
      expect(type(startMorse(0), '.-..', 0).result.state.segments).toEqual([])
    })

    it('startMorse の断片は空', () => {
      expect(startMorse(0, 'あ').segments).toEqual([])
    })
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
  })

  describe('和文符号表から機械的に列挙した、文字の連続(2〜3文字)での網羅', () => {
    const codes = Object.values(MORSE_TABLE)

    /** 独立した判定: ある文字の切れ目 i から連結した符号が SOS で始まれば、その押下で緊急になるはず */
    const alignedStart = (seq: string[]) =>
      seq.some((_, i) => seq.slice(i).join('').startsWith(SOS))

    const combos: string[][] = []
    for (const a of codes) {
      for (const b of codes) {
        combos.push([a, b])
        for (const c of codes) combos.push([a, b, c])
      }
    }
    // 連結符号が SOS を(どこかに)含む組
    const withSos = combos.filter((seq) => seq.join('').includes(SOS))
    const fired = withSos.filter((seq) => typeChars(seq).events > 0)
    const notFired = withSos.filter((seq) => typeChars(seq).events === 0)

    it('連結が SOS を含む組が存在する(列挙が空でない)', () => {
      expect(withSos.length).toBeGreaterThan(0)
    })

    it('SOS が文字の途中から始まる組(偶然一致)は、どれも発火しない', () => {
      const unaligned = withSos.filter((seq) => !alignedStart(seq))
      expect(unaligned.length).toBeGreaterThan(0)
      for (const seq of unaligned) expect(typeChars(seq).events, seq.join('|')).toBe(0)
      expect(notFired.length).toBe(unaligned.length)
    })

    it('SOS が文字の切れ目から始まる組(ゆっくり打った SOS)だけが発火する', () => {
      expect(fired.length).toBeGreaterThan(0)
      for (const seq of fired) expect(alignedStart(seq), seq.join('|')).toBe(true)
      expect(fired.length).toBe(withSos.filter(alignedStart).length)
    })
  })
})
