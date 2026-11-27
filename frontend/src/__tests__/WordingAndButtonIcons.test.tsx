// Issue #153・#155: 画面と読み上げの文言にかっこを使わない。呼び方は「パネル」。ボタンには文字に添えて線画アイコンを付ける。
// 全画面・介助者用メニューの全タブを実際に描画して調べる。利用者が入力した文は対象外(既定の状態で調べる)
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App, { OFFLINE_READY_LABELS, WAKE_LOCK_LABELS } from '../App'
import { buildBehaviorNotes, buildScreenNotes } from '../lib/guidance'
import { SCREEN_GUIDANCE, SCREEN_TITLES, buildMenu, PATIENT_SCREEN_IDS } from '../lib/menus'
import { DEFAULT_PHRASES, phraseProblem } from '../lib/phrases'
import { DEFAULT_SETTINGS } from '../lib/settings'
import { tileIconName } from '../TileIcon'
import indexHtml from '../../index.html?raw'
import manifest from '../../public/manifest.webmanifest?raw'
import {
  chooseRadio,
  openCaregiverMenu,
  selectCaregiverTab,
  setSettings,
  setupApp,
  tap,
  teardownApp,
  tile,
} from './appTestKit'

/** かっこ(丸・波・角・隅付き・亀甲)。かぎ括弧の「」『』は対象外 */
const BRACKETS = /[()（）{}｛｝[\]［］【】〔〕]/
const FORBIDDEN = new RegExp(`${BRACKETS.source}|タイル`)

const TABS = [
  '使用準備',
  'スキャン',
  '音と振動',
  '表示',
  'フレーズ',
  'モールス',
  'データ',
  'このアプリ',
]

/** 画面に出る文字と、読み上げ・吹き出しに使う属性 */
function wordings(root: Element): string[] {
  const out: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    out.push(node.textContent ?? '')
  }
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const name of ['aria-label', 'placeholder', 'alt', 'title']) {
      const value = el.getAttribute(name)
      if (value) out.push(value)
    }
  }
  return out
}

const expectClean = (root: Element, where: string) => {
  const bad = wordings(root).filter((text) => FORBIDDEN.test(text))
  expect(bad, where).toEqual([])
}

/** 文字を持つボタンと、向きの形だけのボタンの両方に、読み上げない線画があること。タブとパンくずは除く */
function expectButtonIcons(root: Element, where: string): string[] {
  const buttons = Array.from(root.querySelectorAll('button')).filter(
    (b) => !b.matches('[role="tab"], .breadcrumb-link'),
  )
  const seen: string[] = []
  for (const b of buttons) {
    const name = b.getAttribute('aria-label') ?? b.textContent?.trim() ?? ''
    const svg = b.querySelector('svg')
    expect(svg, `${where} のボタン「${name}」`).not.toBeNull()
    expect(svg?.getAttribute('aria-hidden'), `${where} のボタン「${name}」`).toBe('true')
    // 絵文字や記号の字形を文字ラベルにしない
    expect(b.textContent, `${where} のボタン「${name}」`).not.toMatch(
      /[↑↓←→✕×＋]|\p{Extended_Pictographic}/u,
    )
    seen.push(name)
  }
  return seen
}

beforeEach(setupApp)
afterEach(teardownApp)

const allOn = {
  morseEnabled: true,
  minHoldMs: 800,
  activateOn: 'release',
  auditoryScan: true,
  voiceMode: 'full',
}

describe('Issue #153: かっこと「タイル」を使わない', () => {
  it('介助者用メニューの全タブ(確認文・警告・案内を含む)', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      id: `c${i}`,
      label: `項目${i}`,
      text: '変です。',
    }))
    setSettings({
      ...allOn,
      morseDashMs: 150,
      phrases: { painLocation: [...many, { id: 'empty', label: '', text: '' }] },
    })
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    for (const tab of TABS) {
      selectCaregiverTab(container, tab)
      if (tab === 'フレーズ') chooseRadio(container, '不快 › 痛い')
      expectClean(container, tab)
      const reset = container.querySelector('.caregiver-reset-button')
      if (reset) {
        fireEvent.click(reset)
        expectClean(container, `${tab} の確認`)
        fireEvent.click(container.querySelector('.caregiver-reset-cancel') as Element)
      }
    }
  })

  it('本人画面(ホーム・下位画面・伝達欄・履歴・緊急・解除・モールス)', () => {
    setSettings({ morseEnabled: true })
    const { container } = render(() => <App />)
    expectClean(container, 'ホーム')
    for (const label of ['快', '不快', '要望', '文字盤']) {
      tap(container, label)
      expectClean(container, label)
      tap(container, '戻る')
    }
    tap(container, 'はい')
    tap(container, 'もう一度')
    expectClean(container, 'もう一度')
    tap(container, '緊急')
    expectClean(container, '緊急')
    tap(container, '苦しい')
    tap(container, '緊急')
    tap(container, '息ができない')
    tap(container, '緊急')
    tap(container, '緊急を解除')
    expectClean(container, '解除の確認')
    tap(container, '解除する')
    expectClean(container, '解除の後')
    fireEvent.click(container.querySelector('[aria-label="前の伝達を表示"]') as Element)
    expectClean(container, '過去の表示')
    tap(container, 'モールス')
    expect(container.querySelector('.morse-panel')).not.toBeNull()
    expectClean(container, 'モールス')
  })

  it('画面に出す定義の文言(全画面の項目・案内・状態・既定フレーズ・編集の理由・HTML とマニフェスト)', () => {
    const texts: string[] = [
      ...Object.values(SCREEN_TITLES),
      ...Object.values(SCREEN_GUIDANCE),
      ...Object.values(WAKE_LOCK_LABELS),
      ...Object.values(OFFLINE_READY_LABELS),
      ...Object.values(DEFAULT_PHRASES).flatMap((list) => list.flatMap((p) => [p.label, p.text])),
      ...buildBehaviorNotes({
        settings: { ...DEFAULT_SETTINGS, ...allOn, activateOn: 'release', voiceMode: 'full' },
      }),
      ...buildScreenNotes({
        emergencyActive: true,
        vibrationAwaitsTouch: true,
        settings: DEFAULT_SETTINGS,
      }),
      ...['戻る', '緊急', ''].map((label) => phraseProblem({ id: 'x', label, text: 'x' }) ?? ''),
    ]
    for (const screen of PATIENT_SCREEN_IDS) {
      for (const item of buildMenu(screen, { morseEnabled: true })) {
        texts.push(item.label, item.preview ?? '')
      }
    }
    expect(texts.filter((t) => FORBIDDEN.test(t))).toEqual([])
    // HTML とマニフェストは、利用者に見える値だけを調べる
    const title = /<title>([^<]*)<\/title>/.exec(indexHtml)?.[1] ?? ''
    const description = /name="description"\s+content="([^"]*)"/.exec(indexHtml)?.[1] ?? ''
    const parsed = JSON.parse(manifest) as { name: string; description: string }
    for (const text of [title, description, parsed.name, parsed.description]) {
      expect(text).not.toBe('')
      expect(text).not.toMatch(FORBIDDEN)
    }
  })
})

describe('Issue #155: ボタンのアイコン', () => {
  it('本人画面と介助者用メニューの全タブの全ボタン(タブとパンくずを除く)に、読み上げない線画がある', () => {
    setSettings({ morseEnabled: true })
    const view = render(() => <App />)
    const { container } = view
    tap(container, 'はい')
    tap(container, 'いいえ')
    fireEvent.click(container.querySelector('[aria-label="前の伝達を表示"]') as Element)
    tap(container, '緊急')
    expectButtonIcons(container, '本人画面')
    openCaregiverMenu(container)
    const names = new Set<string>()
    for (const tab of TABS) {
      selectCaregiverTab(container, tab)
      const reset = container.querySelector('.caregiver-reset-button')
      if (reset) {
        fireEvent.click(reset)
        for (const n of expectButtonIcons(container, `${tab} の確認`)) names.add(n)
        fireEvent.click(container.querySelector('.caregiver-reset-cancel') as Element)
      }
      for (const n of expectButtonIcons(container, tab)) names.add(n)
    }
    // 検査が空振りしていないこと
    for (const name of [
      '緊急を解除',
      '閉じる',
      '上へ',
      '下へ',
      '削除',
      'フレーズを追加',
      '画像を選ぶ',
      '書き出し',
      '取り込み',
      'やめる',
      'もう一度押すと初期値に戻す',
    ]) {
      expect([...names], name).toContain(name)
    }
  })

  it('フレーズの並べ替えと削除は、アイコンに文字を添える', () => {
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    selectCaregiverTab(container, 'フレーズ')
    const row = container.querySelector('.phrase-row-actions') as Element
    expect(Array.from(row.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual([
      '上へ',
      '下へ',
      '削除',
    ])
  })

  it('同じ操作は同じアイコン、別の操作は別のアイコン', () => {
    window.localStorage.setItem('libra:photo', 'data:image/jpeg;base64,AAAA')
    const { container } = render(() => <App />)
    const iconOf = (el: Element) => el.querySelector('svg[data-icon]')?.getAttribute('data-icon')
    tap(container, '緊急')
    // 緊急の詳細の「緊急を解除」パネル
    expect(iconOf(tile(container, '緊急を解除'))).toBe('release')
    tap(container, '緊急を解除')
    expect(iconOf(tile(container, '解除する'))).toBe('release')
    openCaregiverMenu(container)
    expect(iconOf(container.querySelector('.caregiver-emergency-clear') as Element)).toBe('release')
    selectCaregiverTab(container, 'フレーズ')
    expect(iconOf(container.querySelector('button[aria-label="削除"]') as Element)).toBe('delete')
    selectCaregiverTab(container, '表示')
    const remove = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === '画像を消す',
    ) as Element
    expect(iconOf(remove)).toBe('delete')
    cleanup()
  })

  it('決まった操作のパネルだけに付き、フレーズの id が決まった操作と同じでも付かない', () => {
    // 既定の「背中腰」の id は back(戻る と同じ)
    expect(DEFAULT_PHRASES.painLocation.some((p) => p.id === 'back')).toBe(true)
    for (const item of buildMenu('painLocation').slice(2)) {
      expect(tileIconName(item), item.label).toBeNull()
    }
    const phrases = {
      moodRequest: ['yes', 'no', 'back', 'repeat', 'emergency', 'commit'].map((id) => ({
        id,
        label: `項目${id}`,
        text: '文です。',
      })),
    }
    for (const item of buildMenu('requests', { phrases }).slice(2)) {
      expect(tileIconName(item), item.id).toBeNull()
    }
    const letters = buildMenu('letters')
    expect(letters.filter((i) => tileIconName(i)).map((i) => i.label)).toEqual([
      '戻る',
      '緊急',
      '1字消す',
      '確定',
    ])
  })
})
