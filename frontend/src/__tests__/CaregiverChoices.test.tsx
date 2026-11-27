// Issue #144・#145・#148: 介助者用メニューの値の選択(ラジオ)と、フレーズの編集先の一覧。
// 1 段に並ぶこと・高さ・文字の大きさは実寸なので e2e(layout.e2e.mjs の caregiver-choices)で測る。
//
// 観点
//   値の欄       | 5 欄すべてラジオ(ボタンではない)。名前と順番・今の値がチェックされる・選ぶと保存・グループ名
//   打鍵         | ラジオ・チェックボックス(フレーズの編集先を含む)にフォーカスが残っていても、どのキーも
//                | 本人のスイッチ: 既定の動作を止めて閉じ、値は変わらない。スライダーは矢印だけ閉じない
//   押しっぱなし | repeat: true の打鍵も同じ扱い(既定の動作を止めて閉じる)。2 回押しの確認を通さない。
//                | 本人画面のリピートは何も実行せず、既定の動作も止める。例外の部品のリピートは保つ
//   実行する操作 | 画像を選ぶ・消すはボタンのまま
//   編集先       | パネルの階層と順・快は選べない・読み上げ名は道順・選ぶと一覧が替わる・警告と初期値に戻すも道順
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import { DEFAULT_PHRASES, PHRASE_GROUPS, PHRASE_GROUP_LABELS } from '../lib/phrases'
import {
  chooseRadio,
  menuOpen,
  openCaregiverMenu,
  radioByName,
  selectCaregiverTab,
  setSettings,
  setupApp,
  teardownApp,
} from './appTestKit'

const FIELDS = [
  {
    tab: 'スキャン',
    label: '決定のタイミング',
    options: ['押した瞬間', '離した瞬間'],
    initial: '押した瞬間',
    pick: '離した瞬間',
    key: 'activateOn',
    saved: 'release',
  },
  {
    tab: '音と振動',
    label: '伝えた内容を読み上げる音声モード',
    options: ['OFF', '効果音だけ', '短く読む', '全部読む'],
    initial: 'OFF',
    pick: '短く読む',
    key: 'voiceMode',
    saved: 'short',
  },
  {
    tab: '音と振動',
    label: '振動の強さ',
    options: ['弱', '標準', '強'],
    initial: '標準',
    pick: '強',
    key: 'hapticsStrength',
    saved: 'strong',
  },
  {
    tab: '表示',
    label: 'パネルの文字サイズ',
    options: ['標準', '大', '特大'],
    initial: '標準',
    pick: '大',
    key: 'fontSize',
    saved: 'large',
  },
  {
    tab: '表示',
    label: '明るさ',
    options: ['ライト', 'ダーク', 'OSの設定'],
    initial: 'OSの設定',
    pick: 'ダーク',
    key: 'theme',
    saved: 'dark',
  },
]

const saved = () => JSON.parse(window.localStorage.getItem('libra') ?? '{}')

function openTab(tab: string) {
  const view = render(() => <App />)
  openCaregiverMenu(view.container)
  const panel = selectCaregiverTab(view.container, tab)
  return { ...view, panel }
}

const radioGroup = (root: Element, label: string): HTMLElement => {
  const found = Array.from(root.querySelectorAll<HTMLElement>('[role="radiogroup"]')).find(
    (g) => document.getElementById(g.getAttribute('aria-labelledby') ?? '')?.textContent === label,
  )
  expect(found, `ラジオの組「${label}」`).toBeTruthy()
  return found as HTMLElement
}

beforeEach(() => {
  setupApp()
  setSettings({ hapticsEnabled: true })
})
afterEach(teardownApp)

describe('Issue #148: 値を選ぶ欄はラジオボタン', () => {
  it.each(FIELDS)('$label: 名前と順番、今の値の選択、選んだ値の保存', (field) => {
    const { panel } = openTab(field.tab)
    const group = radioGroup(panel, field.label)
    const radios = Array.from(group.querySelectorAll<HTMLInputElement>('input[type="radio"]'))
    expect(radios.map((r) => r.closest('label')?.textContent)).toEqual(field.options)
    expect(new Set(radios.map((r) => r.name)).size).toBe(1)
    expect(group.querySelector('button')).toBeNull()
    const checked = () =>
      radios.filter((r) => r.checked).map((r) => r.closest('label')?.textContent)
    expect(checked()).toEqual([field.initial])
    chooseRadio(group, field.pick)
    expect(checked()).toEqual([field.pick])
    expect(saved()[field.key]).toBe(field.saved)
  })

  it('同じタブの別の組は、別の name を持つ(片方を選んでももう片方は外れない)', () => {
    const { panel } = openTab('音と振動')
    chooseRadio(radioGroup(panel, '伝えた内容を読み上げる音声モード'), '全部読む')
    chooseRadio(radioGroup(panel, '振動の強さ'), '弱')
    expect(panel.querySelectorAll('input[type="radio"]:checked')).toHaveLength(2)
  })

  it('初期値に戻すと、ラジオの選択も戻る', () => {
    const { panel } = openTab('表示')
    chooseRadio(panel, 'ダーク')
    const reset = panel.querySelector('.caregiver-reset-button') as HTMLElement
    fireEvent.click(reset)
    fireEvent.click(reset)
    expect(radioByName(panel, 'OSの設定').checked).toBe(true)
  })

  // 安全: 介助者がラジオを押すとフォーカスが残る。そのまま本人が矢印キー型などのスイッチを押しても、
  // 値を変えずにメニューを閉じる(requirements.md §6)
  const SWITCH_KEYS = [
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
    'a',
    'Backspace',
    'Enter',
    ' ',
    'Tab',
    'AudioVolumeUp',
    'Escape',
  ]

  it.each(SWITCH_KEYS)(
    'ラジオにフォーカスが残っていて「%s」を押すと、閉じて、値は変わらない',
    (key) => {
      const { container, panel } = openTab('音と振動')
      chooseRadio(panel, '全部読む')
      const radio = radioByName(panel, '全部読む')
      radio.focus()
      expect(fireEvent.keyDown(radio, { key })).toBe(false) // 既定の動作(値の移動・選択)を止める
      expect(menuOpen(container)).toBe(false)
      expect(saved().voiceMode).toBe('full')
    },
  )

  it.each(SWITCH_KEYS)('フレーズの編集先にフォーカスが残っていて「%s」を押すと、閉じる', (key) => {
    const { container, panel } = openTab('フレーズ')
    const radio = radioByName(panel, '不快')
    radio.focus()
    expect(fireEvent.keyDown(radio, { key })).toBe(false)
    expect(menuOpen(container)).toBe(false)
  })

  it.each(SWITCH_KEYS)(
    'チェックボックスにフォーカスが残っていて「%s」を押すと、閉じて、値は変わらない',
    (key) => {
      const { container, panel } = openTab('音と振動')
      const checkbox = panel.querySelector('input[type="checkbox"]') as HTMLInputElement
      checkbox.focus()
      expect(fireEvent.keyDown(checkbox, { key })).toBe(false)
      expect(menuOpen(container)).toBe(false)
      expect(saved().hapticsEnabled).toBe(true)
    },
  )

  it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])(
    'スライダーの矢印キー「%s」は、閉じず、既定の動作(値の調整)を止めない',
    (key) => {
      const { container, panel } = openTab('スキャン')
      const slider = panel.querySelector('input[type="range"]') as HTMLInputElement
      slider.focus()
      expect(fireEvent.keyDown(slider, { key })).toBe(true)
      expect(menuOpen(container)).toBe(true)
    },
  )

  it.each(['a', 'Backspace', 'Home', 'End', 'Enter', ' ', 'AudioVolumeUp'])(
    'スライダーでも、矢印キー以外の「%s」は本人のスイッチとして閉じる',
    (key) => {
      const { container, panel } = openTab('スキャン')
      const slider = panel.querySelector('input[type="range"]') as HTMLInputElement
      slider.focus()
      expect(fireEvent.keyDown(slider, { key })).toBe(false)
      expect(menuOpen(container)).toBe(false)
    },
  )

  it.each(['a', 'Backspace', 'ArrowLeft', 'Home', 'End'])(
    '設定データの textarea の「%s」は、文字の入力・編集なので閉じない',
    (key) => {
      const { container, panel } = openTab('データ')
      const area = panel.querySelector('textarea') as HTMLTextAreaElement
      area.focus()
      expect(fireEvent.keyDown(area, { key })).toBe(true)
      expect(menuOpen(container)).toBe(true)
    },
  )

  // 安全: 押しっぱなしのスイッチのリピートを素通しにすると、ブラウザの既定の動作で値が変わり、
  // フォーカスしたボタンが何度も実行される。jsdom は既定の動作を起こさないので、止めたこと
  // (preventDefault)と閉じたことを確かめる。実際のボタンの実行は実ブラウザ(e2e の caregiver-key-repeat)
  const pressRepeat = (el: Element, key: string) => fireEvent.keyDown(el, { key, repeat: true })

  it.each(SWITCH_KEYS)(
    'ラジオ上のリピート「%s」は、既定の動作を止めて閉じ、値は変わらない',
    (key) => {
      const { container, panel } = openTab('音と振動')
      chooseRadio(panel, '全部読む')
      const radio = radioByName(panel, '全部読む')
      radio.focus()
      expect(pressRepeat(radio, key)).toBe(false)
      expect(menuOpen(container)).toBe(false)
      expect(saved().voiceMode).toBe('full')
    },
  )

  it.each(['Enter', ' ', 'ArrowRight', 'a'])(
    '「初期値に戻す」の確認中のリピート「%s」は、ボタンの実行を止めて閉じる',
    (key) => {
      setSettings({ intervalMs: 5000 })
      const { container, panel } = openTab('スキャン')
      const reset = panel.querySelector('.caregiver-reset-button') as HTMLElement
      fireEvent.click(reset)
      reset.focus()
      expect(pressRepeat(reset, key)).toBe(false)
      expect(menuOpen(container)).toBe(false)
      expect(saved().intervalMs).toBe(5000)
    },
  )

  it.each(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])(
    'スライダーの矢印「%s」の押しっぱなしは、これまでどおり閉じず、調整を止めない',
    (key) => {
      const { container, panel } = openTab('スキャン')
      const slider = panel.querySelector('input[type="range"]') as HTMLInputElement
      expect(pressRepeat(slider, key)).toBe(true)
      expect(menuOpen(container)).toBe(true)
    },
  )

  it.each(['a', 'Backspace', 'ArrowLeft'])(
    '文字を入力する欄の「%s」の押しっぱなしは、閉じず、入力を止めない',
    (key) => {
      const { container, panel } = openTab('データ')
      const area = panel.querySelector('textarea') as HTMLTextAreaElement
      expect(pressRepeat(area, key)).toBe(true)
      expect(menuOpen(container)).toBe(true)
    },
  )

  it('タブ上の矢印の押しっぱなしは、これまでどおりタブを移り、閉じない', () => {
    const { container } = openTab('使用準備')
    const selected = () => container.querySelector('[role="tab"][aria-selected="true"]') as Element
    pressRepeat(selected(), 'ArrowRight')
    pressRepeat(selected(), 'ArrowRight')
    expect(selected().textContent).toBe('音と振動')
    expect(menuOpen(container)).toBe(true)
  })

  it.each(['Enter', ' '])(
    '本人画面の「介助者用」上のリピート「%s」は、ボタンの実行を止め、何も開かず何も選ばない',
    (key) => {
      const { container } = render(() => <App />)
      const button = container.querySelector('.caregiver-button') as HTMLElement
      button.focus()
      expect(pressRepeat(button, key)).toBe(false)
      expect(menuOpen(container)).toBe(false)
      expect(container.querySelector('.emergency-status')).toBeNull()
      // 最初の打鍵は、これまでどおりボタンの標準の実行に任せる
      expect(fireEvent.keyDown(button, { key })).toBe(true)
    },
  )

  it('画像を選ぶのは実行する操作なので、ボタンのまま', () => {
    const { panel } = openTab('表示')
    const choose = Array.from(panel.querySelectorAll('button')).find(
      (b) => b.textContent === '画像を選ぶ',
    )
    expect(choose?.classList.contains('caregiver-action')).toBe(true)
  })
})

describe('Issue #145: フレーズの編集先', () => {
  const editor = (c: HTMLElement) => c.querySelector('.phrase-editor') as HTMLElement
  const target = (c: HTMLElement) => editor(c).querySelector('[role="radiogroup"]') as HTMLElement
  /** 一覧を [深さ, 名前, 選べるか] にする */
  const rows = (list: Element, depth = 0): [number, string, boolean][] =>
    Array.from(list.children).flatMap((li) => {
      const own = li.firstElementChild as HTMLElement
      const child = li.querySelector(':scope > ul')
      return [
        [depth, own.textContent ?? '', own.querySelector('input') !== null] as [
          number,
          string,
          boolean,
        ],
        ...(child ? rows(child, depth + 1) : []),
      ]
    })

  it('ドロップダウンでもボタンでもなく、パネルの階層を字下げした一覧(順はパネルの並び)', () => {
    const { container } = openTab('フレーズ')
    expect(editor(container).querySelector('select')).toBeNull()
    expect(target(container).querySelector('button')).toBeNull()
    expect(rows(target(container).querySelector('ul') as Element)).toEqual([
      [0, '快', false],
      [1, '気分', true],
      [0, '不快', true],
      [1, '痛い', true],
      [1, 'その他', true],
      [0, '要望', true],
    ])
  })

  it('読み上げ名はホームからの道順で、順番は PHRASE_GROUPS と同じ。見える名前を含む', () => {
    const { container } = openTab('フレーズ')
    const radios = Array.from(target(container).querySelectorAll<HTMLInputElement>('input'))
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
      '快 › 気分',
      '不快',
      '不快 › 痛い',
      '不快 › その他',
      '要望',
    ])
    expect(radios.map((r) => r.value)).toEqual(PHRASE_GROUPS)
    for (const r of radios) {
      expect(r.getAttribute('aria-label')).toContain(r.closest('label')?.textContent)
    }
  })

  it('選ぶと、その画面のフレーズが並ぶ', () => {
    const { container } = openTab('フレーズ')
    for (const group of PHRASE_GROUPS) {
      chooseRadio(target(container), PHRASE_GROUP_LABELS[group])
      expect(
        Array.from(
          editor(container).querySelectorAll<HTMLInputElement>(
            '.phrase-row label:first-child input',
          ),
        ).map((i) => i.value),
        group,
      ).toEqual(DEFAULT_PHRASES[group].map((p) => p.label))
    }
  })

  it('項目数の警告と、初期値に戻すの確認も同じ名前を使う', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, label: `L${i}`, text: 'x' }))
    setSettings({ phrases: { feelings: many, painLocation: many } })
    const { container } = openTab('フレーズ')
    const warning = editor(container).querySelector('[role="alert"]')?.textContent ?? ''
    expect(warning).toContain('快 › 気分は 11 項目')
    expect(warning).toContain('不快 › 痛いは 11 項目')
    const reset = container.querySelector('.caregiver-reset-button') as HTMLElement
    fireEvent.click(reset)
    expect(container.querySelector('.caregiver-reset')?.textContent).toContain(
      '対象は快 › 気分、不快、不快 › 痛い、不快 › その他、要望のフレーズです。',
    )
  })
})
