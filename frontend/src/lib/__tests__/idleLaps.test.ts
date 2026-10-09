import { describe, expect, it } from 'vitest'
import { advanceIdleLaps, IDLE_LAPS_BEFORE_HOME, UNDO_LAPS } from '../idleLaps'

describe('advanceIdleLaps', () => {
  it('周回の定数は取り消し2周・無入力3周', () => {
    expect(UNDO_LAPS).toBe(2)
    expect(IDLE_LAPS_BEFORE_HOME).toBe(3)
  })

  it('先頭へ戻った瞬間でなければ数えない', () => {
    expect(advanceIdleLaps(1, false)).toEqual({ count: 1, returnHome: false })
  })

  it('3周目の周回が終わった時点で戻す。2周では戻さない', () => {
    const first = advanceIdleLaps(0, true)
    expect(first).toEqual({ count: 1, returnHome: false })
    const second = advanceIdleLaps(first.count, true)
    expect(second).toEqual({ count: 2, returnHome: false })
    expect(advanceIdleLaps(second.count, true)).toEqual({ count: 0, returnHome: true })
  })

  it('入力で 0 に戻す(呼び出し側)と数え直しになる', () => {
    const second = advanceIdleLaps(advanceIdleLaps(0, true).count, true)
    expect(advanceIdleLaps(0, true).returnHome).toBe(false)
    expect(second.count).toBe(2)
  })

  it('上限は引数で変えられる', () => {
    expect(advanceIdleLaps(0, true, 1)).toEqual({ count: 0, returnHome: true })
  })
})
