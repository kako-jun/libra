// Issue #84: ページ(ドキュメント)を構造上スクロール不可にする。
// 実ブラウザ(Chromium)ではアドレスバー出入りによる 100vh と見える高さの食い違いを再現できないため、
// 原因そのもの(html/body に 100vh 基準の高さが残る、.app-shell が 100vh/100dvh のまま)と、固定(overflow:hidden / position:fixed)を
// globals.css の静的検証で縛る(@media 内の上書きも含む)。
import { beforeAll, describe, expect, it } from 'vitest'

let css = ''
beforeAll(async () => {
  // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
  const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
})

/** @media 内も含め、セレクタ(カンマ区切りの一つ)が完全一致する規則の本体 */
const bodies = (selector: string): string[] => {
  const out: string[] = []
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((x) => x.trim())
    if (sels.includes(selector)) out.push(m[2])
  }
  return out
}

describe('Issue #84: ページのスクロール固定', () => {
  it.each(['html', 'body', '#app', '.app-shell'])(
    '%s に vh 系(vh/svh/lvh/dvh)基準の高さ(height/min-height/max-height)を置かない',
    (sel) => {
      const all = bodies(sel)
      expect(all.length, sel).toBeGreaterThan(0)
      for (const b of all) {
        expect(b, sel).not.toMatch(/(?:^|[;\s])(?:min-|max-)?height:\s*[^;]*\d+[sld]?vh/)
      }
    },
  )

  it.each(['html', 'body'])('%s は overflow:hidden で、他の規則で上書きされない', (sel) => {
    const all = bodies(sel)
    expect(all.some((b) => /overflow:\s*hidden/.test(b)), sel).toBe(true)
    for (const b of all) expect(b, sel).not.toMatch(/overflow(?:-[xy])?:\s*(?!hidden)[a-z]+/)
  })

  it('body は position:fixed; inset:0 で見える領域に固定される', () => {
    const all = bodies('body').join('\n')
    expect(all).toMatch(/position:\s*fixed/)
    expect(all).toMatch(/inset:\s*0/)
  })

  it('html, body に height/min-height を持たせない(高さは body の inset が確定する)', () => {
    for (const sel of ['html', 'body']) {
      for (const b of bodies(sel)) expect(b, sel).not.toMatch(/(?:^|[;\s])(?:min-|max-)?height:/)
    }
  })

  it('#app と .app-shell は height:100% の連鎖で body の確定高さを受ける(.app-shell だけでは親が潰れるので #app とセット)', () => {
    for (const sel of ['#app', '.app-shell']) {
      const all = bodies(sel).join('\n')
      expect(all, sel).toMatch(/(?:^|[;\s])height:\s*100%/)
    }
  })

  it('.app-shell は overflow:hidden を維持する', () => {
    expect(bodies('.app-shell').join('\n')).toMatch(/overflow:\s*hidden/)
  })
})
