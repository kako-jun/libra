// Issue #69: パンくずの祖先をクリック/タップで移動できる。
// 方針: Tab で入る経路は作らない(Tab は本人のスイッチ入力)。フォーカス到達は click 後・支援技術・プログラム focus のみ、
// Enter / Space はボタン標準の click に任せ、本人のスイッチ入力として処理しない。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import * as offlineReadyModule from '../lib/offlineReady'
import { PARENT_SCREEN, buildScreenBreadcrumb } from '../lib/menus'
import type { ScreenId } from '../lib/menus'

const INTERVAL_MS = 1500

let css = ''
beforeAll(async () => {
  // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
  const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
})

function scanningLabel(container: HTMLElement): string | null {
  return container.querySelector('.tile.scanning .tile-label')?.textContent ?? null
}

function selectByLabel(container: HTMLElement, label: string) {
  for (let i = 0; i < 40 && scanningLabel(container) !== label; i += 1) {
    vi.advanceTimersByTime(INTERVAL_MS)
  }
  expect(scanningLabel(container)).toBe(label)
  vi.advanceTimersByTime(600)
  fireEvent.keyDown(window, { key: ' ' })
}

const crumb = (container: HTMLElement) => container.querySelector('.screen-breadcrumb') as HTMLElement
const crumbButtons = (container: HTMLElement) =>
  Array.from(crumb(container).querySelectorAll<HTMLButtonElement>('button.breadcrumb-link'))
const crumbButton = (container: HTMLElement, title: string) => {
  const b = crumbButtons(container).find((x) => x.textContent === title)
  expect(b, title).toBeDefined()
  return b as HTMLButtonElement
}
const tileLabels = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('.tile-label')).map((el) => el.textContent ?? '')
const guideTitle = (container: HTMLElement) => container.querySelector('.screen-guide h2')?.textContent

describe('buildScreenBreadcrumb: 移動先(screen)', () => {
  const screens = Object.keys(PARENT_SCREEN).concat('home') as ScreenId[]

  it('全ScreenIdで、screen を持つ要素は PARENT_SCREEN の祖先チェーンと一致し、現在地は screen を持たない', () => {
    for (const screen of screens) {
      const chain: ScreenId[] = []
      for (let c = screen; c !== 'home'; ) {
        c = PARENT_SCREEN[c]
        chain.unshift(c)
      }
      const items = buildScreenBreadcrumb(screen)
      expect(items.at(-1)?.screen, screen).toBeUndefined()
      expect(
        items.filter((i) => i.screen).map((i) => i.screen),
        screen,
      ).toEqual(chain)
    }
  })

  it('動的要素: 痛みの場所は painLocation へ、文字盤の行ラベルは移動先なし', () => {
    const pain = buildScreenBreadcrumb('painIntensity', { painLabel: '胸' })
    expect(pain.find((i) => i.title === '胸')?.screen).toBe('painLocation')
    const row = buildScreenBreadcrumb('lettersRow', { letterRowLabel: 'あ行' })
    expect(row.find((i) => i.title === 'あ行')?.screen).toBeUndefined()
    expect(row.find((i) => i.title === '文字盤')?.screen).toBe('letters')
  })
})

describe('App: パンくずの祖先クリック', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    window.localStorage.clear()
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = undefined
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = vi.fn()
    ;(window as unknown as { speechSynthesis?: unknown }).speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
    }
    ;(globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance =
      class {
        constructor(public text: string) {}
      }
    vi.spyOn(offlineReadyModule, 'recheckOfflineReady').mockResolvedValue(undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  function toPainIntensity(container: HTMLElement) {
    selectByLabel(container, '不快')
    selectByLabel(container, '痛い')
    selectByLabel(container, '胸')
    expect(crumb(container).textContent).toContain('痛みの強さ')
  }

  it('ホームのパンくず(現在地のみ)にはボタンが無い', () => {
    const { container } = render(() => <App />)
    expect(crumbButtons(container)).toHaveLength(0)
  })

  it('現在地の li にはボタンが無く aria-current=location が付く。祖先はボタン', () => {
    const { container } = render(() => <App />)
    toPainIntensity(container)
    const lis = Array.from(crumb(container).querySelectorAll('li'))
    const last = lis.at(-1) as HTMLElement
    expect(last.getAttribute('aria-current')).toBe('location')
    expect(last.querySelector('button')).toBeNull()
    expect(crumbButtons(container).map((b) => b.textContent)).toEqual(['ホーム', '不快', '胸'])
  })

  it('祖先をクリックすると該当画面へ移る(ホーム/不快/選んだ場所)', () => {
    const { container } = render(() => <App />)
    toPainIntensity(container)

    fireEvent.click(crumbButton(container, '胸'))
    expect(crumb(container).textContent).toContain('痛い場所')
    expect(crumb(container).textContent).not.toContain('痛みの強さ')

    fireEvent.click(crumbButton(container, '不快'))
    expect(guideTitle(container)).toBe('つらいことを選んでください。')
    expect(tileLabels(container)).toContain('痛い')

    fireEvent.click(crumbButton(container, 'ホーム'))
    expect(crumbButtons(container)).toHaveLength(0)
    expect(tileLabels(container)).toContain('不快')
    expect(tileLabels(container)).toContain('緊急')
  })

  it('介助者メニュー表示中は背後のパンくずボタンを押しても遷移しない', () => {
    const { container } = render(() => <App />)
    toPainIntensity(container)
    const before = crumb(container).textContent
    fireEvent.click(container.querySelector('.caregiver-button') as HTMLElement)
    expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
    fireEvent.click(crumbButton(container, 'ホーム'))
    expect(crumb(container).textContent).toBe(before)
    expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
  })

  it('緊急状態中でもパンくずから移動でき、緊急表示が維持される', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '緊急')
    selectByLabel(container, '戻る')
    toPainIntensity(container)
    expect(container.querySelector('.emergency-status')).not.toBeNull()

    fireEvent.click(crumbButton(container, '不快'))
    expect(guideTitle(container)).toBe('つらいことを選んでください。')
    expect(container.querySelector('.emergency-status')).not.toBeNull()
    fireEvent.click(crumbButton(container, 'ホーム'))
    expect(container.querySelector('.emergency-status')).not.toBeNull()
  })

  it('文字盤: 行ラベルはボタンにならず、文字盤はボタンで letters へ移る', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '文字盤')
    const firstRow = tileLabels(container).find((l) => /行$/.test(l)) as string
    expect(firstRow).toBeDefined()
    selectByLabel(container, firstRow)
    expect(crumb(container).textContent).toContain(firstRow)
    expect(crumbButtons(container).map((b) => b.textContent)).toEqual(['ホーム', '文字盤'])

    fireEvent.click(crumbButton(container, '文字盤'))
    expect(crumb(container).textContent).not.toContain(firstRow)
    expect(tileLabels(container).some((l) => /行$/.test(l))).toBe(true)
    expect(crumbButtons(container).map((b) => b.textContent)).toEqual(['ホーム'])
  })

  // スコープ: 合成 KeyboardEvent は jsdom でボタンの既定アクティベーション(Enter/Space で click)を起こさないため、
  // ここでは「本人のスイッチ入力として扱われない(defaultPrevented でない・メッセージが出ない)」ことだけを検証する。
  // 実ブラウザでフォーカスしたホーム + Space でホームへ移動することは確認済み(#72 レビュー)。
  // @testing-library/user-event は未導入のため、新規依存は足していない。
  it('パンくずボタンにフォーカスした Enter/Space は本人のスイッチ入力にならない', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '不快')
    const home = crumbButton(container, 'ホーム')
    home.focus()
    vi.advanceTimersByTime(600)
    for (const key of ['Enter', ' ']) {
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
      home.dispatchEvent(ev)
      expect(ev.defaultPrevented, key).toBe(false)
      home.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }))
    }
    vi.advanceTimersByTime(600)
    // 画面は不快のまま(タイル実行されていない)で伝達メッセージも出ていない
    expect(guideTitle(container)).toBe('つらいことを選んでください。')
    expect(container.querySelector('.message-panel.is-empty')).not.toBeNull()
  })

  it('ボタン以外にフォーカスがある Enter/Space は従来どおり本人のスイッチ入力', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '不快')
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    // 先頭は「戻る」。Space で実行されてホームへ戻る
    expect(scanningLabel(container)).toBe('戻る')
    vi.advanceTimersByTime(600)
    fireEvent.keyDown(window, { key: ' ' })
    fireEvent.keyUp(window, { key: ' ' })
    expect(tileLabels(container)).toContain('緊急')
    expect(crumbButtons(container)).toHaveLength(0)
  })
})

describe('globals.css: .breadcrumb-link(静的)', () => {
  const bodies = (selector: string): string => {
    const out: string[] = []
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (m[1].split(',').map((s) => s.trim()).includes(selector)) out.push(m[2])
    }
    return out.join('\n')
  }

  it('touch-action: manipulation と下線を持つ', () => {
    const b = bodies('.screen-breadcrumb .breadcrumb-link')
    expect(b).toMatch(/touch-action:\s*manipulation/)
    expect(b).toMatch(/text-decoration:\s*underline/)
  })

  it(':focus-visible の outline を持つ', () => {
    expect(bodies('.screen-breadcrumb .breadcrumb-link:focus-visible')).toMatch(/outline:\s*\d+px solid/)
  })
})
