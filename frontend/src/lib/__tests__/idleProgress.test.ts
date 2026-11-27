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
  // 2 項目の画面は 6 項目ぶん進むと戻る
  const base = {
    steps: 0,
    itemCount: 2,
    resetAt: 0,
    advancedAt: 0,
    nextAdvanceAt: 2000,
    now: 0,
    held: false,
  }

  it('数え直した直後は 0', () => {
    expect(lapProgress(base)).toBe(0)
    // 項目の途中で数え直しても、その項目の経過ぶんは持ち越さない
    expect(lapProgress({ ...base, resetAt: 1500, now: 1500 })).toBe(0)
  })

  it('進んだ項目数に、いまの項目の経過ぶんを足す', () => {
    expect(lapProgress({ ...base, now: 1000 })).toBeCloseTo(0.5 / 6)
    expect(
      lapProgress({ ...base, steps: 3, advancedAt: 5000, nextAdvanceAt: 6500, now: 5000 }),
    ).toBeCloseTo(3 / 6)
  })

  it('ホームへ戻る瞬間(最後の項目の次へ進む時刻)にちょうど 1。手前では 1 未満', () => {
    const last = { ...base, steps: 5, advancedAt: 8000, nextAdvanceAt: 9500 }
    expect(lapProgress({ ...last, now: 9499 })).toBeLessThan(1)
    expect(lapProgress({ ...last, now: 9500 })).toBe(1)
    expect(lapProgress({ ...last, now: 9999 })).toBe(1)
  })

  it('押している間は 0', () => {
    expect(lapProgress({ ...base, steps: 4, now: 1000, held: true })).toBe(0)
  })
})
