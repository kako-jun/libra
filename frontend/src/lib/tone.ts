// 効果音(Issue #13)用の AudioContext 管理。緊急警告音は鳴らさない(Issue #43)。
// 正本: docs/requirements.md §4.3, §7

type AudioContextCtor = typeof AudioContext

function getAudioContextCtor(): AudioContextCtor | undefined {
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext
  )
}

let audioContext: AudioContext | null = null

/**
 * AudioContext を(なければ)作る。resume() はユーザーのアクティベーションを伴わないと
 * pending のままになることがあるため、多重呼び出しをガードせず毎回 resume を試みる。
 */
function ensureAudioContext(): AudioContext | null {
  // closed になった AudioContext は resume() しても二度と running にならないので作り直す。
  if (audioContext && audioContext.state === 'closed') {
    audioContext = null
  }
  if (audioContext) return audioContext
  const Ctor = getAudioContextCtor()
  if (!Ctor) return null
  audioContext = new Ctor()
  return audioContext
}

/** 最初のユーザー入力で呼ぶ。AudioContext は自動再生ポリシーのため resume が要る。 */
export function resumeToneAudioContext(): void {
  try {
    const ctx = ensureAudioContext()
    if (!ctx) return
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {
        // resume が reject されても、次のユーザー操作で再度呼ばれるので落とさない
      })
    }
  } catch {
    // AudioContext が使えない環境では効果音なしで動作を続ける
  }
}

/**
 * 振動の代替の短い効果音(Issue #13)。パターン(振動・休止・振動…の ms)をそのまま
 * 音の長さ・合間にして鳴らす。AudioContext が running でなければ何もしない
 * (待ってまとめて鳴らすことはしない。取りこぼしても致命的でない)。
 */
let activeTones: OscillatorNode[] = []

export function playTonePattern(pattern: number[], frequency = 520): void {
  const ctx = audioContext
  if (!ctx || ctx.state !== 'running') return
  try {
    // 振動と同じく、新しい効果音が直前の効果音を置き換える(受理→はい で音が重ならない)
    for (const previous of activeTones) {
      try {
        previous.stop()
      } catch {
        // すでに止まっている
      }
    }
    activeTones = []
    let at = ctx.currentTime
    pattern.forEach((ms, index) => {
      const seconds = ms / 1000
      if (index % 2 === 0) {
        const oscillator = ctx.createOscillator()
        const gain = ctx.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(frequency, at)
        gain.gain.setValueAtTime(0.0001, at)
        gain.gain.exponentialRampToValueAtTime(0.2, at + Math.min(0.01, seconds / 2))
        gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds)
        oscillator.connect(gain)
        gain.connect(ctx.destination)
        oscillator.start(at)
        oscillator.stop(at + seconds + 0.02)
        activeTones.push(oscillator)
      }
      at += seconds
    })
  } catch {
    // 効果音の再生に失敗しても、他の動作は続ける
  }
}

/**
 * タブが非表示→表示に戻ったタイミングでも AudioContext の resume を試みる。
 * モバイルでバックグラウンド化すると AudioContext が suspended/interrupted に
 * なることがあり、フォアグラウンド復帰時に効果音が出ないままになるのを防ぐ。
 * App.tsx の onMount から呼び、返り値の解除関数を onCleanup に渡す。
 */
export function initToneVisibilityResume(): () => void {
  if (typeof document === 'undefined') return () => {}
  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      resumeToneAudioContext()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => document.removeEventListener('visibilitychange', onVisibilityChange)
}
