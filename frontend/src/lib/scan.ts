// シングルスイッチ自動スキャンの状態遷移。副作用なし。時刻は常に引数で受け取る。
// 項目数はここに保持せず、呼び出し側(App.tsx)が毎回そのときの表示メニュー配列の
// 長さを渡す。これにより表示中メニューとスキャン状態が常に食い違わない。
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
  /** この時刻(ms)になったらカーソルを次へ進める */
  nextAdvanceAt: number
  /** 直前にスイッチがオンになった時刻(ms)。連打無視の基準 */
  lastPressAt: number | null
}

/**
 * 画面を開いた時点のスキャン状態を作る。先頭項目から、先頭待機込みで始まる。
 * lastPressAt は前の画面での直前の押下時刻を渡すと引き継がれる（省略時は null）。
 * 引き継がないと、画面遷移のたびに連打無視がリセットされ、遷移直後の連打で
 * 遷移先の先頭項目（緊急）が誤って実行されてしまう。
 */
export function startScan(
  now: number,
  config: ScanConfig,
  previousLastPressAt: number | null = null,
): ScanState {
  return {
    index: 0,
    nextAdvanceAt: now + Math.max(config.headHoldMs, 0),
    lastPressAt: previousLastPressAt,
  }
}

/**
 * 表示中メニューの項目数に合わせてカーソルを範囲内へ補正する。
 * メニューの項目数が本人操作を経ずに変化した場合（例: 「取り消し」が
 * 1周後に消える）に、カーソルと実際の項目のずれを防ぐ。
 */
export function resync(state: ScanState, itemCount: number): ScanState {
  if (itemCount <= 0) {
    return state.index === 0 ? state : { ...state, index: 0 }
  }
  if (state.index < itemCount) return state
  return { ...state, index: itemCount - 1 }
}

/** 時間経過に応じてカーソルを進める。進める時刻に達していなければ何もしない。 */
export function tick(
  state: ScanState,
  itemCount: number,
  now: number,
  config: ScanConfig,
): ScanState {
  if (itemCount <= 0) return state
  if (now < state.nextAdvanceAt) return state
  const nextIndex = (state.index + 1) % itemCount
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
export function press(
  state: ScanState,
  itemCount: number,
  now: number,
  config: ScanConfig,
): PressResult {
  if (itemCount <= 0) return { state, activatedIndex: null }
  if (state.lastPressAt !== null && now - state.lastPressAt < Math.max(config.debounceMs, 0)) {
    return { state, activatedIndex: null }
  }
  return {
    state: { ...state, lastPressAt: now },
    activatedIndex: state.index,
  }
}
