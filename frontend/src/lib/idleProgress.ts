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
  /** 次にカーソルが進む時刻(scan.ts の nextAdvanceAt) */
  nextAdvanceAt: number
  /** カーソルが次の項目へ進む間隔(scan.ts の intervalMs) */
  intervalMs: number
  now: number
  /** 押している間は数えない */
  held: boolean
}

/**
 * 下位画面の「無入力 3 周でホームへ戻る」までの進み具合。数え直してからの時間を、数え直しから戻る時刻
 * までの時間で割る(時間に比例して満ちる。先頭待機のように長くとどまる項目があっても速さは変わらない)。
 * 戻る時刻は、次にカーソルが進む時刻に、その後の残りの項目ぶんの間隔を足したもの。
 */
export function lapProgress(input: LapProgressInput): number {
  if (input.held) return 0
  const total = Math.max(1, input.itemCount) * IDLE_LAPS_BEFORE_HOME
  const remaining = Math.max(0, total - input.steps - 1)
  const end = input.nextAdvanceAt + remaining * input.intervalMs
  if (end <= input.resetAt) return 1
  return timeProgress(input.resetAt, end - input.resetAt, input.now)
}
