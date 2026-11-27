import { describe, expect, it } from 'vitest'
import { lapProgress, timeProgress } from '../idleProgress'

describe('timeProgress', () => {
  it('起点で 0、時間どおりで 1、範囲外は切り詰める', () => {
    expect(timeProgress(1000, 60000, 1000)).toBe(0)
    expect(timeProgress(1000, 60000, 31000)).toBe(0.5)
    expect(timeProgress(1000, 60000, 61000)).toBe(1)
    expect(timeProgress(1000, 60000, 90000)).toBe(1)
    expect(timeProgress(1000, 60000, 0)).toBe(0)
  })
})

describe('lapProgress', () => {
  // 2 項目の画面は 6 項目ぶん進むと戻る。先頭待機 2000ms、間隔 1500ms なら 9500ms で戻る
  const base = {
    steps: 0,
    itemCount: 2,
    resetAt: 0,
    nextAdvanceAt: 2000,
    intervalMs: 1500,
    now: 0,
    held: false,
  }

  it('数え直した直後は 0', () => {
    expect(lapProgress(base)).toBe(0)
    // 項目の途中で数え直しても、その項目の経過ぶんは持ち越さない
    expect(lapProgress({ ...base, resetAt: 1500, now: 1500 })).toBe(0)
  })

  it('時間に比例して満ちる。長くとどまる先頭でも速さは変わらない', () => {
    expect(lapProgress({ ...base, now: 950 })).toBeCloseTo(0.1)
    expect(lapProgress({ ...base, now: 1900 })).toBeCloseTo(0.2)
    // 先頭を過ぎて次の項目に移っても、同じ時刻の値はつながる
    const before = lapProgress({ ...base, now: 2000 })
    const after = lapProgress({ ...base, steps: 1, nextAdvanceAt: 3500, now: 2000 })
    expect(before).toBeCloseTo(2000 / 9500)
    expect(after).toBeCloseTo(before)
    expect(lapProgress({ ...base, steps: 3, nextAdvanceAt: 6500, now: 5700 })).toBeCloseTo(0.6)
  })

  it('途中で数え直すと、そこから戻る時刻までを 0 から 1 にする', () => {
    // 項目の途中(2750ms)で数え直す。次に進むのは 3500ms、残り 5 項目ぶんで 11000ms に戻る
    const input = { ...base, resetAt: 2750, nextAdvanceAt: 3500 }
    expect(lapProgress({ ...input, now: 2750 })).toBe(0)
    expect(lapProgress({ ...input, now: 2750 + (11000 - 2750) / 2 })).toBeCloseTo(0.5)
  })

  it('ホームへ戻る瞬間(最後の項目の次へ進む時刻)にちょうど 1。手前では 1 未満', () => {
    const last = { ...base, steps: 5, nextAdvanceAt: 9500 }
    expect(lapProgress({ ...last, now: 9499 })).toBeLessThan(1)
    expect(lapProgress({ ...last, now: 9500 })).toBe(1)
    expect(lapProgress({ ...last, now: 9999 })).toBe(1)
  })

  it('押している間は 0', () => {
    expect(lapProgress({ ...base, steps: 4, now: 1000, held: true })).toBe(0)
  })
})
