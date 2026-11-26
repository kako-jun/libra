import { createUniqueId, type JSX } from 'solid-js'

interface RangeFieldProps {
  /** 矢印の読み上げ名に使う設定名(「<name>を減らす」「<name>を増やす」) */
  name: string
  min: number
  max: number
  step: number
  value: number
  onValue: (value: number) => void
  /** 見出し(設定名と現在の値) */
  children: JSX.Element
}

/**
 * 介助者用メニューのスライダー(Issue #141)。左右の矢印は 1 回で 1 段階動かす。上限・下限では外側の矢印を
 * 見えなくする(disabled + visibility: hidden。場所は残すので、スライダーの幅と位置は動かない)。
 * 矢印の押下はパネル内の pointerdown なので、無操作 60 秒の自動クローズも数え直される(App.tsx)。
 * label の中にボタンを置くと、見出しのタップが最初のボタンを押してしまうため、label は for で結ぶ
 */
export default function RangeField(props: RangeFieldProps) {
  const id = createUniqueId()
  const stepBy = (direction: -1 | 1) =>
    props.onValue(Math.min(props.max, Math.max(props.min, props.value + direction * props.step)))

  return (
    <div class="caregiver-field caregiver-range">
      <label for={id}>{props.children}</label>
      <div class="caregiver-range-row">
        <button
          type="button"
          class="caregiver-range-step"
          aria-label={`${props.name}を減らす`}
          disabled={props.value <= props.min}
          onClick={() => stepBy(-1)}
        >
          <svg viewBox="0 0 20 24" aria-hidden="true">
            <path d="M15 3 L5 12 L15 21" />
          </svg>
        </button>
        <input
          id={id}
          type="range"
          min={props.min}
          max={props.max}
          step={props.step}
          value={props.value}
          onInput={(event) => props.onValue(Number(event.currentTarget.value))}
        />
        <button
          type="button"
          class="caregiver-range-step"
          aria-label={`${props.name}を増やす`}
          disabled={props.value >= props.max}
          onClick={() => stepBy(1)}
        >
          <svg viewBox="0 0 20 24" aria-hidden="true">
            <path d="M5 3 L15 12 L5 21" />
          </svg>
        </button>
      </div>
    </div>
  )
}
