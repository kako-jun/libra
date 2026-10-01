// 介助者メニューのフレーズ編集(Issue #8)。
// 編集できるのは不快・不快その他・痛い場所・快/要望の「伝達メッセージ」項目だけ。
// 緊急・戻る・はい・いいえ・下位画面への遷移項目は menus.ts が構造で固定するため、
// ここからは触れない(先頭緊急規則 §4.1 を編集で崩さない)。

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
  phrasesFor,
  screenItemCount,
  type Phrase,
  type PhraseGroup,
} from './lib/phrases'
import { exportSettingsJson, parseSettingsJson, type Settings } from './lib/settings'

interface PhraseEditorProps {
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  /** 取り込んだ設定で丸ごと置き換える */
  replaceSettings: (next: Settings) => void
}

export default function PhraseEditor(props: PhraseEditorProps) {
  const [group, setGroup] = createSignal<PhraseGroup>('discomfort')
  const [backupText, setBackupText] = createSignal('')
  const [backupStatus, setBackupStatus] = createSignal('')

  // 編集中の一覧。編集が無いグループは既定値(編集した時点で既定のコピーから始める)
  const list = () => phrasesFor(group(), props.settings.phrases)
  const isCustomized = () => props.settings.phrases[group()] !== undefined

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

  const resetGroup = () => {
    const rest = { ...props.settings.phrases }
    delete rest[group()]
    props.updateSettings({ phrases: rest })
  }

  const doExport = () => {
    const json = exportSettingsJson(props.settings)
    setBackupText(json)
    // 端末によってはクリップボードが使えない。使えなければ下の欄から手でコピーしてもらう
    void navigator.clipboard
      ?.writeText(json)
      .then(() => setBackupStatus('書き出してコピーしました'))
      .catch(() => setBackupStatus('書き出しました（下の欄からコピーしてください）'))
    if (!navigator.clipboard) setBackupStatus('書き出しました（下の欄からコピーしてください）')
  }

  const doImport = () => {
    const next = parseSettingsJson(backupText())
    if (!next) {
      setBackupStatus('取り込めません: 書き出した JSON を貼り付けてください')
      return
    }
    props.replaceSettings(next)
    setBackupStatus('取り込みました')
  }

  return (
    <section class="phrase-editor" aria-label="フレーズ編集">
      <h3>フレーズ編集</h3>
      <p class="phrase-note">
        緊急・戻る・はい・いいえの位置と内容は変えられません。ここで編集できるのは下の定型文だけです。
      </p>

      <div class="caregiver-choice-options">
        <For each={PHRASE_GROUPS}>
          {(g) => (
            <button type="button" classList={{ active: group() === g }} onClick={() => setGroup(g)}>
              {PHRASE_GROUP_LABELS[g]}
            </button>
          )}
        </For>
      </div>

      <Show when={isOverItemLimit(group(), props.settings.phrases)}>
        <p class="caregiver-status warn" role="alert">
          この画面は {screenItemCount(group(), props.settings.phrases)} 項目で、目安の{' '}
          {SCREEN_ITEM_LIMIT} 項目を超えています。スキャンが長くなり緊急に届くまで時間がかかるため、
          項目を減らすか、別の画面に分けてください。
        </p>
      </Show>

      <ul class="phrase-list">
        <Index each={editable()}>
          {(phrase, index) => (
            <li class="phrase-row">
              <label>
                <span>表示ラベル（短く）</span>
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
        <button
          type="button"
          class="caregiver-action"
          onClick={resetGroup}
          disabled={!isCustomized()}
        >
          この画面を既定に戻す
        </button>
      </div>

      <div class="caregiver-field">
        <span>設定のバックアップ（端末の入れ替え用）</span>
        <textarea
          rows="4"
          value={backupText()}
          onInput={(event) => setBackupText(event.currentTarget.value)}
          placeholder="書き出した設定の JSON をここに貼り付けて取り込みます"
        />
        <div class="phrase-actions">
          <button type="button" class="caregiver-action" onClick={doExport}>
            書き出し
          </button>
          <button type="button" class="caregiver-action" onClick={doImport}>
            取り込み
          </button>
        </div>
        <Show when={backupStatus()}>
          <p class="caregiver-status" role="status">
            {backupStatus()}
          </p>
        </Show>
      </div>
    </section>
  )
}
