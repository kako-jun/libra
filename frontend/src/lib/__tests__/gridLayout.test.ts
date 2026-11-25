import { describe, expect, it } from 'vitest'
import {
  computeGridLayout,
  GRID_FILL_MAX_ITEMS,
  GRIDS,
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

describe('computeGridLayout の格子の種類(Issue #121/#123)', () => {
  it('home は縦長 2×5 / 横長 5×2 の10セルで、10項目までスクロールしない', () => {
    expect(computeGridLayout(10, 390, 844, 'home')).toEqual({ fill: true, cols: 2, rows: 5 })
    expect(computeGridLayout(10, 844, 390, 'home')).toEqual({ fill: true, cols: 5, rows: 2 })
    expect(computeGridLayout(11, 844, 390, 'home').fill).toBe(false)
  })

  it('letters は縦長 3×5 / 横長 5×3 の15セルで、行段階の14項目をスクロールなしで出す', () => {
    expect(computeGridLayout(14, 390, 844, 'letters')).toEqual({ fill: true, cols: 3, rows: 5 })
    expect(computeGridLayout(14, 844, 390, 'letters')).toEqual({ fill: true, cols: 5, rows: 3 })
    expect(computeGridLayout(15, 844, 390, 'letters').fill).toBe(true)
    expect(computeGridLayout(16, 844, 390, 'letters').fill).toBe(false)
  })

  it('種類を省略すると standard(8セル)で、home / letters は項目数によらず同じ格子を返す', () => {
    expect(computeGridLayout(8, 844, 390)).toEqual(computeGridLayout(8, 844, 390, 'standard'))
    expect(computeGridLayout(9, 844, 390).fill).toBe(false)
    for (const n of [1, 5, 10]) {
      expect(computeGridLayout(n, 390, 844, 'home')).toEqual({ fill: true, cols: 2, rows: 5 })
    }
    expect(GRIDS.standard.portrait).toEqual(PORTRAIT_GRID)
    expect(GRIDS.standard.landscape).toEqual(LANDSCAPE_GRID)
  })
})
