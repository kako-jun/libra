// タイル格子の列数・行数を決める。副作用なし。
// 正本: docs/grid-layout.md, DESIGN.md §4
//
// Issue #47(kako-jun 確定仕様): 項目数でタイルの大きさを変えない。全ての選択肢は同じ大きさで、
// 項目が少ないときは空きセルを残す(最後のタイルを引き延ばさない)。
//
// 固定格子: 通常のスキャン画面(1画面8項目以内)は、画面の向きだけで決まる1つの格子を共有する。
//   縦長(高さ >= 幅。正方形を含む。CSS の orientation: portrait と同じ境界): 2列 × 4行
//   横長(幅 > 高さ): 4列 × 2行
// どちらも8セル。8項目(requirements.md §4.1 の1画面の上限。ホームの「取り消し」込み)が
// ちょうど埋まる最小の格子で、項目数・緊急中・伝達メッセージの有無・文字サイズでは変わらない。
// 判定にはビューポートの縦横を使う(格子領域の実測は、緊急帯・伝達メッセージ・案内帯の増減で
// 縦横比が変わり、画面ごとに格子が切り替わってしまうため使わない)。
// 空きセルは App.tsx が非操作のセルとして描く(スキャン・クリック・読み上げの対象外)。
//
// 9項目以上の画面(現状は文字盤の行段階のみ。ホームは取り消し表示中にモールスの入口を畳んで8項目以内に保つ)は設計上スクロールする別枠で、fill=false を返す。

export interface GridLayout {
  /** true のとき固定格子で領域全体を等分して敷き詰める。false は auto-fit/minmax + スクロール */
  fill: boolean
  cols: number
  rows: number
}

/** 固定格子を使う最大項目数(requirements.md §4.1 の「1画面8項目以内」)。これを超える画面はスクロール */
export const GRID_FILL_MAX_ITEMS = 8

/** 縦長ビューポートの固定格子 */
export const PORTRAIT_GRID = { cols: 2, rows: 4 } as const
/** 横長(幅 > 高さ)ビューポートの固定格子 */
export const LANDSCAPE_GRID = { cols: 4, rows: 2 } as const

/**
 * @param itemCount 表示する選択肢の数
 * @param viewportWidth ビューポートの幅(縦横の判定にだけ使う)
 * @param viewportHeight ビューポートの高さ
 */
export function computeGridLayout(
  itemCount: number,
  viewportWidth: number,
  viewportHeight: number,
): GridLayout {
  if (itemCount <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
    return { fill: false, cols: 1, rows: 1 }
  }
  if (itemCount > GRID_FILL_MAX_ITEMS) {
    return { fill: false, cols: 1, rows: 1 }
  }
  const grid = viewportWidth > viewportHeight ? LANDSCAPE_GRID : PORTRAIT_GRID
  return { fill: true, cols: grid.cols, rows: grid.rows }
}
