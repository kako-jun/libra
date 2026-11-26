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
  it('home の通常 8 項目は、空きマスの無い 縦長 2×4 / 横長 4×2(Issue #127)', () => {
    expect(computeGridLayout(8, 390, 844, 'home')).toEqual({ fill: true, cols: 2, rows: 4 })
    expect(computeGridLayout(8, 844, 390, 'home')).toEqual({ fill: true, cols: 4, rows: 2 })
  })

  it('home のモールス使用 9 項目は 縦長 2×5 / 横長 5×2(空き 1 マス)。11 項目はスクロール', () => {
    expect(computeGridLayout(9, 390, 844, 'home')).toEqual({ fill: true, cols: 2, rows: 5 })
    expect(computeGridLayout(9, 844, 390, 'home')).toEqual({ fill: true, cols: 5, rows: 2 })
    expect(computeGridLayout(11, 844, 390, 'home').fill).toBe(false)
  })

  // Issue #126: はい・いいえ は並びの添字 2・3。列数から段と列を出し、同じ段で左右に隣り合うことを確かめる
  it.each([
    [320, 568],
    [390, 844],
    [600, 600],
    [600, 960],
    [768, 1024],
    [1024, 1366],
    [568, 320],
    [844, 390],
    [1024, 768],
    [1280, 720],
  ])(
    '%ix%i: 8 項目でも 9 項目でも はい と いいえ は同じ段で隣り合い、丸ごと空く段が無い',
    (w, h) => {
      for (const count of [8, 9]) {
        const { fill, cols, rows } = computeGridLayout(count, w, h, 'home')
        expect(fill).toBe(true)
        expect(Math.floor(2 / cols)).toBe(Math.floor(3 / cols))
        expect(cols * rows - count).toBe(count === 8 ? 0 : 1)
      }
    },
  )

  it('letters は縦長 3×5 / 横長 5×3 の15セルで、行段階の14項目をスクロールなしで出す', () => {
    expect(computeGridLayout(14, 390, 844, 'letters')).toEqual({ fill: true, cols: 3, rows: 5 })
    expect(computeGridLayout(14, 844, 390, 'letters')).toEqual({ fill: true, cols: 5, rows: 3 })
    expect(computeGridLayout(15, 844, 390, 'letters').fill).toBe(true)
    expect(computeGridLayout(16, 844, 390, 'letters').fill).toBe(false)
  })

  it('種類を省略すると standard(8セル)で、letters は項目数によらず同じ格子、home は 8 項目以内なら standard と同じ', () => {
    expect(computeGridLayout(8, 844, 390)).toEqual(computeGridLayout(8, 844, 390, 'standard'))
    expect(computeGridLayout(9, 844, 390).fill).toBe(false)
    for (const n of [1, 5, 14]) {
      expect(computeGridLayout(n, 390, 844, 'letters')).toEqual({ fill: true, cols: 3, rows: 5 })
    }
    for (const n of [1, 5, 8]) {
      expect(computeGridLayout(n, 390, 844, 'home')).toEqual(computeGridLayout(n, 390, 844))
    }
    expect(GRIDS.standard.portrait).toEqual(PORTRAIT_GRID)
    expect(GRIDS.standard.landscape).toEqual(LANDSCAPE_GRID)
  })
})
