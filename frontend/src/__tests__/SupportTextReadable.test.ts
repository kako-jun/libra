// Issue #81: 本人が読む補助文字(直前に伝えたこと・伝えた状態・緊急詳細・パンくず・画面案内)は、
// 標準で 16px(1rem)以上、かつ置かれる地の上で 4.5:1 以上のコントラストを保つ。
// globals.css を静的に読み、@media の中の縮小や、薄い地用の色(--text-muted)の誤用も検出する。
import { beforeAll, describe, expect, it } from 'vitest'

let css = ''
beforeAll(async () => {
  // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
  const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
})

/** @media 内も含め、セレクタ(カンマ区切りの一つ)が完全一致する全規則の本体 */
const bodies = (selector: string): string[] => {
  const out: string[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((x) => x.trim())
    if (sels.includes(selector)) out.push(m[2])
  }
  return out
}

const MIN_PX = 16

/** font-size の値の「下限」を px で返す。clamp(min, …) は min、max(a, b) は大きい方、rem は 16 倍 */
const lowerBoundPx = (value: string): number => {
  const v = value.trim()
  const unit = (s: string): number => {
    const m = s.trim().match(/^([\d.]+)(rem|px|em)$/)
    if (!m) return Number.NaN
    return Number(m[1]) * (m[2] === 'px' ? 1 : 16)
  }
  const clamp = v.match(/^clamp\(\s*([^,]+),/)
  if (clamp) return unit(clamp[1])
  const max = v.match(/^max\((.+)\)$/)
  if (max) return Math.max(...max[1].split(',').map(unit))
  return unit(v)
}

// 本人が読む補助文字のセレクタ。@media 内の同名規則も全部検査する
const SUPPORT_SELECTORS = [
  '.message-panel-label',
  '.emergency-detail-label',
  '.screen-breadcrumb',
  '.screen-guide h2',
  '.emergency-status .emergency-detail-label',
]

describe('Issue #81: 本人向け補助文字は標準で 16px 以上(@media 内も)', () => {
  for (const sel of SUPPORT_SELECTORS) {
    it(`${sel} の font-size は全ての規則で 16px 以上`, () => {
      const all = bodies(sel)
      expect(all.length, `${sel} の規則が見つからない`).toBeGreaterThan(0)
      for (const body of all) {
        const m = body.match(/(?:^|[;\s])font-size:\s*([^;]+)/)
        if (!m) continue
        const px = lowerBoundPx(m[1])
        expect(px, `${sel} の font-size: ${m[1]}`).toBeGreaterThanOrEqual(MIN_PX)
      }
    })
  }

  it('.message-panel-label と .screen-breadcrumb は、少なくとも1つの規則で font-size を持つ', () => {
    for (const sel of ['.message-panel-label', '.screen-breadcrumb', '.emergency-detail-label']) {
      expect(
        bodies(sel).some((b) => /font-size:/.test(b)),
        sel,
      ).toBe(true)
    }
  })

  it('.emergency-details の @media 内の縮小も 16px 以上', () => {
    for (const body of bodies('.emergency-details')) {
      const m = body.match(/(?:^|[;\s])font-size:\s*([^;]+)/)
      if (m) expect(lowerBoundPx(m[1]), m[1]).toBeGreaterThanOrEqual(MIN_PX)
    }
    for (const body of bodies('.emergency-status .emergency-details')) {
      const m = body.match(/(?:^|[;\s])font-size:\s*([^;]+)/)
      if (m) expect(lowerBoundPx(m[1]), m[1]).toBeGreaterThanOrEqual(MIN_PX)
    }
  })
})

describe('Issue #81: 「直前に伝えたこと」の色はメッセージ枠の文字色を継ぐ', () => {
  it('最終的な color は inherit(枠の --message-text / --urgent-text)で、薄い地用の --text-muted ではない', () => {
    const colors = bodies('.message-panel-label')
      .map((b) => b.match(/(?:^|[;\s])color:\s*([^;]+)/)?.[1].trim())
      .filter((c): c is string => !!c)
    expect(colors.length).toBeGreaterThan(0)
    expect(colors[colors.length - 1]).toBe('inherit')
  })
})

// ---- 色トークンのコントラスト(テーマ4種 × 地)----
const tokenBlock = (selector: string): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const body of bodies(selector)) {
    for (const d of body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[d[1]] = d[2]
  }
  return out
}
const lum = (hex: string): number => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string): number => {
  const x = lum(a)
  const y = lum(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

describe('Issue #81: 本人向け補助文字の色は全テーマで 4.5:1 以上', () => {
  const themeTokens = (): Array<[string, Record<string, string>]> => {
    const light = { ...tokenBlock(':root'), ...tokenBlock(":root[data-theme='light']") }
    const dark = { ...light, ...tokenBlock(":root[data-theme='dark']") }
    return [
      ['light', light],
      ['dark', dark],
      [
        'light+高コントラスト',
        { ...light, ...tokenBlock(":root[data-theme='light'][data-high-contrast='true']") },
      ],
      [
        'dark+高コントラスト',
        { ...dark, ...tokenBlock(":root[data-theme='dark'][data-high-contrast='true']") },
      ],
    ]
  }
  const names = ['light', 'dark', 'light+高コントラスト', 'dark+高コントラスト']
  for (const [i, name] of names.entries()) {
    it(`${name}: 通常枠の文字(--message-text)と緊急の文字(--urgent-text / --urgent-text-muted)`, () => {
      const t = themeTokens()[i][1]
      expect(ratio(t['--message-text'], t['--message-bg']), 'message-text').toBeGreaterThanOrEqual(
        4.5,
      )
      expect(ratio(t['--urgent-text'], t['--urgent-bg']), 'urgent-text').toBeGreaterThanOrEqual(4.5)
      expect(
        ratio(t['--urgent-text-muted'], t['--urgent-bg']),
        'urgent-text-muted',
      ).toBeGreaterThanOrEqual(4.5)
    })
  }

  it('緊急詳細(.emergency-detail-status / .emergency-details)は --urgent-text-muted(赤地の上で 4.5:1 以上のトークン)', () => {
    for (const sel of ['.emergency-detail-status', '.emergency-details']) {
      expect(bodies(sel).join('\n'), sel).toMatch(/color:\s*var\(--urgent-text-muted\)/)
    }
  })
})
