// 介助者用メニューのフレーズ編集(Issue #8)。
// 編集できるのは 快 › 気分・不快・不快 › 痛い・不快 › その他・要望の「伝達メッセージ」項目だけ。
// 緊急・戻る・はい・いいえ・続けて/やめて/変えて・下位画面への遷移項目・痛みの強さは
// menus.ts が構造で固定するため、
// ここからは触れない(ホームの緊急先頭、通常下位画面の戻る→緊急など §4.1 の固定項目規則を保つ)。

import { For, Index, Show, createSignal } from 'solid-js'
import {
  MAX_PHRASES_PER_GROUP,
  PHRASE_GROUPS,
  PHRASE_GROUP_LABELS,
  PHRASE_LABEL_MAX,
  PHRASE_TEXT_MAX,
  SCREEN_ITEM_LIMIT,
  isOverItemLimit,
  newPhraseId,
  phraseProblem,
  phrasesFor,
  screenItemCount,
  type Phrase,
  type PhraseGroup,
} from './lib/phrases'
import { exportSettingsJson, parseSettingsJson, type Settings } from './lib/settings'

/**
 * 編集先の一覧(Issue #145)。ホームからのパネルの階層を字下げで示す。name は実際のパネル名で、
 * group が無いもの(快)は、編集できるフレーズが無いので見出しだけ。上から読む順は PHRASE_GROUPS と同じ
 */
interface PhraseTargetNode {
  name: string
  group?: PhraseGroup
  children?: PhraseTargetNode[]
}

export const PHRASE_TARGET_TREE: PhraseTargetNode[] = [
  { name: '快', children: [{ name: '気分', group: 'feelings' }] },
  {
    name: '不快',
    group: 'discomfort',
    children: [
      { name: '痛い', group: 'painLocation' },
      { name: 'その他', group: 'discomfortOther' },
    ],
  },
  { name: '要望', group: 'moodRequest' },
]

function PhraseTargetList(props: {
  nodes: PhraseTargetNode[]
  selected: PhraseGroup
  onSelect: (group: PhraseGroup) => void
}) {
  return (
    <ul>
      <For each={props.nodes}>
        {(node) => (
          <li>
            <Show
              when={node.group}
              fallback={<span class="phrase-target-parent">{node.name}</span>}
            >
              {(target) => (
                <label class="phrase-target-option">
                  <input
                    type="radio"
                    name="phrase-target"
                    value={target()}
                    aria-label={PHRASE_GROUP_LABELS[target()]}
                    checked={props.selected === target()}
                    onChange={() => props.onSelect(target())}
                  />
                  <span>{node.name}</span>
                </label>
              )}
            </Show>
            <Show when={node.children}>
              {(children) => (
                <PhraseTargetList
                  nodes={children()}
                  selected={props.selected}
                  onSelect={props.onSelect}
                />
              )}
            </Show>
          </li>
        )}
      </For>
    </ul>
  )
}

interface PhraseEditorProps {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
}

export default function PhraseEditor(props: PhraseEditorProps) {
  const [group, setGroup] = createSignal<PhraseGroup>('discomfort')
  const overGroups = () => PHRASE_GROUPS.filter((g) => isOverItemLimit(g, props.settings.phrases))

  // 編集中の一覧。編集が無いグループは既定値(編集した時点で既定のコピーから始める)
  const list = () => phrasesFor(group(), props.settings.phrases)

  const save = (next: Phrase[]) =>
    props.updateSettings({ phrases: { ...props.settings.phrases, [group()]: next } })

  // 編集中に空欄になった項目も一覧には残す(消さずに入力を続けられる)。表示には使われない。
  const editable = () => props.settings.phrases[group()] ?? list()

  const update = (index: number, patch: Partial<Phrase>) =>
    save(editable().map((p, i) => (i === index ? { ...p, ...patch } : p)))

  const remove = (index: number) => save(editable().filter((_, i) => i !== index))

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta
    const items = [...editable()]
    if (target < 0 || target >= items.length) return
    ;[items[index], items[target]] = [items[target], items[index]]
    save(items)
  }

  const add = () => {
    const items = editable()
    if (items.length >= MAX_PHRASES_PER_GROUP) return
    save([...items, { id: newPhraseId(items), label: '', text: '' }])
  }

  return (
    <section class="phrase-editor" aria-label="フレーズ編集">
      <p class="phrase-note">
        緊急・戻る・はい・いいえ・続けて/やめて/変えて
        の位置と内容は変えられません。ここで編集できるのは下のフレーズだけです。
      </p>

      <div class="phrase-target">
        <span id="phrase-target-label">編集する画面</span>
        <div role="radiogroup" aria-labelledby="phrase-target-label">
          <PhraseTargetList nodes={PHRASE_TARGET_TREE} selected={group()} onSelect={setGroup} />
        </div>
      </div>

      <Show when={group() === 'painLocation'}>
        <p class="phrase-note">
          痛い場所を選ぶと、続けて強さを選びます。強さは「場所だけ・少し・かなり・とても」の4つです。伝える文に
          「痛いです」を含めると「胸がとても痛いです。」のように強さが入ります。含まない文は、句点で終わるなら句点の前に「…変です、とても。」のように、句点がなければ末尾に、とてもと付きます。
        </p>
      </Show>

      <Show when={overGroups().length > 0}>
        <p class="caregiver-status warn" role="alert">
          目安の {SCREEN_ITEM_LIMIT} 件を超えている画面があります:{' '}
          {overGroups()
            .map(
              (g) =>
                `${PHRASE_GROUP_LABELS[g]}（${screenItemCount(g, props.settings.phrases)}件）`,
            )
            .join('、')}
          。選ぶものが多すぎて緊急に届くまで時間がかかるため、件数を減らしてください。
        </p>
      </Show>

      <ul class="phrase-list">
        <Index each={editable()}>
          {(phrase, index) => (
            <li class="phrase-row">
              <label>
                <span>表示ラベル</span>
                <span class="caregiver-hint">短く書いてください。</span>
                <input
                  type="text"
                  maxLength={PHRASE_LABEL_MAX}
                  value={phrase().label}
                  onInput={(event) => update(index, { label: event.currentTarget.value })}
                />
              </label>
              <label>
                <span>伝える文</span>
                <input
                  type="text"
                  maxLength={PHRASE_TEXT_MAX}
                  value={phrase().text}
                  onInput={(event) => update(index, { text: event.currentTarget.value })}
                />
              </label>
              <Show
                when={
                  group() === 'painLocation' &&
                  phrase().text.trim() !== '' &&
                  !phrase().text.includes('痛いです')
                }
              >
                <p class="phrase-note" role="note">
                  この文には「痛いです」が無いので、強さは「、とても」の形で付きます。句点で終わる文は句点の前に、句点がない文は末尾に付きます。
                </p>
              </Show>
              <Show when={phraseProblem(phrase())}>
                {(problem) => (
                  <p class="caregiver-status warn" role="note">
                    このフレーズは表示されません: {problem()}
                  </p>
                )}
              </Show>
              <div class="phrase-row-actions">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  aria-label="上へ"
                >
                  ↑
                </button>
                <button
                  type="button"
                  disabled={index === editable().length - 1}
                  onClick={() => move(index, 1)}
                  aria-label="下へ"
                >
                  ↓
                </button>
                <button type="button" onClick={() => remove(index)} aria-label="削除">
                  削除
                </button>
              </div>
            </li>
          )}
        </Index>
      </ul>

      <div class="phrase-actions">
        <button
          type="button"
          class="caregiver-action"
          onClick={add}
          disabled={editable().length >= MAX_PHRASES_PER_GROUP}
        >
          フレーズを追加
        </button>
      </div>
    </section>
  )
}

interface SettingsBackupProps {
  settings: Settings
  /** 取り込んだ設定で丸ごと置き換える */
  replaceSettings: (next: Settings) => void
}

/** 設定の書き出し/取り込み(端末の入れ替え用)。介助者用メニューの「データ」タブ */
export function SettingsBackup(props: SettingsBackupProps) {
  const [backupText, setBackupText] = createSignal('')
  const [backupStatus, setBackupStatus] = createSignal('')
  // 取り込みは今の設定を上書きするため、1回目は確認の表示だけにして2回目で実行する
  const [importArmed, setImportArmed] = createSignal(false)
  const doExport = () => {
    const json = exportSettingsJson(props.settings)
    setBackupText(json)
    // 端末によってはクリップボードが使えない。使えなければ下の欄から手でコピーしてもらう
    const fallback = () => setBackupStatus('書き出しました。下の欄からコピーしてください。')
    if (!navigator.clipboard) {
      fallback()
      return
    }
    navigator.clipboard
      .writeText(json)
      .then(() => setBackupStatus('書き出してコピーしました。'))
      .catch(fallback)
  }

  const doImport = () => {
    // 今の設定を土台に、書き出しに含まれる検証済みの項目だけを上書きする
    const next = parseSettingsJson(backupText(), props.settings)
    if (!next) {
      setImportArmed(false)
      setBackupStatus('取り込めません。このアプリで書き出した設定を貼り付けてください。')
      return
    }
    if (!importArmed()) {
      setImportArmed(true)
      setBackupStatus(
        '取り込むと今の設定が書き換わります。よければもう一度「取り込み」を押してください。',
      )
      return
    }
    setImportArmed(false)
    props.replaceSettings(next)
    setBackupStatus('取り込みました。')
  }

  return (
    <section class="settings-backup" aria-label="設定データ">
      <div class="caregiver-field">
        <span>設定の書き出しと取り込み</span>
        <textarea
          rows="4"
          value={backupText()}
          onInput={(event) => {
            setBackupText(event.currentTarget.value)
            setImportArmed(false)
          }}
          placeholder="書き出した設定をここに貼り付けて取り込みます。"
        />
        <div class="phrase-actions">
          <button type="button" class="caregiver-action" onClick={doExport}>
            書き出し
          </button>
          <button type="button" class="caregiver-action" onClick={doImport}>
            取り込み
          </button>
        </div>
      </div>
      <Show when={backupStatus()}>
        <p class="caregiver-status" role="status">
          {backupStatus()}
        </p>
      </Show>
    </section>
  )
}
