// e2e 共通の土台: dist/ の静的配信サーバー・Chromium の起動・検査の実行ランナー。
// 各 *.e2e.mjs はここから startServer / launchBrowser / runChecks を使う。
// 事前に `npm run build` で dist/ を作っておくこと(Service Worker のマニフェスト生成を含む)。

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const DIST_DIR = fileURLToPath(new URL('../dist', import.meta.url))
export const CONTENT_TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
}

/**
 * dist/ を配信するサーバーを立てる。mode: 'plain' | 'cf' | '404dot'(オフライン検査の配信モード)。
 */
export function startServer(mode, port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    let pathname = decodeURIComponent(url.pathname)

    if (mode === 'cf' && pathname.endsWith('/index.html')) {
      // Cloudflare Pages 相当: /index.html への直接アクセスは / へ308リダイレクトする
      res.writeHead(308, { Location: pathname.slice(0, -'index.html'.length) || '/' })
      res.end()
      return
    }
    if (mode === '404dot' && path.basename(pathname).startsWith('.')) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    if (pathname.endsWith('/')) pathname += 'index.html'

    let filePath = path.join(DIST_DIR, pathname)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // SPA フォールバック: 深いパス(ディープリンク)は index.html を返す
      filePath = path.join(DIST_DIR, 'index.html')
    }
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
    })
    fs.createReadStream(filePath).pipe(res)
  })
  return new Promise((resolve) => server.listen(port, () => resolve(server)))
}

/** Chromium を起動する。PLAYWRIGHT_CHROMIUM_PATH があればその実行ファイルを使う。 */
export function launchBrowser(chromium) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH
  return chromium.launch(executablePath ? { executablePath } : undefined)
}

/**
 * 検査を順に実行する。各検査は (chromium, port) => 失敗メッセージの配列 を返す。
 * 検査名を CI ログに出し、失敗があれば exit code 1 にする。
 * E2E_ONLY=name1,name2 を指定すると、その名前の検査だけを実行する。
 */
export async function runChecks(checks, { basePort }) {
  if (!fs.existsSync(DIST_DIR)) {
    console.error(`dist/ が無い。先に \`npm run build\` を実行すること: ${DIST_DIR}`)
    process.exitCode = 1
    return
  }
  const only = process.env.E2E_ONLY ? process.env.E2E_ONLY.split(',') : null
  const { chromium } = await import('playwright')
  const allFailures = []
  let port = basePort
  for (const { name, run } of checks) {
    if (only && !only.includes(name)) {
      port += 1
      continue
    }
    console.log(`--- checking: ${name} (port ${port}) ---`)
    const failures = await run(chromium, port)
    if (failures.length === 0) {
      console.log(`[${name}] OK`)
    } else {
      console.error(`[${name}] FAILED`)
      failures.forEach((f) => console.error(f))
    }
    allFailures.push(...failures)
    port += 1
  }
  if (allFailures.length > 0) {
    console.error(`\n${allFailures.length} 件失敗した`)
    process.exitCode = 1
  } else {
    console.log('\nすべての検査を通過した')
  }
}
