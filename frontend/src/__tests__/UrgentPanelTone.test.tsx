// Issue #136: 色の付くパネル(.tile-urgent)は「押すと伝達欄が赤くなるパネル」とちょうど一致する。
// 全画面の全パネルを実際に押して、伝達欄の色調(data-message-tone)と照合する。
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { render } from '@solidjs/testing-library'
import App from '../App'
import { PATIENT_SCREEN_IDS, buildMenu, transmissionTone } from '../lib/menus'
import type { ScreenId } from '../lib/menus'
import { DEFAULT_PHRASES, type PhraseSets } from '../lib/phrases'
import { setSettings, setupApp, tap, teardownApp, tile } from './appTestKit'

/** 利用者が追加したフレーズ(編集画面で足すものは tone を持たない)と、取り込みで tone:urgent を持つもの */
const CUSTOM: PhraseSets = {
  discomfort: [
    ...DEFAULT_PHRASES.discomfort,
    { id: 'custom-5', label: '追加の訴え', text: '追加の訴えです。' },
    { id: 'custom-6', label: '急ぎの追加', text: '急ぎです。', tone: 'urgent' },
  ],
  feelings: [{ id: 'custom-1', label: '追加の気分', text: '気分です。', tone: 'urgent' }],
  painLocation: [
    ...DEFAULT_PHRASES.painLocation,
    { id: 'custom-7', label: '首', text: '首が痛いです。' },
  ],
}

/** ホームからその画面へ行くまでに押すラベル(痛みの強さは場所ごと) */
const ROUTES: { path: string[]; urgent: string[] }[] = [
  { path: [], urgent: [] },
  { path: ['不快'], urgent: ['苦しい', '急ぎの追加'] },
  { path: ['不快', 'その他'], urgent: [] },
  { path: ['不快', '痛い'], urgent: [] },
  { path: ['不快', '痛い', '頭'], urgent: ['とても'] },
  { path: ['不快', '痛い', '胸'], urgent: ['場所だけ', '少し', 'かなり', 'とても'] },
  { path: ['不快', '痛い', '首'], urgent: ['とても'] },
  { path: ['快'], urgent: [] },
  { path: ['快', '気分'], urgent: ['追加の気分'] },
  { path: ['要望'], urgent: [] },
  { path: ['文字盤'], urgent: [] },
  { path: ['文字盤', 'あ行'], urgent: [] },
  { path: ['緊急'], urgent: [] },
  { path: ['緊急', '緊急を解除'], urgent: [] },
]

describe('Issue #136: 色の付くパネルと伝達欄の色は同じ tone の指定から決まる', () => {
  beforeEach(setupApp)
  afterEach(teardownApp)

  const open = (path: string[]) => {
    window.localStorage.clear()
    delete document.documentElement.dataset.messageTone
    setSettings({ intervalMs: 600000, phrases: CUSTOM })
    const view = render(() => <App />)
    for (const label of path) tap(view.container, label)
    return view
  }
  const labels = (c: HTMLElement, selector: string) =>
    Array.from(c.querySelectorAll(`.grid-board ${selector} .tile-label`)).map(
      (el) => el.textContent ?? '',
    )

  for (const { path, urgent } of ROUTES) {
    it(`${path.join(' → ') || 'ホーム'}: 色の付くパネルは [${urgent.join('・')}]`, () => {
      const view = open(path)
      expect(labels(view.container, '.tile-urgent')).toEqual(urgent)
    })

    it(`${path.join(' → ') || 'ホーム'}: 各パネルを押して伝達欄が赤くなるのは、色の付くパネルだけ`, () => {
      const first = open(path)
      const all = labels(first.container, '.tile')
      first.unmount()
      expect(all.length).toBeGreaterThan(0)
      for (const label of all) {
        const view = open(path)
        const colored = tile(view.container, label).classList.contains('tile-urgent')
        tap(view.container, label)
        expect(document.documentElement.dataset.messageTone === 'urgent', label).toBe(colored)
        view.unmount()
      }
    })
  }

  it('緊急中でも、色の付くパネルを押すと伝達欄が赤くなる', () => {
    const view = open(['緊急', '戻る', '不快'])
    expect(labels(view.container, '.tile-urgent')).toEqual(['苦しい', '急ぎの追加'])
    tap(view.container, '苦しい')
    expect(document.documentElement.dataset.messageTone).toBe('urgent')
  })

  it('transmissionTone が urgent になるのは伝える項目(message)だけ(全画面のメニュー定義)', () => {
    for (const screen of PATIENT_SCREEN_IDS as ScreenId[]) {
      const items = buildMenu(screen, {
        morseEnabled: true,
        phrases: CUSTOM,
        pain: { label: '胸', text: '胸が痛いです。', tone: 'urgent' },
      })
      for (const item of items) {
        if (transmissionTone(item.action) === 'urgent') {
          expect(item.action.type, `${screen} ${item.label}`).toBe('message')
        }
      }
    }
  })
})
