/**
 * 上部メッセージ(h1)を「1 行に収まる最大のサイズ」で表示するための純粋なサイズ決定。
 * DOM には触らない。測定値(1px あたりの文字列幅など)は呼び出し側が渡す。
 */
export interface FitHeadingInput {
  /** フォントサイズ 1px あたりの文字列の幅(px)。measureText(100px 指定の幅) / 100 */
  textWidthPerPx: number
  /** h1 が使える幅(px)。max-width 制約を外した列幅 */
  availableWidth: number
  /** 既存 clamp の上限側の解決値(px)。これ以上には拡大しない */
  maxSize: number
  /** 既存 clamp の下限側の解決値(px)。ここでも収まらなければ折り返す */
  minSize: number
}

export interface FitHeadingResult {
  /** 1 行にできるか。false のときは従来の折り返し表示(サイズは触らない) */
  singleLine: boolean
  /** singleLine のときに使うフォントサイズ(px)。false のときは maxSize を返す(参考値) */
  size: number
}

/** 丸め誤差・字形の張り出しで 1px はみ出して折り返すのを避ける余白(px) */
const SAFETY_PX = 2

export function fitHeadingSize(input: FitHeadingInput): FitHeadingResult {
  const { textWidthPerPx, availableWidth, maxSize, minSize } = input
  const usable = availableWidth - SAFETY_PX
  if (!(textWidthPerPx > 0) || !(usable > 0) || !(maxSize > 0)) {
    // 測れない(空文字・未描画)ときは何も変えない
    return { singleLine: false, size: maxSize }
  }
  const fitting = Math.floor((usable / textWidthPerPx) * 10) / 10
  const lower = Math.min(minSize, maxSize)
  if (fitting < lower) return { singleLine: false, size: maxSize }
  return { singleLine: true, size: Math.min(maxSize, fitting) }
}

let measureCtx: CanvasRenderingContext2D | null | undefined

/** 100px 指定でのテキスト幅 / 100(= 1px あたりの幅)。canvas が使えなければ null */
export function measureTextWidthPerPx(text: string, weight: string, family: string): number | null {
  if (measureCtx === undefined) {
    try {
      measureCtx = document.createElement('canvas').getContext('2d')
    } catch {
      measureCtx = null
    }
  }
  if (!measureCtx) return null
  measureCtx.font = `${weight} 100px ${family}`
  const width = measureCtx.measureText(text).width
  return Number.isFinite(width) ? width / 100 : null
}

/**
 * h1 に fitHeadingSize を適用する(DOM 測定はここだけ。再計算の契機でだけ呼ぶ)。
 * 1 行にできれば data-fit="single" と --h1-fit を設定し、できなければ何も付けず従来表示にする。
 */
export function applyHeadingFit(h1: HTMLElement): void {
  h1.removeAttribute('data-fit')
  h1.style.removeProperty('--h1-fit')
  const text = h1.textContent ?? ''
  if (!text) return
  const cs = getComputedStyle(h1)
  const maxSize = parseFloat(cs.fontSize)
  h1.style.fontSize = 'var(--h1-min)'
  const minSize = parseFloat(getComputedStyle(h1).fontSize)
  h1.style.removeProperty('font-size')
  // max-width の制約を外した列幅を測る
  h1.setAttribute('data-fit', 'measure')
  const availableWidth = h1.clientWidth
  h1.removeAttribute('data-fit')
  const perPx = measureTextWidthPerPx(text, cs.fontWeight, cs.fontFamily)
  if (perPx === null) return
  const result = fitHeadingSize({ textWidthPerPx: perPx, availableWidth, maxSize, minSize })
  if (!result.singleLine) return
  h1.style.setProperty('--h1-fit', `${result.size}px`)
  h1.setAttribute('data-fit', 'single')
}
