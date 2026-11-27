import { createSignal, onCleanup } from 'solid-js'

/** 円を描き直す間隔(ms) */
const REFRESH_MS = 100
/** 動きを減らす設定では、なめらかに動かさず、この数の段階で進める */
const REDUCED_MOTION_STAGES = 8

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true

/**
 * 無操作で起きる自動操作までの進み具合を示す、満たされていく円(Issue #139)。
 * 見るだけの表示で、ボタンではない(本人画面でここを押すと、ほかの場所と同じく黄色のパネルを選ぶ)。
 * 読み上げの邪魔をしないよう、支援技術には出さない。
 */
export default function IdleRing(props: { progress: () => number }) {
  const read = () => {
    const value = props.progress()
    return prefersReducedMotion()
      ? Math.floor(value * REDUCED_MOTION_STAGES) / REDUCED_MOTION_STAGES
      : value
  }
  const [value, setValue] = createSignal(read())
  const id = window.setInterval(() => setValue(read()), REFRESH_MS)
  onCleanup(() => window.clearInterval(id))

  return (
    <div class="idle-ring-slot" aria-hidden="true">
      <svg class="idle-ring" viewBox="0 0 24 24" data-progress={value().toFixed(3)}>
        <circle class="idle-ring-edge" cx="12" cy="12" r="11" />
        {/* 半径の太さの線で円を描くと、線の長さの割合がそのまま扇形の割合になる */}
        <circle
          class="idle-ring-fill"
          cx="12"
          cy="12"
          r="5.5"
          pathLength="100"
          stroke-dasharray={`${(value() * 100).toFixed(2)} 100`}
          transform="rotate(-90 12 12)"
        />
      </svg>
    </div>
  )
}
