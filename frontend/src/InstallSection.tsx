import { For, Match, Switch, createSignal, onCleanup, onMount } from 'solid-js'
import {
  getInstallState,
  isIos,
  promptInstall,
  subscribeInstallState,
  type InstallState,
} from './lib/install'

const IOS_STEPS = [
  '共有ボタンを押します。',
  '「ホーム画面に追加」を選びます。',
  '「追加」を押します。',
]
const BROWSER_STEPS = [
  'ブラウザのメニューを開きます。',
  '「インストール」か「ホーム画面に追加」を選びます。',
]

/**
 * 「使用準備」タブのインストール欄(Issue #158)。ブラウザが受け付けるときはボタン、受け付けないときは
 * 手順の箇条書き(押せないボタンは出さない)、インストール済みならその旨だけを出す
 */
export default function InstallSection() {
  const [state, setState] = createSignal<InstallState>(getInstallState())
  onMount(() => {
    const update = () => setState(getInstallState())
    update()
    onCleanup(subscribeInstallState(update))
  })

  return (
    <div class="caregiver-item install-section">
      <Switch>
        <Match when={state() === 'installed'}>
          <p class="caregiver-status">
            <span class="caregiver-status-mark" aria-hidden="true">
              ✓
            </span>
            <span class="caregiver-status-text">アプリはインストール済みです。</span>
          </p>
        </Match>
        <Match when={state() === 'prompt'}>
          <p class="caregiver-lead">この端末にアプリとしてインストールできます。</p>
          <div class="phrase-actions">
            <button
              type="button"
              class="caregiver-action install-button"
              onClick={() => void promptInstall()}
            >
              アプリをインストール
            </button>
          </div>
        </Match>
        <Match when={state() === 'manual'}>
          <p class="caregiver-lead">アプリとしてインストールする手順です。</p>
          <ul class="install-steps">
            <For each={isIos() ? IOS_STEPS : BROWSER_STEPS}>{(step) => <li>{step}</li>}</For>
          </ul>
        </Match>
      </Switch>
    </div>
  )
}
