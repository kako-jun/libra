// スイッチ入力の押下判定(押下時間の下限・離して決定)。
// 正本: docs/requirements.md §3.3 / Issue #6
//
// キー・タップ・Bluetooth シャッターの押下/解放を同じ判定に通す。
// 押下開始時点のスナップショット(カーソル位置・画面)を取り、押しっぱなし中にスキャンが
// 進んでも、決定するのは押し始めに乗っていた項目とする。

export type ActivateOn = 'press' | 'release'

export interface SwitchInputConfig {
  /** この時間以上押し続けたときだけオンとみなす(ms)。0 なら下限なし */
  minHoldMs: number
  /** 決定のタイミング。press = 押した瞬間(下限があれば下限に達した瞬間) / release = 離した瞬間 */
  activateOn: ActivateOn
}

export interface SwitchInputOptions<C> {
  getConfig: () => SwitchInputConfig
  /** 押下開始時点の状態(カーソル位置・画面など)を取る */
  snapshot: () => C
  /** 決定。押下開始時のスナップショットを渡す */
  onActivate: (context: C) => void
  /** 下限までの進捗(0〜1)。押下中でなければ null */
  onProgress?: (progress: number | null) => void
}

interface ActivePress<C> {
  startedAt: number
  context: C
  fired: boolean
  timeoutId?: number
  intervalId?: number
}

const PROGRESS_INTERVAL_MS = 50

export interface SwitchInput {
  /** スイッチが押された。sourceId は入力元(キーのコード・ポインタ ID など) */
  down: (sourceId: string) => void
  /** スイッチが離された */
  up: (sourceId: string) => void
  /** 押下中の入力をすべて取り消す(決定しない)。ブラー・介助者メニュー表示時など */
  cancelAll: () => void
}

export function createSwitchInput<C>(options: SwitchInputOptions<C>): SwitchInput {
  const active = new Map<string, ActivePress<C>>()

  const reportProgress = () => {
    if (!options.onProgress) return
    const { minHoldMs } = options.getConfig()
    if (minHoldMs <= 0 || active.size === 0) {
      options.onProgress(null)
      return
    }
    let best = 0
    for (const press of active.values()) {
      best = Math.max(best, Math.min(1, (Date.now() - press.startedAt) / minHoldMs))
    }
    options.onProgress(best)
  }

  const finish = (sourceId: string): ActivePress<C> | undefined => {
    const press = active.get(sourceId)
    if (!press) return undefined
    if (press.timeoutId !== undefined) window.clearTimeout(press.timeoutId)
    if (press.intervalId !== undefined) window.clearInterval(press.intervalId)
    active.delete(sourceId)
    reportProgress()
    return press
  }

  const down = (sourceId: string) => {
    // 解放を取りこぼした古い押下が残っていても、新しい押下として仕切り直す
    finish(sourceId)
    const { minHoldMs, activateOn } = options.getConfig()
    const context = options.snapshot()

    // 既定(押した瞬間・下限なし)は状態を持たず、従来どおり即決定する
    if (activateOn === 'press' && minHoldMs <= 0) {
      options.onActivate(context)
      return
    }

    const press: ActivePress<C> = { startedAt: Date.now(), context, fired: false }
    active.set(sourceId, press)

    if (minHoldMs > 0) {
      press.intervalId = window.setInterval(reportProgress, PROGRESS_INTERVAL_MS)
      if (activateOn === 'press') {
        press.timeoutId = window.setTimeout(() => {
          press.fired = true
          options.onActivate(press.context)
        }, minHoldMs)
      }
    }
    reportProgress()
  }

  const up = (sourceId: string) => {
    const press = finish(sourceId)
    if (!press || press.fired) return
    const { minHoldMs, activateOn } = options.getConfig()
    if (activateOn !== 'release') return
    if (Date.now() - press.startedAt >= minHoldMs) options.onActivate(press.context)
  }

  const cancelAll = () => {
    for (const sourceId of Array.from(active.keys())) finish(sourceId)
  }

  return { down, up, cancelAll }
}
