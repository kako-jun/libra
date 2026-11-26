// @vitest-environment node
// Issue #146: 画面のバージョン(公開版の最後の変更日。日本時間の YYYY-MM-DD)。
//
// 観点
//   toJstDate   | 日本時間の 0 時の境目。年またぎ
//   releaseDate | HEAD の committer date(author date やビルドした日ではない)。履歴が 1 件の浅い clone でも同じ。
//               | フォルダを変えただけでは変わらない。git が無い場所では例外(ビルド当日で代えない)
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { releaseDate, toJstDate } from '../release-date.mjs'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'libra-release-date-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid',
      GIT_COMMITTER_NAME: 't',
      GIT_COMMITTER_EMAIL: 't@example.invalid',
      ...env,
    },
  })
}

function commit(repo: string, file: string, committed: string, authored = committed) {
  mkdirSync(join(repo, file, '..'), { recursive: true })
  writeFileSync(join(repo, file), committed)
  git(repo, ['add', '--', file])
  git(repo, ['commit', '-q', '-m', file], {
    GIT_AUTHOR_DATE: authored,
    GIT_COMMITTER_DATE: committed,
  })
}

describe('toJstDate: 日本時間の日付', () => {
  it.each([
    ['2026-03-04T14:59:59Z', '2026-03-04'],
    ['2026-03-04T15:00:00Z', '2026-03-05'],
    ['2025-12-31T15:00:00Z', '2026-01-01'],
  ])('%s → %s', (utc, expected) => {
    expect(toJstDate(Date.parse(utc) / 1000)).toBe(expected)
  })
})

describe('releaseDate: HEAD のコミット日', () => {
  function makeRepo() {
    const repo = tempDir()
    git(repo, ['init', '-q', '-b', 'main'])
    commit(repo, 'frontend/a.txt', '2020-01-10T12:00:00+09:00')
    // 後の変更は frontend の外。committer date(日本時間の 2021-06-02)を使い、author date は使わない
    commit(repo, 'docs/b.txt', '2021-06-01T23:30:00Z', '2019-05-05T00:00:00Z')
    return repo
  }

  it('最後の変更の committer date。サブフォルダから呼んでも同じ', () => {
    const repo = makeRepo()
    expect(releaseDate(repo)).toBe('2021-06-02')
    expect(releaseDate(join(repo, 'frontend'))).toBe('2021-06-02')
  })

  it('履歴が 1 件の浅い clone(CI・Cloudflare Pages)でも同じ日になる', () => {
    const repo = makeRepo()
    const clone = join(tempDir(), 'clone')
    git(repo, ['clone', '-q', '--depth', '1', pathToFileURL(repo).href, clone])
    expect(git(clone, ['rev-parse', '--is-shallow-repository']).trim()).toBe('true')
    expect(git(clone, ['rev-list', '--count', 'HEAD']).trim()).toBe('1')
    expect(releaseDate(join(clone, 'frontend'))).toBe('2021-06-02')
  })

  it('git のリポジトリでない場所では例外にする', () => {
    expect(() => releaseDate(tempDir())).toThrow()
  })
})
