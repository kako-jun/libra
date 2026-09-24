// 緊急警告音。Web Audio API のオシレーターで生成し、音声ファイルは使わない。
// 正本: docs/requirements.md §4.3, §7 — 音声モード OFF でも鳴らす。

type AudioContextCtor = typeof AudioContext

function getAudioContextCtor(): AudioContextCtor | undefined {
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  )
}

let audioContext: AudioContext | null = null
let intervalId: number | null = null
let resumeInFlight = false

/** 最初のユーザー入力で呼ぶ。AudioContext は自動再生ポリシーのため resume が要る。 */
export function resumeAlarmAudioContext(): void {
  try {
    if (!audioContext) {
      const Ctor = getAudioContextCtor()
      if (!Ctor) return
      audioContext = new Ctor()
    }
    // 連打で resume() を何度呼んでも、その解決時に複数回キャッチアップ鳴動しないよう
    // 進行中は多重に .then を積まない。
    if (audioContext.state === 'suspended' && !resumeInFlight) {
      resumeInFlight = true
      audioContext
        .resume()
        .then(() => {
          resumeInFlight = false
          // S-new-2: タッチで最初に緊急を選ぶと pointerdown 時点では suspended のため
          // beep がスキップされ、最大 repeatMs(既定3秒)警告音が遅れる。resume が実際に
          // 完了した瞬間、アラーム動作中(intervalId!==null)なら次の周期を待たず1回鳴らす。
          if (intervalId !== null) beep()
        })
        .catch(() => {
          resumeInFlight = false
        })
    }
  } catch {
    // AudioContext が使えない環境ではアラームなしで動作を続ける
  }
}

/** 警告音が鳴る状態かどうか。AudioContext が running でなければ鳴らない。 */
export function getAlarmAudioStatus(): 'running' | 'not-running' {
  return audioContext?.state === 'running' ? 'running' : 'not-running'
}

function beep(): void {
  const ctx = audioContext
  if (!ctx) return
  // 'running' 以外(suspended/interrupted/closed 等)では鳴らさない。resume を試みておき、
  // 実際に鳴らすのは次の周期以降(resume が間に合ってから)にする。ここで待ってから鳴らすと
  // 複数周期分の音がまとめて鳴る(キャッチアップ)ことになるため、このタイミングでは諦める。
  if (ctx.state !== 'running') {
    try {
      void ctx.resume().catch(() => {
        // resume できない環境でもアラーム自体は落とさない(unhandled rejection 防止)
      })
    } catch {
      // resume できない環境でもアラーム自体は落とさない
    }
    return
  }
  try {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.type = 'square'
    oscillator.frequency.setValueAtTime(880, ctx.currentTime)
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start()
    oscillator.stop(ctx.currentTime + 0.55)
  } catch {
    // 単発の再生失敗は無視して次の周期に任せる
  }
}

/** 警告音を鳴らし始める。介助者が止めるまで一定間隔で繰り返す。 */
export function startAlarm(repeatMs = 3000): void {
  resumeAlarmAudioContext()
  stopAlarm()
  beep()
  intervalId = window.setInterval(beep, repeatMs)
}

/** 警告音を止める。介助者による緊急解除で呼ぶ。 */
export function stopAlarm(): void {
  if (intervalId !== null) {
    window.clearInterval(intervalId)
    intervalId = null
  }
}

/**
 * タブが非表示→表示に戻ったタイミングでも AudioContext の resume を試みる。
 * モバイルでバックグラウンド化すると AudioContext が suspended/interrupted に
 * なることがあり、フォアグラウンド復帰時に鳴り始めないままになるのを防ぐ。
 * App.tsx の onMount から呼び、返り値の解除関数を onCleanup に渡す。
 */
export function initAlarmVisibilityResume(): () => void {
  if (typeof document === 'undefined') return () => {}
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      resumeAlarmAudioContext()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => document.removeEventListener('visibilitychange', onVisibilityChange)
}
