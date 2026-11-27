// 介助者用メニュー「このアプリ」タブの情報(Issue #118): リンク先・利用回数・バージョン。
// どれも伝達機能とは無関係で、オフライン・失敗時は「出さない / 取得できない」だけにする。

/** 作者サイト */
export const AUTHOR_SITE_URL = 'https://llll-ll.com'
/** ご意見・ご感想の掲示板(作者サイトのサポート BBS。Nostalgic BBS) */
export const FEEDBACK_BBS_URL = 'https://llll-ll.com/ja/#bbs'
/** 利用ガイド(リポジトリの docs/user-guide.md)。アプリ内には使い方の本文を置かない(Issue #149) */
export const USER_GUIDE_URL = 'https://github.com/kako-jun/libra/blob/main/docs/user-guide.md'

/** Nostalgic カウンターの公開 ID(公開してよい値。get / increment しかできない) */
export const NOSTALGIC_COUNTER_ID = 'libra-d59ef40c'
const NOSTALGIC_VISIT_API = 'https://api.nostalgic.llll-ll.com/visit'
/** 利用回数を数える本番のホスト名。開発・検証・自動テストの起動では数えない(表示のための取得だけ行う) */
export const PRODUCTION_HOSTNAME = 'libra.llll-ll.com'
const COUNTER_TIMEOUT_MS = 8000

/** 同梱フォント(BIZ UDGothic)のライセンス(OFL 1.1)全文。配信物に入る(vite.config.ts)。
 *  Service Worker が precache するので、オフラインでも開ける */
export const FONT_LICENSE_URL = '/licenses/BIZUDGothic-OFL.txt'

/** 画面に出すバージョン(Issue #146): 公開版の最後の変更日(日本時間の YYYY-MM-DD)だけ。
 *  ビルド時に埋め込む。テスト等で未定義なら 'dev' */
export const APP_RELEASE_DATE: string =
  typeof __RELEASE_DATE__ === 'string' ? __RELEASE_DATE__ : 'dev'

/** 利用回数の取得 URL。本番のホストでは 1 増やして取得し、それ以外では増やさず取得する */
export function usageCountUrl(hostname: string): string {
  const action = hostname === PRODUCTION_HOSTNAME ? 'increment' : 'get'
  return `${NOSTALGIC_VISIT_API}?action=${action}&id=${NOSTALGIC_COUNTER_ID}`
}

/** API の応答から累計の回数を取り出す。形が違えば null */
export function parseUsageCount(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const data = (body as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) return null
  const total = (data as { total?: unknown }).total
  return typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : null
}

/**
 * 起動時に 1 回だけ呼ぶ。利用回数(累計)を返す。オフライン・タイムアウト・失敗は null(何も投げない)。
 * 数え方: 本番のホストで開いたときに 1 回数える。同じ端末(IP + ブラウザ)の重複は Nostalgic 側が 1 日単位で除く。
 */
export async function fetchUsageCount(
  hostname: string = window.location.hostname,
): Promise<number | null> {
  if (typeof fetch !== 'function') return null
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? window.setTimeout(() => controller.abort(), COUNTER_TIMEOUT_MS) : 0
  try {
    const response = await fetch(usageCountUrl(hostname), { signal: controller?.signal })
    if (!response.ok) return null
    return parseUsageCount(await response.json())
  } catch {
    return null
  } finally {
    if (controller) window.clearTimeout(timer)
  }
}
