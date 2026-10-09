// Issue #71: 遷移タイルの予告(.tile-preview)は、セルの高さに余裕があるときだけ2行まで許す。
// jsdom は @container も寸法も評価できないため、globals.css の静的な不変条件を縛る。
// 核: 「予告の2行化」と「ラベルの避け領域(margin-bottom)拡大」が同じ @container ブロック(同じ条件)にあること。
// 片方だけ別条件に分かれると、予告とラベルが重なる退行になる。実寸は実ブラウザで確認する。
import { beforeAll, describe, expect, it } from 'vitest'

let css = ''
beforeAll(async () => {
  // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
  const fs = (await import('node:fs')) as { readFileSync: (path: string, enc: string) => string }
  const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
  css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
})

interface ContainerBlock {
  condition: string
  body: string
  start: number
  end: number
}

/** 波括弧の対応を数えて、全ての @container ブロック(条件・本体・範囲)を取り出す */
const containerBlocks = (src: string): ContainerBlock[] => {
  const out: ContainerBlock[] = []
  for (const m of src.matchAll(/@container([^{]*)\{/g)) {
    let depth = 1
    let i = (m.index ?? 0) + m[0].length
    const bodyStart = i
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    out.push({ condition: m[1].trim(), body: src.slice(bodyStart, i - 1), start: m.index ?? 0, end: i })
  }
  return out
}

/** @container ブロックを取り除いた CSS(ベースの規則だけを見るため) */
const withoutContainerBlocks = (src: string): string => {
  let out = ''
  let pos = 0
  for (const b of containerBlocks(src)) {
    out += src.slice(pos, b.start)
    pos = b.end
  }
  return out + src.slice(pos)
}

const bodiesOf = (src: string, selector: string): string[] => {
  const out: string[] = []
  for (const m of src.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((x) => x.trim())
    if (sels.includes(selector)) out.push(m[2])
  }
  return out
}

const decl = (body: string, prop: string): string | undefined => {
  const m = body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*([^;]+)`))
  return m?.[1].replace(/\s+/g, ' ').trim()
}

/** min-height のしきい値(px)が 72 前後の「予告を2行にする」ブロック */
const previewBlocks = (): ContainerBlock[] =>
  containerBlocks(css).filter((b) => bodiesOf(b.body, '.tile-preview').length > 0)

describe('Issue #71: 予告の2行化は、セルに余裕があるときだけ(静的)', () => {
  it('.tile-preview を変える @container ブロックがちょうど1つあり、条件は無名の (min-height: Npx)', () => {
    const blocks = previewBlocks()
    expect(blocks.length).toBe(1)
    // 名前付き(@container foo (...))にしない = 最寄りの .tile コンテナが基準
    expect(blocks[0].condition).toMatch(/^\(\s*min-height:\s*\d+(\.\d+)?px\s*\)$/)
  })

  it('しきい値は 72px 前後(60〜84px の範囲)。境界付近にもセルがあり画面サイズ次第で行数が割れるのは許容した仕様(DESIGN.md)', () => {
    const n = Number(previewBlocks()[0].condition.match(/(\d+(?:\.\d+)?)px/)?.[1])
    expect(n).toBeGreaterThan(60)
    expect(n).toBeLessThan(84)
  })

  it('ブロック内で .tile-preview は 2行 clamp + 折り返し許可になる', () => {
    const bodies = bodiesOf(previewBlocks()[0].body, '.tile-preview')
    expect(bodies.length).toBeGreaterThan(0)
    const joined = bodies.join('\n')
    expect(decl(joined, '-webkit-line-clamp')).toBe('2')
    expect(decl(joined, 'white-space')).toBe('normal')
  })

  it('予告の2行化と、ラベルの避け領域(margin-bottom)拡大が「同じ @container ブロック」にある', () => {
    const block = previewBlocks()[0]
    const labels = bodiesOf(block.body, '.tile-nav .tile-label')
    expect(labels.length).toBeGreaterThan(0)
    const mb = decl(labels.join('\n'), 'margin-bottom')
    expect(mb).toBeDefined()
    // 予告1行ぶん(行高 1.1 × 予告の font-size)が加算されている。足す項は、ベースの
    // .tile-preview の font-size の式と(空白を畳んで)同じ文字列であること(1.1 * 0.5rem 等の取り違えを許さない)
    const previewFont = decl(bodiesOf(withoutContainerBlocks(css), '.tile-preview').join('\n'), 'font-size')
    expect(previewFont).toBeDefined()
    const squash = (x: string): string => x.replace(/\s+/g, '')
    expect(squash(mb ?? '')).toContain(`1.1*${squash(previewFont ?? '')}`)
    expect(mb).toMatch(/clamp\(22px,\s*20cqb,\s*48px\)/)
    // ラベルの margin-bottom を変える @container は、他に無い(別条件への分離を許さない)
    const others = containerBlocks(css).filter(
      (b) => b.start !== block.start && bodiesOf(b.body, '.tile-nav .tile-label').some((x) => /margin-bottom/.test(x)),
    )
    expect(others).toEqual([])
  })

  it('@container 内の .tile-preview は右側 padding でアイコンを避けない(全幅で使う。Issue #82)', () => {
    const joined = bodiesOf(previewBlocks()[0].body, '.tile-preview').join('\n')
    // 全行の右側を空けると、アイコンの高さに届かない2行目まで文字2〜3つ分の幅を失う
    expect(joined).not.toMatch(/padding/)
    // 予告の位置(right)も変えない
    expect(joined).not.toMatch(/(^|[;\s])right:/)
    // ラベルの避け幅(ベース)は従来どおり
    const label = bodiesOf(withoutContainerBlocks(css), '.tile-nav .tile-label').join('\n')
    expect(decl(label, 'margin-right')).toBe('clamp(20px, 12cqi, 36px)')
  })

  it('2行モードでは山形アイコンの中心が min(50%, 予告の上端 − アイコン高さの半分) になり、1行目と縦に重ならない(Issue #82)', () => {
    const chevrons = bodiesOf(previewBlocks()[0].body, '.tile-chevron')
    expect(chevrons.length).toBe(1)
    const top = (decl(chevrons[0], 'top') ?? '').replace(/\s+/g, '')
    expect(top.startsWith('min(50%,')).toBe(true)
    // 予告2行ぶん(行高1.1 × 2 × 予告の font-size)をベースの式と同じ文字列で引く
    const previewFont = decl(bodiesOf(withoutContainerBlocks(css), '.tile-preview').join('\n'), 'font-size') ?? ''
    const squash = (x: string): string => x.replace(/\s+/g, '')
    expect(top).toContain(`2.2*${squash(previewFont)}`)
    expect(top).toContain('100%-var(--scan-ring-inset)')
    // アイコン高さの半分 = 幅 clamp(14px, 9cqi, 28px) × 0.6(viewBox 24/20 の半分)
    const base = bodiesOf(withoutContainerBlocks(css), '.tile-chevron').join('\n')
    expect(decl(base, 'width')).toBe('clamp(14px, 9cqi, 28px)')
    expect(top).toContain('0.6*clamp(14px,9cqi,28px)')
    // アイコンの中心の基準 top:50% と translateY(-50%) はベースのまま
    expect(decl(base, 'top')).toBe('50%')
    expect(decl(base, 'transform')).toBe('translateY(-50%)')
  })

  it('.tile-preview は align-self: end で下端を明示し、place-items:center の影響を受けない(Issue #82)', () => {
    const base = bodiesOf(withoutContainerBlocks(css), '.tile-preview').join('\n')
    expect(decl(base, 'align-self')).toBe('end')
    expect(decl(base, 'bottom')).toBe('var(--scan-ring-inset)')
  })

  it('ベース(@container の外)の .tile-preview は 1行+省略のまま', () => {
    const base = withoutContainerBlocks(css)
    const bodies = bodiesOf(base, '.tile-preview')
    expect(bodies.length).toBeGreaterThan(0)
    const joined = bodies.join('\n')
    expect(decl(joined, 'white-space')).toBe('nowrap')
    expect(decl(joined, 'text-overflow')).toBe('ellipsis')
    expect(decl(joined, 'overflow')).toBe('hidden')
    expect(joined).not.toMatch(/line-clamp/)
  })

  it('ベースの .tile-nav .tile-label の margin-bottom は従来どおり(予告1行ぶんの加算なし)', () => {
    const base = withoutContainerBlocks(css)
    const bodies = bodiesOf(base, '.tile-nav .tile-label').filter((b) => /margin-bottom/.test(b))
    expect(bodies.length).toBeGreaterThan(0)
    const mb = decl(bodies.join('\n'), 'margin-bottom')
    expect(mb).toMatch(/clamp\(22px,\s*20cqb,\s*48px\)/)
    expect(mb).not.toMatch(/1\.1\s*\*/)
  })

  it('.tile は container-type: size(cqb と min-height 条件の基準)', () => {
    const joined = bodiesOf(css, '.tile').join('\n')
    expect(decl(joined, 'container-type')).toBe('size')
  })

  it('予告の font-size(ラベルの50%の式)と色は @container 内で上書きされない', () => {
    const joined = bodiesOf(previewBlocks()[0].body, '.tile-preview').join('\n')
    expect(joined).not.toMatch(/font-size|(^|[;\s])color:/)
    // ベース側は式が維持されている
    const base = bodiesOf(withoutContainerBlocks(css), '.tile-preview').join('\n')
    expect(decl(base, 'font-size')).toMatch(/0\.5\s*\*\s*var\(--tile-label-font\)/)
  })
})
