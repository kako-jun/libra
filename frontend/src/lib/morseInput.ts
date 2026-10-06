// モールス入力の押下時間の計測と、時間経過(文字確定・語確定・無操作でスキャンへ戻る)の駆動。
// 符号の判定そのものは morse.ts(副作用なし)。ここはスイッチの押下/解放と時計を繋ぐだけ。
// 正本: docs/requirements.md §4.7 / Issue #14

import {
  pushSymbol,
  startMorse,
  tickMorse,
  type MorseConfig,
  type MorseEvent,
  type MorseState,
  type MorseSymbol,
} from './morse'

export interface MorseInputConfig extends MorseConfig {
  /** この時間に満たない押下は雑音として無視する(ms)。#6 の押下時間の下限 */
  noiseMs: number
}

export interface MorseInputOptions {
  getConfig: () => MorseInputConfig
  /** 状態(入力中の符号・確定済みの文字列)が変わった */
  onState: (state: MorseState) => void
  /** 緊急・スキャンへ戻る・伝達の確定 */
  onEvent: (event: Exclude<MorseEvent, null>) => void
  /** 介助者メニューが開いている間など、時間経過(文字確定・無操作での復帰)を止めたいとき true */
  isPaused?: () => boolean
  /** 押している間の符号(短点/長点の見込み)。押下中でなければ null */
  onHold?: (symbol: MorseSymbol | null) => void
}

const TICK_INTERVAL_MS = 50

/** 解放を取りこぼして押しっぱなしになった入力を、符号にせず捨てる時間(ms)。無操作での復帰を妨げない */
export const MORSE_MAX_HOLD_MS = 10000

export interface MorseInput {
  /** モールス画面に入った。text は前回までの確定済み文字列 */
  start: (text: string) => void
  /** モールス画面を出た。タイマーと押下中の入力を止める */
  stop: () => void
  down: (sourceId: string) => void
  up: (sourceId: string) => void
  /** 指定した入力元の押下だけを取り消す(符号にしない) */
  cancel: (sourceId: string) => void
  cancelAll: () => void
}

export function createMorseInput(options: MorseInputOptions): MorseInput {
  let state: MorseState | null = null
  let tickId: number | undefined
  const pressed = new Map<string, number>()

  const symbolFor = (heldMs: number): MorseSymbol =>
    heldMs >= options.getConfig().dashMs ? '-' : '.'

  const reportHold = () => {
    if (!options.onHold) return
    if (pressed.size === 0) {
      options.onHold(null)
      return
    }
    const now = Date.now()
    const longest = Math.max(...Array.from(pressed.values(), (startedAt) => now - startedAt))
    options.onHold(symbolFor(longest))
  }

  const apply = (next: { state: MorseState; event: MorseEvent }) => {
    state = next.state
    options.onState(state)
    if (next.event) {
      options.onEvent(next.event)
      // スキャンへ戻るときは、呼び出し側の対応を待たずに自分も止める(exit を繰り返し出さない)
      if (next.event.type === 'exit') stop()
    }
  }

  const tick = () => {
    if (!state) return
    if (options.isPaused?.()) return
    const now = Date.now()
    // 解放を取りこぼした押下が残り続けると、文字確定も無操作での復帰も止まってしまう
    for (const [sourceId, startedAt] of Array.from(pressed.entries())) {
      if (now - startedAt > MORSE_MAX_HOLD_MS) pressed.delete(sourceId)
    }
    // 押している間は、文字の確定・語の区切り・無操作での復帰を進めない。時間は離した時刻から測る。
    // (長押しの最中に確定されると、SOS の符号がばらけて届かなくなる)
    if (pressed.size === 0) {
      const before = state
      const result = tickMorse(state, now, options.getConfig())
      if (result.state !== before || result.event) apply(result)
    }
    reportHold()
  }

  const clearTimer = () => {
    if (tickId !== undefined) {
      window.clearInterval(tickId)
      tickId = undefined
    }
  }

  const start = (text: string) => {
    clearTimer()
    pressed.clear()
    state = startMorse(Date.now(), text)
    options.onState(state)
    options.onHold?.(null)
    tickId = window.setInterval(tick, TICK_INTERVAL_MS)
  }

  const stop = () => {
    clearTimer()
    pressed.clear()
    state = null
    options.onHold?.(null)
  }

  const down = (sourceId: string) => {
    if (!state) return
    // 解放を取りこぼした古い押下が残っていても、新しい押下として仕切り直す
    pressed.set(sourceId, Date.now())
    reportHold()
  }

  const up = (sourceId: string) => {
    const startedAt = pressed.get(sourceId)
    if (startedAt === undefined || !state) return
    pressed.delete(sourceId)
    const now = Date.now()
    const heldMs = now - startedAt
    reportHold()
    if (heldMs < options.getConfig().noiseMs) return
    apply(pushSymbol(state, symbolFor(heldMs), now))
  }

  const cancel = (sourceId: string) => {
    pressed.delete(sourceId)
    reportHold()
  }

  const cancelAll = () => {
    pressed.clear()
    options.onHold?.(null)
  }

  return { start, stop, down, up, cancel, cancelAll }
}
