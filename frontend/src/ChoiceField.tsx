import { For, createUniqueId } from 'solid-js'

interface ChoiceFieldProps<T extends string> {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  onSelect: (value: T) => void
}

/**
 * 値を 1 つ選ぶ欄(Issue #147・#148)。実行する操作と見分けられるよう、ボタンではなくラジオボタンにする。
 * 選択肢は折り返さず等幅の 1 段に並べる。--choices(個数)と --choice-chars(いちばん長い名前の文字数)は、
 * 狭い幅で文字の大きさを決める式(globals.css の .caregiver-radio)が使う
 */
export default function ChoiceField<T extends string>(props: ChoiceFieldProps<T>) {
  const id = createUniqueId()
  const longest = () =>
    Math.max(...props.options.map((option) => Array.from(props.labels[option]).length))
  return (
    <div class="caregiver-field">
      <span id={`${id}-label`}>{props.label}</span>
      <div
        class="caregiver-radios"
        role="radiogroup"
        aria-labelledby={`${id}-label`}
        style={{ '--choices': String(props.options.length), '--choice-chars': String(longest()) }}
      >
        <For each={props.options}>
          {(option) => (
            <label class="caregiver-radio">
              <input
                type="radio"
                name={id}
                value={option}
                checked={props.value === option}
                onChange={() => props.onSelect(option)}
              />
              <span>{props.labels[option]}</span>
            </label>
          )}
        </For>
      </div>
    </div>
  )
}
