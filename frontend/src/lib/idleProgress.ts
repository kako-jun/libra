// 無操作で起きる自動操作までの進み具合(0〜1)。右下の円(IdleRing)が使う。副作用なし。
// 動作そのものと表示がずれないよう、呼び出し側は動作の判定に使う状態をそのまま渡す。
// 正本: docs/requirements.md §4.1.4 / Issue #139

import { IDLE_LAPS_BEFORE_HOME } from './idleLaps'

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

/** 起点の時刻から duration ミリ秒で 1 になる(介助者用メニューの自動で閉じる・モールスの無操作での復帰) */
export function timeProgress(since: number, duration: number, now: number): number {
  return clamp01((now - since) / duration)
}

export interface LapProgressInput {
  /** 無入力の間にカーソルが進んだ項目数(idleLaps.ts) */
  steps: number
  itemCount: number
  /** 最後に数え直した時刻 */
  resetAt: number
  /** 最後にカーソルが進んだ時刻 */
  advancedAt: number
  /** 次にカーソルが進む時刻(scan.ts の nextAdvanceAt) */
  nextAdvanceAt: number
  now: number
  /** 押している間は数えない */
  held: boolean
}

/**
 * 下位画面の「無入力 3 周でホームへ戻る」までの進み具合。進んだ項目数に、いま乗っている項目の
 * 経過ぶんを足す。数え直した直後は 0、ホームへ戻る瞬間(最後の項目の次へ進む時刻)にちょうど 1 になる。
 */
export function lapProgress(input: LapProgressInput): number {
  if (input.held) return 0
  const total = Math.max(1, input.itemCount) * IDLE_LAPS_BEFORE_HOME
  const from = Math.max(input.resetAt, input.advancedAt)
  const span = input.nextAdvanceAt - from
  const fraction = span > 0 ? clamp01((input.now - from) / span) : 0
  return clamp01((input.steps + fraction) / total)
}
