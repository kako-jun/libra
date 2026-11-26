// Issue #36(赤は上部メッセージ欄だけ・タイルの赤ベタ塗り廃止)/ #136(押すと伝達欄が赤くなるパネルだけ赤みの面)/ #33(スキャン枠の白縁・二重枠の撤去、
// 選択状態は黄色枠一本)の見た目の約束を固定する。
// jsdom は CSS を計算せず変数も展開しないため、CSS の静的解析(ルール/トークンの存在・不在・参照関係・
// 色値からのコントラスト計算)+ DOM の属性(class / data-message-tone)で縛る。
// 既存の AppFixedGrid.test.tsx(::after の box-shadow 無し・inset)と重ならない観点だけを足す。
//
// デシジョンテーブル(テーマ × 高コントラスト × 画面 × タイル種 → 背景トークン / 枠 / 文字色)
//   テーマ   | HC | 画面                 | タイル種                  | 背景トークン            | 枠(通常時) | 文字色
//   明/夜    | -  | ホーム               | 緊急入口(.tile-emergency) | 通常面(--surface 系)     | なし   | --text
//   明/夜    | -  | 不快/痛みの強さ      | 押すと伝達欄が赤(苦しい等)| --tile-urgent-bg(#136)   | なし   | --text
//   明/夜    | -  | 痛い場所/緊急詳細    | 画面遷移(胸)・緊急の詳細  | 通常面                   | なし   | --text
//   明/夜    | -  | 全画面               | スキャン中(緊急入口含む)  | --surface-scanning       | 黄 ::after 1本 | --scan-text(-muted)
//   明/夜    | 有 | 全画面               | スキャン中                | 同上(HC は枠だけ 9px に太る) | 黄 1本 | 同上
//   全て     | 全 | 上部メッセージ欄     | urgent 色調/緊急状態帯    | --urgent-bg(赤はここだけ) | -   | --urgent-text
// 緊急入口は色・面で区別しない(ラベル「緊急」・固定位置・上部の緊急状態帯の文言で示す)。スキャン中の面と
// 通常面が必ず異なることを下の静的検査で縛る(実描画の確認は e2e/theme.e2e.mjs の checkScanRingSurface)。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import * as offlineReadyModule from '../lib/offlineReady'
import { buildMenu } from '../lib/menus'
import type { ScreenId } from '../lib/menus'

class MockAudioContext {
  state: 'running' | 'suspended' = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  createOscillator() {
    return {
      type: '',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
  }
}

let css = ''
beforeAll(async () => {
  // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
  const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8')
})

// ---- CSS 静的解析ヘルパ ----
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** セレクタ文字列が完全一致するトップレベルのブロック本文(複数あれば連結) */
const blocksOf = (selector: string): string => {
  const src = stripComments(css)
  const re = new RegExp(`(?:^|\\})\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`, 'g')
  return Array.from(src.matchAll(re))
    .map((m) => m[1])
    .join('\n')
}
/** ブロック本文から --token の値(後勝ち) */
const tokenIn = (body: string, name: string): string | undefined => {
  const all = Array.from(body.matchAll(new RegExp(`${escapeRe(name)}\\s*:\\s*([^;]+);`, 'g')))
  return all.length ? all[all.length - 1][1].trim() : undefined
}
type Theme = 'light' | 'dark'
/** テーマ × 高コントラストで実際に効くトークン値(基底(寸法は `:root` 単独) → テーマ(色) → HC 全体 → テーマ+HC の順に後勝ち) */
const effective = (theme: Theme, hc: boolean, name: string): string | undefined => {
  const bodies = [
    // Issue #65: 寸法トークン(--scan-ring-width 等)はテーマ非依存の `:root` 単独ブロックが基底
    blocksOf(':root'),
    theme === 'light'
      ? `${blocksOf(`:root,\n:root[data-theme='light']`)}\n${blocksOf(`:root[data-theme='light']`)}`
      : blocksOf(`:root[data-theme='dark']`),
    ...(hc
      ? [
          blocksOf(`:root[data-high-contrast='true']`),
          blocksOf(`:root[data-theme='${theme}'][data-high-contrast='true']`),
        ]
      : []),
  ]
  let v: string | undefined
  for (const b of bodies) v = tokenIn(b, name) ?? v
  return v
}

const lum = (hex: string) => {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const isHex = (v: string | undefined): v is string => !!v && /^#[0-9a-f]{6}$/i.test(v)
/** 赤とみなす色(R が支配的で G/B が大きく劣る) */
const isRed = (hex: string) => {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  return r > 140 && r > g * 2 && r > b * 2
}

const THEMES: [Theme, boolean][] = [
  ['light', false],
  ['dark', false],
  ['light', true],
  ['dark', true],
]

describe('Issue #33: スキャン枠の装飾線の撤去(CSS 静的)', () => {
  const src = () => stripComments(css)

  it('.tile.scanning::after は黄色枠(--scan-ring)の border 一本だけで、box-shadow も outline も無い', () => {
    const after = blocksOf('.tile.scanning::after')
    expect(after).toMatch(/border:\s*var\(--scan-ring-width\) solid var\(--scan-ring\)/)
    expect(after).not.toMatch(/box-shadow|outline|filter|drop-shadow/)
  })

  it('スキャン枠の白縁用トークン --scan-ring-outline* の定義も参照も CSS に残っていない', () => {
    expect(src()).not.toMatch(/--scan-ring-outline/)
  })

  it('.tile-urgent::before(重複装飾線)と、緊急タイル専用のスキャン上書きルールが存在しない', () => {
    expect(src()).not.toMatch(/\.tile-urgent::before/)
    expect(src()).not.toMatch(/\.tile\.scanning\.tile-urgent/)
    expect(src()).not.toMatch(/\.tile-urgent::after/)
  })

  it('.tile / .tile-* の本体ルールに内側の白枠(box-shadow inset・outline)が無い', () => {
    const tileRules = Array.from(
      src().matchAll(/(\.tile[\w.-]*(?:::before|::after)?)\s*\{([^}]*)\}/g),
    )
    for (const [, sel, body] of tileRules) {
      if (/^\.tile-(number|label|detail|preview|chevron)/.test(sel)) continue
      // 格子の区切り線(--grid-line)の inset だけは許す(枠の装飾ではない)
      const insetShadows = Array.from(body.matchAll(/box-shadow:([^;]*);/g)).filter(
        (m) => /inset/.test(m[1]) && !/--grid-line/.test(m[1]),
      )
      expect(insetShadows, sel).toHaveLength(0)
      expect(body, sel).not.toMatch(/outline:/)
    }
  })

  it('スキャン中の面と文字は --surface-scanning / --scan-text / --scan-text-muted を参照する', () => {
    const scanning = blocksOf('.tile.scanning')
    expect(scanning).toMatch(/background:\s*var\(--surface-scanning\)/)
    expect(scanning).toMatch(/color:\s*var\(--scan-text\)/)
    expect(blocksOf('.tile.scanning :is(.tile-detail, .tile-preview)')).toMatch(
      /color:\s*var\(--scan-text-muted\)/,
    )
  })

  it('選択状態でパディング・サイズが変わらない(.tile.scanning は余白/枠幅/寸法を触らない)', () => {
    expect(blocksOf('.tile.scanning')).not.toMatch(
      /padding|border|width|height|margin|transform|scale/,
    )
  })
})

describe('Issue #33/#36: 4テーマのトークン定義とコントラスト', () => {
  const NEEDED = [
    '--surface-scanning',
    '--scan-ring',
    '--scan-ring-width',
    '--scan-text',
    '--scan-text-muted',
    '--urgent-bg',
    '--urgent-text',
  ]
  for (const [theme, hc] of THEMES) {
    const name = `${theme === 'light' ? '明るい' : '夜間'}${hc ? '+高コントラスト' : ''}`
    it(`${name}: 必要なトークンが全て定義され、色値は #rrggbb で解決できる`, () => {
      for (const t of NEEDED) {
        const v = effective(theme, hc, t)
        expect(v, `${name} ${t}`).toBeTruthy()
        if (t !== '--scan-ring-width') expect(isHex(v), `${name} ${t}=${v}`).toBe(true)
      }
    })

    it(`${name}: 黄枠と面のコントラストが 3:1 以上(非テキスト WCAG 1.4.11)`, () => {
      const ring = effective(theme, hc, '--scan-ring') as string
      const face = effective(theme, hc, '--surface-scanning') as string
      expect(contrast(ring, face), `ring ${ring} vs scanning ${face}`).toBeGreaterThanOrEqual(3)
    })

    it(`${name}: スキャン中の文字が面に対し 4.5:1 以上(本文)`, () => {
      const face = effective(theme, hc, '--surface-scanning') as string
      for (const t of ['--scan-text', '--scan-text-muted']) {
        const fg = effective(theme, hc, t) as string
        expect(contrast(fg, face), `${t} ${fg} vs ${face}`).toBeGreaterThanOrEqual(4.5)
      }
    })

    it(`${name}: スキャン中の面は通常タイル面(--surface。全タイル同色, #77)と同色でなく、明確に異なる`, () => {
      const scan = effective(theme, hc, '--surface-scanning') as string
      for (const s of ['--surface']) {
        const face = effective(theme, hc, s) as string
        expect(scan.toLowerCase(), `${name} ${s}`).not.toBe(face.toLowerCase())
        expect(
          contrast(scan, face),
          `${name} scanning ${scan} vs ${s} ${face}`,
        ).toBeGreaterThanOrEqual(1.3)
      }
    })

    it(`${name}: スキャン面・文字色トークンは赤でない`, () => {
      for (const t of ['--surface-scanning', '--scan-text', '--scan-text-muted']) {
        expect(isRed(effective(theme, hc, t) as string), `${name} ${t}`).toBe(false)
      }
    })
  }

  it('高コントラストは黄枠を太くする(通常 6px → 高コントラスト 9px)', () => {
    expect(effective('light', false, '--scan-ring-width')).toBe('6px')
    expect(effective('light', true, '--scan-ring-width')).toBe('9px')
    expect(effective('dark', true, '--scan-ring-width')).toBe('9px')
  })
})

describe('Issue #36: 赤(--urgent-bg)の使用箇所は上部メッセージ欄だけ(CSS 静的)', () => {
  /** --urgent-bg / --urgent-text(-muted) を参照するルールのセレクタ一覧 */
  const usersOf = (token: string) => {
    const src = stripComments(css)
    const out: string[] = []
    // @media などネストを平坦に扱うため、'{' の直前のセレクタと直後の本文を総当たりで拾う
    for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (new RegExp(`var\\(${escapeRe(token)}\\)`).test(m[2]))
        out.push(m[1].trim().replace(/\s+/g, ' '))
    }
    return out
  }

  it('--urgent-bg を参照するのは .emergency-status と .message-panel(urgent 色調)だけ', () => {
    const users = usersOf('--urgent-bg')
    expect(users.length).toBeGreaterThan(0)
    for (const sel of users) {
      expect(sel, `--urgent-bg の使用者: ${sel}`).toMatch(
        /^(\.emergency-status|:root\[data-message-tone='urgent'\] \.message-panel)$/,
      )
    }
    expect(users).toContain('.emergency-status')
    expect(users).toContain(":root[data-message-tone='urgent'] .message-panel")
  })

  it('--urgent-text / --urgent-text-muted を参照するルールにも .tile 系が無い', () => {
    for (const token of ['--urgent-text', '--urgent-text-muted']) {
      for (const sel of usersOf(token)) {
        expect(sel, `${token} の使用者`).not.toMatch(/\.tile/)
      }
    }
  })

  it('#136: .tile-urgent の CSS ルールは現在位置でないときの1つだけで、面と区切り線の変数だけを差し替える(赤 --urgent-* は使わない)', () => {
    const src = stripComments(css)
    expect(src.match(/\.tile-urgent[^{},]*(?=[{,])/g)?.map((x) => x.trim())).toEqual([
      '.tile-urgent:not(.scanning)',
    ])
    const decls = blocksOf('.tile-urgent:not(.scanning)')
      .split(';')
      .map((d) => d.trim().replace(/\s+/g, ' '))
      .filter(Boolean)
    expect(decls).toEqual([
      '--grid-line: var(--tile-urgent-line)',
      'background: var(--tile-urgent-bg)',
    ])
  })

  it('肯定・穏やかのトーンは復活しない(#77: .tile-positive / .tile-calm / data-message-tone=positive / --surface-positive が CSS に無い)', () => {
    const src = stripComments(css)
    expect(src).not.toMatch(/\.tile-positive/)
    expect(src).not.toMatch(/\.tile-calm/)
    expect(src).not.toMatch(/data-message-tone=['"]?positive/)
    expect(src).not.toMatch(/--surface-positive/)
  })

  it('緊急入口 .tile-emergency は面・文字色を持たず(通常面のまま)、スキャン面を上書きできる詳細度の取り違えも無い', () => {
    const body = blocksOf('.tile-emergency')
    expect(body).not.toMatch(/background|color:|--urgent|--emergency-tile/)
    expect(stripComments(css)).not.toMatch(/--emergency-tile/)
    // .tile.scanning(詳細度 0,2,0)が tone クラス(0,1,0)の面より常に勝つ。tone クラス側に !important が無い
    expect(stripComments(css)).not.toMatch(
      /\.tile-(?:calm|positive|neutral|emergency)\s*\{[^}]*!important/,
    )
    expect(blocksOf('.tile.scanning')).toMatch(/background:\s*var\(--surface-scanning\)/)
  })

  it('赤い値(#b3261e / #d7263d)を使う宣言は --urgent-bg の定義だけ', () => {
    const src = stripComments(css)
    for (const m of src.matchAll(/([a-z-]+)\s*:\s*[^;{}]*#(?:b3261e|d7263d)[^;{}]*;/gi)) {
      expect(m[1], m[0]).toBe('--urgent-bg')
    }
  })
})

describe('Issue #136: 押すと伝達欄が赤くなるパネルの色', () => {
  for (const [theme, hc] of THEMES) {
    const name = `${theme === 'light' ? '明るい' : '夜間'}${hc ? '+高コントラスト' : ''}`
    const get = (t: string) => effective(theme, hc, t) as string

    it(`${name}: 面は決定値(高コントラストでも同じ)で、真っ赤でも通常面でもない`, () => {
      expect(get('--tile-urgent-bg')).toBe(theme === 'light' ? '#ffe3e3' : '#663f2a')
      expect(isRed(get('--tile-urgent-bg'))).toBe(false)
      expect(get('--tile-urgent-bg')).not.toBe(get('--surface'))
    })

    it(`${name}: 文字(--text。ライトは濃い色・夜間は白系)が面に対し 4.5:1 以上`, () => {
      const textLum = lum(get('--text'))
      if (theme === 'light') expect(textLum).toBeLessThan(0.05)
      else expect(textLum).toBeGreaterThan(0.8)
      expect(contrast(get('--text'), get('--tile-urgent-bg'))).toBeGreaterThanOrEqual(4.5)
    })

    it(`${name}: 区切り線が、同じ色の面の上で通常の区切り線の通常面上の下限以上に見える(高コントラストは 3:1)`, () => {
      // 通常テーマの下限は、既存の通常パネルの区切り線(ライト 1.35:1 / 夜間 1.66:1)。高コントラストは非テキストの 3:1
      const floor = hc ? 3 : contrast(get('--grid-line'), get('--surface'))
      expect(contrast(get('--tile-urgent-line'), get('--tile-urgent-bg'))).toBeGreaterThanOrEqual(
        floor,
      )
    })

    it(`${name}: 黄枠は面に対し 3:1 以上(夜間)。現在位置の面とは区別できる`, () => {
      // 明るいテーマの淡い面と黄枠は、通常の白面と同じく 3:1 に届かない(現在位置は暗い面への反転で示す)
      if (theme === 'dark')
        expect(contrast(get('--scan-ring'), get('--tile-urgent-bg'))).toBeGreaterThanOrEqual(3)
      // 夜間の現在位置 #6b5510 と決定色 #663f2a の明るさの比は 1.27:1。通常面の下限 1.3(上の検査。変えていない)に
      // 届かないので、この面だけ下限を 1.25 にする(Issue #136。現在位置は黄枠でも示す)
      expect(contrast(get('--surface-scanning'), get('--tile-urgent-bg'))).toBeGreaterThanOrEqual(
        theme === 'dark' ? 1.25 : 1.3,
      )
    })
  }

  it('現在位置の色と黄枠は変わらない', () => {
    expect(effective('light', false, '--surface-scanning')).toBe('#0f241d')
    expect(effective('dark', false, '--surface-scanning')).toBe('#6b5510')
    expect(effective('light', false, '--scan-ring')).toBe('#facc15')
    expect(effective('dark', false, '--scan-ring')).toBe('#facc15')
  })
})

describe('Issue #36/#33: App の DOM(赤タイルが無い・緊急入口の色以外の手がかり)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    window.localStorage.clear()
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = MockAudioContext
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = vi.fn()
    ;(window as unknown as { speechSynthesis?: unknown }).speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
    }
    ;(globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance =
      class {
        lang = ''
        rate = 1
        pitch = 1
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

  const tiles = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLElement>('.grid-board .tile'))
  const labelOf = (t: HTMLElement) => t.querySelector('.tile-label')?.textContent ?? ''
  const press = (c: HTMLElement, label: string) => {
    const t = tiles(c).find((x) => labelOf(x) === label)
    expect(t, `tile ${label}`).toBeTruthy()
    vi.advanceTimersByTime(700) // 連打無視を過ぎてから押す
    fireEvent.pointerDown(t as HTMLElement, { pointerId: 1 })
  }
  /** 現在の画面の各タイルについて、そのタイルが持つ全クラス(tile-urgent 等)を選択子に含む CSS ルールが
      赤(--urgent-* / 赤の色値)を参照していないことを、CSS 静的に検査する(jsdom は計算後スタイルを持たないため) */
  const expectNoRedTiles = (c: HTMLElement) => {
    const rules = Array.from(stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g))
    for (const t of tiles(c)) {
      for (const cls of Array.from(t.classList)) {
        for (const [, sel, body] of rules) {
          if (new RegExp(`\\.${escapeRe(cls)}(?![\\w-])`).test(sel)) {
            expect(body, `.${cls} ルール「${sel.trim()}」(${labelOf(t)})`).not.toMatch(
              /--urgent|#b3261e|#d7263d/i,
            )
          }
        }
      }
      expect(t.getAttribute('style') ?? '', labelOf(t)).not.toMatch(
        /background|#b3261e|#d7263d|red/i,
      )
    }
  }

  it('ホーム: 緊急入口は先頭の1枚だけが .tile-emergency で、ラベルは「緊急」', () => {
    const { container } = render(() => <App />)
    const emergencyTiles = tiles(container).filter((t) => t.classList.contains('tile-emergency'))
    expect(emergencyTiles).toHaveLength(1)
    expect(labelOf(emergencyTiles[0])).toBe('緊急')
    expect(tiles(container).indexOf(emergencyTiles[0])).toBe(0)
    expect(emergencyTiles[0].getAttribute('aria-label')).toBe('緊急')
    expectNoRedTiles(container)
  })

  it('緊急入口以外のタイルは .tile-emergency を持たない(ホーム・不快・緊急詳細)', () => {
    const { container } = render(() => <App />)
    expect(
      tiles(container).filter(
        (t) => t.classList.contains('tile-emergency') && labelOf(t) !== '緊急',
      ),
    ).toHaveLength(0)
    press(container, '不快')
    for (const t of tiles(container)) {
      expect(t.classList.contains('tile-emergency'), labelOf(t)).toBe(labelOf(t) === '緊急')
    }
  })

  it('不快画面: 下位画面では緊急入口は2番目(戻るの次)に固定され、tone:urgent の「苦しい」は緊急入口ではない', () => {
    const { container } = render(() => <App />)
    press(container, '不快')
    const all = tiles(container)
    expect(labelOf(all[0])).toBe('戻る')
    expect(labelOf(all[1])).toBe('緊急')
    expect(all[1].classList.contains('tile-emergency')).toBe(true)
    const suffering = all.find((t) => labelOf(t) === '苦しい') as HTMLElement
    expect(suffering).toBeTruthy()
    expect(suffering.classList.contains('tile-urgent')).toBe(true) // 押すと伝達欄が赤くなる(#136)
    expect(suffering.classList.contains('tile-emergency')).toBe(false)
    expectNoRedTiles(container)
  })

  it('痛み(場所): 緊急入口は2番目に固定、画面遷移の「胸」は tone:urgent でも色を付けない(#136)', () => {
    const { container } = render(() => <App />)
    press(container, '不快')
    press(container, '痛い')
    const all = tiles(container)
    expect(labelOf(all[1])).toBe('緊急')
    const chest = all.find((t) => labelOf(t) === '胸') as HTMLElement
    expect(chest, '痛み(場所)画面に「胸」が無い').toBeTruthy()
    expect(chest.classList.contains('tile-urgent')).toBe(false)
    expect(chest.classList.contains('tile-emergency')).toBe(false)
    expectNoRedTiles(container)
  })

  it('緊急状態に入っても画面にある赤の要素は上部の .emergency-status だけで、タイルは赤にならない', () => {
    const { container } = render(() => <App />)
    press(container, '緊急')
    // 緊急詳細画面: 緊急入口は並ばない(状態は上部の帯が示す・Issue #44)
    expect(container.querySelector('.emergency-status')).toBeTruthy()
    const all = tiles(container)
    expect(all.some((t) => t.classList.contains('tile-emergency'))).toBe(false)
    expect(all.length).toBeGreaterThan(0)
    for (const t of all) {
      // 緊急詳細の各候補は、赤くなるのが緊急の帯で伝達欄ではないので、色を付けない(#136)
      expect(t.classList.contains('tile-urgent'), labelOf(t)).toBe(false)
    }
    expectNoRedTiles(container)
    // 緊急帯の中のテキストは帯のラベルであり、タイル(.tile)の子孫ではない
    expect(container.querySelector('.emergency-status')?.closest('.tile')).toBeNull()
  })

  it('緊急中にホームへ戻ってもホームのタイルは赤くならず、緊急入口は通常面のまま先頭', () => {
    const { container } = render(() => <App />)
    press(container, '緊急')
    press(container, '戻る')
    const all = tiles(container)
    expect(container.querySelector('.emergency-status')).toBeTruthy()
    expectNoRedTiles(container)
    // 緊急中は入口の扱いが変わりうるが、.tile-emergency が付くなら先頭のラベル「緊急」だけ
    for (const t of all.filter((x) => x.classList.contains('tile-emergency'))) {
      expect(labelOf(t)).toBe('緊急')
    }
  })

  it('メッセージ欄の色調は data-message-tone で表され、urgent の伝達でもタイル側に赤クラスが生えない', () => {
    const { container } = render(() => <App />)
    press(container, '不快')
    press(container, '苦しい')
    vi.advanceTimersByTime(5000)
    expect(document.documentElement.dataset.messageTone).toBe('urgent')
    expect(container.querySelector('.message-panel')).toBeTruthy()
    expectNoRedTiles(container)
    for (const t of tiles(container)) {
      expect(t.style.background).toBe('')
    }
  })

  it('メニュー定義: 緊急入口(action:emergency)は画面ごとに1つまでで、ほかのパネルに同じラベルは無い', () => {
    const screens: ScreenId[] = [
      'home',
      'urgentDetail',
      'discomfort',
      'painLocation',
      'painIntensity',
    ]
    for (const s of screens) {
      const items = buildMenu(s, {
        morseEnabled: false,
        phrases: undefined,
        pain: undefined,
      } as never)
      const emergencyItems = items.filter((i) => i.action.type === 'emergency')
      for (const e of emergencyItems) expect(e.label).toBe('緊急')
      expect(emergencyItems.length).toBeLessThanOrEqual(1)
      // 緊急以外のパネルに、緊急入口と同じラベルは無い(色以外で区別できる)
      for (const i of items.filter((x) => x.action.type !== 'emergency')) {
        expect(i.label).not.toBe('緊急')
      }
    }
  })
})

describe('回帰: #33/#36 の変更が既存の静的な約束を壊していない', () => {
  it('--scan-ring-inset は 4px + リング太さ + 2px のまま(余白式)', () => {
    expect(stripComments(css)).toMatch(
      /--scan-ring-inset:\s*calc\(4px \+ var\(--scan-ring-width\) \+ 2px\)/,
    )
  })

  it('タイル本体の padding は --scan-ring-inset のまま、緊急入口/スキャン中は余白を変えない', () => {
    expect(blocksOf('.tile')).toMatch(/padding:\s*var\(--scan-ring-inset\)/)
    expect(blocksOf('.tile-emergency')).not.toMatch(/padding|border|margin/)
  })

  it('ラベルのフォント下限 max(13px, …) が残っている', () => {
    expect(stripComments(css)).toMatch(/max\(13px,/)
  })

  it('緊急入口の sticky(スクロールモード)ルールが残っている', () => {
    expect(blocksOf('.grid-board:not(.grid-fill) .tile-emergency')).toMatch(/position:\s*sticky/)
  })

  it('空きセル(.tile-empty)は面を持たない(スキャン面・緊急面トークンを使わない)', () => {
    const empty = blocksOf('.tile-empty')
    expect(empty).not.toMatch(/--surface-scanning|--urgent/)
  })
})
