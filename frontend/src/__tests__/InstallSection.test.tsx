// Issue #158: 「使用準備」タブの PWA インストール。
//
// デシジョンテーブル:
//   インストール版で開いている | beforeinstallprompt | UA      | 表示
//   はい                       | -                   | -       | インストール済み。ボタンも手順も無い
//   いいえ                     | 届いた              | -       | ボタン
//   いいえ                     | 届かない            | iOS     | iOS の手順(ボタン無し)
//   いいえ                     | 届かない            | その他  | ブラウザの手順(ボタン無し)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import { getInstallState, initInstallCapture } from '../lib/install'
import { menuOpen, openCaregiverMenu, setupApp, teardownApp } from './appTestKit'

let stopCapture: () => void
beforeEach(() => {
  setupApp()
  stopCapture = initInstallCapture()
})
afterEach(() => {
  stopCapture()
  teardownApp()
})

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>
    userChoice: Promise<{ outcome: string }>
  }
  event.prompt = vi.fn().mockResolvedValue(undefined)
  event.userChoice = Promise.resolve({ outcome })
  return event
}
function open() {
  const view = render(() => <App />)
  openCaregiverMenu(view.container)
  return view.container
}
const section = (c: HTMLElement) => c.querySelector('.install-section') as HTMLElement
const button = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('.install-button')
const steps = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.install-steps li')).map((li) => li.textContent)

describe('Issue #158: インストール欄', () => {
  it('描画より前に届いたイベントを預かり、ボタンから端末の確認画面を出す', async () => {
    const event = installEvent()
    window.dispatchEvent(event) // App の描画より前
    expect(event.defaultPrevented).toBe(true)
    const c = open()
    expect(button(c)?.textContent).toBe('アプリをインストール')
    expect(button(c)?.disabled).toBe(false)
    expect(steps(c)).toEqual([])
    fireEvent.click(button(c) as HTMLElement)
    expect(event.prompt).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(0)
    // 承諾した直後は appinstalled がまだ無い。手順もボタンも出さない(欄ごと無い)
    expect(section(c)).toBeNull()
    expect(c.querySelector('.install-steps')).toBeNull()
    expect(menuOpen(c)).toBe(true)
    window.dispatchEvent(new Event('appinstalled'))
    expect(section(c).textContent).toContain('アプリはインストール済みです。')
    expect(steps(c)).toEqual([])
  })

  it('確認画面を出している間は何も出さず、メニューを開き直しても手順を出さない', () => {
    const event = installEvent()
    event.userChoice = new Promise(() => {})
    window.dispatchEvent(event)
    const c = open()
    fireEvent.click(button(c) as HTMLElement)
    expect(section(c)).toBeNull()
    fireEvent.click(c.querySelector('.caregiver-close') as HTMLElement)
    fireEvent.click(c.querySelector('.caregiver-button') as HTMLElement)
    expect(menuOpen(c)).toBe(true)
    expect(section(c)).toBeNull()
  })

  it('確認画面で断ったら、使えないボタンは残さず手順にする。次のイベントでボタンに戻る', async () => {
    const event = installEvent('dismissed')
    window.dispatchEvent(event)
    const c = open()
    fireEvent.click(button(c) as HTMLElement)
    await vi.advanceTimersByTimeAsync(0)
    expect(button(c)).toBeNull()
    expect(steps(c).length).toBeGreaterThan(0)
    window.dispatchEvent(installEvent())
    expect(button(c)).not.toBeNull()
  })

  it('メニューを開いた後に届いても、ボタンに切り替わる', () => {
    const c = open()
    expect(button(c)).toBeNull()
    window.dispatchEvent(installEvent())
    expect(button(c)).not.toBeNull()
    expect(steps(c)).toEqual([])
  })

  it('appinstalled が届いたら、インストール済みと示してボタンも手順も出さない', () => {
    window.dispatchEvent(installEvent())
    const c = open()
    window.dispatchEvent(new Event('appinstalled'))
    expect(section(c).textContent).toContain('アプリはインストール済みです。')
    expect(button(c)).toBeNull()
    expect(steps(c)).toEqual([])
  })

  it('確認画面が出せなくても例外にせず、手順に切り替える', async () => {
    const event = installEvent()
    event.prompt = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    window.dispatchEvent(event)
    const c = open()
    fireEvent.click(button(c) as HTMLElement)
    await vi.advanceTimersByTimeAsync(0)
    expect(button(c)).toBeNull()
    expect(steps(c).length).toBeGreaterThan(0)
  })

  it('イベントが無い環境は手順の箇条書きだけで、ボタン(押せないボタンを含む)は出さない', () => {
    const c = open()
    expect(steps(c)).toEqual([
      'ブラウザのメニューを開きます。',
      '「インストール」か「ホーム画面に追加」を選びます。',
    ])
    expect(section(c).querySelector('button')).toBeNull()
  })

  it.each([
    ['iPhone', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }],
    [
      'iPadOS(Mac を名乗る)',
      { userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 },
    ],
  ])('%s は iOS の手順を出す', (_name, props) => {
    // jsdom の navigator に無いプロパティもあるので、インスタンスに被せて後で消す
    for (const [key, value] of Object.entries(props)) {
      Object.defineProperty(window.navigator, key, { value, configurable: true })
    }
    try {
      const c = open()
      expect(steps(c)).toEqual([
        '共有ボタンを押します。',
        '「ホーム画面に追加」を選びます。',
        '「追加」を押します。',
      ])
      expect(section(c).querySelector('button')).toBeNull()
    } finally {
      for (const key of Object.keys(props)) {
        delete (window.navigator as unknown as Record<string, unknown>)[key]
      }
    }
  })

  it.each(['fullscreen', 'standalone', 'minimal-ui'])(
    'display-mode: %s で開いていればインストール済み(イベントが届いてもボタンは出さない)',
    (mode) => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === `(display-mode: ${mode})`,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
      window.dispatchEvent(installEvent())
      expect(getInstallState()).toBe('installed')
      const c = open()
      expect(section(c).textContent).toContain('アプリはインストール済みです。')
      expect(section(c).querySelector('button')).toBeNull()
      expect(steps(c)).toEqual([])
    },
  )

  it('iOS の navigator.standalone でもインストール済み', () => {
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true })
    try {
      const c = open()
      expect(section(c).textContent).toContain('アプリはインストール済みです。')
    } finally {
      delete (window.navigator as unknown as { standalone?: boolean }).standalone
    }
  })

  const UA = {
    macSafari:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
    macChrome:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
    linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0',
    macFirefox:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0',
    androidFirefox: 'Mozilla/5.0 (Android 15; Mobile; rv:140.0) Gecko/140.0 Firefox/140.0',
    androidChrome:
      'Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
  }
  const MAC = [
    '「ファイル」メニューを開きます。',
    '「Dockに追加」を選びます。',
    '「追加」を押します。',
  ]
  const FIREFOX = [
    'Chrome か Edge でこのページを開きます。',
    '開いた画面で、この欄の案内に従います。',
  ]
  const BROWSER = [
    'ブラウザのメニューを開きます。',
    '「インストール」か「ホーム画面に追加」を選びます。',
  ]
  it.each([
    ['Mac の Safari', UA.macSafari, MAC],
    ['Mac の Chrome', UA.macChrome, BROWSER],
    ['Linux の Firefox', UA.linuxFirefox, FIREFOX],
    ['Mac の Firefox', UA.macFirefox, FIREFOX],
    ['Android の Firefox', UA.androidFirefox, BROWSER],
    ['Android の Chrome', UA.androidChrome, BROWSER],
  ])('%s の手順', (_name, userAgent, expected) => {
    Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true })
    try {
      const c = open()
      expect(steps(c)).toEqual(expected)
      expect(section(c).querySelector('button')).toBeNull()
      expect(section(c).textContent).not.toMatch(/[（）()]/)
    } finally {
      delete (window.navigator as unknown as Record<string, unknown>).userAgent
    }
  })

  it('インストール欄の文言にかっこは無い', () => {
    const c = open()
    expect(section(c).textContent).not.toMatch(/[（）()]/)
  })
})
