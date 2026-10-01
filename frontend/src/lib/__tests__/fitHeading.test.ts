import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyHeadingFit,
  fitHeadingSize,
  measureTextWidthAt,
  measureTextWidthPerPx,
} from '../fitHeading'

// 全角 15 字(1px あたり 15px 幅)を想定
const base = { textWidthPerPx: 15, maxSize: 54, minSize: 38 }

describe('fitHeadingSize', () => {
  it('余裕があれば上限サイズで 1 行', () => {
    expect(fitHeadingSize({ ...base, availableWidth: 900 })).toEqual({ singleLine: true, size: 54 })
  })
  it('幅が足りなければ収まる最大サイズへ縮める', () => {
    const r = fitHeadingSize({ ...base, availableWidth: 602 })
    expect(r.singleLine).toBe(true)
    expect(r.size).toBe(40)
    expect(r.size * 15).toBeLessThanOrEqual(600)
  })
  it('下限でも収まらなければ折り返し(1 行にしない)', () => {
    expect(fitHeadingSize({ ...base, availableWidth: 500 }).singleLine).toBe(false)
  })
  it('測れない入力では折り返し扱い', () => {
    expect(fitHeadingSize({ ...base, textWidthPerPx: 0, availableWidth: 500 }).singleLine).toBe(
      false,
    )
    expect(fitHeadingSize({ ...base, availableWidth: 0 }).singleLine).toBe(false)
  })
})

describe('fitHeadingSize 境界', () => {
  // 15px/px * 38px(min) = 570 + 安全余白 2 = 572 が下限ぴったり
  it('min ぴったり(570 + 余白 2)は 1 行、1px 足りないと折り返し', () => {
    expect(fitHeadingSize({ ...base, availableWidth: 572 })).toEqual({ singleLine: true, size: 38 })
    expect(fitHeadingSize({ ...base, availableWidth: 571 }).singleLine).toBe(false)
    expect(fitHeadingSize({ ...base, availableWidth: 573 }).singleLine).toBe(true)
  })
  it('max ぴったり(810 + 2)は max、1px 足りないと max 未満、1px 多くても max でクランプ', () => {
    expect(fitHeadingSize({ ...base, availableWidth: 812 })).toEqual({ singleLine: true, size: 54 })
    const under = fitHeadingSize({ ...base, availableWidth: 811 })
    expect(under.singleLine).toBe(true)
    expect(under.size).toBeLessThan(54)
    expect(fitHeadingSize({ ...base, availableWidth: 813 }).size).toBe(54)
  })
  it('安全余白 2px を差し引く: 結果の文字列幅は常に availableWidth - 2 以下', () => {
    for (let w = 572; w <= 812; w += 1) {
      const r = fitHeadingSize({ ...base, availableWidth: w })
      expect(r.size * 15).toBeLessThanOrEqual(w - 2)
    }
  })
  it('0.1px 単位に切り捨てる(四捨五入で溢れさせない)', () => {
    // usable = 598 → 598/15 = 39.8666… → 39.8(39.9 だと 598.5 で溢れる)
    expect(fitHeadingSize({ ...base, availableWidth: 600 }).size).toBe(39.8)
  })
  it('測れない入力(NaN・負・maxSize 0)は折り返し扱い', () => {
    expect(fitHeadingSize({ ...base, textWidthPerPx: NaN, availableWidth: 900 }).singleLine).toBe(
      false,
    )
    expect(fitHeadingSize({ ...base, availableWidth: -5 }).singleLine).toBe(false)
    expect(fitHeadingSize({ ...base, maxSize: 0, availableWidth: 900 }).singleLine).toBe(false)
    expect(fitHeadingSize({ ...base, availableWidth: 2 }).singleLine).toBe(false)
  })
  it('min > max でも max を超えない', () => {
    const r = fitHeadingSize({ textWidthPerPx: 10, maxSize: 30, minSize: 40, availableWidth: 900 })
    expect(r).toEqual({ singleLine: true, size: 30 })
  })
  it('折り返し時の size は max(参考値)', () => {
    expect(fitHeadingSize({ ...base, availableWidth: 100 }).size).toBe(54)
  })
})

describe('fitHeadingSize 測り直し(字送りの整数丸め)', () => {
  // Chromium は字送りを実際の文字サイズで整数 px に丸める: 15 字 × round(size * 0.95)
  const CHARS = 15
  const ADVANCE = 0.95
  const roundedWidth = (size: number) => CHARS * Math.round(size * ADVANCE)
  const perPx = roundedWidth(100) / 100 // 100px 測定の線形縮尺
  const rounding = { textWidthPerPx: perPx, maxSize: 54, minSize: 38 }

  it('線形縮尺だけでは丸めで usable を超える幅が実在する(テストの前提)', () => {
    let overflowed = 0
    for (let w = 520; w <= 780; w += 1) {
      const r = fitHeadingSize({ ...rounding, availableWidth: w })
      if (r.singleLine && roundedWidth(r.size) > w - 2) overflowed += 1
    }
    expect(overflowed).toBeGreaterThan(0)
  })
  it('測り直せば丸めを再現する測定でも結果の幅は常に availableWidth - 2 以下', () => {
    let single = 0
    for (let w = 520; w <= 780; w += 1) {
      const r = fitHeadingSize({ ...rounding, availableWidth: w, measureWidthAt: roundedWidth })
      if (!r.singleLine) continue
      single += 1
      expect(roundedWidth(r.size)).toBeLessThanOrEqual(w - 2)
      expect(r.size).toBeGreaterThanOrEqual(38)
      expect(r.size).toBeLessThanOrEqual(54)
    }
    expect(single).toBeGreaterThan(100)
  })
  it('線形推定では下限で収まるが、測り直すと下限でも収まらなければ折り返し', () => {
    // 実幅 = size * 15 + 20(線形縮尺に乗らない固定幅つき)。usable = 590 - 2 = 588
    // 線形推定: 588 / 15 = 39.2 >= 下限 38 なので線形の段階では弾かれず測り直しに入る
    // 測り直し: 39.2 → 608、下限 38 でも 590 > 588 で収まらず、37.9 は下限割れ → 折り返し
    const r = fitHeadingSize({
      textWidthPerPx: 15,
      maxSize: 54,
      minSize: 38,
      availableWidth: 590,
      measureWidthAt: (s) => s * 15 + 20,
    })
    expect(r.singleLine).toBe(false)
  })
  it('測定関数が非有限値を返したら折り返し', () => {
    const r = fitHeadingSize({ ...base, availableWidth: 900, measureWidthAt: () => Number.NaN })
    expect(r.singleLine).toBe(false)
  })
  it('測定が常に usable を超えるなら上限回数で打ち切って折り返し(無限ループしない)', () => {
    let calls = 0
    const r = fitHeadingSize({
      textWidthPerPx: 1,
      maxSize: 1000,
      minSize: 1,
      availableWidth: 2000,
      measureWidthAt: () => {
        calls += 1
        return 1e9
      },
    })
    expect(r.singleLine).toBe(false)
    expect(calls).toBeLessThanOrEqual(201)
  })
})

describe('measureTextWidthPerPx / applyHeadingFit (canvas をスタブ)', () => {
  let measured = 0
  let hasCanvas = true
  // measured は 100px 指定時の幅。他サイズは線形(丸めは別の describe で検証)
  const linearMeasure = () => {
    const size = parseFloat(/([\d.]+)px/.exec(ctx.font)?.[1] ?? '100')
    return { width: (measured * size) / 100 }
  }
  const ctx = { font: '', measureText: linearMeasure as () => { width: number } }
  let h1: HTMLHeadingElement
  let clientWidth = 0

  beforeEach(() => {
    measured = 0
    hasCanvas = true
    ctx.measureText = linearMeasure
    clientWidth = 0
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() =>
      hasCanvas ? ctx : null) as never)
    // jsdom は var(--h1-min) を解決しないので、computed font-size を固定値で返す
    const realGcs = window.getComputedStyle.bind(window)
    vi.spyOn(window, 'getComputedStyle').mockImplementation(((el: Element) => {
      const real = realGcs(el)
      const inline = (el as HTMLElement).style.fontSize
      return {
        fontSize: inline === 'var(--h1-min)' ? '38px' : '54px',
        fontWeight: '800',
        fontFamily: 'sans-serif',
        getPropertyValue: real.getPropertyValue.bind(real),
      } as unknown as CSSStyleDeclaration
    }) as never)
    h1 = document.createElement('h1')
    Object.defineProperty(h1, 'clientWidth', { get: () => clientWidth })
    h1.textContent = '選んだ内容がここに大きく出ます'
    document.body.appendChild(h1)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    h1.remove()
  })

  it('measureTextWidthPerPx は 100px 指定の幅 / 100 を返す', () => {
    measured = 1500
    expect(measureTextWidthPerPx('あ', '800', 'sans-serif')).toBe(15)
    expect(ctx.font).toBe('800 100px sans-serif')
  })

  it('measureTextWidthAt は指定サイズでの幅を返す', () => {
    measured = 1500
    expect(measureTextWidthAt('あ', '800', 'sans-serif', 50)).toBe(750)
    expect(ctx.font).toBe('800 50px sans-serif')
  })

  it('applyHeadingFit は候補サイズで測り直す(100px 測定の縮尺より狭い幅になる丸めでも収める)', () => {
    // 15 字 × round(size * 0.95): 100px では 1425。丸めのせいで 100px の縮尺と実幅がずれる
    ctx.measureText = () => {
      const size = parseFloat(/([\d.]+)px/.exec(ctx.font)?.[1] ?? '100')
      return { width: 15 * Math.round(size * 0.95) }
    }
    let single = 0
    for (clientWidth = 560; clientWidth <= 780; clientWidth += 1) {
      applyHeadingFit(h1)
      if (h1.getAttribute('data-fit') !== 'single') continue
      single += 1
      const fit = parseFloat(h1.style.getPropertyValue('--h1-fit'))
      expect(15 * Math.round(fit * 0.95)).toBeLessThanOrEqual(clientWidth - 2)
    }
    expect(single).toBeGreaterThan(100)
  })

  it('収まるなら data-fit=single と --h1-fit が付き、インライン font-size は残らない', () => {
    measured = 1500
    clientWidth = 700
    applyHeadingFit(h1)
    expect(h1.getAttribute('data-fit')).toBe('single')
    expect(h1.style.getPropertyValue('--h1-fit')).toBe('46.5px')
    expect(h1.style.fontSize).toBe('')
  })

  it('収まらなければ data-fit も --h1-fit も付かない(従来の折り返し)', () => {
    measured = 1500
    clientWidth = 400
    applyHeadingFit(h1)
    expect(h1.hasAttribute('data-fit')).toBe(false)
    expect(h1.style.getPropertyValue('--h1-fit')).toBe('')
  })

  it('再計算で収まる→収まらないに変わると前回の属性が消える', () => {
    measured = 1500
    clientWidth = 900
    applyHeadingFit(h1)
    expect(h1.getAttribute('data-fit')).toBe('single')
    clientWidth = 300
    applyHeadingFit(h1)
    expect(h1.hasAttribute('data-fit')).toBe(false)
    expect(h1.style.getPropertyValue('--h1-fit')).toBe('')
  })

  it('空テキストでは何も付けない', () => {
    h1.textContent = ''
    measured = 1500
    clientWidth = 900
    applyHeadingFit(h1)
    expect(h1.hasAttribute('data-fit')).toBe(false)
  })

  it('canvas が使えないときは何も付けない', () => {
    hasCanvas = false
    clientWidth = 900
    // measureCtx はモジュール内キャッシュ済みの可能性があるので null 返しを直接確認
    vi.resetModules()
    return import('../fitHeading').then((m) => {
      m.applyHeadingFit(h1)
      expect(h1.hasAttribute('data-fit')).toBe(false)
    })
  })

  it('測定中に使う data-fit=measure は残らない', () => {
    measured = 1500
    clientWidth = 400
    applyHeadingFit(h1)
    expect(h1.getAttribute('data-fit')).not.toBe('measure')
  })
})
