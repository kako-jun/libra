// タイル格子の列数・行数を決める。副作用なし。
// 正本: docs/grid-layout.md, DESIGN.md §4
//
// Issue #47(kako-jun 確定仕様): 項目数でタイルの大きさを変えない。全ての選択肢は同じ大きさで、
// 項目が少ないときは空きセルを残す(最後のタイルを引き延ばさない)。
//
// 固定格子: 通常のスキャン画面(1画面8項目以内)は、画面の向きだけで決まる1つの格子を共有する。
//   縦長(高さ >= 幅。正方形を含む。CSS の orientation: portrait と同じ境界): 2列 × 4行
//   横長(幅 > 高さ): 4列 × 2行
// どちらも8セル。8項目(requirements.md §4.1 の1画面の上限)がちょうど埋まる最小の格子で、
// 項目数・緊急中・伝達メッセージの有無・文字サイズでは変わらない。
// 判定にはビューポートの縦横を使う(格子領域の実測は、緊急帯・伝達メッセージ・案内帯の増減で
// 縦横比が変わり、画面ごとに格子が切り替わってしまうため使わない)。
// 空きセルは App.tsx が非操作のセルとして描く(スキャン・クリック・読み上げの対象外)。
//
// ホームも通常の 8 項目は同じ 8 セルで、空きセルを作らない(Issue #127)。モールス使用の 9 項目
// だけは 縦長 2列×5行 / 横長 5列×2行 にする(空き 1 マス。丸ごと空く行は作らない)。
// どの格子も列数が 2・4・5 なので、ホームの はい・いいえ(添字 2・3)は同じ段で左右に隣り合う(Issue #126)。
// 文字盤の行段階は、画面ごとに決まった別の格子(GRIDS.letters)を使う。格子のセル数を超える画面
// (介助者がフレーズを増やした画面など)は設計上スクロールする別枠で、fill=false を返す。

export interface GridLayout {
  /** true のとき固定格子で領域全体を等分して敷き詰める。false は auto-fit/minmax + スクロール */
  fill: boolean
  cols: number
  rows: number
}

/** 固定格子を使う最大項目数(requirements.md §4.1 の「1画面8項目以内」)。標準の格子のセル数。これを超える画面はスクロール */
export const GRID_FILL_MAX_ITEMS = 8

/** 縦長ビューポートの固定格子 */
export const PORTRAIT_GRID = { cols: 2, rows: 4 } as const
/** 横長(幅 > 高さ)ビューポートの固定格子 */
export const LANDSCAPE_GRID = { cols: 4, rows: 2 } as const

/**
 * 格子の種類。画面で決まる。
 * - standard: 通常の下位画面。8 セル(縦長 2×4 / 横長 4×2)
 * - home: ホーム。8 項目以内は standard と同じ 8 セル。9 項目(モールス使用)は 10 セル
 *   (縦長 2×5 / 横長 5×2。Issue #127)。ホームの項目数は介助者の設定だけで決まり、本人の操作では変わらない
 * - letters: 文字盤の行段階(14 項目)。スクロールさせず全項目を出すため、15 セル(縦長 3×5 / 横長 5×3。Issue #121)
 */
export type GridKind = 'standard' | 'home' | 'letters'

export const GRIDS: Record<
  GridKind,
  { portrait: { cols: number; rows: number }; landscape: { cols: number; rows: number } }
> = {
  standard: { portrait: PORTRAIT_GRID, landscape: LANDSCAPE_GRID },
  home: { portrait: { cols: 2, rows: 5 }, landscape: { cols: 5, rows: 2 } },
  letters: { portrait: { cols: 3, rows: 5 }, landscape: { cols: 5, rows: 3 } },
}

/**
 * @param itemCount 表示する選択肢の数
 * @param viewportWidth ビューポートの幅(縦横の判定にだけ使う)
 * @param viewportHeight ビューポートの高さ
 * @param kind 格子の種類(画面で決まる)。省略時は標準の 8 セル
 */
export function computeGridLayout(
  itemCount: number,
  viewportWidth: number,
  viewportHeight: number,
  kind: GridKind = 'standard',
): GridLayout {
  if (itemCount <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { fill: false, cols: 1, rows: 1 }
  }
  const orientation = viewportWidth > viewportHeight ? 'landscape' : 'portrait'
  // ホームは 8 項目以内なら標準の 8 セル。丸ごと空く行・列を作らない(Issue #127)
  const effectiveKind = kind === 'home' && itemCount <= GRID_FILL_MAX_ITEMS ? 'standard' : kind
  const grid = GRIDS[effectiveKind][orientation]
  // セル数を超える画面(介助者がフレーズを増やした画面など)は、スクロールする別枠
  if (itemCount > grid.cols * grid.rows) {
    return { fill: false, cols: 1, rows: 1 }
  }
  return { fill: true, cols: grid.cols, rows: grid.rows }
}
