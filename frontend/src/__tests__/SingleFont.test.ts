// Issue #156: フォントは同梱の BIZ UDGothic の1種類だけ。入力欄・ボタン・選択部品も同じ書体にし、
// 予備フォントは指定しない。同梱するのは書体の全字(分割・間引きをしない)。
// 実際に描かれた書体は e2e/font.e2e.mjs が実ブラウザで確かめる。ここはソースの規則を静的に縛る。
import { beforeAll, describe, expect, it } from 'vitest'

type Fs = {
  readFileSync: ((path: string, enc: string) => string) & ((path: string) => Uint8Array)
  existsSync: (path: string) => boolean
}
type Crypto = {
  createHash: (a: string) => { update: (d: Uint8Array) => { digest: (e: string) => string } }
}

let fs: Fs
let crypto: Crypto
let cwd = ''
let fontsCss = ''
let globalsCss = ''
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')

beforeAll(async () => {
  // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
  fs = (await import('node:fs')) as Fs
  // @ts-expect-error node:crypto の型定義は無い(実行時には存在する)
  crypto = (await import('node:crypto')) as Crypto
  cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  fontsCss = stripComments(fs.readFileSync(`${cwd}/src/styles/fonts.css`, 'utf8'))
  globalsCss = stripComments(fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8'))
})

describe('Issue #156: フォントは BIZ UDGothic の1種類', () => {
  it('@font-face は BIZ UDGothic の 400 と 700 の2つだけで、分割も local() も無い', () => {
    const faces = fontsCss.match(/@font-face\s*\{[^}]*\}/g) ?? []
    expect(faces).toHaveLength(2)
    for (const face of faces) expect(face).toContain("font-family: 'BIZ UDGothic';")
    expect(faces.map((f) => /font-weight:\s*(\d+)/.exec(f)?.[1])).toEqual(['400', '700'])
    expect(fontsCss).not.toMatch(/unicode-range|local\(/)
  })

  it('同梱するファイルは、全字を持つことを確認した版そのもの(差し替えたら DESIGN.md §3 の手順で確認し直す)', () => {
    const expected = {
      'BIZUDGothic-Regular.woff2':
        '6c106a89c990226dcf8d8653a2b088dc568b3c92385aeffbcd30e4f3fc75a5d7',
      'BIZUDGothic-Bold.woff2': 'dcc5e40e37c196860318d59a60b692a10071a744d1fef71324483bd1040dc049',
    }
    for (const [name, sha] of Object.entries(expected)) {
      expect(fontsCss).toContain(`url('../assets/fonts/${name}') format('woff2')`)
      const bytes = fs.readFileSync(`${cwd}/src/assets/fonts/${name}`)
      expect(crypto.createHash('sha256').update(bytes).digest('hex'), name).toBe(sha)
    }
    expect(fs.existsSync(`${cwd}/src/assets/fonts/OFL.txt`)).toBe(true)
  })

  it('index.tsx が fonts.css を読み込み、外部のフォントの依存は無い', () => {
    expect(fs.readFileSync(`${cwd}/src/index.tsx`, 'utf8')).toContain("import './styles/fonts.css'")
    expect(fs.readFileSync(`${cwd}/package.json`, 'utf8')).not.toContain('@fontsource')
    expect(fs.readFileSync(`${cwd}/index.html`, 'utf8')).not.toMatch(/fonts\.googleapis/)
  })

  it('globals.css の書体指定は BIZ UDGothic か inherit だけで、予備フォントが無い', () => {
    const families = [...globalsCss.matchAll(/(?:^|[;{\s])font-family:\s*([^;}]+)/g)].map((m) =>
      m[1].trim(),
    )
    expect(families).toContain("'BIZ UDGothic'")
    expect(families.filter((v) => v !== "'BIZ UDGothic'" && v !== 'inherit')).toEqual([])
    // font ショートハンドは inherit だけ(書体を持ち込む抜け道を塞ぐ)
    const shorthands = [...globalsCss.matchAll(/(?:^|[;{\s])font:\s*([^;}]+)/g)].map((m) =>
      m[1].trim(),
    )
    expect(shorthands.filter((v) => v !== 'inherit')).toEqual([])
  })

  it('入力欄・ボタン・選択部品は親の書体を継ぐ', () => {
    expect(globalsCss).toMatch(
      /button,\s*input,\s*textarea,\s*select,\s*optgroup\s*\{\s*font-family:\s*inherit;\s*\}/,
    )
    expect(globalsCss).toMatch(/input::file-selector-button\s*\{\s*font-family:\s*inherit;\s*\}/)
  })
})
