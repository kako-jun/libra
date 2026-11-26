// 単体テストの共通の準備。
//
// App はマウント時に利用回数(Issue #118)を取りに行く(lib/appInfo.ts の fetchUsageCount)。Node には fetch が
// あるので、差し止めないと App を描画するテストのたびに、本番の Nostalgic API へ実際の通信が出てしまう
// (テストが通信の有無・速さに左右され、公開中のサービスへ毎回数百件の要求を送ることになる)。
// 既定では通信を失敗させ(アプリから見ればオフラインと同じ)、通信を検査するテストだけが自分で fetch を差し替える。
import { beforeEach } from 'vitest'

beforeEach(() => {
  globalThis.fetch = (() =>
    Promise.reject(
      new TypeError('単体テストでは外部へ通信しない(必要なテストは fetch を差し替える)'),
    )) as typeof fetch
})
