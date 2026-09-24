// シングルスイッチ自動スキャンの状態遷移。副作用なし。時刻は常に引数で受け取る。
// 正本: docs/requirements.md §3

export interface ScanConfig {
  /** カーソルが次の項目へ進むまでの間隔(ms) */
  intervalMs: number
  /** 画面を開いた直後、先頭項目に留まる時間(ms) */
  headHoldMs: number
  /** 直前のオンから、これより短い間隔のオンを無視する(ms) */
  debounceMs: number
}

export interface ScanState {
  index: number
  itemCount: number
  /** この時刻(ms)になったらカーソルを次へ進める */
  nextAdvanceAt: number
  /** 直前にスイッチがオンになった時刻(ms)。連打無視の基準 */
  lastPressAt: number | null
}

/** 画面を開いた時点のスキャン状態を作る。先頭項目から、先頭待機込みで始まる。 */
export function startScan(itemCount: number, now: number, config: ScanConfig): ScanState {
  return {
    index: 0,
    itemCount: Math.max(itemCount, 0),
    nextAdvanceAt: now + Math.max(config.headHoldMs, 0),
    lastPressAt: null,
  }
}

/** 時間経過に応じてカーソルを進める。進める時刻に達していなければ何もしない。 */
export function tick(state: ScanState, now: number, config: ScanConfig): ScanState {
  if (state.itemCount <= 0) return state
  if (now < state.nextAdvanceAt) return state
  const nextIndex = (state.index + 1) % state.itemCount
  return {
    ...state,
    index: nextIndex,
    nextAdvanceAt: now + Math.max(config.intervalMs, 1),
  }
}

export interface PressResult {
  state: ScanState
  /** 実行すべき項目のインデックス。連打無視で無視された場合は null */
  activatedIndex: number | null
}

/** スイッチが「オン」になったときに呼ぶ。連打無視の対象なら activatedIndex は null。 */
export function press(state: ScanState, now: number, config: ScanConfig): PressResult {
  if (state.itemCount <= 0) return { state, activatedIndex: null }
  if (state.lastPressAt !== null && now - state.lastPressAt < Math.max(config.debounceMs, 0)) {
    return { state, activatedIndex: null }
  }
  return {
    state: { ...state, lastPressAt: now },
    activatedIndex: state.index,
  }
}
