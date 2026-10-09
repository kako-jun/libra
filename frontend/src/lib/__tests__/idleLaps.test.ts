import { describe, expect, it } from 'vitest'
import { advanceIdleSteps, IDLE_LAPS_BEFORE_HOME, UNDO_LAPS } from '../idleLaps'

/** n ステップ進めた結果(最後の 1 歩の結果を返す) */
function run(itemCount: number, n: number, start = 0) {
  let steps = start
  let last = { steps, returnHome: false }
  for (let i = 0; i < n; i += 1) {
    last = advanceIdleSteps(steps, itemCount)
    steps = last.steps
    if (last.returnHome) break
  }
  return last
}

describe('advanceIdleSteps', () => {
  it('周回の定数は取り消し2周・無入力3周', () => {
    expect(UNDO_LAPS).toBe(2)
    expect(IDLE_LAPS_BEFORE_HOME).toBe(3)
  })

  it('1歩ごとに 1 ずつ数える', () => {
    expect(advanceIdleSteps(0, 15)).toEqual({ steps: 1, returnHome: false })
    expect(advanceIdleSteps(7, 15)).toEqual({ steps: 8, returnHome: false })
  })

  it('項目数×3 ステップ目で戻す。1 歩手前では戻さない', () => {
    expect(run(15, 15 * 3 - 1)).toEqual({ steps: 44, returnHome: false })
    expect(run(15, 15 * 3)).toEqual({ steps: 0, returnHome: true })
  })

  it('項目数が違えば必要なステップ数も違う(判定時点の項目数で決まる)', () => {
    expect(run(4, 11).returnHome).toBe(false)
    expect(run(4, 12).returnHome).toBe(true)
    // 途中で項目数が減っても、判定時点の項目数×3 に達していれば戻す
    expect(advanceIdleSteps(11, 4)).toEqual({ steps: 0, returnHome: true })
  })

  it('上限の周回数は引数で変えられる', () => {
    expect(advanceIdleSteps(5, 6, 1)).toEqual({ steps: 0, returnHome: true })
    expect(advanceIdleSteps(4, 6, 1)).toEqual({ steps: 5, returnHome: false })
  })

  it('項目数 0 でも壊れない(最低 1 項目として扱う)', () => {
    expect(advanceIdleSteps(0, 0, 1)).toEqual({ steps: 0, returnHome: true })
  })
})
