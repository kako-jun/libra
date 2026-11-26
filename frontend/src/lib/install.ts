// 介助者用メニュー「使用準備」タブの PWA インストール(Issue #158)。
//
// Chromium 系は、インストールを受け付けられるときに beforeinstallprompt を起動直後に出す。取りこぼすと
// 後から取り直せないので、index.tsx が描画より前に initInstallCapture() を呼んで預かる。
// このイベントが無い環境(iOS Safari など)は、ページのボタンからインストールできないので手順を示す。
// インストール済みかは「インストールした版で開いている(display-mode / iOS の navigator.standalone)」か
// appinstalled が届いたことで判断する。ブラウザのタブで開いている間に過去のインストールを知る方法は使わない。

/** beforeinstallprompt のイベント(標準の型定義に無い) */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<unknown>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/**
 * installed: インストール済み / prompt: ボタンから端末の確認画面を出せる / manual: 手順を示す /
 * waiting: 確認画面を出している間と、承諾してから appinstalled が届くまで(何も出さない)
 */
export type InstallState = 'installed' | 'waiting' | 'prompt' | 'manual'

/** 手順の出し分け。ブラウザによってメニューの場所と、インストールできるかが違う */
export type InstallGuide = 'ios' | 'macSafari' | 'desktopFirefox' | 'browser'

// manifest の display は fullscreen(非対応環境では standalone)。minimal-ui はブラウザ側の代替
const INSTALLED_DISPLAY_MODES = ['fullscreen', 'standalone', 'minimal-ui']

let deferred: BeforeInstallPromptEvent | null = null
let installedNow = false
let waiting = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

function openedAsInstalledApp(): boolean {
  if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true
  if (typeof window.matchMedia !== 'function') return false
  return INSTALLED_DISPLAY_MODES.some(
    (mode) => window.matchMedia(`(display-mode: ${mode})`)?.matches === true,
  )
}

export function getInstallState(): InstallState {
  if (installedNow || openedAsInstalledApp()) return 'installed'
  if (waiting) return 'waiting'
  return deferred ? 'prompt' : 'manual'
}

export function getInstallGuide(): InstallGuide {
  const { userAgent, platform, maxTouchPoints } = window.navigator
  // iPadOS はデスクトップの Mac を名乗るので、タッチ点数で見分ける
  if (/iPhone|iPad|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1)) {
    return 'ios'
  }
  // Mac の Safari だけが Version/ と Safari/ を持つ(Chrome・Edge は Version/ を持たない)
  if (/Macintosh/.test(userAgent) && /Version\/[\d.]+ Safari\//.test(userAgent)) return 'macSafari'
  // Android の Firefox はメニューから追加できるので、ほかのブラウザと同じ手順にする
  if (/Firefox\//.test(userAgent) && !/Android|Mobile|Tablet/.test(userAgent)) {
    return 'desktopFirefox'
  }
  return 'browser'
}

/** 状態が変わりうるとき(イベントが届いた・確認画面を使った)に呼ばれる。戻り値で購読をやめる */
export function subscribeInstallState(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 端末の確認画面を出す。預かったイベントは 1 回しか使えないので手放す */
export async function promptInstall(): Promise<void> {
  const event = deferred
  if (!event) return
  deferred = null
  waiting = true
  notify()
  try {
    await event.prompt()
    const choice = await event.userChoice
    // 承諾されたら appinstalled を待つ。その間に手順を出すと、まだ操作が要るように見える
    if (choice.outcome !== 'accepted') waiting = false
  } catch {
    // 確認画面を出せなくても、手順の表示に切り替わるだけで伝達には影響しない
    waiting = false
  } finally {
    notify()
  }
}

/** 起動直後に 1 回呼ぶ。戻り値はテスト用の後始末(預かったイベントと状態も消す) */
export function initInstallCapture(): () => void {
  const onBeforeInstallPrompt = (event: Event) => {
    // ブラウザ独自の案内を本人の画面に出さず、介助者がボタンから出す
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    installedNow = false
    waiting = false
    notify()
  }
  const onInstalled = () => {
    deferred = null
    waiting = false
    installedNow = true
    notify()
  }
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  window.addEventListener('appinstalled', onInstalled)
  return () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.removeEventListener('appinstalled', onInstalled)
    deferred = null
    installedNow = false
    waiting = false
  }
}
