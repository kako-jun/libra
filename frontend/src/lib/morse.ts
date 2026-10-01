// モールス入力(和文モールス)の符号表と状態遷移。副作用なし。時刻は引数で受け取る。
// 正本: docs/requirements.md §4.7 / Issue #14
//
// 符号は内部では '.'(短点・短押し)と '-'(長点・長押し)で持ち、表示側で ・ － に直す。
// 緊急の符号(長押し5つの連続)は、符号の確定を待たず5つ目の長押しを離した時点で即座に出す。

export type MorseSymbol = '.' | '-'

/** 和文モールス(かな)。濁点・半濁点・長音を含む */
export const MORSE_TABLE: Record<string, string> = {
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

/** 緊急: 長押し5つの連続。かなの符号には無い(数字の0にあたる)。5つ目を離した時点で即緊急 */
export const MORSE_EMERGENCY_CODE = '-----'

/** 操作の符号。文字の確定(無入力)を待って判定する。かなの符号とは重ならない */
export const MORSE_CONTROL_CODES = {
  /** モールス入力をやめてスキャンへ戻る(短押し5つ) */
  exit: '.....',
  /** 1字消す(短押し6つ) */
  backspace: '......',
  /** 入力した文字列を伝達として確定する */
  send: '.-.-.-',
} as const

export type MorseControl = keyof typeof MORSE_CONTROL_CODES

/** 無操作がこれだけ続くとスキャンへ戻る(モールス中に本人が取り残されないため)。符号入力中は対象外 */
export const MORSE_IDLE_EXIT_MS = 30000

/** 語の区切り(分かち書き)として入れる文字 */
export const MORSE_WORD_SEPARATOR = '　'

const DECODE: Record<string, string> = Object.fromEntries(
  Object.entries(MORSE_TABLE).map(([char, code]) => [code, char]),
)

const DAKUTEN: Record<string, string> = {
  う: 'ゔ',
  か: 'が',
  き: 'ぎ',
  く: 'ぐ',
  け: 'げ',
  こ: 'ご',
  さ: 'ざ',
  し: 'じ',
  す: 'ず',
  せ: 'ぜ',
  そ: 'ぞ',
  た: 'だ',
  ち: 'ぢ',
  つ: 'づ',
  て: 'で',
  と: 'ど',
  は: 'ば',
  ひ: 'び',
  ふ: 'ぶ',
  へ: 'べ',
  ほ: 'ぼ',
}

const HANDAKUTEN: Record<string, string> = {
  は: 'ぱ',
  ひ: 'ぴ',
  ふ: 'ぷ',
  へ: 'ぺ',
  ほ: 'ぽ',
}

/** 符号(内部表記)からかなを引く。無ければ null。濁点・半濁点は '゛' '゜' を返す */
export function decodeMorse(code: string): string | null {
  return DECODE[code] ?? null
}

/** 内部表記の符号を表示用(・ －)にする */
export function formatMorseCode(code: string): string {
  return Array.from(code, (c) => (c === '.' ? '・' : '－')).join(' ')
}

/** この時間に満たない押下は接点のばたつき等の雑音として符号にしない(ms)。押下時間の下限(#6)が大きければそれに従う */
export function morseNoiseMs(minHoldMs: number): number {
  return Math.max(10, minHoldMs)
}

/** 実際に使う長押し(－)の境目(ms)。押下時間の下限(#6)より必ず長くする(下限未満は雑音で捨てるため) */
export function effectiveDashMs(dashMs: number, minHoldMs: number): number {
  return Math.max(dashMs, morseNoiseMs(minHoldMs) + 100)
}

export interface MorseConfig {
  /** 押している時間がこれ以上なら長押し(－)(ms) */
  dashMs: number
  /** 無入力がこれ続くと、入力中の符号を1文字として確定する(ms) */
  letterGapMs: number
  /** 無入力がこれ続くと語の区切りを入れる(ms)。letterGapMs より長い */
  wordGapMs: number
}

export interface MorseState {
  /** 入力中の符号(内部表記)。空なら文字の合間 */
  code: string
  /** 確定済みの文字列(語の区切りを含む) */
  text: string
  /** 最後に符号が入力された時刻(ms)。モールスに入った時刻で始まる */
  lastAt: number
  /** 現在の無入力区間で語の区切りを入れ済みか */
  wordMarked: boolean
}

export type MorseEvent =
  | { type: 'emergency' }
  | { type: 'exit' }
  | { type: 'send'; text: string }
  | null

export interface MorseResult {
  state: MorseState
  event: MorseEvent
}

export function startMorse(now: number, text = ''): MorseState {
  // 入り直した直後に、既存の文字列へ勝手に語の区切りを足さない(次の入力まで)
  return { code: '', text, lastAt: now, wordMarked: true }
}

/** 符号(短点/長点)が1つ入力された。長押し5つの連続は確定を待たず緊急にする。 */
export function pushSymbol(state: MorseState, symbol: MorseSymbol, now: number): MorseResult {
  const code = state.code + symbol
  // 直前に誤って別の符号が入っていても、末尾が長押し5つの連続なら緊急(取りこぼさない)
  if (code.endsWith(MORSE_EMERGENCY_CODE)) {
    return {
      state: { ...state, code: '', lastAt: now, wordMarked: false },
      event: { type: 'emergency' },
    }
  }
  return { state: { ...state, code, lastAt: now, wordMarked: false }, event: null }
}

/** 濁点・半濁点の付いた文字から、付く前の文字を引く(ば→は、ぱ→は)。付いていなければそのまま */
const UNMARKED: Record<string, string> = Object.fromEntries(
  [...Object.entries(DAKUTEN), ...Object.entries(HANDAKUTEN)].map(([base, marked]) => [
    marked,
    base,
  ]),
)

/** 末尾の文字へ濁点/半濁点を付ける(ば→ぱ のように付け替えもできる)。付けられなければ null */
function applyMark(text: string, mark: '゛' | '゜'): string | null {
  const chars = Array.from(text)
  const last = chars[chars.length - 1]
  if (last === undefined) return null
  const map = mark === '゛' ? DAKUTEN : HANDAKUTEN
  const marked = map[UNMARKED[last] ?? last]
  if (!marked) return null
  chars[chars.length - 1] = marked
  return chars.join('')
}

function commitCode(state: MorseState): MorseResult {
  const { code } = state
  // 消した後・捨てた後に、考えている間の無入力で語の区切りが勝手に入らないよう、
  // 次の入力まで語の区切りは入れない(wordMarked)
  const cleared = { ...state, code: '', wordMarked: true }

  if (code === MORSE_CONTROL_CODES.exit) return { state: cleared, event: { type: 'exit' } }
  if (code === MORSE_CONTROL_CODES.backspace) {
    return {
      state: { ...cleared, text: Array.from(state.text).slice(0, -1).join('') },
      event: null,
    }
  }
  if (code === MORSE_CONTROL_CODES.send) {
    const text = state.text.trim()
    return { state: cleared, event: text ? { type: 'send', text } : null }
  }

  const char = decodeMorse(code)
  if (char === null) return { state: cleared, event: null } // 該当なしの符号は捨てる
  if (char === '゛' || char === '゜') {
    const next = applyMark(state.text, char)
    return { state: next === null ? cleared : { ...cleared, text: next }, event: null }
  }
  // 文字を足したあとは、続く無入力で語の区切りを入れてよい
  return { state: { ...cleared, text: state.text + char, wordMarked: false }, event: null }
}

/**
 * 時間経過の処理。無入力が letterGapMs 続けば入力中の符号を確定し、さらに wordGapMs 続けば
 * 語の区切りを入れ、MORSE_IDLE_EXIT_MS 続けばスキャンへ戻る(exit)。
 */
export function tickMorse(state: MorseState, now: number, config: MorseConfig): MorseResult {
  const idle = now - state.lastAt

  if (state.code !== '') {
    if (idle >= config.letterGapMs) return commitCode(state)
    return { state, event: null }
  }

  if (idle >= MORSE_IDLE_EXIT_MS) return { state, event: { type: 'exit' } }

  if (
    !state.wordMarked &&
    idle >= config.wordGapMs &&
    state.text !== '' &&
    !state.text.endsWith(MORSE_WORD_SEPARATOR)
  ) {
    return {
      state: { ...state, text: state.text + MORSE_WORD_SEPARATOR, wordMarked: true },
      event: null,
    }
  }
  return { state, event: null }
}
