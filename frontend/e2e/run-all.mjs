#!/usr/bin/env node
// 全 e2e ファイルを順に実行する。途中で落ちても残りを最後まで回し、1つでも落ちたら終了コード 1。

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SUITES = ['offline', 'navigation', 'layout', 'theme']
const failed = []
for (const suite of SUITES) {
  console.log(`\n===== e2e: ${suite} =====`)
  const file = fileURLToPath(new URL(`./${suite}.e2e.mjs`, import.meta.url))
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' })
  if (result.status !== 0) failed.push(suite)
}
if (failed.length > 0) {
  console.error(`\n失敗した e2e: ${failed.join(', ')}`)
  process.exitCode = 1
} else {
  console.log('\nすべての e2e を通過した')
}
