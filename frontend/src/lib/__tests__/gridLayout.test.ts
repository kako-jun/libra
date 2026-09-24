import { describe, expect, it } from 'vitest'
import {
  computeGridLayout,
  DEFAULT_MIN_CELL_HEIGHT,
  DEFAULT_MIN_CELL_WIDTH,
  GRID_FILL_MAX_ITEMS,
} from '../gridLayout'

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

  describe('横長(landscape 1000x500, aspect 2.0, 既定の最小セル寸法)', () => {
    const expected: Record<number, { cols: number; rows: number; lastSpan: number }> = {
      2: { cols: 2, rows: 1, lastSpan: 1 },
      3: { cols: 3, rows: 1, lastSpan: 1 },
      4: { cols: 2, rows: 2, lastSpan: 1 },
      5: { cols: 5, rows: 1, lastSpan: 1 },
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

  describe('縦長(portrait 500x1000, aspect 0.5, 既定の最小セル寸法)', () => {
    // PR#16 3巡目 must-2: 評価関数を |log(cellAspect)|(正方形に近いか)から
    // score=min(0.15*cellWidth, 0.20*cellHeight)(ラベル文字が何pxまで大きくなれるか)の
    // 最大化に変更。n=7 は空きセル数が0になる候補が cols=1(1列7行、全幅の縦積み)しか
    // 無く、空きセル最小優先(維持する制約)によりそちらが選ばれるため 2列×4行(span2)
    // から 1列×7行 に変わる(1列でも幅は500pxとcqi上限に対し十分あり、細い帯ではない)
    const expected: Record<number, { cols: number; rows: number; lastSpan: number }> = {
      2: { cols: 1, rows: 2, lastSpan: 1 },
      3: { cols: 1, rows: 3, lastSpan: 1 },
      4: { cols: 1, rows: 4, lastSpan: 1 },
      5: { cols: 1, rows: 5, lastSpan: 1 },
      6: { cols: 2, rows: 3, lastSpan: 1 },
      7: { cols: 1, rows: 7, lastSpan: 1 },
      8: { cols: 2, rows: 4, lastSpan: 1 },
    }
    for (const [n, want] of Object.entries(expected)) {
      it(`n=${n} → ${want.cols}列×${want.rows}行(lastSpan=${want.lastSpan})`, () => {
        const result = computeGridLayout(Number(n), PORTRAIT.width, PORTRAIT.height)
        expect(result).toEqual({ fill: true, ...want })
      })
    }
  })

  describe('正方形(square 600x600, aspect 1.0, 既定の最小セル寸法)', () => {
    // PR#16 3巡目 must-2: 上のportraitと同じ理由で、空きセル数0を実現できる列数が
    // 1列しか無い n(3,5,7)は、スコア(ラベル文字の大きさ)ではなく空きセル数0が優先され
    // 1列の縦積みになる(600px幅は十分広く、細い帯ではない)
    const expected: Record<number, { cols: number; rows: number; lastSpan: number }> = {
      2: { cols: 1, rows: 2, lastSpan: 1 },
      3: { cols: 1, rows: 3, lastSpan: 1 },
      4: { cols: 2, rows: 2, lastSpan: 1 },
      5: { cols: 1, rows: 5, lastSpan: 1 },
      6: { cols: 2, rows: 3, lastSpan: 1 },
      7: { cols: 1, rows: 7, lastSpan: 1 },
      8: { cols: 2, rows: 4, lastSpan: 1 },
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

  it('選ばれた列数・行数のセルは既定の最小セル寸法(160x84)を下回らない', () => {
    for (const dims of [LANDSCAPE, PORTRAIT, SQUARE]) {
      for (let n = 2; n <= GRID_FILL_MAX_ITEMS; n += 1) {
        const result = computeGridLayout(n, dims.width, dims.height)
        if (!result.fill) continue
        expect(dims.width / result.cols).toBeGreaterThanOrEqual(DEFAULT_MIN_CELL_WIDTH)
        expect(dims.height / result.rows).toBeGreaterThanOrEqual(DEFAULT_MIN_CELL_HEIGHT)
      }
    }
  })

  describe('最小セル寸法(minCellWidth/minCellHeight)のオプション', () => {
    it('最小セル寸法を満たす分割が無い場合は fill しない(スクロールへフォールバック)', () => {
      // 8項目を 50x50 の領域に収めようとしても、既定の最小セル寸法(160x84)を
      // 満たす分割は存在しない
      const result = computeGridLayout(8, 50, 50)
      expect(result.fill).toBe(false)
    })

    it('minCellWidth/minCellHeight を大きくすると、それに応じて列数が絞られる', () => {
      // 8項目、実測領域は 1200x900。最小セル寸法が既定(160x84)なら2列×4行(セル幅600px)
      // が選ばれるが、最小幅を650pxまで引き上げると2列(セル幅600px)は入らなくなり、
      // 1列(全幅、セル幅1200px)まで列数が減る
      const withDefault = computeGridLayout(8, 1200, 900)
      expect(withDefault.cols).toBe(2)
      const withLargerMin = computeGridLayout(8, 1200, 900, { minCellWidth: 650 })
      expect(withLargerMin.cols).toBeLessThan(2)
      expect(1200 / withLargerMin.cols).toBeGreaterThanOrEqual(650)
    })
  })

  // PR#16 Opus レビュー: 実機の画面サイズ(768x1024 / 390x844 / 320x568)相当の
  // 格子領域サイズで、細い帯(cols=itemCount や rows=itemCount)が選ばれないことを確認する。
  // grid-board の実際の高さはメッセージ欄等を差し引いた値になるため、ここではおおよその
  // 実測値を模した数値を使う。
  describe('実機サイズ相当(768x1024 / 390x844 / 320x568)', () => {
    const realDims: Record<string, { width: number; height: number }> = {
      '768x1024(グリッド領域 768x850相当)': { width: 768, height: 850 },
      '390x844(グリッド領域 390x680相当)': { width: 390, height: 680 },
      '320x568(グリッド領域 320x420相当)': { width: 320, height: 420 },
    }
    // PR#16 3巡目 must-2: 「cols/rows が n と一致しない」という以前の判定基準は、旧
    // |log(aspect)| 評価の時代に「N列×1行/1列×N行の細い帯」を弾くための代理指標
    // だった。新しい評価(ラベル文字が最大になる候補を選ぶ)では、空きセル数0を
    // 実現できる列数の候補が1列(全幅)しか無い n(例: 7)で意図的に1列を選ぶことがある。
    // 全幅の1列は「セルが小さすぎて読みにくい細い帯」とは別物(むしろ幅は最大)なので、
    // 実際に守るべき不変条件である最小セル寸法(160x84)の充足だけを確認する
    for (const [label, dims] of Object.entries(realDims)) {
      for (const n of [6, 7, 8]) {
        it(`${label} で n=${n} は既定の最小セル寸法(160x84)を満たしたまま全面充填する`, () => {
          const result = computeGridLayout(n, dims.width, dims.height)
          expect(result.fill).toBe(true)
          expect(dims.width / result.cols).toBeGreaterThanOrEqual(DEFAULT_MIN_CELL_WIDTH)
          expect(dims.height / result.rows).toBeGreaterThanOrEqual(DEFAULT_MIN_CELL_HEIGHT)
        })
      }
    }

    // PR#16 再レビュー must-A/B(方針転換): 以前はここで、呼び出し側(App.tsx)が
    // 文字サイズ設定に応じて minCellWidth/Height を引き上げて渡す想定で、
    // フィットしなければスクロールへフォールバックすることを許容していた。
    // これだと大/特大文字で8項目以下の画面までスクロール化し、巡回中に緊急タイルが
    // 画面外へ消えることがあった。方針を転換し、最小セル寸法は文字サイズに関係なく
    // 既定(160x84)で固定する(App.tsx は computeGridLayout をオプション無しで呼ぶ)。
    // 文字が収まらない分はCSS側(--tile-label-font の min())で文字自体を縮めて対応する。
    it('文字サイズ設定(呼び出し側のオプション)に関係なく、8項目以下は常に全面充填する', () => {
      // 実機サイズ相当の格子領域×項目数1〜8の全組み合わせで、オプション無し
      // (既定の 160x84)なら必ず fill:true になることを確認する
      const dimsList = [
        { width: 768, height: 850 },
        { width: 390, height: 680 },
        { width: 320, height: 420 },
        { width: 844, height: 300 },
      ]
      for (const dims of dimsList) {
        for (let n = 1; n <= 8; n += 1) {
          const result = computeGridLayout(n, dims.width, dims.height)
          expect(result.fill).toBe(true)
        }
      }
    })

    // PR#16 再レビュー must-A/B: 「≤8項目で巡回中に緊急タイルが常にビューポート内」の
    // 保証について。computeGridLayout 自体はスキャン位置(どのタイルが巡回中か)を
    // 一切考慮しない純粋関数であり、cols/rows は項目数と領域サイズだけで決まる。
    // fill:true のとき App.tsx は .grid-board に .grid-fill を付け、globals.css の
    // .grid-board.grid-fill は overflow-y:hidden(スクロール自体が起きない)で
    // grid-template-columns/rows を厳密に cols×rows で等分する。緊急タイルは
    // 常に先頭(index 0、menus.ts の homeScreen/subScreen)にあるため、fill:true である
    // 限り緊急タイルを含む全タイルが常に同時にビューポート内へ収まる(スクロール自体が
    // 存在しないので巡回中に画面外へ出ることがあり得ない)。上のテストで
    // 「8項目以下は常に fill:true」を保証しているため、この不変条件は論理的に導かれる。
    // 実ブラウザでの目視相当の確認は scratchpad/rv16r.mjs と e2e/offline.e2e.mjs で行う
    it('fill:true のときは巡回位置に関わらず全タイルが同時に描画領域内へ収まる(スクロール自体が発生しない)', () => {
      const result = computeGridLayout(8, 768, 850)
      expect(result.fill).toBe(true)
      // fill モードは cols*rows で領域全体を等分するため、8項目全てに専用セルがあり
      // (空きは1セルまで許容)、どのタイルも他のタイルより後ろへ隠れることがない
      expect(result.cols * result.rows).toBeGreaterThanOrEqual(8)
      expect(result.cols * result.rows - 8).toBeLessThanOrEqual(1)
    })
  })
})
