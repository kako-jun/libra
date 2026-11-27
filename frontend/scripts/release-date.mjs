// Issue #146: 介助者用メニュー「このアプリ」に出す日付。公開版の最後の変更日(ビルドする HEAD の
// コミット日時。committer date)を日本時間の YYYY-MM-DD にする。
// パスでは絞らない: CI や Cloudflare Pages の浅い clone(履歴が HEAD の 1 件だけ)でも同じ値になるように、
// HEAD のコミットだけを読む。

import { execFileSync } from 'node:child_process'

/** UNIX 秒を日本時間の YYYY-MM-DD にする */
export function toJstDate(unixSeconds) {
  return new Date((unixSeconds + 9 * 60 * 60) * 1000).toISOString().slice(0, 10)
}

/**
 * cwd を含むリポジトリの HEAD のコミット日。git から取れないときは例外にする
 * (ビルドした日を代わりに出すと、変更が無くても新しい版に見えるため、黙って代えない)
 * @param {string} cwd
 * @returns {string}
 */
export function releaseDate(cwd) {
  const out = execFileSync('git', ['log', '-1', '--format=%ct', 'HEAD'], {
    cwd,
    encoding: 'utf-8',
    // git の stderr は端末へ流さず、失敗したときの例外に含める
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
  if (!/^\d+$/.test(out)) throw new Error(`HEAD のコミット日時を取れない: ${JSON.stringify(out)}`)
  return toJstDate(Number(out))
}
