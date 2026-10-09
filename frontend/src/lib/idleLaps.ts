// 下位画面の「無入力周回」の数え方。副作用なし(周回の発生は引数で受け取る)。
// 正本: docs/requirements.md §3 / Issue #76

/** 取り消しタイルが残る周回数(伝達直後から数える) */
export const UNDO_LAPS = 2

/** 入力がないまま、この周回数だけ回ったら下位画面からホームへ戻る。将来は設定へ出せるよう定数で持つ */
export const IDLE_LAPS_BEFORE_HOME = 3

export interface IdleLapsResult {
  /** 更新後の無入力周回数。戻る(returnHome)ときは 0 */
  count: number
  /** ホームへ戻すべきか */
  returnHome: boolean
}

/**
 * 無入力周回数の更新。wrapped は「カーソルが先頭以外から先頭へ戻った」瞬間だけ true。
 * 画面を開いた直後の先頭待機は周回に数えない(戻った瞬間でないため)。
 * 入力・画面遷移での 0 戻しは呼び出し側が count=0 に置き換える。
 */
export function advanceIdleLaps(
  count: number,
  wrapped: boolean,
  limit: number = IDLE_LAPS_BEFORE_HOME,
): IdleLapsResult {
  if (!wrapped) return { count, returnHome: false }
  const next = count + 1
  if (next >= limit) return { count: 0, returnHome: true }
  return { count: next, returnHome: false }
}
