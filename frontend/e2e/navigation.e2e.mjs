#!/usr/bin/env node
// 本人画面の導線(戻る・パンくず・緊急の保持)の e2e。実ブラウザで画面遷移を実際に踏む。
//
// 事前に `npm run build` で dist/ を作っておくこと。実行方法は docs/development.md 参照。
//
// - back-navigation-and-emergency-retention: 緊急詳細の戻る・状態保持、通常下位画面の戻る→緊急順、痛い場所から不快への親戻り
// - breadcrumb-not-truncated: パンくずが省略されず、折り返した祖先ボタンで正しい画面へ戻れる(#69/#81)

import { launchBrowser, runChecks, startServer } from './lib.mjs'

async function checkBackNavigationAndEmergencyRetention(chromium, port) {
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const failures = []

  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } })
    await page.addInitScript(() => {
      localStorage.setItem(
        'libra',
        JSON.stringify({ intervalMs: 500, headHoldMultiplier: 1, morseEnabled: true }),
      )
    })
    await page.goto(`http://localhost:${port}/`)
    const labels = () => page.locator('.grid-board .tile-label').allTextContents()
    const press = async () => {
      await page.keyboard.press('Space')
      await page.waitForTimeout(550)
    }
    const waitForCursor = async (label) => {
      await page.waitForFunction(
        (expected) =>
          document.querySelector('.tile.scanning .tile-label')?.textContent === expected,
        label,
        { timeout: 8000 },
      )
    }
    const select = async (label) => {
      await waitForCursor(label)
      await press()
    }

    await select('緊急')
    const urgentLabels = await labels()
    if (urgentLabels[0] !== '戻る' || urgentLabels.includes('緊急') || urgentLabels.length < 2) {
      failures.push(
        '[navigation] urgentDetail must start with Back and contain details without a duplicate Emergency tile',
      )
    }
    await page.waitForFunction(
      () => document.querySelector('.emergency-status-message')?.textContent?.includes('緊急です'),
      null,
      { timeout: 5000 },
    )
    await select('戻る')
    if ((await labels())[0] !== '緊急')
      failures.push('[navigation] urgentDetail Back did not return to home')
    if (!(await page.locator('.emergency-status-message').count())) {
      failures.push('[navigation] emergency state was cleared when returning from urgentDetail')
    }
    await select('緊急')
    await select('苦しい')
    if (!((await page.locator('.emergency-details').textContent()) ?? '').includes('苦しい')) {
      failures.push('[navigation] selected emergency detail was not retained')
    }

    // 通常下位 ScreenId は、スキャン選択で実際に入り、戻るを選んで直前の親メニューへ戻る。
    // 親のタイル構成を遷移前に保存し、見出しが同じ画面(discomfort / discomfortOther等)も区別する。
    const routes = [
      ['discomfort', ['不快']],
      ['discomfortOther', ['不快', 'その他']],
      ['painLocation', ['不快', '痛い']],
      ['painIntensity', ['不快', '痛い', '頭']],
      ['comfort', ['快']],
      ['requests', ['要望']],
      ['feelings', ['快', '気分']],
      ['letters', ['文字盤']],
      ['lettersRow', ['文字盤', 'あ行']],
      ['morse', ['モールス']],
    ]
    for (const [screen, path] of routes) {
      let parentLabels = []
      for (let index = 0; index < path.length; index += 1) {
        if (index === path.length - 1) parentLabels = await labels()
        await select(path[index])
      }
      if (screen === 'morse') {
        // モールスは入力画面に戻るタイルを表示しない専用入力モード。定義済みの
        // 「・を5回 → 待つ」復帰操作が親(home)へ戻ることを確認する。
        for (let dot = 0; dot < 5; dot += 1) {
          await page.keyboard.down('Space')
          await page.waitForTimeout(100)
          await page.keyboard.up('Space')
          await page.waitForTimeout(150)
        }
        await page.waitForTimeout(1600)
        if (await page.locator('.morse-panel').count()) {
          failures.push('[navigation] morse return operation did not leave morse screen')
        }
        if (!(await page.locator('.emergency-status-message').count())) {
          failures.push('[navigation] emergency state was cleared while returning from morse')
        }
        if (!((await page.locator('.emergency-details').textContent()) ?? '').includes('苦しい')) {
          failures.push('[navigation] emergency detail was cleared while returning from morse')
        }
        continue
      }

      const childLabels = await labels()
      if (childLabels[0] !== '戻る') {
        failures.push(`[navigation] ${screen} does not expose Back as its first item`)
        continue
      }
      if (screen !== 'urgentDetail' && childLabels[1] !== '緊急') {
        failures.push(`[navigation] ${screen} does not expose Emergency as its second item`)
      }
      await select('戻る')
      const actualParentLabels = await labels()
      if (JSON.stringify(actualParentLabels) !== JSON.stringify(parentLabels)) {
        failures.push(
          `[navigation] ${screen} Back did not return to its immediate parent: ${JSON.stringify(actualParentLabels)}`,
        )
      }
      if (!(await page.locator('.emergency-status-message').count())) {
        failures.push(`[navigation] emergency state was cleared after backing out of ${screen}`)
      }
      if (!((await page.locator('.emergency-details').textContent()) ?? '').includes('苦しい')) {
        failures.push(`[navigation] emergency detail was cleared after backing out of ${screen}`)
      }

      // 各ケースの開始位置をhomeへ戻す。親から戻る操作も同じ実入力で行う。
      while ((await labels())[0] !== '緊急') await select('戻る')
    }
  } catch (error) {
    failures.push(`[navigation] ${error.message.split('\n')[0]}`)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
  return failures
}

// Issue #81 M1/S1: パンくずの祖先は押して戻るボタン(#69)。16px の文字が狭い画面の深い階層や、
// 介助者が付けた長い自作ラベル(最大 20 字)で「…」に省略されたり、介助者ボタンの下へはみ出して
// 読めなくなってはならない。収まらないときは折り返し、省略(text-overflow)しない。
// 実描画で次を測る: (i) 列(ul)が scrollWidth <= clientWidth、(ii) 各 li の右端が .screen-guide-copy の右端以内、
// (iii) li と介助者ボタン、(iv) li と h2 の矩形が重ならない、(v) 各 li の computed font-size が 16px 以上、
// (vi) 折り返した祖先ボタンを押すと正しい画面へ移動する(#69)、(vii) 縦スクロールが出ない。
// li 自身は overflow を持たないので li.scrollWidth だけでは「列からのはみ出し」を拾えない。
const LONG_PAIN_LABEL = '右の脇腹から背中にかけての奥のあたり'

async function checkBreadcrumbNotTruncated(chromium, port) {
  const server = await startServer('plain', port)
  const browser = await launchBrowser(chromium)
  const failures = []

  try {
    for (const [width, height] of [
      [320, 568],
      [360, 640],
      [390, 844],
    ]) {
      const page = await browser.newPage({ viewport: { width, height } })
      await page.addInitScript((label) => {
        localStorage.setItem(
          'libra',
          JSON.stringify({
            intervalMs: 600000,
            phrasesVersion: 1,
            phrases: {
              painLocation: [
                { id: 'long', label, text: '脇腹が痛いです。' },
                { id: 'chest', label: '胸', text: '胸が痛いです。' },
              ],
            },
          }),
        )
      }, LONG_PAIN_LABEL)
      const home = async () => {
        await page.goto(`http://localhost:${port}/`)
        await page.evaluate(() => document.fonts.ready)
      }
      const open = async (label) => {
        await page
          .locator('.tile', {
            has: page.locator('.tile-label', { hasText: new RegExp(`^${label}$`) }),
          })
          .first()
          .click()
        await page.waitForTimeout(500)
      }
      const measure = async (caseName, expected) => {
        await page.evaluate(() => document.fonts.ready)
        const r = await page.evaluate(() => {
          const ul = document.querySelector('.screen-breadcrumb')
          const copy = document.querySelector('.screen-guide-copy')
          const control = document.querySelector('.screen-guide .message-panel-controls button')
          const h2 = document.querySelector('.screen-guide h2')
          const copyRight = copy.getBoundingClientRect().right
          const hit = (a, b) =>
            a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
          const controlRect = control.getBoundingClientRect()
          const h2Rect = h2.getBoundingClientRect()
          return {
            ulOverflow: ul.scrollWidth - ul.clientWidth,
            vScroll: document.documentElement.scrollHeight - innerHeight,
            lis: [...ul.querySelectorAll('li')].map((li) => {
              const rect = li.getBoundingClientRect()
              const button = li.querySelector('button')
              return {
                text: li.textContent,
                liCut: li.scrollWidth > li.clientWidth,
                buttonCut: button ? button.scrollWidth > button.clientWidth : false,
                outside: rect.right > copyRight + 0.5,
                overControl: hit(rect, controlRect),
                overH2: hit(rect, h2Rect),
                fontSize: parseFloat(getComputedStyle(li).fontSize),
              }
            }),
          }
        })
        const tag = `[breadcrumb ${width}x${height} ${caseName}]`
        const texts = r.lis.map((x) => x.text)
        if (JSON.stringify(texts) !== JSON.stringify(expected)) {
          failures.push(`${tag} unexpected path ${JSON.stringify(texts)}`)
        }
        if (r.ulOverflow > 0) failures.push(`${tag} list overflows its column by ${r.ulOverflow}px`)
        if (r.vScroll > 0) failures.push(`${tag} page scrolls vertically by ${r.vScroll}px`)
        for (const x of r.lis) {
          if (x.liCut || x.buttonCut) failures.push(`${tag} "${x.text}" is truncated`)
          if (x.outside) failures.push(`${tag} "${x.text}" sticks out of the guide column`)
          if (x.overControl) failures.push(`${tag} "${x.text}" overlaps the caregiver button`)
          if (x.overH2) failures.push(`${tag} "${x.text}" overlaps the heading`)
          if (x.fontSize < 16) failures.push(`${tag} "${x.text}" font-size ${x.fontSize}px < 16px`)
        }
      }
      await home()
      await open('不快')
      await open('痛い')
      await open('胸')
      await measure('painIntensity', ['ホーム', '不快', '胸', '痛みの強さ'])
      await home()
      await open('文字盤')
      await open('あ行')
      await measure('lettersRow', ['ホーム', '文字盤', 'あ行', '文字盤・文字'])
      if (width !== 360) {
        // 介助者が付けた 18 字の自作ラベル。1 項目だけで列に入りきらないので、その項目の中で折り返す
        await home()
        await open('不快')
        await open('痛い')
        await open(LONG_PAIN_LABEL)
        await measure('longLabel', ['ホーム', '不快', LONG_PAIN_LABEL, '痛みの強さ'])
        // 折り返した祖先もボタンのまま押せて、痛い場所の選択画面へ戻る(#69)
        await page.locator('.screen-breadcrumb .breadcrumb-link', { hasText: '右の脇腹' }).click()
        await page.waitForTimeout(500)
        const crumbs = await page.evaluate(() =>
          [...document.querySelectorAll('.screen-breadcrumb li')].map((li) => li.textContent),
        )
        if (JSON.stringify(crumbs) !== JSON.stringify(['ホーム', '不快', '痛い場所'])) {
          failures.push(
            `[breadcrumb ${width}x${height} longLabel click] unexpected path ${JSON.stringify(crumbs)}`,
          )
        }
      }
      await page.close()
    }
  } catch (error) {
    failures.push(`[breadcrumb-not-truncated] ${error.message.split('\n')[0]}`)
  } finally {
    await browser.close()
    await new Promise((resolve) => server.close(resolve))
  }
  return failures
}

await runChecks(
  [
    {
      name: 'back-navigation-and-emergency-retention',
      run: checkBackNavigationAndEmergencyRetention,
    },
    { name: 'breadcrumb-not-truncated', run: checkBreadcrumbNotTruncated },
  ],
  { basePort: 4720 },
)
