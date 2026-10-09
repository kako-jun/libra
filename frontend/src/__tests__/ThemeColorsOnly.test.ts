// Issue #65: テーマ(明るい/夜間)は色トークンだけを定義する。寸法・文字の大きさ・
// レイアウト係数をテーマに持たせない(テーマで寸法が変わる作りは詳細度の食い違いを生む。
// 実例: ブレークポイントの :root{--label-cqi} が `:root,:root[data-theme='light']` に負けて、
// 明るいテーマだけラベルの係数が効かなかった)。
// globals.css を静的に読み、規則を機械的に縛る。
import { beforeAll, describe, expect, it } from 'vitest'

let css = ''
beforeAll(async () => {
  // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
  const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8')
})

type Decl = { prop: string; value: string }
type Rule = { selector: string; decls: Decl[]; media: string | null }

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

/** at-rule の入れ子を再帰して読む簡易パーサ。media には at-rule の連鎖(例 `@media (...) > @supports (...)`)が入る */
function parseRules(src: string): Rule[] {
  const rules: Rule[] = []
  const text = stripComments(src)
  const walk = (body: string, media: string | null) => {
    let i = 0
    while (i < body.length) {
      const open = body.indexOf('{', i)
      if (open < 0) break
      const head = body.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (j < body.length && depth > 0) {
        if (body[j] === '{') depth++
        else if (body[j] === '}') depth--
        j++
      }
      const inner = body.slice(open + 1, j - 1)
      if (head.startsWith('@')) {
        // @media / @supports / @container / @layer など、どの at-rule の中も再帰して読む(入れ子の連鎖を media に持つ)
        const chain = `${media ? `${media} > ` : ''}${head.replace(/\s+/g, ' ')}`
        walk(inner, chain)
      } else {
        const decls: Decl[] = inner
          .split(';')
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d) => {
            const k = d.indexOf(':')
            return { prop: d.slice(0, k).trim(), value: d.slice(k + 1).trim() }
          })
        rules.push({ selector: head.replace(/\s+/g, ' '), decls, media })
      }
      i = j
    }
  }
  walk(text, null)
  return rules
}

/** テーマのブロック = セレクタに data-theme を含むルール(明るいテーマの `:root, :root[data-theme='light']` を含む) */
const isThemeRule = (r: Rule) => /\[data-theme/.test(r.selector)

/** 長さ・calc を含む値は色ではない(color-mix() / oklch() / transparent / var(別名) などの色表現は許す) */
const LENGTH_OR_CALC =
  /calc\(|(?<![\w#.-])-?\d*\.?\d+(?:px|rem|em|vh|vw|vmin|vmax|cqi|cqb|ch|pt)\b/i

/** 寸法/係数トークン(テーマに持たせない) */
const DIMENSION_TOKENS = [
  '--font-scale',
  '--label-ratio',
  '--label-cqi',
  '--label-cqb',
  '--scan-ring-width',
  '--scan-ring-inset',
  '--grid-line-width',
]

describe('Issue #65: テーマのブロックは色トークンだけ', () => {
  it('テーマのブロックが明るい・夜間・各テーマ×高コントラストの4つあり、解析できている(検査が空振りしない)', () => {
    const themeRules = parseRules(css).filter(isThemeRule)
    expect(themeRules.length).toBe(4)
    const sels = themeRules.map((r) => r.selector)
    expect(sels).toContain(":root, :root[data-theme='light']")
    expect(sels).toContain(":root[data-theme='dark']")
    expect(themeRules.flatMap((r) => r.decls).length).toBeGreaterThan(40)
  })

  it('テーマのブロックの宣言は --custom-property だけで、寸法トークン一覧に載っておらず、値に長さ単位・calc を含まない', () => {
    const offenders: string[] = []
    for (const r of parseRules(css).filter(isThemeRule)) {
      for (const d of r.decls) {
        if (!d.prop.startsWith('--')) offenders.push(`${r.selector} { ${d.prop} } 通常プロパティ`)
        else if (DIMENSION_TOKENS.includes(d.prop))
          offenders.push(`${r.selector} { ${d.prop} } 寸法トークン`)
        else if (LENGTH_OR_CALC.test(d.value))
          offenders.push(`${r.selector} { ${d.prop}: ${d.value} } 値が長さ・calc`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('CSS に prefers-color-scheme を書かない(テーマの解決は App.tsx。メディアクエリ内の :root で寸法をテーマ別にしない)', () => {
    expect(stripComments(css)).not.toMatch(/prefers-color-scheme/)
  })

  it('テーマのブロックはどの at-rule(@media / @supports / @container 等)の中にも無い', () => {
    expect(parseRules(css).filter((r) => isThemeRule(r) && r.media !== null)).toEqual([])
  })

  it('寸法/係数トークンはテーマのブロックに一つも無い', () => {
    const inTheme = parseRules(css)
      .filter(isThemeRule)
      .flatMap((r) => r.decls.map((d) => `${r.selector} { ${d.prop} }`))
      .filter((s) => DIMENSION_TOKENS.some((t) => s.endsWith(`{ ${t} }`)))
    expect(inTheme).toEqual([])
  })
})

describe('Issue #65: 寸法/係数トークンの定義はテーマ非依存ブロックに一箇所だけ', () => {
  const rules = () => parseRules(css)

  for (const token of DIMENSION_TOKENS) {
    it(`${token} の基底定義は @media の外の \`:root\` 単独セレクタに1回だけ`, () => {
      const base = rules().filter(
        (r) => r.media === null && r.selector === ':root' && r.decls.some((d) => d.prop === token),
      )
      expect(base).toHaveLength(1)
      expect(base[0].decls.filter((d) => d.prop === token)).toHaveLength(1)
    })

    it(`${token} を定義する他のルール(上書き)はテーマのセレクタを含まない`, () => {
      const defs = rules().filter((r) => r.decls.some((d) => d.prop === token))
      expect(defs.length).toBeGreaterThanOrEqual(1)
      expect(defs.filter(isThemeRule).map((r) => r.selector)).toEqual([])
    })
  }

  it('寸法の上書きを含む at-rule は、単独の @media(prefers-color-scheme を含まない)だけ', () => {
    const offenders = rules()
      .filter((r) => r.media !== null && r.decls.some((d) => DIMENSION_TOKENS.includes(d.prop)))
      .filter(
        (r) =>
          !/^@media [^>]*$/.test(r.media as string) ||
          /prefers-color-scheme/.test(r.media as string),
      )
      .map((r) => `${r.media} ${r.selector}`)
    expect(offenders).toEqual([])
  })

  it('上書きは指定のセレクタだけ: @media 内は `:root` か高コントラスト、それ以外は font-size / high-contrast 属性', () => {
    const allowed = (r: Rule) =>
      r.selector === ':root' ||
      /^:root\[data-font-size='(large|xlarge)'\]$/.test(r.selector) ||
      r.selector === ":root[data-high-contrast='true']"
    const offenders = rules()
      .filter((r) => r.decls.some((d) => DIMENSION_TOKENS.includes(d.prop)))
      .filter((r) => !allowed(r))
      .map((r) => r.selector)
    expect(offenders).toEqual([])
  })

  it('高コントラストが変える寸法は --grid-line-width と --scan-ring-width だけで、テーマと組み合わせたセレクタでは変えない', () => {
    const hc = rules().filter((r) => /data-high-contrast/.test(r.selector))
    const dimsInHc = hc.flatMap((r) =>
      r.decls
        .filter((d) => DIMENSION_TOKENS.includes(d.prop))
        .map((d) => ({ sel: r.selector, prop: d.prop })),
    )
    expect(new Set(dimsInHc.map((d) => d.prop))).toEqual(
      new Set(['--grid-line-width', '--scan-ring-width']),
    )
    // テーマ×高コントラストのブロックは色だけ(上のテストで保証済み)なので、寸法の HC 上書きは属性単独セレクタのみ
    expect(dimsInHc.every((d) => d.sel === ":root[data-high-contrast='true']")).toBe(true)
  })

  it('--label-cqi / --label-cqb のブレークポイント上書きが基底より後ろ・同じ詳細度の `:root` で、明るいテーマにも効く(テーマの有無で値が変わらない)', () => {
    const src = parseRules(css)
    for (const token of ['--label-cqi', '--label-cqb']) {
      const idx = (r: Rule) => src.indexOf(r)
      const base = src.find(
        (r) => r.media === null && r.selector === ':root' && r.decls.some((d) => d.prop === token),
      )!
      const overrides = src.filter((r) => r.media !== null && r.decls.some((d) => d.prop === token))
      expect(overrides.length).toBeGreaterThanOrEqual(2)
      for (const o of overrides) {
        expect(o.selector).toBe(':root')
        expect(idx(o)).toBeGreaterThan(idx(base))
      }
    }
  })
})
