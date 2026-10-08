// Issue #68: 介助者メニューは画面全体の設定画面。高さ固定でタブ切替時に外枠が動かない。
// jsdom はレイアウト寸法を測れないため、(1) globals.css の規則を静的に縛り、
// (2) 全タブ切替で外枠・ヘッダ・タブ列・案内帯が同一DOMノードのまま(再マウントされない)を確認する。
// 実寸(getBoundingClientRect の一致)は実ブラウザで確認する。
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'

let css = ''
beforeAll(async () => {
  // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
  const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8')
})

/** メディアクエリの外にある(行頭の)単独セレクタの規則本体 */
const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  return matches.map((m) => m[1]).join('\n')
}

describe('Issue #68: 介助者メニューのスタイル(静的)', () => {
  it('.caregiver-overlay は画面全体に固定され、暗幕・中央寄せ・余白を持たない', () => {
    const body = ruleBody('.caregiver-overlay')
    expect(body).toMatch(/position:\s*fixed/)
    expect(body).toMatch(/inset:\s*0\b/)
    expect(body).toMatch(/z-index:\s*30\b/)
    expect(body).not.toMatch(/background/)
    expect(body).not.toMatch(/display:\s*grid|place-items|place-content/)
    expect(body).not.toMatch(/padding/)
  })

  it('.caregiver-panel は幅100%・高さ100dvh固定で、角丸・影のないポップアップでない不透明背景', () => {
    const body = ruleBody('.caregiver-panel')
    expect(body).toMatch(/(^|[;\s])width:\s*100%/)
    expect(body).toMatch(/(^|[;\s])height:\s*100dvh/)
    // 高さが中身で決まる max-height 方式に戻さない
    expect(body).not.toMatch(/max-height/)
    expect(body).not.toMatch(/border-radius/)
    expect(body).not.toMatch(/box-shadow/)
    expect(body).toMatch(/background:\s*var\(--caregiver-panel-bg\)/)
  })

  it('.caregiver-tabpanel だけがスクロールする(overflow-y: auto)', () => {
    expect(ruleBody('.caregiver-tabpanel')).toMatch(/overflow-y:\s*auto/)
    expect(ruleBody('.caregiver-panel')).toMatch(/overflow:\s*hidden/)
  })
})

describe('Issue #68: 全タブ切替で外枠が動かない(DOM構造)', () => {
  afterEach(() => cleanup())

  const TAB_LABELS = [
    '状態',
    'スキャン',
    '入力方式',
    'フィードバック',
    '表示',
    'フレーズ',
    'データ',
  ]
  const pick = (c: HTMLElement) => ({
    overlay: c.querySelector('.caregiver-overlay'),
    panel: c.querySelector('.caregiver-panel'),
    header: c.querySelector('.caregiver-header'),
    notes: c.querySelector('.caregiver-notes'),
    tablist: c.querySelector('.caregiver-tablist'),
  })
  const tabs = (c: HTMLElement) => Array.from(c.querySelectorAll('[role="tab"]')) as HTMLElement[]
  const hasButton = (c: HTMLElement, text: string) =>
    Array.from(c.querySelectorAll('.caregiver-header button')).some((b) =>
      b.textContent?.includes(text),
    )

  it('7タブを順に切り替えても overlay/panel/header/notes/tablist は同一ノードのまま', () => {
    const { container } = render(() => <App />)
    fireEvent.click(container.querySelector('.caregiver-button') as HTMLElement)
    const before = pick(container)
    for (const el of Object.values(before)) expect(el).not.toBeNull()

    expect(tabs(container).map((t) => t.textContent)).toEqual(TAB_LABELS)
    for (const label of TAB_LABELS) {
      fireEvent.click(tabs(container).find((t) => t.textContent === label) as HTMLElement)
      const after = pick(container)
      expect(after.overlay).toBe(before.overlay)
      expect(after.panel).toBe(before.panel)
      expect(after.header).toBe(before.header)
      expect(after.notes).toBe(before.notes)
      expect(after.tablist).toBe(before.tablist)
      // 常に tabpanel は1つだけで、スクロールはその中
      expect(container.querySelectorAll('.caregiver-panel > .caregiver-tabpanel')).toHaveLength(1)
    }
  })

  it('緊急解除と閉じるは全タブで常にヘッダに存在する', () => {
    const { container } = render(() => <App />)
    fireEvent.click(container.querySelector('.caregiver-button') as HTMLElement)
    for (const label of TAB_LABELS) {
      fireEvent.click(tabs(container).find((t) => t.textContent === label) as HTMLElement)
      expect(hasButton(container, '緊急解除'), `${label}: 緊急解除`).toBe(true)
      expect(hasButton(container, '閉じる'), `${label}: 閉じる`).toBe(true)
    }
  })
})
