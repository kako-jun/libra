import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSwitchInput, type SwitchInputConfig } from '../switchInput'

function setup(config: SwitchInputConfig) {
  let cursor = 0
  const activated: number[] = []
  const progress: (number | null)[] = []
  const input = createSwitchInput({
    getConfig: () => config,
    snapshot: () => cursor,
    onActivate: (index) => activated.push(index),
    onProgress: (p) => progress.push(p),
  })
  return {
    input,
    activated,
    progress,
    moveCursor: (next: number) => {
      cursor = next
    },
  }
}

describe('switchInput', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
  })
  afterEach(() => vi.useRealTimers())

  it('既定(押した瞬間・下限なし)は押した時点で即決定する', () => {
    const { input, activated } = setup({ minHoldMs: 0, activateOn: 'press' })
    input.down('k')
    expect(activated).toEqual([0])
  })

  it('下限0.5秒: 0.2秒の押下は無視し、0.6秒の押下は決定する', () => {
    const { input, activated } = setup({ minHoldMs: 500, activateOn: 'press' })
    input.down('k')
    vi.advanceTimersByTime(200)
    input.up('k')
    vi.advanceTimersByTime(1000)
    expect(activated).toEqual([])

    input.down('k')
    vi.advanceTimersByTime(600)
    expect(activated).toEqual([0]) // 下限に達した時点で決定
    input.up('k')
    expect(activated).toEqual([0]) // 離しても二重に決定しない
  })

  it('押しっぱなし中にカーソルが進んでも、押し始めの項目を決定する', () => {
    const { input, activated, moveCursor } = setup({ minHoldMs: 500, activateOn: 'press' })
    moveCursor(2)
    input.down('k')
    moveCursor(3)
    vi.advanceTimersByTime(500)
    expect(activated).toEqual([2])
  })

  it('離して決定: 押下中は実行されず、離した時点で実行される', () => {
    const { input, activated } = setup({ minHoldMs: 0, activateOn: 'release' })
    input.down('k')
    vi.advanceTimersByTime(3000)
    expect(activated).toEqual([])
    input.up('k')
    expect(activated).toEqual([0])
  })

  it('離して決定 + 下限: 下限未満で離したら実行しない', () => {
    const { input, activated } = setup({ minHoldMs: 500, activateOn: 'release' })
    input.down('k')
    vi.advanceTimersByTime(300)
    input.up('k')
    expect(activated).toEqual([])
    input.down('k')
    vi.advanceTimersByTime(700)
    input.up('k')
    expect(activated).toEqual([0])
  })

  it('cancelAll した押下は離しても決定しない', () => {
    const { input, activated } = setup({ minHoldMs: 0, activateOn: 'release' })
    input.down('k')
    input.cancelAll()
    input.up('k')
    expect(activated).toEqual([])
  })

  it('離す動作を取りこぼしても、次の押下は新しい押下として扱う', () => {
    const { input, activated } = setup({ minHoldMs: 0, activateOn: 'release' })
    input.down('k')
    input.down('k')
    input.up('k')
    expect(activated).toEqual([0])
  })

  it('下限があるあいだ進捗を報告し、離すと null に戻る', () => {
    const { input, progress } = setup({ minHoldMs: 1000, activateOn: 'press' })
    input.down('k')
    vi.advanceTimersByTime(500)
    expect(progress.some((p) => p !== null && p > 0.4 && p < 0.6)).toBe(true)
    input.up('k')
    expect(progress.at(-1)).toBeNull()
  })
})
