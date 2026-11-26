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
    // 使ったイベントはもう使えないので、押しても反応しないボタンは残さない
    expect(button(c)).toBeNull()
    expect(steps(c).length).toBeGreaterThan(0)
    expect(menuOpen(c)).toBe(true)
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

  it('インストール欄の文言にかっこは無い', () => {
    const c = open()
    expect(section(c).textContent).not.toMatch(/[（）()]/)
  })
})
