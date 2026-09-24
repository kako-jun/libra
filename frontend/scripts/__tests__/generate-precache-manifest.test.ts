import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectPrecacheUrls } from '../generate-precache-manifest.mjs'

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
  it('dist直下・サブディレクトリのファイルをルートからの絶対パスで列挙する', () => {
    const dir = makeDistLike({
      'index.html': '<html></html>',
      'manifest.webmanifest': '{}',
      'assets/index.js': 'console.log(1)',
      'assets/index.css': 'body{}',
    })
    const urls = collectPrecacheUrls(dir)
    expect(urls).toEqual([
      '/assets/index.css',
      '/assets/index.js',
      '/index.html',
      '/manifest.webmanifest',
    ])
  })

  it('sw.js 自身は対象に含めない', () => {
    const dir = makeDistLike({
      'index.html': '<html></html>',
      'sw.js': 'self.addEventListener()',
    })
    const urls = collectPrecacheUrls(dir)
    expect(urls).not.toContain('/sw.js')
    expect(urls).toContain('/index.html')
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
