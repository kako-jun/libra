// タイル格子の列数・行数を、項目数と格子領域の実測サイズから算出する。副作用なし。
// 正本: docs/grid-layout.md, DESIGN.md §4
//
// 方針(kako-jun レビュー 2026-09-24):
// 1. 空きセル数が最小になる (cols, rows) を優先する
// 2. 同数なら、セルの縦横比(cellWidth/cellHeight)が 1 に近い(0.6〜1.6の範囲を優先)ものを選ぶ
// 3. 最後の行が欠ける場合は最後のタイルの grid-column span で埋めるが、
//    span は最大でも2まで(空きセルが2以上になる列数の候補はそもそも採らない)

export interface GridLayout {
  /** true のとき格子領域全体を敷き詰める「fill」モード。false は従来の
   *  auto-fit/minmax + スクロールのレイアウトを使う(項目数が多い画面向け) */
  fill: boolean
  cols: number
  rows: number
  /** 最後の行に空きが出る場合、最後のタイルへ与える grid-column の span 数(1〜2) */
  lastSpan: number
}

/** 1画面の項目数がこれを超えたら fill モードを使わず、最小タイル高を保ってスクロールする
 *  (requirements.md §4.1 の「1画面8項目以内」の目安に合わせる) */
export const GRID_FILL_MAX_ITEMS = 8

const ASPECT_MIN = 0.6
const ASPECT_MAX = 1.6

interface Candidate {
  cols: number
  rows: number
  emptyCells: number
  lastSpan: number
  cellAspect: number
}

export function computeGridLayout(itemCount: number, width: number, height: number): GridLayout {
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
    const lastSpan = emptyCells + 1
    const cellWidth = width / cols
    const cellHeight = height / rows
    const cellAspect = cellHeight === 0 ? Infinity : cellWidth / cellHeight
    candidates.push({ cols, rows, emptyCells, lastSpan, cellAspect })
  }

  // cols === itemCount(1行に全部並べる)は常に emptyCells=0 で候補に入るため、
  // candidates が空になることはない
  const inRange = candidates.filter(
    (c) => c.cellAspect >= ASPECT_MIN && c.cellAspect <= ASPECT_MAX,
  )
  const pool = inRange.length > 0 ? inRange : candidates

  pool.sort((a, b) => {
    if (a.emptyCells !== b.emptyCells) return a.emptyCells - b.emptyCells
    return Math.abs(a.cellAspect - 1) - Math.abs(b.cellAspect - 1)
  })

  const best = pool[0]
  return { fill: true, cols: best.cols, rows: best.rows, lastSpan: best.lastSpan }
}
