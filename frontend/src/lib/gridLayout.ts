// タイル格子の列数・行数を、項目数と格子領域の実測サイズから算出する。副作用なし。
// 正本: docs/grid-layout.md, DESIGN.md §4
//
// 方針(kako-jun レビュー 2026-09-24、PR#16 Opus レビュー 2026-09-25 で改訂):
// 1. 最小セル寸法(文字サイズに応じて呼び出し側が渡す)を下回る候補は採らない
//    (これが無いと、例えば7項目で「7列×1行」のような極端に細い帯が選ばれてしまう)
// 2. 空きセル数が最小(0か1のみ許可、span は最大2まで)になる候補を優先する
// 3. セルの縦横比の評価は |log(cellAspect)| にする(2倍と0.5倍を対称に同じ悪さとして
//    扱える)。0.4〜2.5 の範囲内の候補を優先し、範囲内が無い場合のみ全候補から
//    |log(cellAspect)| 最小を採用する
// 4. 条件を満たす候補が1つも無い場合(最小セル寸法が厳しすぎる等)は fill しない。
//    呼び出し側は従来どおり auto-fit/minmax のスクロールレイアウトにフォールバックする

export interface GridLayout {
  /** true のとき格子領域全体を敷き詰める「fill」モード。false は従来の
   *  auto-fit/minmax + スクロールのレイアウトを使う(項目数が多い画面、または
   *  最小セル寸法を満たす分割が無い画面向け) */
  fill: boolean
  cols: number
  rows: number
  /** 最後の行に空きが出る場合、最後のタイルへ与える grid-column の span 数(1〜2) */
  lastSpan: number
}

/** 1画面の項目数がこれを超えたら fill モードを使わず、最小タイル高を保ってスクロールする
 *  (requirements.md §4.1 の「1画面8項目以内」の目安に合わせる) */
export const GRID_FILL_MAX_ITEMS = 8

/** セルの実用的な最小寸法の既定値(px)。呼び出し側が文字サイズ設定に応じて
 *  大きい値を渡すことを想定する(大きい文字ほど広いセルが要る)。
 *  PR#16 Opus レビュー 再検証: 120x88 だと縦横比の評価(|log(aspect)|)だけでは
 *  「6列×1行、幅141px」のような読みにくい細切れ列を許してしまうケースがあった
 *  (実測 844x390 で日本語ラベルが3行に折り返した)。実用に耐える値まで引き上げる */
export const DEFAULT_MIN_CELL_WIDTH = 160
export const DEFAULT_MIN_CELL_HEIGHT = 96

const ASPECT_MIN = 0.4
const ASPECT_MAX = 2.5

interface Candidate {
  cols: number
  rows: number
  emptyCells: number
  lastSpan: number
  cellAspect: number
  logAspect: number
}

export interface GridLayoutOptions {
  minCellWidth?: number
  minCellHeight?: number
}

export function computeGridLayout(
  itemCount: number,
  width: number,
  height: number,
  options: GridLayoutOptions = {},
): GridLayout {
  const minCellWidth = options.minCellWidth ?? DEFAULT_MIN_CELL_WIDTH
  const minCellHeight = options.minCellHeight ?? DEFAULT_MIN_CELL_HEIGHT

  if (itemCount <= 0 || width <= 0 || height <= 0) {
    return { fill: false, cols: 1, rows: 1, lastSpan: 1 }
  }
  if (itemCount > GRID_FILL_MAX_ITEMS) {
    return { fill: false, cols: 1, rows: 1, lastSpan: 1 }
  }

  const candidates: Candidate[] = []
  for (let cols = 1; cols <= itemCount; cols += 1) {
    const rows = Math.ceil(itemCount / cols)
    const remainder = itemCount % cols
    const emptyCells = remainder === 0 ? 0 : cols - remainder
    // 空きセルが2以上になる(最後のタイルのspanが3以上必要になる)候補は採らない
    if (emptyCells > 1) continue
    const cellWidth = width / cols
    const cellHeight = height / rows
    // 最小セル寸法を下回る候補(細い帯になる)は採らない
    if (cellWidth < minCellWidth || cellHeight < minCellHeight) continue
    const lastSpan = emptyCells + 1
    const cellAspect = cellHeight === 0 ? Infinity : cellWidth / cellHeight
    candidates.push({
      cols,
      rows,
      emptyCells,
      lastSpan,
      cellAspect,
      logAspect: Math.log(cellAspect),
    })
  }

  if (candidates.length === 0) {
    // 最小セル寸法を満たす分割が無い(項目が多すぎる/画面が小さすぎる)。
    // fill をあきらめ、呼び出し側の通常レイアウト(スクロール)へフォールバックする
    return { fill: false, cols: 1, rows: 1, lastSpan: 1 }
  }

  const inRange = candidates.filter(
    (c) => c.cellAspect >= ASPECT_MIN && c.cellAspect <= ASPECT_MAX,
  )
  const pool = inRange.length > 0 ? inRange : candidates

  pool.sort((a, b) => {
    if (a.emptyCells !== b.emptyCells) return a.emptyCells - b.emptyCells
    return Math.abs(a.logAspect) - Math.abs(b.logAspect)
  })

  const best = pool[0]
  return { fill: true, cols: best.cols, rows: best.rows, lastSpan: best.lastSpan }
}
