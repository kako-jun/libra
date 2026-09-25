import { describe, expect, it } from 'vitest'
import {
  computeGridLayout,
  DEFAULT_LABEL_HEIGHT_FACTOR,
  DEFAULT_LABEL_WIDTH_FACTOR,
  DEFAULT_MIN_CELL_HEIGHT,
  DEFAULT_MIN_CELL_WIDTH,
  GRID_FILL_MAX_ITEMS,
} from '../gridLayout'

// 固定の格子領域サイズ(実測サイズの代わり)。aspect = width/height
const LANDSCAPE = { width: 1000, height: 500 } // aspect 2.0
const PORTRAIT = { width: 500, height: 1000 } // aspect 0.5
const SQUARE = { width: 600, height: 600 } // aspect 1.0

// PR#16 5巡目 must-G: globals.css 側の係数はブレークポイントごとに異なり、
// App.tsx は実際に描画された値を getComputedStyle で読んで渡す。テストでは
// このファイルにハードコードせず、既定(基本ブレークポイント相当)の係数を
// 明示的に options として渡す(呼び出し側の契約をテストでも同じ形にする)
const BASE_FACTORS = {
  labelWidthFactor: DEFAULT_LABEL_WIDTH_FACTOR,
  labelHeightFactor: DEFAULT_LABEL_HEIGHT_FACTOR,
}

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
    // PR#16 4巡目 must-E: labelScore(ラベル文字が何pxまで大きくなれるか)を
    // 空きセル数より優先する評価に変更(空きセルは僅差のタイブレークとしての
    // 小さな減点のみ)。n=5 は以前 5列×1行(空きセル0)だったが、それは幅200pxの
    // 帯(BAND_MIN_LONG_SIDE=5により候補から除外される)になるため、
    // 3列×2行(span2、空きセル1だがラベルがずっと大きい)に変わる
    const expected: Record<number, { cols: number; rows: number; lastSpan: number }> = {
      2: { cols: 2, rows: 1, lastSpan: 1 },
      3: { cols: 3, rows: 1, lastSpan: 1 },
      4: { cols: 2, rows: 2, lastSpan: 1 },
      5: { cols: 3, rows: 2, lastSpan: 2 },
      6: { cols: 3, rows: 2, lastSpan: 1 },
      7: { cols: 4, rows: 2, lastSpan: 2 },
      8: { cols: 4, rows: 2, lastSpan: 1 },
    }
    for (const [n, want] of Object.entries(expected)) {
      it(`n=${n} → ${want.cols}列×${want.rows}行(lastSpan=${want.lastSpan})`, () => {
        const result = computeGridLayout(Number(n), LANDSCAPE.width, LANDSCAPE.height, BASE_FACTORS)
        expect(result).toEqual({ fill: true, ...want })
      })
    }
  })

  describe('縦長(portrait 500x1000, aspect 0.5, 既定の最小セル寸法)', () => {
    // PR#16 4巡目 must-E 再検証: 3巡目では空きセル数0を最優先していたため、n=7 は
    // 空きセル数0を実現できる列数が1列(1列7行、全幅の縦積み)しか無く、そちらが
    // 選ばれていた。4巡目でラベルの大きさを主キーに戻したため(空きセル数は僅差の
    // タイブレークに後退)、2列×4行(span2、空きセル1だがラベルがずっと大きい)に戻る。
    // n=3/5 も同様に、1列(空きセル0)よりラベルが大きい2列(span2、空きセル1)を選ぶ
    const expected: Record<number, { cols: number; rows: number; lastSpan: number }> = {
      2: { cols: 1, rows: 2, lastSpan: 1 },
      3: { cols: 1, rows: 3, lastSpan: 1 },
      4: { cols: 1, rows: 4, lastSpan: 1 },
      5: { cols: 2, rows: 3, lastSpan: 2 },
      6: { cols: 2, rows: 3, lastSpan: 1 },
      7: { cols: 2, rows: 4, lastSpan: 2 },
      8: { cols: 2, rows: 4, lastSpan: 1 },
    }
    for (const [n, want] of Object.entries(expected)) {
      it(`n=${n} → ${want.cols}列×${want.rows}行(lastSpan=${want.lastSpan})`, () => {
        const result = computeGridLayout(Number(n), PORTRAIT.width, PORTRAIT.height, BASE_FACTORS)
        expect(result).toEqual({ fill: true, ...want })
      })
    }
  })

  describe('正方形(square 600x600, aspect 1.0, 既定の最小セル寸法)', () => {
    // PR#16 4巡目 must-E 再検証: 上のportraitと同じ理由で、n=3/5/7 は1列(空きセル0)
    // ではなくラベルが大きくなる2列(span2、空きセル1)を選ぶ
    const expected: Record<number, { cols: number; rows: number; lastSpan: number }> = {
      2: { cols: 1, rows: 2, lastSpan: 1 },
      3: { cols: 2, rows: 2, lastSpan: 2 },
      4: { cols: 2, rows: 2, lastSpan: 1 },
      5: { cols: 2, rows: 3, lastSpan: 2 },
      6: { cols: 2, rows: 3, lastSpan: 1 },
      7: { cols: 2, rows: 4, lastSpan: 2 },
      8: { cols: 2, rows: 4, lastSpan: 1 },
    }
    for (const [n, want] of Object.entries(expected)) {
      it(`n=${n} → ${want.cols}列×${want.rows}行(lastSpan=${want.lastSpan})`, () => {
        const result = computeGridLayout(Number(n), SQUARE.width, SQUARE.height, BASE_FACTORS)
        expect(result).toEqual({ fill: true, ...want })
      })
    }
  })

  describe('PR#16 4巡目 must-E: 帯(1×N/N×1、N>=5)は最小セル寸法を満たしていても選ばれない', () => {
    it('1024x607(格子領域相当) n=7 → 4列×2行(帯にならない)', () => {
      const result = computeGridLayout(7, 1024, 607, BASE_FACTORS)
      expect(result).toEqual({ fill: true, cols: 4, rows: 2, lastSpan: 2 })
    })

    it('390x844 n=7 → 2列×4行(帯にならない)', () => {
      const result = computeGridLayout(7, 390, 844, BASE_FACTORS)
      expect(result).toEqual({ fill: true, cols: 2, rows: 4, lastSpan: 2 })
    })

    it('1280x720 n=7 は帯(cols===1 または rows===1)にならない', () => {
      const result = computeGridLayout(7, 1280, 720, BASE_FACTORS)
      expect(result.fill).toBe(true)
      expect(result.cols).not.toBe(1)
      expect(result.rows).not.toBe(1)
    })

    it('横に極端に広い領域(2000x300)で n=8 でも 1行の帯にはならない', () => {
      // 幅は十分あるが高さが厳しい領域。8列×1行(空きセル0)は帯として除外され、
      // 別の(帯でない)候補が選ばれる
      const result = computeGridLayout(8, 2000, 300, BASE_FACTORS)
      if (result.fill) {
        expect(result.rows).not.toBe(1)
      }
    })
  })

  it('lastSpan は常に1か2で、cols*rows - itemCount(空きセル数)は1以下', () => {
    for (const dims of [LANDSCAPE, PORTRAIT, SQUARE]) {
      for (let n = 2; n <= GRID_FILL_MAX_ITEMS; n += 1) {
        const result = computeGridLayout(n, dims.width, dims.height, BASE_FACTORS)
        expect(result.lastSpan === 1 || result.lastSpan === 2).toBe(true)
        expect(result.cols * result.rows - n).toBeLessThanOrEqual(1)
      }
    }
  })

  it('選ばれた列数・行数のセルは既定の最小セル寸法(160x84)を下回らない', () => {
    for (const dims of [LANDSCAPE, PORTRAIT, SQUARE]) {
      for (let n = 2; n <= GRID_FILL_MAX_ITEMS; n += 1) {
        const result = computeGridLayout(n, dims.width, dims.height, BASE_FACTORS)
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
      // 8項目、実測領域は 1200x900。最小セル寸法が既定(160x84)なら3列×3行(span2、
      // セル幅400px)が選ばれるが、最小幅を500pxまで引き上げると3列(セル幅400px)は
      // 入らなくなり、2列(セル幅600px)まで列数が減る
      const withDefault = computeGridLayout(8, 1200, 900, BASE_FACTORS)
      expect(withDefault.cols).toBe(3)
      const withLargerMin = computeGridLayout(8, 1200, 900, { minCellWidth: 500, ...BASE_FACTORS })
      expect(withLargerMin.cols).toBeLessThan(3)
      expect(1200 / withLargerMin.cols).toBeGreaterThanOrEqual(500)
    })
  })

  describe('PR#16 5巡目 must-G: labelWidthFactor/labelHeightFactor を呼び出し側から渡せる', () => {
    it('係数を変えると同じ領域・項目数でも選ばれる列数が変わる(値がハードコードされていない)', () => {
      // 幅に強く重み付けした係数(横長のセルを好む)と、高さに強く重み付けした
      // 係数(縦長のセルを好む)とで、同じ 1000x300 8項目でも異なる列数を選ぶことを
      // 確認する
      const widthHeavy = computeGridLayout(8, 1000, 300, {
        labelWidthFactor: 0.15,
        labelHeightFactor: 0.2,
      })
      const heightHeavy = computeGridLayout(8, 1000, 300, {
        labelWidthFactor: 0.01,
        labelHeightFactor: 0.9,
      })
      expect(widthHeavy.fill).toBe(true)
      expect(heightHeavy.fill).toBe(true)
      expect(widthHeavy.cols).not.toBe(heightHeavy.cols)
    })

    it('係数を省略すると基本ブレークポイント相当の既定値(15/20)にフォールバックする', () => {
      const withDefaults = computeGridLayout(8, 1200, 900)
      const withExplicitBase = computeGridLayout(8, 1200, 900, BASE_FACTORS)
      expect(withDefaults).toEqual(withExplicitBase)
    })
  })

  describe('PR#16 5巡目 should-B: 候補ゼロ時に最小セル高さを50pxまで緩めて再探索する', () => {
    // 実測: 568x320(横向きの低い画面)でのメッセージ欄を差し引いた格子領域は
    // 幅568×高さ203px程度(同ラウンドのnitで .message-panel-controls に
    // 条件付きmin-height:84pxを足した影響で、以前の実測値236.6pxより縮んでいる)。
    // 7項目は候補が cols=2,rows=4(空きセル1)しか無く、必要セル高さは
    // 203/4=50.75px で、既定の84pxはもちろん当初案の72px・一度引き下げた58pxでも
    // 足りない
    const REAL_BOARD_HEIGHT = 203

    it('568x203で7項目は、既定の84pxでは候補が無いが50pxまで緩めてfillする', () => {
      const result = computeGridLayout(7, 568, REAL_BOARD_HEIGHT, BASE_FACTORS)
      expect(result.fill).toBe(true)
      expect(REAL_BOARD_HEIGHT / result.rows).toBeGreaterThanOrEqual(50)
    })

    it('568x203で8項目もfillする(3列×3行、必要セル高さ≒67.7pxで既定より緩い50で足りる)', () => {
      const result = computeGridLayout(8, 568, REAL_BOARD_HEIGHT, BASE_FACTORS)
      expect(result.fill).toBe(true)
      expect(REAL_BOARD_HEIGHT / result.rows).toBeGreaterThanOrEqual(50)
    })

    it('50pxまで緩めても候補が無い場合は従来どおり fill しない', () => {
      // 高さ40pxでは50pxの緩和後でも1行すら確保できない
      const result = computeGridLayout(8, 1200, 40, BASE_FACTORS)
      expect(result.fill).toBe(false)
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
    // PR#16 4巡目 must-E: 最小セル寸法の充足に加え、帯(cols===1 かつ
    // rows>=BAND_MIN_LONG_SIDE、または rows===1 かつ cols>=BAND_MIN_LONG_SIDE)にも
    // ならないことを確認する
    for (const [label, dims] of Object.entries(realDims)) {
      for (const n of [6, 7, 8]) {
        it(`${label} で n=${n} は既定の最小セル寸法(160x84)を満たし、帯にもならずに全面充填する`, () => {
          const result = computeGridLayout(n, dims.width, dims.height, BASE_FACTORS)
          expect(result.fill).toBe(true)
          expect(dims.width / result.cols).toBeGreaterThanOrEqual(DEFAULT_MIN_CELL_WIDTH)
          expect(dims.height / result.rows).toBeGreaterThanOrEqual(DEFAULT_MIN_CELL_HEIGHT)
          expect(result.cols === 1 && result.rows >= 5).toBe(false)
          expect(result.rows === 1 && result.cols >= 5).toBe(false)
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
          const result = computeGridLayout(n, dims.width, dims.height, BASE_FACTORS)
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
      const result = computeGridLayout(8, 768, 850, BASE_FACTORS)
      expect(result.fill).toBe(true)
      // fill モードは cols*rows で領域全体を等分するため、8項目全てに専用セルがあり
      // (空きは1セルまで許容)、どのタイルも他のタイルより後ろへ隠れることがない
      expect(result.cols * result.rows).toBeGreaterThanOrEqual(8)
      expect(result.cols * result.rows - 8).toBeLessThanOrEqual(1)
    })
  })
})
