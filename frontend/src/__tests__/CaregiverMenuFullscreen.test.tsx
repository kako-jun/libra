// Issue #68: 介助者メニューは画面全体の設定画面。高さ固定でタブ切替時に外枠が動かない。
// jsdom はレイアウト寸法を測れないため、(1) globals.css の規則を静的に縛り(メディアクエリ内も含む)、
// (2) 全タブ切替で外枠・ヘッダ・タブ列・案内帯の構造が不変(同一DOMノード・tabpanel は1つ)であることを確認する。
// (2) は構造の不変条件であり、#68 の退行(高さが中身で決まる等)そのものはCSS側の静的検証が捕まえる。
// 実寸(getBoundingClientRect の一致)は実ブラウザで確認する。
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'

let css = ''
beforeAll(async () => {
  // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
  const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  // コメントは全 helper の共通入口(css 本体)で除去する。規則本体・セレクタ側どちらのコメントも拾わない。
  css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
})

/** メディアクエリの外にある(行頭の)単独セレクタの規則本体 */
const ruleBody = (selector: string): string => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  return matches.map((m) => m[1]).join('\n')
}

/** メディアクエリ内も含め、全ての規則のうちセレクタ(カンマ区切りの一つ)が完全一致するものの本体 */
const allRuleBodies = (selector: string): string[] => {
  const out: string[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((x) => x.trim())
    if (sels.includes(selector)) out.push(m[2])
  }
  return out
}

/**
 * メディアクエリ内も含め、セレクタ(カンマ区切りの一つ)の「末尾の複合セレクタ」が cls で始まる規則の本体。
 * `.caregiver-overlay .caregiver-panel { … }` のような子孫・複合指定も拾う。
 * `.caregiver-panel input` のように cls が祖先側にあるだけの規則(対象は別要素)は拾わない。
 * 制約: セレクタは単純にカンマ分割するため、`:is(.a, .caregiver-panel)` / `:not(...)` のように
 * 括弧内にカンマを含むセレクタは正しく分解できない(現行 CSS に該当は無い)。
 */
const subjectRuleBodies = (cls: string): string[] => {
  const out: string[] = []
  const head = new RegExp(`^${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((x) => x.trim())
    if (sels.some((sel) => head.test(sel.split(/[\s>+~]+/).pop() ?? ''))) out.push(m[2])
  }
  return out
}

describe('Issue #68: 介助者メニューのスタイル(静的)', () => {
  it('メディアクエリ内を含め、.caregiver-panel に max-height/角丸/影が、.caregiver-overlay に grid/中央寄せ/背景/余白が戻っていない', () => {
    const panels = subjectRuleBodies('.caregiver-panel')
    const overlays = allRuleBodies('.caregiver-overlay')
    expect(panels.length).toBeGreaterThan(0)
    expect(overlays.length).toBeGreaterThan(0)
    for (const b of panels) {
      expect(b).not.toMatch(/max-height|border-radius|box-shadow/)
    }
    for (const b of overlays) {
      expect(b).not.toMatch(/display:\s*grid|place-items|place-content|background|padding/)
    }
  })

  it('.caregiver-header / .caregiver-notes / .caregiver-tablist は flex: none の固定帯', () => {
    for (const sel of ['.caregiver-header', '.caregiver-notes', '.caregiver-tablist']) {
      expect(ruleBody(sel), sel).toMatch(/(^|[;\s])flex:\s*none/)
    }
  })

  it('メディアクエリ内でも固定帯の flex と .caregiver-panel の height を上書きしていない', () => {
    for (const sel of ['.caregiver-header', '.caregiver-notes', '.caregiver-tablist']) {
      for (const b of allRuleBodies(sel)) {
        expect(b, sel).not.toMatch(/(^|[;\s])flex(-grow|-shrink|-basis)?:\s*(?!none)[^\s;]/)
      }
    }
    for (const b of subjectRuleBodies('.caregiver-panel')) {
      expect(b).not.toMatch(/(^|[;\s])(max-|min-)?height:\s*(?!100%)[^\s;]/)
    }
  })

  it('本人画面 .app-shell の height は 100% だけで、メディアクエリ内でも他の値で上書きしない(#84: 100vh/100dvh は dvh 非対応環境で body より高くなり下端が切れるため撤去)', () => {
    const bodies = subjectRuleBodies('.app-shell')
    expect(bodies.length).toBeGreaterThan(0)
    const heights = bodies.flatMap((b) =>
      [...b.matchAll(/(?:^|[;\s])height:\s*([^;}]+)/g)].map((m) => m[1].trim()),
    )
    expect(heights.length).toBeGreaterThan(0)
    for (const h of heights) expect(h, `height: ${h}`).toBe('100%')
  })

  it('html, body に height を持たせず、#app は height:100%(#84: 高さは body の position:fixed; inset:0 が確定し、#app → .app-shell の 100% 連鎖で受ける)', () => {
    for (const sel of ['html', 'body']) {
      const bodies = allRuleBodies(sel)
      expect(bodies.length, sel).toBeGreaterThan(0)
      for (const b of bodies) expect(b, sel).not.toMatch(/(^|[;\s])(min-|max-)?height:/)
    }
    const app = allRuleBodies('#app')
    expect(app.length).toBeGreaterThan(0)
    expect(app.join('\n')).toMatch(/(^|[;\s])height:\s*100%/)
  })

  it('.caregiver-tabpanel の子要素は読みやすい幅(960px)に抑える', () => {
    expect(ruleBody('.caregiver-tabpanel > *')).toMatch(/max-inline-size:\s*960px/)
  })

  it('.caregiver-overlay は画面全体に固定され、暗幕・中央寄せ・余白を持たない', () => {
    const body = ruleBody('.caregiver-overlay')
    expect(body).toMatch(/position:\s*fixed/)
    expect(body).toMatch(/inset:\s*0\b/)
    expect(body).toMatch(/z-index:\s*30\b/)
    expect(body).not.toMatch(/background/)
    expect(body).not.toMatch(/display:\s*grid|place-items|place-content/)
    expect(body).not.toMatch(/padding/)
  })

  it('.caregiver-panel は幅100%・高さ100%(overlay基準)固定で、角丸・影のないポップアップでない不透明背景', () => {
    const body = ruleBody('.caregiver-panel')
    expect(body).toMatch(/(^|[;\s])width:\s*100%/)
    expect(body).toMatch(/(^|[;\s])height:\s*100%/)
    // 高さが中身で決まる max-height 方式に戻さない
    expect(body).not.toMatch(/max-height/)
    expect(body).not.toMatch(/border-radius/)
    expect(body).not.toMatch(/box-shadow/)
    expect(body).toMatch(/background:\s*var\(--caregiver-panel-bg\)/)
  })

  it('.caregiver-tabpanel だけがスクロールする(overflow-y: auto)', () => {
    expect(ruleBody('.caregiver-tabpanel')).toMatch(/overflow-y:\s*auto/)
    expect(ruleBody('.caregiver-panel')).toMatch(/overflow:\s*hidden/)
    // メディアクエリ内・複合セレクタでも上書きして退行させない
    for (const b of subjectRuleBodies('.caregiver-tabpanel')) {
      for (const m of b.matchAll(/(?:^|[;\s])overflow(?:-y)?:\s*([^;}]+)/g)) {
        expect(m[1].trim()).toBe('auto')
      }
    }
    for (const b of subjectRuleBodies('.caregiver-panel')) {
      for (const m of b.matchAll(/(?:^|[;\s])overflow(?:-y)?:\s*([^;}]+)/g)) {
        expect(m[1].trim()).toBe('hidden')
      }
    }
  })
})

describe('Issue #68: 全タブ切替で外枠の構造が変わらない(構造の不変条件)', () => {
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

// Issue #91: 「閉じる」はどの幅でもパネル右上の角に固定する。jsdom は寸法を測れないため、
// CSS の grid-template-areas を静的に縛り(@container 内も)、DOM 順(Tab 順)が 見出し → 緊急解除 → 閉じる のままであることを確認する。
// 実寸(閉じるの右端 = パネル右端 − padding、上端 = パネル上端 + padding)は実ブラウザで確認する。
describe('Issue #91: 「閉じる」は右上の角に固定(静的)', () => {
  /** grid-template-areas の各行を area 名の配列にして返す(クオート行を抽出) */
  const areaRows = (body: string): string[][] => {
    const m = body.match(/grid-template-areas:\s*([^;}]+)/)
    if (!m) return []
    return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1].trim().split(/\s+/))
  }
  const headerGridBodies = () => allRuleBodies('.caregiver-header-grid')

  it('.caregiver-header-grid は grid で、flex-wrap の落ち方に頼らない', () => {
    const bodies = headerGridBodies()
    expect(bodies.join('\n')).toMatch(/display:\s*grid/)
    for (const sel of ['.caregiver-header', '.caregiver-header-grid']) {
      for (const b of allRuleBodies(sel)) expect(b, sel).not.toMatch(/flex-wrap|display:\s*flex/)
    }
  })

  it('どの grid-template-areas でも「閉じる」は 1 行目の右端の列にある', () => {
    const all = headerGridBodies().map(areaRows).filter((r) => r.length > 0)
    expect(all.length).toBeGreaterThanOrEqual(2) // 狭い幅(基本)と広い幅(@container)
    for (const rows of all) {
      const first = rows[0]
      expect(first[first.length - 1]).toBe('close')
      // 「閉じる」は 1 行目だけに 1 回だけ現れる
      expect(rows.flat().filter((a) => a === 'close')).toHaveLength(1)
    }
  })

  it('広い幅は 1 行 [title emergency close]、狭い幅は 2 行目へ緊急解除だけを落とす', () => {
    const [narrow, wide] = [
      areaRows(ruleBody('.caregiver-header-grid')),
      headerGridBodies().map(areaRows).find((r) => r.length === 1) ?? [],
    ]
    expect(narrow).toEqual([
      ['title', 'close'],
      ['emergency', 'emergency'],
    ])
    expect(wide).toEqual([['title', 'emergency', 'close']])
  })

  it('広い幅への切替は、ブラウザ既定の文字サイズに追従する container query(em。アプリの文字サイズ設定は介助者メニューに影響しない)で、container は .caregiver-header', () => {
    expect(ruleBody('.caregiver-header')).toMatch(/container-type:\s*inline-size/)
    expect(css).toMatch(/@container\s*\(min-width:\s*[\d.]+em\)/)
  })

  it('見出し・緊急解除・閉じるは grid-area を持ち、閉じるに margin 等の位置ずらしがない', () => {
    expect(allRuleBodies('.caregiver-header h2').join('\n')).toMatch(/grid-area:\s*title/)
    expect(allRuleBodies('.caregiver-header .caregiver-emergency-clear').join('\n')).toMatch(
      /grid-area:\s*emergency/,
    )
    const closeBodies = allRuleBodies('.caregiver-header .caregiver-close')
    expect(closeBodies.join('\n')).toMatch(/grid-area:\s*close/)
    for (const b of closeBodies) expect(b).not.toMatch(/margin|position|transform|justify-self/)
    // 見出しが折り返して 1 行目が伸びても、閉じるは中央に下がらず 1 行目の上端(右上の角)に固定する
    expect(closeBodies.join('\n')).toMatch(/align-self:\s*start/)
    for (const b of closeBodies) expect(b).not.toMatch(/align-self:\s*(?!start)\S/)
  })
})

describe('Issue #91: ヘッダの DOM 順(Tab 順)は 見出し → 緊急解除 → 閉じる', () => {
  afterEach(() => cleanup())

  it('見出しの後に、緊急解除、閉じるの順で並ぶ', () => {
    const { container } = render(() => <App />)
    fireEvent.click(container.querySelector('.caregiver-button') as HTMLElement)
    const grid = container.querySelector('.caregiver-header > .caregiver-header-grid') as HTMLElement
    expect(grid).not.toBeNull()
    const children = Array.from(grid.children)
    expect(children.map((e) => e.tagName)).toEqual(['H2', 'BUTTON', 'BUTTON'])
    expect(children[1].className).toContain('caregiver-emergency-clear')
    expect(children[2].className).toContain('caregiver-close')
    expect(children[2].textContent).toBe('閉じる')
  })
})
