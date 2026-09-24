import { describe, expect, it } from 'vitest'
import { press, resync, startScan, tick, type ScanConfig } from '../scan'

const config: ScanConfig = { intervalMs: 1000, headHoldMs: 2000, debounceMs: 500 }

describe('startScan', () => {
  it('nextAdvanceAt は now + headHoldMs になる', () => {
    const state = startScan(1000, config)
    expect(state).toEqual({ index: 0, nextAdvanceAt: 3000, lastPressAt: null })
  })

  it('headHoldMs=0 のとき nextAdvanceAt は now と同じになる', () => {
    const state = startScan(1000, { ...config, headHoldMs: 0 })
    expect(state.nextAdvanceAt).toBe(1000)
  })

  it('headHoldMs が負値のときは 0 に丸められる', () => {
    const state = startScan(1000, { ...config, headHoldMs: -500 })
    expect(state.nextAdvanceAt).toBe(1000)
  })
})

describe('tick', () => {
  it('now = nextAdvanceAt-1 のときカーソルは進まない', () => {
    const state = { index: 0, nextAdvanceAt: 1000, lastPressAt: null }
    const next = tick(state, 3, 999, config)
    expect(next).toBe(state)
  })

  it('now = nextAdvanceAt のときカーソルが1つ進む', () => {
    const state = { index: 0, nextAdvanceAt: 1000, lastPressAt: null }
    const next = tick(state, 3, 1000, config)
    expect(next.index).toBe(1)
  })

  it('now = nextAdvanceAt+1 のときもカーソルが1つ進む', () => {
    const state = { index: 0, nextAdvanceAt: 1000, lastPressAt: null }
    const next = tick(state, 3, 1001, config)
    expect(next.index).toBe(1)
  })

  it('末尾の項目から進むと先頭(0)にラップする', () => {
    const state = { index: 2, nextAdvanceAt: 1000, lastPressAt: null }
    const next = tick(state, 3, 1000, config)
    expect(next.index).toBe(0)
  })

  it('itemCount<=0 のときは状態を変えない', () => {
    const state = { index: 0, nextAdvanceAt: 1000, lastPressAt: null }
    const next = tick(state, 0, 1000, config)
    expect(next).toBe(state)
  })

  it('intervalMs が 0 でも次の進行間隔は最低 1ms になる', () => {
    const state = { index: 0, nextAdvanceAt: 1000, lastPressAt: null }
    const next = tick(state, 3, 1000, { ...config, intervalMs: 0 })
    expect(next.nextAdvanceAt).toBe(1001)
  })

  it('intervalMs が負値でも次の進行間隔は最低 1ms になる', () => {
    const state = { index: 0, nextAdvanceAt: 1000, lastPressAt: null }
    const next = tick(state, 3, 1000, { ...config, intervalMs: -100 })
    expect(next.nextAdvanceAt).toBe(1001)
  })
})

describe('press', () => {
  it('連打無視の境界: debounceMs-1 経過では無視される', () => {
    const state = { index: 1, nextAdvanceAt: 5000, lastPressAt: 1000 }
    const result = press(state, 3, 1000 + config.debounceMs - 1, config)
    expect(result.activatedIndex).toBeNull()
  })

  it('連打無視の境界: debounceMs ちょうど経過では実行される', () => {
    const state = { index: 1, nextAdvanceAt: 5000, lastPressAt: 1000 }
    const result = press(state, 3, 1000 + config.debounceMs, config)
    expect(result.activatedIndex).toBe(1)
  })

  it('連打無視の境界: debounceMs+1 経過でも実行される', () => {
    const state = { index: 1, nextAdvanceAt: 5000, lastPressAt: 1000 }
    const result = press(state, 3, 1000 + config.debounceMs + 1, config)
    expect(result.activatedIndex).toBe(1)
  })

  it('lastPressAt が null なら（初回押下）常に実行される', () => {
    const state = { index: 2, nextAdvanceAt: 5000, lastPressAt: null }
    const result = press(state, 3, 1000, config)
    expect(result.activatedIndex).toBe(2)
  })

  it('debounceMs=0 のときは直前と同時刻でも実行される', () => {
    const state = { index: 0, nextAdvanceAt: 5000, lastPressAt: 1000 }
    const result = press(state, 3, 1000, { ...config, debounceMs: 0 })
    expect(result.activatedIndex).toBe(0)
  })

  it('itemCount<=0 のときは activatedIndex が null になる', () => {
    const state = { index: 0, nextAdvanceAt: 5000, lastPressAt: null }
    const result = press(state, 0, 1000, config)
    expect(result.activatedIndex).toBeNull()
  })

  it('連打無視で無視されたとき lastPressAt は更新されない', () => {
    const state = { index: 0, nextAdvanceAt: 5000, lastPressAt: 1000 }
    const result = press(state, 3, 1100, config)
    expect(result.state.lastPressAt).toBe(1000)
  })
})

describe('resync', () => {
  it('index が itemCount 以上なら itemCount-1 に補正される', () => {
    const state = { index: 5, nextAdvanceAt: 1000, lastPressAt: null }
    const next = resync(state, 3)
    expect(next.index).toBe(2)
  })

  it('index が範囲内なら状態は変わらない', () => {
    const state = { index: 1, nextAdvanceAt: 1000, lastPressAt: null }
    const next = resync(state, 3)
    expect(next).toBe(state)
  })

  it('itemCount=0 のとき index は 0 に補正される', () => {
    const state = { index: 4, nextAdvanceAt: 1000, lastPressAt: null }
    const next = resync(state, 0)
    expect(next.index).toBe(0)
  })
})
