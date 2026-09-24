import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyPrecacheManifest,
  collectPrecacheUrls,
  computeCacheVersion,
} from '../generate-precache-manifest.mjs'

let tmpDir: string | undefined

afterEach(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  tmpDir = undefined
})

function makeDistLike(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'libra-precache-'))
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(dir, relPath)
    mkdirSync(join(fullPath, '..'), { recursive: true })
    writeFileSync(fullPath, content)
  }
  tmpDir = dir
  return dir
}

describe('collectPrecacheUrls', () => {
  it('dist直下・サブディレクトリのファイルをルートからの絶対パスで列挙し、index.htmlは/として扱う', () => {
    const dir = makeDistLike({
      'index.html': '<html></html>',
      'manifest.webmanifest': '{}',
      'assets/index.js': 'console.log(1)',
      'assets/index.css': 'body{}',
    })
    const urls = collectPrecacheUrls(dir)
    expect(urls).toEqual(['/', '/assets/index.css', '/assets/index.js', '/manifest.webmanifest'])
  })

  it('sw.js 自身は対象に含めない', () => {
    const dir = makeDistLike({
      'index.html': '<html></html>',
      'sw.js': 'self.addEventListener()',
    })
    const urls = collectPrecacheUrls(dir)
    expect(urls).not.toContain('/sw.js')
    // index.html は / として precache する(PR#11 must-1: Cloudflare Pages 等が
    // /index.html への直接アクセスを / へ308リダイレクトすることがあるため)
    expect(urls).toContain('/')
    expect(urls).not.toContain('/index.html')
  })

  it('PR#11 must-1: ドットファイル(.nojekyll等)は対象外にする', () => {
    const dir = makeDistLike({
      'index.html': '<html></html>',
      '.nojekyll': '',
      '.well-known/foo': 'x',
    })
    const urls = collectPrecacheUrls(dir)
    expect(urls).not.toContain('/.nojekyll')
    expect(urls.some((u) => u.includes('.well-known'))).toBe(false)
  })

  it('PR#11 must-1: _headers/_redirects(配信設定ファイル)は対象外にする', () => {
    const dir = makeDistLike({
      'index.html': '<html></html>',
      _headers: '/* X-Foo: 1',
      _redirects: '/a /b 301',
    })
    const urls = collectPrecacheUrls(dir)
    expect(urls).not.toContain('/_headers')
    expect(urls).not.toContain('/_redirects')
  })

  it('.woff2が1つでもあれば.woffは全て除外する(ハッシュ付きファイル名は同名判定できないため)', () => {
    const dir = makeDistLike({
      // @fontsource/vite 相当: woff と woff2 でハッシュが異なり同名にはならない
      'assets/font-japanese-400-normal-CoVnaAmp.woff2': 'woff2-bytes',
      'assets/font-japanese-400-normal-mmdfgdEE.woff': 'woff-bytes',
    })
    const urls = collectPrecacheUrls(dir)
    expect(urls).toContain('/assets/font-japanese-400-normal-CoVnaAmp.woff2')
    expect(urls).not.toContain('/assets/font-japanese-400-normal-mmdfgdEE.woff')
  })

  it('.woff2が1つも無ければ.woffはそのまま残す(フォールバック手段が他にないため)', () => {
    const dir = makeDistLike({
      'assets/font-solo.woff': 'solo-bytes',
    })
    const urls = collectPrecacheUrls(dir)
    expect(urls).toContain('/assets/font-solo.woff')
  })

  it('空のディレクトリでは空配列を返す', () => {
    const dir = makeDistLike({})
    expect(collectPrecacheUrls(dir)).toEqual([])
  })
})

describe('computeCacheVersion', () => {
  it('内容が同じなら同じハッシュになる', () => {
    const dirA = makeDistLike({
      'index.html': '<html>a</html>',
      'assets/x.js': '1',
      'sw.js': 'const CACHE_NAME=1',
    })
    const urlsA = collectPrecacheUrls(dirA)
    const versionA = computeCacheVersion(dirA, urlsA)
    rmSync(dirA, { recursive: true, force: true })

    const dirB = makeDistLike({
      'index.html': '<html>a</html>',
      'assets/x.js': '1',
      'sw.js': 'const CACHE_NAME=1',
    })
    const urlsB = collectPrecacheUrls(dirB)
    const versionB = computeCacheVersion(dirB, urlsB)

    expect(versionA).toBe(versionB)
  })

  it('precache対象ファイルの内容が変わればハッシュも変わる', () => {
    const dir1 = makeDistLike({ 'index.html': '<html>a</html>', 'sw.js': 'x' })
    const urls1 = collectPrecacheUrls(dir1)
    const version1 = computeCacheVersion(dir1, urls1)
    rmSync(dir1, { recursive: true, force: true })

    const dir2 = makeDistLike({ 'index.html': '<html>b</html>', 'sw.js': 'x' })
    const urls2 = collectPrecacheUrls(dir2)
    const version2 = computeCacheVersion(dir2, urls2)

    expect(version1).not.toBe(version2)
  })

  it('PR#11 3巡目 must-E: sw.js自身の内容(ロジック)が変わればハッシュも変わる(precache対象ファイルが同じでも)', () => {
    const dir1 = makeDistLike({ 'index.html': '<html>a</html>', 'sw.js': 'const X = 1' })
    const urls1 = collectPrecacheUrls(dir1)
    const version1 = computeCacheVersion(dir1, urls1)
    rmSync(dir1, { recursive: true, force: true })

    const dir2 = makeDistLike({ 'index.html': '<html>a</html>', 'sw.js': 'const X = 2' })
    const urls2 = collectPrecacheUrls(dir2)
    const version2 = computeCacheVersion(dir2, urls2)

    expect(version1).not.toBe(version2)
  })

  it('12文字の16進文字列を返す', () => {
    const dir = makeDistLike({ 'index.html': '<html></html>', 'sw.js': 'x' })
    const urls = collectPrecacheUrls(dir)
    const version = computeCacheVersion(dir, urls)
    expect(version).toMatch(/^[0-9a-f]{12}$/)
  })
})

describe('applyPrecacheManifest', () => {
  it('sw.jsの両プレースホルダをURL一覧とハッシュへ置き換える', () => {
    const dir = makeDistLike({
      'index.html': '<html></html>',
      'sw.js':
        "const CACHE_NAME='libra-__CACHE_VERSION__'\nconst PRECACHE_URLS=__PRECACHE_URLS__\n",
    })
    const { urls, cacheVersion } = applyPrecacheManifest(dir)
    const written = readFileSync(join(dir, 'sw.js'), 'utf-8')
    expect(written).not.toContain('__CACHE_VERSION__')
    expect(written).not.toContain('__PRECACHE_URLS__')
    expect(written).toContain(cacheVersion)
    expect(written).toContain(JSON.stringify(urls))
  })

  it('__PRECACHE_URLS__ が無い sw.js では throw する', () => {
    const dir = makeDistLike({
      'index.html': '<html></html>',
      'sw.js': "const CACHE_NAME='libra-__CACHE_VERSION__'\n",
    })
    expect(() => applyPrecacheManifest(dir)).toThrow(/__PRECACHE_URLS__/)
  })

  it('__CACHE_VERSION__ が無い sw.js では throw する', () => {
    const dir = makeDistLike({
      'index.html': '<html></html>',
      'sw.js': 'const PRECACHE_URLS=__PRECACHE_URLS__\n',
    })
    expect(() => applyPrecacheManifest(dir)).toThrow(/__CACHE_VERSION__/)
  })
})
