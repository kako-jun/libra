// Issue #122: 利用者の好きな画像(lib/photo.ts)。端末内(localStorage の `libra:photo`)だけに保存する。
// 正本: docs/requirements.md §5「好きな画像」
//
// 観点
//   fitPhotoSize        | 長辺を上限に収める(縦横比を保つ・拡大しない)。境界: 上限ちょうど / +1。0・負・NaN は 0x0。細長い画像でも 1px を割らない
//   savePhoto           | 画像の data URL だけを保存する。上限(PHOTO_MAX_CHARS)ちょうどは保存、+1 は保存しない。容量不足は false(例外にしない)
//   loadPhoto           | 無い・壊れている(画像でない文字列)・読めない(例外)は null
//   clearPhoto          | 消す。消せなくても例外にしない。設定(libra)には触れない
//   fileToPhotoDataUrl  | 縮小して WebP。大きすぎるときだけ白地の JPEG。読めない画像・canvas 不可は例外。object URL は必ず解放する
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PHOTO_MAX_CHARS,
  PHOTO_MAX_EDGE,
  PHOTO_STORAGE_KEY,
  clearPhoto,
  fileToPhotoDataUrl,
  fitPhotoSize,
  loadPhoto,
  savePhoto,
} from '../photo'

const PNG = 'data:image/png;base64,iVBORw0KGgo='

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('定数(仕様の値)', () => {
  it('保存キーは設定(libra)と別の libra:photo、長辺の上限は 480px、文字数の上限は 1,500,000', () => {
    expect(PHOTO_STORAGE_KEY).toBe('libra:photo')
    expect(PHOTO_MAX_EDGE).toBe(480)
    expect(PHOTO_MAX_CHARS).toBe(1_500_000)
  })
})

describe('fitPhotoSize: 長辺を上限に収める', () => {
  it('横長は幅を上限にし、縦横比を保つ', () => {
    expect(fitPhotoSize(4000, 3000)).toEqual({ width: 480, height: 360 })
  })

  it('縦長は高さを上限にし、縦横比を保つ', () => {
    expect(fitPhotoSize(3000, 4000)).toEqual({ width: 360, height: 480 })
  })

  it('正方形は両辺が上限になる', () => {
    expect(fitPhotoSize(2000, 2000)).toEqual({ width: 480, height: 480 })
  })

  it('境界: 長辺が上限ちょうど(480)は変えず、上限+1(481)は 480 に縮める', () => {
    expect(fitPhotoSize(480, 100)).toEqual({ width: 480, height: 100 })
    expect(fitPhotoSize(481, 100).width).toBe(480)
    expect(fitPhotoSize(100, 481).height).toBe(480)
  })

  it('上限より小さい画像は拡大しない', () => {
    expect(fitPhotoSize(120, 80)).toEqual({ width: 120, height: 80 })
    expect(fitPhotoSize(1, 1)).toEqual({ width: 1, height: 1 })
  })

  it('極端に細長い画像でも、短辺は 1px を割らない', () => {
    expect(fitPhotoSize(10000, 1)).toEqual({ width: 480, height: 1 })
    expect(fitPhotoSize(1, 10000)).toEqual({ width: 1, height: 480 })
  })

  it('上限は引数で変えられる', () => {
    expect(fitPhotoSize(1000, 500, 100)).toEqual({ width: 100, height: 50 })
  })

  it.each([
    ['0x0', 0, 0],
    ['負の値', -10, -20],
    ['NaN', Number.NaN, Number.NaN],
  ])('大きさが無い画像(%s)は 0x0 を返す', (_name, width, height) => {
    expect(fitPhotoSize(width, height)).toEqual({ width: 0, height: 0 })
  })
})

describe('savePhoto / loadPhoto / clearPhoto', () => {
  it('画像の data URL を保存でき、そのまま読み出せる', () => {
    expect(savePhoto(PNG)).toBe(true)
    expect(window.localStorage.getItem(PHOTO_STORAGE_KEY)).toBe(PNG)
    expect(loadPhoto()).toBe(PNG)
  })

  it('保存していなければ null', () => {
    expect(loadPhoto()).toBeNull()
  })

  it.each([
    ['空文字', ''],
    ['http の URL', 'https://example.com/a.png'],
    ['画像でない data URL(HTML)', 'data:text/html,<script>alert(1)</script>'],
    ['javascript: の URL', 'javascript:alert(1)'],
    ['前に空白がある data URL', ' data:image/png;base64,AAAA'],
  ])('画像の data URL でない入力(%s)は保存しない', (_name, value) => {
    expect(savePhoto(value)).toBe(false)
    expect(window.localStorage.getItem(PHOTO_STORAGE_KEY)).toBeNull()
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['数値', 123],
    ['オブジェクト', { src: PNG }],
  ])('文字列でない入力(%s)は保存せず、例外にもならない', (_name, value) => {
    expect(savePhoto(value as unknown as string)).toBe(false)
    expect(window.localStorage.getItem(PHOTO_STORAGE_KEY)).toBeNull()
  })

  it('境界: 上限ちょうどの長さは保存し、上限+1 は保存しない(すでにある画像は残す)', () => {
    const head = 'data:image/webp;base64,'
    const atLimit = head + 'A'.repeat(PHOTO_MAX_CHARS - head.length)
    expect(atLimit.length).toBe(PHOTO_MAX_CHARS)
    expect(savePhoto(atLimit)).toBe(true)
    expect(loadPhoto()).toBe(atLimit)

    expect(savePhoto(PNG)).toBe(true)
    expect(savePhoto(`${atLimit}A`)).toBe(false)
    expect(loadPhoto()).toBe(PNG)
  })

  it('容量不足などで保存に失敗したら false を返し、例外にしない', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })
    expect(() => savePhoto(PNG)).not.toThrow()
    expect(savePhoto(PNG)).toBe(false)
  })

  it.each([
    ['画像でない文字列', 'こわれた値'],
    ['JSON', '{"src":"data:image/png;base64,AAAA"}'],
    ['画像でない data URL', 'data:text/html,<p>x</p>'],
    ['空文字', ''],
  ])('壊れた保存値(%s)は null として扱う', (_name, raw) => {
    window.localStorage.setItem(PHOTO_STORAGE_KEY, raw)
    expect(loadPhoto()).toBeNull()
  })

  it('localStorage が読めないとき(例外)は null', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadPhoto()).toBeNull()
  })

  it('clearPhoto は画像だけを消し、設定(libra)と緊急状態(libra:emergency)には触れない', () => {
    window.localStorage.setItem('libra', '{"intervalMs":3000}')
    window.localStorage.setItem('libra:emergency', '{"active":true}')
    savePhoto(PNG)
    clearPhoto()
    expect(loadPhoto()).toBeNull()
    expect(window.localStorage.getItem(PHOTO_STORAGE_KEY)).toBeNull()
    expect(window.localStorage.getItem('libra')).toBe('{"intervalMs":3000}')
    expect(window.localStorage.getItem('libra:emergency')).toBe('{"active":true}')
  })

  it('保存していない状態の clearPhoto、消せない(例外)ときの clearPhoto は例外にならない', () => {
    expect(() => clearPhoto()).not.toThrow()
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(() => clearPhoto()).not.toThrow()
  })
})

describe('fileToPhotoDataUrl: 縮小して data URL にする', () => {
  type FakeContext = {
    drawImage: ReturnType<typeof vi.fn>
    fillRect: ReturnType<typeof vi.fn>
    globalCompositeOperation: string
    fillStyle: string
  }
  let context: FakeContext
  let createObjectURL: ReturnType<typeof vi.fn>
  let revokeObjectURL: ReturnType<typeof vi.fn>
  let canvases: HTMLCanvasElement[]

  /** Image の読み込み結果を差し替える。size が null なら読み込み失敗(onerror) */
  function stubImage(size: { width: number; height: number } | null) {
    class FakeImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = size?.width ?? 0
      naturalHeight = size?.height ?? 0
      set src(_value: string) {
        queueMicrotask(() => (size ? this.onload?.() : this.onerror?.()))
      }
    }
    vi.stubGlobal('Image', FakeImage)
  }

  /** canvas の書き出しを差し替える。type ごとに返す文字列を決める */
  function stubCanvas(output: (type: string) => string, hasContext = true) {
    context = {
      drawImage: vi.fn(),
      fillRect: vi.fn(),
      globalCompositeOperation: 'source-over',
      fillStyle: '',
    }
    canvases = []
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      canvases.push(this)
      return (hasContext ? context : null) as unknown as CanvasRenderingContext2D
    } as never)
    return vi
      .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
      .mockImplementation(((type?: string) => output(type ?? 'image/png')) as never)
  }

  beforeEach(() => {
    createObjectURL = vi.fn(() => 'blob:photo')
    revokeObjectURL = vi.fn()
    ;(URL as unknown as { createObjectURL: unknown }).createObjectURL = createObjectURL
    ;(URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = revokeObjectURL
  })

  const file = () => new Blob(['x'], { type: 'image/jpeg' })

  it('大きい画像は長辺 480px に縮小して描き、WebP(品質 0.85)で返す', async () => {
    stubImage({ width: 4000, height: 3000 })
    const toDataURL = stubCanvas((type) => `data:${type};base64,AAAA`)

    await expect(fileToPhotoDataUrl(file())).resolves.toBe('data:image/webp;base64,AAAA')

    expect(canvases[0].width).toBe(480)
    expect(canvases[0].height).toBe(360)
    expect(context.drawImage).toHaveBeenCalledTimes(1)
    expect(context.drawImage.mock.calls[0].slice(1)).toEqual([0, 0, 480, 360])
    expect(toDataURL).toHaveBeenCalledTimes(1)
    expect(toDataURL).toHaveBeenCalledWith('image/webp', 0.85)
    // WebP で収まったときは白地で塗らない(透過を残す)
    expect(context.fillRect).not.toHaveBeenCalled()
  })

  it('小さい画像は拡大せず、元の大きさのまま書き出す', async () => {
    stubImage({ width: 120, height: 80 })
    stubCanvas((type) => `data:${type};base64,AAAA`)
    await fileToPhotoDataUrl(file())
    expect(canvases[0].width).toBe(120)
    expect(canvases[0].height).toBe(80)
  })

  it('書き出しが上限を超えるとき(WebP を書き出せず PNG になるブラウザ)は、白地の JPEG にする', async () => {
    stubImage({ width: 800, height: 600 })
    const huge = `data:image/png;base64,${'A'.repeat(PHOTO_MAX_CHARS)}`
    const toDataURL = stubCanvas((type) =>
      type === 'image/jpeg' ? 'data:image/jpeg;base64,JJJJ' : huge,
    )

    await expect(fileToPhotoDataUrl(file())).resolves.toBe('data:image/jpeg;base64,JJJJ')

    expect(toDataURL).toHaveBeenLastCalledWith('image/jpeg', 0.85)
    // 透過部分が黒くならないよう、絵の後ろ(destination-over)に白を敷く
    expect(context.globalCompositeOperation).toBe('destination-over')
    expect(context.fillStyle).toBe('#ffffff')
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 480, 360)
  })

  it('境界: 書き出しが上限ちょうどの長さなら WebP のまま返す(JPEG にしない)', async () => {
    stubImage({ width: 800, height: 600 })
    const head = 'data:image/webp;base64,'
    const atLimit = head + 'A'.repeat(PHOTO_MAX_CHARS - head.length)
    const toDataURL = stubCanvas(() => atLimit)
    await expect(fileToPhotoDataUrl(file())).resolves.toBe(atLimit)
    expect(toDataURL).toHaveBeenCalledTimes(1)
  })

  it('画像として読めないファイルは例外になり、object URL は解放される', async () => {
    stubImage(null)
    stubCanvas((type) => `data:${type};base64,AAAA`)
    await expect(fileToPhotoDataUrl(new Blob(['not an image']))).rejects.toThrow()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo')
  })

  it('大きさが 0 の画像(壊れた画像)は例外になる', async () => {
    stubImage({ width: 0, height: 0 })
    stubCanvas((type) => `data:${type};base64,AAAA`)
    await expect(fileToPhotoDataUrl(file())).rejects.toThrow()
  })

  it('canvas が使えない環境では例外になる(呼び出し側が「読み込めませんでした」を出す)', async () => {
    stubImage({ width: 100, height: 100 })
    stubCanvas((type) => `data:${type};base64,AAAA`, false)
    await expect(fileToPhotoDataUrl(file())).rejects.toThrow()
  })

  it('読み込めたときも object URL を解放する(選び直すたびにメモリが残らない)', async () => {
    stubImage({ width: 100, height: 100 })
    stubCanvas((type) => `data:${type};base64,AAAA`)
    await fileToPhotoDataUrl(file())
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo')
  })
})
