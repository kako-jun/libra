// 本人画面の「介助者用」ボタンの左に出す、利用者の好きな画像(Issue #122)。
// 端末内(localStorage)だけに保存し、外部へは送らない。設定(ルートキー `libra`)とは別キーで、
// 設定の書き出し/取り込みには含めない(画像は大きく、端末の入れ替え用 JSON を貼り付けで扱えなくなるため)。
// 保存前に縮小する(長辺 PHOTO_MAX_EDGE px)。オフラインでも data URL からそのまま表示できる。

export const PHOTO_STORAGE_KEY = 'libra:photo'

/** 保存する画像の長辺の上限(px)。表示は最大でも高さ 120px 程度なので、高精細な画面でも足りる */
export const PHOTO_MAX_EDGE = 480

/**
 * これより大きい data URL は保存しない(localStorage の容量を使い切って設定の保存を妨げないため)。
 * 長辺 480px の WebP(品質 0.85)は写真でもおよそ 3〜12 万文字で、ほぼすべて 20 万文字に収まる。
 * 細かい模様の多い画像や JPEG の書き出しに余裕を見て 30 万文字(約 220KB)にする。
 * 読み込み(loadPhoto)は長さを問わない: 以前の上限(150 万文字)で保存した画像も、そのまま表示できる
 */
export const PHOTO_MAX_CHARS = 300_000

/** 上限を超えたときに順に試す JPEG の品質 */
const JPEG_QUALITIES = [0.85, 0.6] as const

function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('data:image/')
}

/** 保存済みの画像(data URL)。無い・壊れている・読めないときは null */
export function loadPhoto(): string | null {
  try {
    const raw = window.localStorage.getItem(PHOTO_STORAGE_KEY)
    return isImageDataUrl(raw) ? raw : null
  } catch {
    return null
  }
}

/** 画像を保存する。保存できたら true(容量不足などで失敗したら false。呼び出し側は表示を変えない) */
export function savePhoto(dataUrl: string): boolean {
  if (!isImageDataUrl(dataUrl) || dataUrl.length > PHOTO_MAX_CHARS) return false
  try {
    window.localStorage.setItem(PHOTO_STORAGE_KEY, dataUrl)
    return true
  } catch {
    return false
  }
}

export function clearPhoto(): void {
  try {
    window.localStorage.removeItem(PHOTO_STORAGE_KEY)
  } catch {
    // 消せなくても、表示側は消えた状態で動き続ける
  }
}

/** 長辺が maxEdge に収まる大きさ(拡大はしない)。縦横比は保つ */
export function fitPhotoSize(
  width: number,
  height: number,
  maxEdge: number = PHOTO_MAX_EDGE,
): { width: number; height: number } {
  const longer = Math.max(width, height)
  if (!(longer > 0)) return { width: 0, height: 0 }
  const scale = Math.min(1, maxEdge / longer)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function loadImageElement(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image load failed'))
    }
    image.src = url
  })
}

/**
 * 選んだ画像ファイルを、縮小した data URL にする。画像として読めないときは例外。
 * WebP で書き出し、上限(PHOTO_MAX_CHARS)を超えるとき(WebP を書き出せず PNG になるブラウザ、
 * 細かい模様の多い画像)は、白地の JPEG(品質 0.85、それでも超えれば 0.6)にする。
 */
export async function fileToPhotoDataUrl(file: Blob): Promise<string> {
  const image = await loadImageElement(file)
  const size = fitPhotoSize(image.naturalWidth, image.naturalHeight)
  if (size.width === 0 || size.height === 0) throw new Error('empty image')
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas unavailable')
  ctx.drawImage(image, 0, 0, size.width, size.height)
  const webp = canvas.toDataURL('image/webp', 0.85)
  if (webp.length <= PHOTO_MAX_CHARS) return webp
  ctx.globalCompositeOperation = 'destination-over'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, size.width, size.height)
  // 品質を下げて上限に収める。最後の品質でも超えるときはそのまま返し、保存側(savePhoto)が断る
  let jpeg = ''
  for (const quality of JPEG_QUALITIES) {
    jpeg = canvas.toDataURL('image/jpeg', quality)
    if (jpeg.length <= PHOTO_MAX_CHARS) break
  }
  return jpeg
}
