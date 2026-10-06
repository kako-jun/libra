import { describe, expect, it } from 'vitest'
import {
  computeGridLayout,
  GRID_FILL_MAX_ITEMS,
  LANDSCAPE_GRID,
  PORTRAIT_GRID,
} from '../gridLayout'

describe('computeGridLayout (固定格子, Issue #47)', () => {
  it('項目数0以下・幅高さ0以下では fill しない', () => {
    expect(computeGridLayout(0, 1000, 500).fill).toBe(false)
    expect(computeGridLayout(-1, 1000, 500).fill).toBe(false)
    expect(computeGridLayout(6, 0, 500).fill).toBe(false)
    expect(computeGridLayout(6, 1000, 0).fill).toBe(false)
  })

  it(`項目数が ${GRID_FILL_MAX_ITEMS} を超えるとスクロール(fill しない)`, () => {
    expect(computeGridLayout(GRID_FILL_MAX_ITEMS + 1, 1000, 500).fill).toBe(false)
    expect(computeGridLayout(GRID_FILL_MAX_ITEMS, 1000, 500).fill).toBe(true)
  })

  it('項目数1〜8のどれでも、同じ向きなら同じ列数×行数(項目数で変えない)', () => {
    for (const [w, h, grid] of [
      [844, 390, LANDSCAPE_GRID],
      [568, 320, LANDSCAPE_GRID],
      [390, 844, PORTRAIT_GRID],
      [320, 568, PORTRAIT_GRID],
    ] as const) {
      for (let n = 1; n <= GRID_FILL_MAX_ITEMS; n += 1) {
        expect(computeGridLayout(n, w, h)).toEqual({ fill: true, ...grid })
      }
    }
  })

  it('固定格子は8セルで、8項目がちょうど埋まる', () => {
    expect(LANDSCAPE_GRID.cols * LANDSCAPE_GRID.rows).toBe(GRID_FILL_MAX_ITEMS)
    expect(PORTRAIT_GRID.cols * PORTRAIT_GRID.rows).toBe(GRID_FILL_MAX_ITEMS)
  })

  it('幅 > 高さなら横長格子、高さ >= 幅(正方形を含む)なら縦長格子(CSS の orientation と同じ境界)', () => {
    expect(computeGridLayout(5, 601, 600)).toMatchObject(LANDSCAPE_GRID)
    expect(computeGridLayout(5, 600, 600)).toMatchObject(PORTRAIT_GRID)
    expect(computeGridLayout(5, 599, 600)).toMatchObject(PORTRAIT_GRID)
  })
})
