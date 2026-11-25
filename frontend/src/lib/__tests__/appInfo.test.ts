// Issue #118: 介助者用メニュー「このアプリ」タブの情報(lib/appInfo.ts)。
// 正本: docs/requirements.md §6「このアプリ」タブ / §8「外部への通信は利用回数の取得だけ」
//
// 観点
//   usageCountUrl    | 本番のホスト(libra.llll-ll.com)と完全一致のときだけ increment。似たホスト・開発・検証・空は get(数えない)
//   parseUsageCount  | { data: { total: 0 以上の有限の数 } } だけを受け取る。形が違えば null
//   fetchUsageCount  | 成功は累計、HTTP エラー・通信失敗・JSON でない・形が違う・fetch 無し・8 秒で応答なし は null(何も投げない)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_BUILD_DATE,
  APP_VERSION,
  AUTHOR_SITE_URL,
  FEEDBACK_BBS_URL,
  NOSTALGIC_COUNTER_ID,
  PRODUCTION_HOSTNAME,
  USER_GUIDE_URL,
  fetchUsageCount,
  parseUsageCount,
  usageCountUrl,
} from '../appInfo'

const GET_URL = 'https://api.nostalgic.llll-ll.com/visit?action=get&id=libra-d59ef40c'
const INCREMENT_URL = 'https://api.nostalgic.llll-ll.com/visit?action=increment&id=libra-d59ef40c'

const okResponse = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) })

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('リンク先と定数', () => {
  it('外部リンクはどれも https で、仕様の行き先を指す', () => {
    expect(AUTHOR_SITE_URL).toBe('https://llll-ll.com')
    expect(FEEDBACK_BBS_URL).toBe('https://llll-ll.com/ja/#bbs')
    expect(USER_GUIDE_URL).toBe('https://github.com/kako-jun/libra/blob/main/docs/user-guide.md')
  })

  it('本番のホスト名とカウンターの公開 ID', () => {
    expect(PRODUCTION_HOSTNAME).toBe('libra.llll-ll.com')
    expect(NOSTALGIC_COUNTER_ID).toBe('libra-d59ef40c')
  })

  it('ビルドの埋め込みが無い環境(単体テスト)では、版とビルド日は dev になる', () => {
    expect(APP_VERSION).toBe('dev')
    expect(APP_BUILD_DATE).toBe('dev')
  })
})

describe('usageCountUrl: 本番のホストだけ数える', () => {
  it('本番のホスト(libra.llll-ll.com)は increment', () => {
    expect(usageCountUrl('libra.llll-ll.com')).toBe(INCREMENT_URL)
  })

  it.each([
    ['開発', 'localhost'],
    ['開発(IP)', '127.0.0.1'],
    ['LAN の実機確認', '192.168.1.20'],
    ['プレビュー配信', 'abc123.libra-xyz.pages.dev'],
    ['本番のサブドメイン', 'preview.libra.llll-ll.com'],
    ['作者サイト(別ホスト)', 'llll-ll.com'],
    ['本番を前方に含む別ホスト', 'libra.llll-ll.com.example.com'],
    ['本番を後方に含む別ホスト', 'xlibra.llll-ll.com'],
    ['末尾にドットが付いたホスト', 'libra.llll-ll.com.'],
    ['ポート付きの文字列', 'libra.llll-ll.com:8080'],
    ['空(file: で開いた等)', ''],
  ])('%s(%s)は get(増やさない)', (_name, hostname) => {
    expect(usageCountUrl(hostname)).toBe(GET_URL)
  })

  it('どのホストでも increment / get 以外の操作を作らない(公開 ID でできるのはこの2つだけ)', () => {
    for (const host of ['libra.llll-ll.com', 'localhost', '', 'a&action=set', 'x?y=1#z']) {
      expect([GET_URL, INCREMENT_URL]).toContain(usageCountUrl(host))
    }
  })
})

describe('parseUsageCount: 応答から累計を取り出す', () => {
  it.each([
    ['通常', { data: { total: 1234 } }, 1234],
    ['0 回', { data: { total: 0 } }, 0],
    ['ほかの項目があっても total だけを見る', { success: true, data: { total: 7, today: 1 } }, 7],
  ])('%s', (_name, body, expected) => {
    expect(parseUsageCount(body)).toBe(expected)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['文字列', '1234'],
    ['数値そのもの', 1234],
    ['配列', [1234]],
    ['data が無い', { total: 1234 }],
    ['data が null', { data: null }],
    ['data が数値', { data: 1234 }],
    ['total が無い', { data: {} }],
    ['total が文字列', { data: { total: '1234' } }],
    ['total が負', { data: { total: -1 } }],
    ['total が NaN', { data: { total: Number.NaN } }],
    ['total が無限大', { data: { total: Number.POSITIVE_INFINITY } }],
    ['エラー応答', { success: false, error: 'not found' }],
  ])('形が違う応答(%s)は null', (_name, body) => {
    expect(parseUsageCount(body)).toBeNull()
  })
})

describe('fetchUsageCount: 起動時の取得(失敗しても何も投げない)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('本番のホストでは increment を 1 回だけ呼び、累計を返す', async () => {
    fetchMock.mockResolvedValue(okResponse({ data: { total: 321 } }))
    await expect(fetchUsageCount('libra.llll-ll.com')).resolves.toBe(321)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(INCREMENT_URL)
  })

  it('本番以外のホストでは get を呼ぶ(数えない)', async () => {
    fetchMock.mockResolvedValue(okResponse({ data: { total: 321 } }))
    await expect(fetchUsageCount('localhost')).resolves.toBe(321)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(GET_URL)
  })

  it('ホストを省略すると、いま開いているホスト(単体テストでは本番でない)で判定し、get になる', async () => {
    fetchMock.mockResolvedValue(okResponse({ data: { total: 5 } }))
    expect(window.location.hostname).not.toBe(PRODUCTION_HOSTNAME)
    await expect(fetchUsageCount()).resolves.toBe(5)
    expect(fetchMock.mock.calls[0][0]).toBe(GET_URL)
  })

  it('送るのは URL と中断用の signal だけ(本文・ヘッダ・認証情報を付けない)', async () => {
    fetchMock.mockResolvedValue(okResponse({ data: { total: 1 } }))
    await fetchUsageCount('localhost')
    const init = fetchMock.mock.calls[0][1] as Record<string, unknown>
    expect(Object.keys(init)).toEqual(['signal'])
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('HTTP エラー(ok=false)は null。本文は読まない', async () => {
    const json = vi.fn()
    fetchMock.mockResolvedValue({ ok: false, status: 500, json })
    await expect(fetchUsageCount('localhost')).resolves.toBeNull()
    expect(json).not.toHaveBeenCalled()
  })

  it('通信失敗(オフライン)は null。例外にしない', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchUsageCount('localhost')).resolves.toBeNull()
  })

  it('fetch が同期的に例外を出しても null', async () => {
    fetchMock.mockImplementation(() => {
      throw new Error('blocked')
    })
    await expect(fetchUsageCount('localhost')).resolves.toBeNull()
  })

  it('JSON でない応答は null', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: () => Promise.reject(new SyntaxError('bad')) })
    await expect(fetchUsageCount('localhost')).resolves.toBeNull()
  })

  it('形が違う応答は null', async () => {
    fetchMock.mockResolvedValue(okResponse({ data: { total: 'たくさん' } }))
    await expect(fetchUsageCount('localhost')).resolves.toBeNull()
  })

  it('fetch が無い環境では、何もせず null', async () => {
    vi.stubGlobal('fetch', undefined)
    await expect(fetchUsageCount('localhost')).resolves.toBeNull()
  })

  /** signal が中断されるまで応答しない fetch(応答の遅い回線) */
  const hangingFetch = () =>
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )

  it('境界: 応答が無いまま 7,999ms では待ち続け、8,000ms で中断して null になる', async () => {
    vi.useFakeTimers()
    hangingFetch()
    let settled: number | null | 'pending' = 'pending'
    void fetchUsageCount('localhost').then((value) => {
      settled = value
    })
    const signal = (fetchMock.mock.calls[0][1] as { signal: AbortSignal }).signal

    await vi.advanceTimersByTimeAsync(7999)
    expect(signal.aborted).toBe(false)
    expect(settled).toBe('pending')

    await vi.advanceTimersByTimeAsync(1)
    expect(signal.aborted).toBe(true)
    expect(settled).toBeNull()
  })

  it('応答が返ったあとは中断のタイマーを残さない(8 秒後に中断しない)', async () => {
    vi.useFakeTimers()
    fetchMock.mockResolvedValue(okResponse({ data: { total: 9 } }))
    await expect(fetchUsageCount('localhost')).resolves.toBe(9)
    const signal = (fetchMock.mock.calls[0][1] as { signal: AbortSignal }).signal
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(20000)
    expect(signal.aborted).toBe(false)
  })

  it('失敗したあとも中断のタイマーを残さない', async () => {
    vi.useFakeTimers()
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchUsageCount('localhost')).resolves.toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })
})
