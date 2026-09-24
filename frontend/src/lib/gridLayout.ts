// タイル格子の列数・行数を、項目数と格子領域の実測サイズから算出する。副作用なし。
// 正本: docs/grid-layout.md, DESIGN.md §4
//
// 方針(kako-jun レビュー 2026-09-24、PR#16 Opus レビュー 2026-09-25、3巡目 2026-09-26 で改訂):
// 1. 最小セル寸法(既定 160×84、文字サイズ設定に関係なく固定)を下回る候補は採らない
//    (これが無いと、例えば7項目で「7列×1行」のような極端に細い帯が選ばれてしまう)
// 2. 空きセル数が最小(0か1のみ許可、span は最大2まで)になる候補を優先する
// 3. PR#16 3巡目 must-2: セルの評価を |log(cellAspect)|(縦横比が正方形に近いかどうか)
//    から「タイルのラベル文字が実際に何pxまで大きくなれるか」に変更する。
//    globals.css の --tile-label-font は横幅由来(cqi、係数0.15 ≒ 15cqi)と
//    高さ由来(cqb、係数0.20 ≒ 20cqb)の小さい方で頭打ちになるので、
//    score = min(0.15*cellWidth, 0.20*cellHeight) がそのままCSS側の実際の
//    頭打ち値(px)に一致する。これを最大化する候補を選ぶ(縦横比が多少いびつでも、
//    ラベル文字が大きく読めるほうを優先する)。旧方式(縦横比を正方形に寄せる)は、
//    「正方形に近いが小さいセルを選び、面積で選べば大きくできたはずの文字を逆に
//    縮める」ことがあった(3巡目で発覚: 文字サイズ設定を上げるとメッセージ欄が
//    伸びて格子が縮み、旧方式が選ぶ列数が反転してタイル文字が逆に縮む新規バグの
//    一因)
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

/** セルの実用的な最小寸法の既定値(px)。
 *  PR#16 Opus レビュー 再検証: 120x88 だと縦横比の評価(|log(aspect)|)だけでは
 *  「6列×1行、幅141px」のような読みにくい細切れ列を許してしまうケースがあった
 *  (実測 844x390 で日本語ラベルが3行に折り返した)。実用に耐える値まで引き上げる。
 *  PR#16 再レビュー must-A/B 再検証: 幅は160のまま(細切れ列を防ぐ主因はこちら)、
 *  高さだけ96→84に再調整。320x568・特大文字時、8項目画面の格子領域が348pxしか
 *  無く(メッセージ欄が特大でも40dvh以内に収まるよう縮んだ結果)、96のままだと
 *  2列×4行(必要384px)がどの画面サイズでも見つからずスクロールへ落ちてしまい、
 *  「8項目以下は常に全面充填」の原則が崩れていた。84なら348/4=87pxで足り、
 *  かつ他の(より余裕のある)画面サイズでの実際の選択結果には影響しない
 *  (あくまで下限値であり、余裕があれば候補はもっと高いセルを選ぶ) */
export const DEFAULT_MIN_CELL_WIDTH = 160
export const DEFAULT_MIN_CELL_HEIGHT = 84

/** globals.css の --tile-label-font が横幅(cqi)・高さ(cqb)それぞれに掛ける係数と
 *  一致させる(15cqi/20cqb ≒ 0.15*cellWidth/0.20*cellHeight)。ここを変えたら
 *  globals.css 側の対応する係数も合わせて変える必要がある */
const LABEL_WIDTH_FACTOR = 0.15
const LABEL_HEIGHT_FACTOR = 0.2

interface Candidate {
  cols: number
  rows: number
  emptyCells: number
  lastSpan: number
  labelScore: number
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
    const labelScore = Math.min(LABEL_WIDTH_FACTOR * cellWidth, LABEL_HEIGHT_FACTOR * cellHeight)
    candidates.push({
      cols,
      rows,
      emptyCells,
      lastSpan,
      labelScore,
    })
  }

  if (candidates.length === 0) {
    // 最小セル寸法を満たす分割が無い(項目が多すぎる/画面が小さすぎる)。
    // fill をあきらめ、呼び出し側の通常レイアウト(スクロール)へフォールバックする
    return { fill: false, cols: 1, rows: 1, lastSpan: 1 }
  }

  candidates.sort((a, b) => {
    if (a.emptyCells !== b.emptyCells) return a.emptyCells - b.emptyCells
    // labelScore は大きいほど良い(ラベル文字が大きく描ける)候補なので降順に並べる
    return b.labelScore - a.labelScore
  })

  const best = candidates[0]
  return { fill: true, cols: best.cols, rows: best.rows, lastSpan: best.lastSpan }
}
