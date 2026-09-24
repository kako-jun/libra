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

/** 最初のユーザー入力で呼ぶ。AudioContext は自動再生ポリシーのため resume が要る。 */
export function resumeAlarmAudioContext(): void {
  try {
    if (!audioContext) {
      const Ctor = getAudioContextCtor()
      if (!Ctor) return
      audioContext = new Ctor()
    }
    if (audioContext.state === 'suspended') void audioContext.resume()
  } catch {
    // AudioContext が使えない環境ではアラームなしで動作を続ける
  }
}

function beep(): void {
  const ctx = audioContext
  if (!ctx) return
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
