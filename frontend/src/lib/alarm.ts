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

/**
 * AudioContext を(なければ)作り、onstatechange を一度だけ配線する。
 *
 * M-new-1: 以前は「resume 呼び出し中フラグ」で多重 resume を防いでいたが、Web Audio の
 * 仕様では *ユーザーのアクティベーションを伴わない* resume() は reject されず pending の
 * ままになることがある。そのフラグが立った状態で pointerdown(アクティベーション無し)の
 * resume が pending のまま残ると、以降の pointerup/touchend/click/visibilitychange
 * (アクティベーション有り)での resume 呼び出しがガードで丸ごと捨てられ、二度と running
 * にならない(Safari 相当では警告音が一度も鳴らない)。resume() 自体はガードせず毎回呼び、
 * 実際に running へ遷移した瞬間だけ onstatechange で捉える。
 */
function ensureAudioContext(): AudioContext | null {
  if (audioContext) return audioContext
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null
  audioContext = new Ctor()
  audioContext.onstatechange = () => {
    // S-new-2: アラーム動作中(intervalId!==null)に running へ遷移した瞬間、
    // 次の周期(最大 repeatMs)を待たず1回鳴らす。
    if (audioContext?.state === 'running' && intervalId !== null) beep()
  }
  return audioContext
}

/** 最初のユーザー入力で呼ぶ。AudioContext は自動再生ポリシーのため resume が要る。 */
export function resumeAlarmAudioContext(): void {
  try {
    const ctx = ensureAudioContext()
    if (!ctx) return
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {
        // resume が reject されても、次のユーザー操作で再度呼ばれるので落とさない
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
  // 実際に running になった瞬間は ensureAudioContext の onstatechange が1回鳴らす。
  // ここで待ってから鳴らすと複数周期分の音がまとめて鳴る(キャッチアップ)ことになるため、
  // このタイミングでは諦める。
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
