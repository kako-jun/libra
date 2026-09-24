import { describe, expect, it } from 'vitest'
import { computeGridLayout, GRID_FILL_MAX_ITEMS } from '../gridLayout'

// 固定の格子領域サイズ(実測サイズの代わり)。aspect = width/height
const LANDSCAPE = { width: 1000, height: 500 } // aspect 2.0
const PORTRAIT = { width: 500, height: 1000 } // aspect 0.5
const SQUARE = { width: 600, height: 600 } // aspect 1.0

describe('computeGridLayout', () => {
  it('項目数0以下では fill しない', () => {
    expect(computeGridLayout(0, 1000, 500).fill).toBe(false)
    expect(computeGridLayout(-1, 1000, 500).fill).toBe(false)
  })

  it('幅または高さが0以下では fill しない', () => {
    expect(computeGridLayout(6, 0, 500).fill).toBe(false)
    expect(computeGridLayout(6, 1000, 0).fill).toBe(false)
  })

  it(`項目数が GRID_FILL_MAX_ITEMS(${GRID_FILL_MAX_ITEMS})を超えると fill しない(スクロール画面向け)`, () => {
    const result = computeGridLayout(GRID_FILL_MAX_ITEMS + 1, 1000, 500)
    expect(result.fill).toBe(false)
  })

  it(`項目数が GRID_FILL_MAX_ITEMS(${GRID_FILL_MAX_ITEMS})ちょうどなら fill する`, () => {
    expect(computeGridLayout(GRID_FILL_MAX_ITEMS, 1000, 500).fill).toBe(true)
  })

  describe('横長(landscape 1000x500, aspect 2.0)', () => {
    const expected: Record<number, { cols: number; rows: number; lastSpan: number }> = {
      2: { cols: 2, rows: 1, lastSpan: 1 },
      3: { cols: 3, rows: 1, lastSpan: 1 },
      4: { cols: 4, rows: 1, lastSpan: 1 },
      5: { cols: 3, rows: 2, lastSpan: 2 },
      6: { cols: 3, rows: 2, lastSpan: 1 },
      7: { cols: 4, rows: 2, lastSpan: 2 },
      8: { cols: 4, rows: 2, lastSpan: 1 },
    }
    for (const [n, want] of Object.entries(expected)) {
      it(`n=${n} → ${want.cols}列×${want.rows}行(lastSpan=${want.lastSpan})`, () => {
        const result = computeGridLayout(Number(n), LANDSCAPE.width, LANDSCAPE.height)
        expect(result).toEqual({ fill: true, ...want })
      })
    }
  })

  describe('縦長(portrait 500x1000, aspect 0.5)', () => {
    const expected: Record<number, { cols: number; rows: number; lastSpan: number }> = {
      2: { cols: 1, rows: 2, lastSpan: 1 },
      3: { cols: 1, rows: 3, lastSpan: 1 },
      4: { cols: 2, rows: 2, lastSpan: 1 },
      5: { cols: 2, rows: 3, lastSpan: 2 },
      6: { cols: 2, rows: 3, lastSpan: 1 },
      7: { cols: 2, rows: 4, lastSpan: 2 },
      8: { cols: 2, rows: 4, lastSpan: 1 },
    }
    for (const [n, want] of Object.entries(expected)) {
      it(`n=${n} → ${want.cols}列×${want.rows}行(lastSpan=${want.lastSpan})`, () => {
        const result = computeGridLayout(Number(n), PORTRAIT.width, PORTRAIT.height)
        expect(result).toEqual({ fill: true, ...want })
      })
    }
  })

  describe('正方形(square 600x600, aspect 1.0)', () => {
    const expected: Record<number, { cols: number; rows: number; lastSpan: number }> = {
      2: { cols: 2, rows: 1, lastSpan: 1 },
      3: { cols: 2, rows: 2, lastSpan: 2 },
      4: { cols: 2, rows: 2, lastSpan: 1 },
      5: { cols: 3, rows: 2, lastSpan: 2 },
      6: { cols: 3, rows: 2, lastSpan: 1 },
      7: { cols: 7, rows: 1, lastSpan: 1 },
      8: { cols: 3, rows: 3, lastSpan: 2 },
    }
    for (const [n, want] of Object.entries(expected)) {
      it(`n=${n} → ${want.cols}列×${want.rows}行(lastSpan=${want.lastSpan})`, () => {
        const result = computeGridLayout(Number(n), SQUARE.width, SQUARE.height)
        expect(result).toEqual({ fill: true, ...want })
      })
    }
  })

  it('lastSpan は常に1か2で、cols*rows - itemCount(空きセル数)は1以下', () => {
    for (const dims of [LANDSCAPE, PORTRAIT, SQUARE]) {
      for (let n = 2; n <= GRID_FILL_MAX_ITEMS; n += 1) {
        const result = computeGridLayout(n, dims.width, dims.height)
        expect(result.lastSpan === 1 || result.lastSpan === 2).toBe(true)
        expect(result.cols * result.rows - n).toBeLessThanOrEqual(1)
      }
    }
  })
})
