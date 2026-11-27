/**
 * 上部メッセージ(h1)を「1 行に収まる最大のサイズ」で表示するための純粋なサイズ決定。
 * DOM には触らない。測定値(1px あたりの文字列幅など)は呼び出し側が渡す。
 */
export interface FitHeadingInput {
  /**
   * フォントサイズ 1px あたりの文字列の幅(px)。measureText(100px 指定の幅) / 100。
   * `measureWidthAt` を渡した場合は初期推定にしか使わない
   */
  textWidthPerPx: number
  /** h1 が使える幅(px)。max-width 制約を外した列幅 */
  availableWidth: number
  /** 既存 clamp の上限側の解決値(px)。これ以上には拡大しない */
  maxSize: number
  /** 既存 clamp の下限側の解決値(px)。ここでも収まらなければ折り返す */
  minSize: number
  /**
   * 指定サイズ(px)で実際に測った文字列幅(px)。渡されたときは、線形縮尺で出した候補を
   * このサイズで測り直し、usable 以下になるまで 0.1px ずつ下げる(Chromium は字送りを
   * 実サイズで整数 px に丸めるため、100px の測定結果の線形縮尺は実幅とずれる)
   */
  measureWidthAt?: (size: number) => number
}

export interface FitHeadingResult {
  /** 1 行にできるか。false のときは従来の折り返し表示(サイズは触らない) */
  singleLine: boolean
  /** singleLine のときに使うフォントサイズ(px)。false のときは maxSize を返す(参考値) */
  size: number
}

/** 丸め誤差・字形の張り出しで 1px はみ出して折り返すのを避ける余白(px) */
const SAFETY_PX = 2

/** 測り直しで下げる最大回数(0.1px 刻み。線形推定とのずれは数 px 以内なので十分) */
const MAX_REFINE_STEPS = 200

/**
 * 1 行に収まる最大サイズを決める。測り直しは下げる方向にしか動かない
 * (線形推定が実幅より広く見積もった場合は本来より少し小さく表示されるが、安全側)。
 */
export function fitHeadingSize(input: FitHeadingInput): FitHeadingResult {
  const { textWidthPerPx, availableWidth, maxSize, minSize, measureWidthAt } = input
  const usable = availableWidth - SAFETY_PX
  if (!(textWidthPerPx > 0) || !(usable > 0) || !(maxSize > 0)) {
    // 測れない(空文字・未描画)ときは何も変えない
    return { singleLine: false, size: maxSize }
  }
  const fitting = Math.floor((usable / textWidthPerPx) * 10) / 10
  const lower = Math.min(minSize, maxSize)
  if (fitting < lower) return { singleLine: false, size: maxSize }
  let size = Math.min(maxSize, fitting)
  if (measureWidthAt) {
    // 0.1px 刻みで下げる。下限 lower を割る(または上限回数)なら 1 行にしない
    for (let i = 0; i < MAX_REFINE_STEPS; i += 1) {
      const width = measureWidthAt(size)
      if (!Number.isFinite(width)) return { singleLine: false, size: maxSize }
      if (width <= usable) return { singleLine: true, size }
      size = Math.round((size - 0.1) * 10) / 10
      if (size < lower) return { singleLine: false, size: maxSize }
    }
    return { singleLine: false, size: maxSize }
  }
  return { singleLine: true, size }
}

let measureCtx: CanvasRenderingContext2D | null | undefined

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d')
    } catch {
      measureCtx = null
    }
  }
  return measureCtx
}

/** 指定サイズ(px)でのテキスト幅(px)。canvas が使えなければ null */
export function measureTextWidthAt(
  text: string,
  weight: string,
  family: string,
  size: number,
): number | null {
  const ctx = getMeasureCtx()
  if (!ctx) return null
  ctx.font = `${weight} ${size}px ${family}`
  const width = ctx.measureText(text).width
  return Number.isFinite(width) ? width : null
}

/** 100px 指定でのテキスト幅 / 100(= 1px あたりの幅)。canvas が使えなければ null */
export function measureTextWidthPerPx(text: string, weight: string, family: string): number | null {
  const width = measureTextWidthAt(text, weight, family, 100)
  return width === null ? null : width / 100
}

/** 折り返すときの大きさを探す刻み(px)と下限。下限は「全文を収める」を優先して小さくする(Issue #131) */
const WRAP_STEP_PX = 0.5
const WRAP_FLOOR_PX = 1

/**
 * fits(size) が true になる最大の大きさ(WRAP_STEP_PX 刻み)を二分探索する。
 * 小さいほど収まる前提。下限でも収まらなければ下限を返す
 */
export function largestFittingSize(maxSize: number, fits: (size: number) => boolean): number {
  let low = Math.ceil(WRAP_FLOOR_PX / WRAP_STEP_PX)
  let high = Math.max(low, Math.floor(maxSize / WRAP_STEP_PX))
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (fits(mid * WRAP_STEP_PX)) low = mid
    else high = mid - 1
  }
  return low * WRAP_STEP_PX
}

/**
 * h1 に大きさを適用する(DOM 測定はここだけ。再計算の契機でだけ呼ぶ)。
 * 1 行にできれば data-fit="single" と --h1-fit を設定する。1 行にできず、親(文を置く箱)の高さが
 * 測れるときは data-fit="wrap" にして、折り返した全文が箱に収まる最大の大きさにする(Issue #131)。
 */
export function applyHeadingFit(h1: HTMLElement): void {
  h1.removeAttribute('data-fit')
  h1.style.removeProperty('--h1-fit')
  const text = h1.textContent ?? ''
  if (!text || h1.hidden) return
  const cs = getComputedStyle(h1)
  const cssMaxSize = parseFloat(cs.fontSize)
  // 文を置く箱の高さ(0 は測れない: 非表示・未描画)。1 行でもこの高さを超えない大きさにする
  const boxHeight = h1.parentElement?.clientHeight ?? 0
  const lineRatio = parseFloat(cs.lineHeight) / cssMaxSize || 1.05
  const maxSize =
    boxHeight > 0 ? Math.min(cssMaxSize, Math.floor((boxHeight / lineRatio) * 10) / 10) : cssMaxSize
  h1.style.fontSize = 'var(--h1-min)'
  const minSize = parseFloat(getComputedStyle(h1).fontSize)
  h1.style.removeProperty('font-size')
  // max-width の制約を外した列幅を測る
  h1.setAttribute('data-fit', 'measure')
  const availableWidth = h1.clientWidth
  h1.removeAttribute('data-fit')
  const perPx = measureTextWidthPerPx(text, cs.fontWeight, cs.fontFamily)
  if (perPx === null) return
  const result = fitHeadingSize({
    textWidthPerPx: perPx,
    availableWidth,
    maxSize,
    minSize,
    // 候補サイズで測り直す(字送りの整数丸めで 100px 測定の縮尺とずれるため)
    measureWidthAt: (size) =>
      measureTextWidthAt(text, cs.fontWeight, cs.fontFamily, size) ?? Number.NaN,
  })
  if (result.singleLine) {
    h1.style.setProperty('--h1-fit', `${result.size}px`)
    h1.setAttribute('data-fit', 'single')
    return
  }
  if (boxHeight <= 0) return
  h1.setAttribute('data-fit', 'wrap')
  const size = largestFittingSize(cssMaxSize, (candidate) => {
    h1.style.setProperty('--h1-fit', `${candidate}px`)
    return h1.getBoundingClientRect().height <= boxHeight && h1.scrollWidth <= h1.clientWidth
  })
  h1.style.setProperty('--h1-fit', `${size}px`)
}
