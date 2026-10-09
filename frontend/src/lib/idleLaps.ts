// 下位画面の「無入力周回」の数え方。副作用なし(周回の発生は引数で受け取る)。
// 正本: docs/requirements.md §3 / Issue #76

/** 取り消しタイルが残る周回数(伝達直後から数える) */
export const UNDO_LAPS = 2

/** 入力がないまま、この周回数だけ回ったら下位画面からホームへ戻る。将来は設定へ出せるよう定数で持つ */
export const IDLE_LAPS_BEFORE_HOME = 3

export interface IdleStepsResult {
  /** 更新後の無入力ステップ数(カーソルが進んだ項目数)。戻る(returnHome)ときは 0 */
  steps: number
  /** ホームへ戻すべきか */
  returnHome: boolean
}

/**
 * 無入力ステップ数の更新。呼び出し側は「カーソルが 1 項目進んだ」ごとに 1 回呼ぶ。
 * 項目数 × limitLaps ステップ進んだ(＝入力のないまま規定の周回ぶん進んだ)ら戻す。
 * 画面を開いた直後(先頭から)は従来どおり 3 周で戻り、途中の入力からもちょうど 3 周ぶんかかる。
 * 入力・画面遷移・押下中での 0 戻しは呼び出し側が steps=0 に置き換える。
 */
export function advanceIdleSteps(
  steps: number,
  itemCount: number,
  limitLaps: number = IDLE_LAPS_BEFORE_HOME,
): IdleStepsResult {
  const next = steps + 1
  if (next >= Math.max(1, itemCount) * limitLaps) return { steps: 0, returnHome: true }
  return { steps: next, returnHome: false }
}
