import { For, Match, Show, Switch, createSignal, onCleanup, onMount } from 'solid-js'
import {
  getInstallGuide,
  getInstallState,
  promptInstall,
  subscribeInstallState,
  type InstallGuide,
  type InstallState,
} from './lib/install'

const STEPS: Record<InstallGuide, readonly string[]> = {
  ios: ['共有ボタンを押します。', '「ホーム画面に追加」を選びます。', '「追加」を押します。'],
  // macOS Sonoma 14 以降の Safari(https://support.apple.com/ja-jp/104996)
  macSafari: [
    '「ファイル」メニューを開きます。',
    '「Dockに追加」を選びます。',
    '「追加」を押します。',
  ],
  // デスクトップの Firefox は拡張機能なしではインストールできないので、できるブラウザへ案内する
  desktopFirefox: [
    'Chrome か Edge でこのページを開きます。',
    '開いた画面で、この欄の案内に従います。',
  ],
  browser: ['ブラウザのメニューを開きます。', '「インストール」か「ホーム画面に追加」を選びます。'],
}

/**
 * 「使用準備」タブのインストール欄(Issue #158)。ブラウザが受け付けるときはボタン、受け付けないときは
 * 手順の箇条書き(押せないボタンは出さない)、インストール済みならその旨だけを出す。確認画面の表示中と
 * 承諾から appinstalled までは何も出さない
 */
export default function InstallSection() {
  const [state, setState] = createSignal<InstallState>(getInstallState())
  onMount(() => {
    const update = () => setState(getInstallState())
    update()
    onCleanup(subscribeInstallState(update))
  })

  return (
    // 確認画面を出している間と承諾直後は、区切り線ごと何も出さない
    <Show when={state() !== 'waiting'}>
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
              <For each={STEPS[getInstallGuide()]}>{(step) => <li>{step}</li>}</For>
            </ul>
          </Match>
        </Switch>
      </div>
    </Show>
  )
}
