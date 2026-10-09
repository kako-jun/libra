// Issue #58/#79: 常時案内(.screen-notes / .caregiver-notes / 状態タブの「いまの動作」)の App 結合テスト。
// 文言と条件の表引きは lib/__tests__/guidance.test.ts。ここは「実際の状態遷移・設定変更・
// DOM 上の場所」に案内が追従すること(隠せない・場所固定)を確認する。
//
// デシジョンテーブル(App 結合):
//   操作/状態                         | 観測
//   起動直後(既定)・通常時の全画面    | .screen-notes は DOM に無い(帯の高さ0)
//   緊急開始(urgentDetail)            | .screen-notes に振動案内だけ → 解除で帯ごと消える
//   緊急復元+振動ON                   | 再起動後の振動注意 → 画面に触れると消える
//   緊急復元+振動OFF                  | 帯ごと出ない
//   介助者メニュー「状態」タブ         | 「いまの動作」が現在の設定値に追従(連打無視・押し方・読み上げ割り込み)
//   介助者メニュー表示中              | .caregiver-notes が常に出る(タブを替えても残る)
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import * as offlineReadyModule from '../lib/offlineReady'
import { DEFAULT_SETTINGS } from '../lib/settings'

const HEAD_HOLD_MS = 3000
const INTERVAL_MS = 1500

class MockAudioContext {
  state: 'running' | 'suspended' = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  createOscillator() {
    return {
      type: '',
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    }
  }
  createGain() {
    return {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    }
  }
}

const VIBRATION_FRAGMENT = '3秒ごとに振動'
const AWAIT_TOUCH = '再起動後は、画面に触れるかキーを押すまで振動しません。'
const AUDITORY_FRAGMENT = '伝達の読み上げは、直後の1項目分は割り込まれません'
const SCREEN_CHANGE = '押下中に画面や項目の並びが変わると無効'

function tileLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.tile-label')).map((el) => el.textContent ?? '')
}
function scanningLabel(container: HTMLElement): string | null {
  return container.querySelector('.tile.scanning .tile-label')?.textContent ?? null
}
function selectByLabel(container: HTMLElement, label: string) {
  for (let i = 0; i < 40 && scanningLabel(container) !== label; i += 1) {
    vi.advanceTimersByTime(INTERVAL_MS)
  }
  expect(scanningLabel(container)).toBe(label)
  vi.advanceTimersByTime(600)
  fireEvent.keyDown(window, { key: ' ' })
}
function screenNotes(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.screen-notes li')).map(
    (li) => li.textContent ?? '',
  )
}
function notesText(container: HTMLElement): string {
  return screenNotes(container).join('\n')
}
/** 介助者メニュー「状態」タブの「いまの動作」(メニューを開いて状態タブを選んで読む) */
function behaviorNotes(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.caregiver-behavior li')).map(
    (li) => li.textContent ?? '',
  )
}
function caregiverNotes(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.caregiver-notes li')).map(
    (li) => li.textContent ?? '',
  )
}
function openCaregiverMenu(container: HTMLElement) {
  fireEvent.click(container.querySelector('.caregiver-button') as HTMLElement)
}
function closeCaregiverMenu(container: HTMLElement) {
  const close = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === '閉じる',
  ) as HTMLElement
  fireEvent.click(close)
}
function selectCaregiverTab(container: HTMLElement, label: string) {
  const tab = Array.from(container.querySelectorAll('[role="tab"]')).find(
    (t) => t.textContent === label,
  ) as HTMLElement
  expect(tab).toBeTruthy()
  fireEvent.click(tab)
}
function setSlider(container: HTMLElement, labelStart: string, value: number) {
  const field = Array.from(container.querySelectorAll('label.caregiver-field')).find((l) =>
    l.textContent?.startsWith(labelStart),
  )
  const input = field?.querySelector('input[type="range"]') as HTMLInputElement
  expect(input).toBeTruthy()
  fireEvent.input(input, { target: { value: String(value) } })
}
function clickButtonText(container: HTMLElement, text: string) {
  const b = Array.from(container.querySelectorAll('button')).find((x) => x.textContent === text)
  expect(b).toBeTruthy()
  fireEvent.click(b as HTMLElement)
}
function withSettings(settings: Record<string, unknown>) {
  window.localStorage.setItem('libra', JSON.stringify(settings))
}
/** 設定→閉じる(閉じるとスキャンがホーム先頭から再開する) */
function changeSettingsViaMenu(container: HTMLElement, change: () => void) {
  openCaregiverMenu(container)
  change()
  closeCaregiverMenu(container)
}
/** メニューを開いて状態タブの「いまの動作」を読み、閉じる */
function readBehavior(container: HTMLElement): string {
  openCaregiverMenu(container)
  selectCaregiverTab(container, '状態')
  const text = behaviorNotes(container).join('\n')
  closeCaregiverMenu(container)
  return text
}

describe('Issue #58: 常時案内(App 結合)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    window.localStorage.clear()
    ;(window as unknown as { AudioContext?: unknown }).AudioContext = MockAudioContext
    ;(navigator as unknown as { vibrate?: unknown }).vibrate = vi.fn()
    ;(window as unknown as { speechSynthesis?: unknown }).speechSynthesis = {
      cancel: vi.fn(),
      speak: vi.fn(),
    }
    ;(globalThis as unknown as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance =
      class {
        lang = ''
        rate = 1
        pitch = 1
        constructor(public text: string) {}
      }
    vi.spyOn(offlineReadyModule, 'recheckOfflineReady').mockResolvedValue(undefined)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  describe('通常時は帯を出さない', () => {
    it('起動直後(既定)のホームに .screen-notes は無い(連打無視・先頭待機の案内も本人画面に出さない)', () => {
      const { container } = render(() => <App />)
      expect(container.querySelector('.screen-notes')).toBeNull()
    })

    it('伝達直後(取り消し猶予中)・下位画面・文字盤でも .screen-notes は無い', () => {
      const { container } = render(() => <App />)
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      fireEvent.keyDown(window, { key: ' ' }) // はい → home(取り消し)
      expect(tileLabels(container)).toContain('取り消し')
      expect(container.querySelector('.screen-notes')).toBeNull()
      selectByLabel(container, '文字盤')
      expect(container.querySelector('.screen-notes')).toBeNull()
    })

    it('設定を変えても(連打無視・押し方・聴覚スキャン)通常時は .screen-notes が無い', () => {
      withSettings({
        debounceMs: 800,
        minHoldMs: 800,
        activateOn: 'release',
        auditoryScan: true,
        voiceMode: 'short',
      })
      const { container } = render(() => <App />)
      expect(container.querySelector('.screen-notes')).toBeNull()
    })
  })

  describe('緊急の案内', () => {
    function clearEmergencyViaMenu(container: HTMLElement) {
      openCaregiverMenu(container)
      const clear = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('緊急解除'),
      ) as HTMLElement
      fireEvent.click(clear)
      closeCaregiverMenu(container)
    }

    it('緊急開始で振動の案内が出て、解除で消える', () => {
      const { container } = render(() => <App />)
      expect(notesText(container)).not.toContain(VIBRATION_FRAGMENT)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急(urgentDetail へ)
      expect(notesText(container)).toContain(VIBRATION_FRAGMENT)
      clearEmergencyViaMenu(container)
      expect(container.querySelector('.screen-notes')).toBeNull()
    })

    it('緊急中のホームでも出るのは振動の1行だけ(取り消しなし・押し方・先頭待機は書かない)。解除で帯ごと消える', () => {
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      fireEvent.keyDown(window, { key: ' ' }) // 戻る → home
      expect(screenNotes(container)).toHaveLength(1)
      expect(notesText(container)).toContain(VIBRATION_FRAGMENT)
      expect(notesText(container)).not.toContain('取り消し')
      clearEmergencyViaMenu(container)
      expect(container.querySelector('.screen-notes')).toBeNull()
    })

    it('振動OFFなら緊急中でも振動の案内は出ない', () => {
      withSettings({ hapticsEnabled: false })
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' })
      expect(container.querySelector('.screen-notes')).toBeNull()
    })

    it('緊急復元かつ振動ONでだけ再起動後の注意が出て、画面に触れると消える', () => {
      window.localStorage.setItem(
        'libra:emergency',
        JSON.stringify({ active: true, details: [], sub: null }),
      )
      const { container } = render(() => <App />)
      expect(notesText(container)).toContain(VIBRATION_FRAGMENT)
      expect(notesText(container)).toContain(AWAIT_TOUCH)
      fireEvent.pointerDown(document.body)
      vi.advanceTimersByTime(1) // 解除はブラウザの操作判定(次のタスク)に合わせる
      expect(notesText(container)).not.toContain(AWAIT_TOUCH)
      expect(notesText(container)).toContain(VIBRATION_FRAGMENT) // 振動の案内は緊急中は残る
    })

    it('緊急復元でもキー入力で触れた扱いになり、注意が消える', () => {
      window.localStorage.setItem(
        'libra:emergency',
        JSON.stringify({ active: true, details: [], sub: null }),
      )
      const { container } = render(() => <App />)
      expect(notesText(container)).toContain(AWAIT_TOUCH)
      fireEvent.keyDown(window, { key: 'a' })
      vi.advanceTimersByTime(1)
      expect(notesText(container)).not.toContain(AWAIT_TOUCH)
    })

    it('緊急復元でも振動OFFなら振動案内も再起動後の注意も出ない', () => {
      withSettings({ hapticsEnabled: false })
      window.localStorage.setItem(
        'libra:emergency',
        JSON.stringify({ active: true, details: [], sub: null }),
      )
      const { container } = render(() => <App />)
      expect(container.querySelector('.screen-notes')).toBeNull()
    })

    it('緊急でない通常起動では再起動後の注意は出ない', () => {
      const { container } = render(() => <App />)
      expect(container.querySelector('.screen-notes')).toBeNull()
    })
  })

  describe('設定への追従(状態タブの「いまの動作」)', () => {
    it('保存済み設定で起動すると、押し方の文言がその値になる(先頭待機は書かない)', () => {
      withSettings({
        debounceMs: 0,
        minHoldMs: 800,
        activateOn: 'release',
        intervalMs: 2000,
        headHoldMultiplier: 3,
      })
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      selectCaregiverTab(container, '状態')
      expect(behaviorNotes(container)).toEqual([
        `0.8秒以上押し続けて離すと決まります（短押しは数えません。${SCREEN_CHANGE}）。`,
      ])
    })

    it('既定では連打無視の行だけが読める。見出しは「いまの動作」', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      selectCaregiverTab(container, '状態')
      expect(behaviorNotes(container)).toEqual([
        '0.5秒以内の連打は数えません（画面遷移直後も。誤作動防止）。',
      ])
      const titles = Array.from(container.querySelectorAll('.caregiver-section-title')).map(
        (el) => el.textContent,
      )
      expect(titles).toContain('いまの動作')
    })

    it('他のタブには「いまの動作」は出ない(状態タブのパネル内だけ)', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      selectCaregiverTab(container, 'スキャン')
      expect(container.querySelector('.caregiver-behavior')).toBeNull()
    })

    it('連打無視を 0 にし、他の設定も無ければ「いまの動作」の節ごと消える', () => {
      const { container } = render(() => <App />)
      expect(readBehavior(container)).toContain('連打は数えません')
      changeSettingsViaMenu(container, () => {
        selectCaregiverTab(container, 'スキャン')
        setSlider(container, '連打無視', 0)
      })
      expect(readBehavior(container)).toBe('')
      openCaregiverMenu(container)
      selectCaregiverTab(container, '状態')
      expect(container.querySelector('.caregiver-behavior')).toBeNull()
    })

    it('押下時間の下限・決定のタイミングを変えると、押し方の行が追従する', () => {
      const { container } = render(() => <App />)
      expect(readBehavior(container)).not.toContain('押し続け')
      changeSettingsViaMenu(container, () => {
        selectCaregiverTab(container, 'スキャン')
        setSlider(container, '押下時間の下限', 700)
      })
      expect(readBehavior(container)).toContain(
        `0.7秒以上押し続けると決まります（短押しは数えません。${SCREEN_CHANGE}）。`,
      )
      changeSettingsViaMenu(container, () => {
        selectCaregiverTab(container, 'スキャン')
        clickButtonText(container, '離した瞬間')
      })
      expect(readBehavior(container)).toContain(
        `0.7秒以上押し続けて離すと決まります（短押しは数えません。${SCREEN_CHANGE}）。`,
      )
      changeSettingsViaMenu(container, () => {
        selectCaregiverTab(container, 'スキャン')
        setSlider(container, '押下時間の下限', 0)
      })
      expect(readBehavior(container)).toContain(
        `押して離すと決まります（押した瞬間は決まりません。${SCREEN_CHANGE}）。`,
      )
    })

    it('スキャン間隔と先頭待機倍率を変えても先頭待機の文言はどこにも出ない', () => {
      const { container } = render(() => <App />)
      changeSettingsViaMenu(container, () => {
        selectCaregiverTab(container, 'スキャン')
        setSlider(container, 'スキャン間隔', 2000)
        setSlider(container, '先頭待機倍率', 2.5)
      })
      expect(readBehavior(container)).not.toContain('先頭')
      expect(container.querySelector('.screen-notes')).toBeNull()
    })

    it('聴覚スキャンを ON にしたときだけ読み上げ割り込み抑止の案内が出る(音声モードが読み上げのとき)', () => {
      withSettings({ voiceMode: 'short' })
      const { container } = render(() => <App />)
      expect(readBehavior(container)).not.toContain(AUDITORY_FRAGMENT)
      openCaregiverMenu(container)
      selectCaregiverTab(container, '入力方式')
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
      fireEvent.click(checkbox)
      closeCaregiverMenu(container)
      expect(readBehavior(container)).toContain(AUDITORY_FRAGMENT)
      openCaregiverMenu(container)
      selectCaregiverTab(container, '入力方式')
      fireEvent.click(container.querySelector('input[type="checkbox"]') as HTMLInputElement)
      closeCaregiverMenu(container)
      expect(readBehavior(container)).not.toContain(AUDITORY_FRAGMENT)
    })

    it('音声モードが OFF のままなら、聴覚スキャン ON でも読み上げ割り込み抑止の案内は出ない', () => {
      withSettings({ auditoryScan: true, voiceMode: 'off' })
      const { container } = render(() => <App />)
      expect(readBehavior(container)).not.toContain(AUDITORY_FRAGMENT)
    })

    it('タブを切り替えても外枠(パネル・ヘッダ・タブ列)の親子関係は変わらない', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      const panel = container.querySelector('.caregiver-panel') as HTMLElement
      const children = () =>
        Array.from(panel.children).map((el) => el.className.toString().split(' ')[0])
      selectCaregiverTab(container, '状態')
      const before = children()
      for (const label of ['スキャン', '状態', '入力方式', '状態']) {
        selectCaregiverTab(container, label)
        expect(children()).toEqual(before)
      }
    })

    it('振動をメニューで OFF にすると、緊急中の振動案内が帯ごと消える', () => {
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急
      expect(notesText(container)).toContain(VIBRATION_FRAGMENT)
      openCaregiverMenu(container)
      selectCaregiverTab(container, 'フィードバック')
      const checkbox = Array.from(container.querySelectorAll('label.caregiver-checkbox')).find(
        (l) => l.textContent?.includes('本人への振動フィードバック'),
      )?.firstElementChild as HTMLInputElement
      fireEvent.click(checkbox)
      closeCaregiverMenu(container)
      expect(container.querySelector('.screen-notes')).toBeNull()
    })
  })

  describe('場所の固定と隠せないこと', () => {
    it('モールス画面(通常)には .screen-notes が無く、モールス凡例は従来どおり出る', () => {
      withSettings({ morseEnabled: true })
      const { container } = render(() => <App />)
      selectByLabel(container, 'モールス')
      expect(container.querySelector('.morse-panel')).not.toBeNull()
      expect(container.querySelector('.screen-notes')).toBeNull()
      const legend = container.querySelector('.morse-legend')
      expect(legend).not.toBeNull()
      expect(legend?.textContent).toContain('短く押す')
    })

    it('モールス画面でも緊急中は振動の案内だけ出る', () => {
      withSettings({ morseEnabled: true })
      window.localStorage.setItem(
        'libra:emergency',
        JSON.stringify({ active: true, details: [], sub: null }),
      )
      const { container } = render(() => <App />)
      selectByLabel(container, 'モールス')
      vi.advanceTimersByTime(1)
      expect(container.querySelector('.morse-panel')).not.toBeNull()
      expect(container.querySelector('.emergency-status')).not.toBeNull()
      const notes = screenNotes(container)
      // モールスへ入るキー操作で「触れた」扱いなので注意は消え、振動だけ
      expect(notes).toHaveLength(1)
      expect(notes[0]).toContain(VIBRATION_FRAGMENT)
    })

    it('.screen-notes は(緊急中)本人画面で同じ親(app-shell)・盤面の直後・aria-label付きに出る', () => {
      withSettings({ morseEnabled: true })
      window.localStorage.setItem(
        'libra:emergency',
        JSON.stringify({ active: true, details: [], sub: null }),
      )
      const { container } = render(() => <App />)
      const shell = container.querySelector('main.app-shell') as HTMLElement
      const placement = () => {
        const el = container.querySelector('.screen-notes') as HTMLElement | null
        if (!el) return null
        return {
          parentIsShell: el.parentElement === shell,
          afterBoard: el.previousElementSibling?.classList.contains('grid-board') ?? false,
          tag: el.tagName,
          label: el.getAttribute('aria-label'),
        }
      }
      const expected = {
        parentIsShell: true,
        afterBoard: true,
        tag: 'SECTION',
        label: '操作と自動で起きること',
      }
      expect(placement()).toEqual(expected) // home
      selectByLabel(container, '文字盤') // letters
      expect(placement()).toEqual(expected)
      selectByLabel(container, '戻る') // home へ
      expect(placement()).toEqual(expected)
    })

    it('設定項目にも画面にも、案内を隠す・切り替える操作が無い', () => {
      expect(Object.keys(DEFAULT_SETTINGS).filter((k) => /guid|note|hint|案内/i.test(k))).toEqual(
        [],
      )
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[]
      for (const tab of tabs) {
        fireEvent.click(tab)
        const controls = Array.from(
          container.querySelectorAll('.caregiver-panel label, .caregiver-panel button'),
        ).map((el) => el.textContent ?? '')
        for (const text of controls) {
          expect(text).not.toMatch(/案内.*(非表示|隠|表示)|(非表示|隠す).*案内/)
        }
      }
      // 画面側にも閉じる/隠すボタンは無い
      closeCaregiverMenu(container)
      expect(container.querySelector('.screen-notes button')).toBeNull()
    })

    it('案内に絵文字が含まれない(画面・介助者メニュー)', () => {
      const emoji = /\p{Extended_Pictographic}/u
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急で行を増やす
      expect(emoji.test(notesText(container))).toBe(false)
      openCaregiverMenu(container)
      expect(emoji.test(caregiverNotes(container).join(''))).toBe(false)
      expect(emoji.test(behaviorNotes(container).join(''))).toBe(false)
    })

    it('既存の .screen-guide は壊れておらず、常時案内の文言を含まない', () => {
      const { container } = render(() => <App />)
      const guide = container.querySelector('.screen-guide') as HTMLElement
      expect(guide).not.toBeNull()
      expect(guide.textContent?.length).toBeGreaterThan(0)
      expect(container.querySelector('.screen-notes')).toBeNull()
      expect(guide.textContent).not.toContain('連打は数えません')
    })
  })

  describe('介助者メニューの常時案内', () => {
    it('閉じている間は出ず、開くと所定の4行が出る(60秒は自動閉じ時間に一致)', () => {
      const { container } = render(() => <App />)
      expect(container.querySelector('.caregiver-notes')).toBeNull()
      openCaregiverMenu(container)
      const notes = caregiverNotes(container)
      expect(notes).toHaveLength(4)
      expect(notes[0]).toBe(
        '60秒タップしないと、自動で閉じてホームに戻ります（打鍵では延びません）。',
      )
      expect(notes[1]).toContain('キー入力で閉じ')
      expect(notes[1]).not.toContain('外側')
      expect(notes[1]).toContain('タブ上の←/→/Home/End')
      expect(notes[1]).toContain('入力欄・スライダー・チェックボックス操作中')
      // モールス入力が無効(既定)なので、モールスの時間停止は出さずスキャン停止だけ
      expect(notes[2]).toBe('開いている間は、スキャンが止まります。')
      expect(notes[3]).toBe(
        '入力がないまま3周すると、ホームに戻ります（モールス入力・ホームを除く）。',
      )
      expect(container.querySelector('.caregiver-notes')?.getAttribute('aria-label')).toBe(
        '介助者メニューの自動で起きること',
      )
    })

    it('タブを切り替えても .caregiver-notes は同じ場所・同じ内容で残る', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      const first = caregiverNotes(container)
      const parent = container.querySelector('.caregiver-notes')?.parentElement
      const tabs = Array.from(container.querySelectorAll('[role="tab"]')) as HTMLElement[]
      expect(tabs.length).toBeGreaterThan(1)
      for (const tab of tabs) {
        fireEvent.click(tab)
        expect(caregiverNotes(container)).toEqual(first)
        expect(container.querySelector('.caregiver-notes')?.parentElement).toBe(parent)
        // タブ列より前(上部の固定帯)にある
        const notesEl = container.querySelector('.caregiver-notes') as HTMLElement
        const tablist = container.querySelector('.caregiver-tablist') as HTMLElement
        expect(
          notesEl.compareDocumentPosition(tablist) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy()
      }
    })

    it('記載どおり 60 秒の無操作で閉じ、案内も消える(案内の秒数と実挙動が一致)', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      vi.advanceTimersByTime(59000)
      expect(container.querySelector('.caregiver-notes')).not.toBeNull()
      vi.advanceTimersByTime(1500)
      expect(container.querySelector('.caregiver-notes')).toBeNull()
    })

    it('設定を変えても(スキャン間隔等)介助者メニューの案内は変わらない', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      const before = caregiverNotes(container)
      selectCaregiverTab(container, 'スキャン')
      setSlider(container, 'スキャン間隔', 3000)
      expect(caregiverNotes(container)).toEqual(before)
    })
  })

  describe('案内の文言と実挙動の突き合わせ', () => {
    it('「60秒タップしないと閉じる」: フレーズ欄の打鍵では延びず、パネル内のタップでだけ延びる', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      selectCaregiverTab(container, 'フレーズ')
      const field = container.querySelector(
        '.caregiver-panel textarea, .caregiver-panel input[type="text"]',
      ) as HTMLElement
      expect(field).toBeTruthy()
      vi.advanceTimersByTime(40000)
      fireEvent.keyDown(field, { key: 'a' }) // 打鍵(編集)は閉じないが、タイマーも延ばさない
      expect(container.querySelector('.caregiver-notes')).not.toBeNull()
      vi.advanceTimersByTime(21000) // 開いてから 61 秒
      expect(container.querySelector('.caregiver-notes')).toBeNull()
    })

    it('パネル内のタップ(pointerdown)は60秒を延ばす', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      vi.advanceTimersByTime(40000)
      fireEvent.pointerDown(container.querySelector('.caregiver-tabpanel') as HTMLElement)
      vi.advanceTimersByTime(40000) // 開いてから 80 秒だが、タップから 40 秒
      expect(container.querySelector('.caregiver-notes')).not.toBeNull()
    })

    it('「タブ上の←/→/Home/End はタブ移動で閉じない」は記載どおり', () => {
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      const tab = container.querySelector('[role="tab"]') as HTMLElement
      tab.focus()
      fireEvent.keyDown(tab, { key: 'ArrowRight' })
      expect(container.querySelector('.caregiver-notes')).not.toBeNull()
      fireEvent.keyDown(tab, { key: 'a' }) // それ以外のキーは本人入力として閉じる
      expect(container.querySelector('.caregiver-notes')).toBeNull()
    })

    it('聴覚スキャンの読み上げ: 伝達の直後の1項目分は割り込まず、次の読み上げでは cancel が呼ばれる', () => {
      withSettings({ auditoryScan: true, voiceMode: 'short' })
      const { container } = render(() => <App />)
      const cancel = (
        window as unknown as { speechSynthesis: { cancel: ReturnType<typeof vi.fn> } }
      ).speechSynthesis.cancel
      for (let i = 0; i < 40 && scanningLabel(container) !== 'はい'; i += 1) {
        vi.advanceTimersByTime(INTERVAL_MS)
      }
      vi.advanceTimersByTime(600)
      cancel.mockClear()
      fireEvent.keyDown(window, { key: ' ' }) // はい: 伝達の読み上げ(speak 自身の cancel が1回)
      // 直後に遷移先の先頭項目を読むが、これは割り込まない(cancel は増えない)
      expect(cancel).toHaveBeenCalledTimes(1)
      vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS) // 次のカーソル移動の読み上げ
      expect(cancel.mock.calls.length).toBeGreaterThanOrEqual(2) // 2回目以降は割り込む(切れることがある)
    })

    it('振動できない端末(navigator.vibrate なし)では、振動の案内を出さず「振動できません」を出す', () => {
      delete (navigator as unknown as { vibrate?: unknown }).vibrate
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急
      expect(notesText(container)).toContain('この端末は振動できません（緊急中の周期振動なし）。')
      expect(notesText(container)).not.toContain('秒ごとに振動')
    })

    it('振動できる端末では「振動できません」は出ない', () => {
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' })
      expect(notesText(container)).not.toContain('振動できません')
    })
  })

  describe('低い画面の短縮文言(matchMedia)', () => {
    type Listener = (event: { matches: boolean }) => void
    function mockMatchMedia(initial: boolean) {
      const listeners: Listener[] = []
      let matches = initial
      ;(window as unknown as { matchMedia?: unknown }).matchMedia = vi.fn((query: string) => ({
        get matches() {
          return query === '(max-height: 500px), (max-width: 480px)' ? matches : false
        },
        media: query,
        addEventListener: (_: string, l: Listener) => listeners.push(l),
        removeEventListener: (_: string, l: Listener) => {
          const at = listeners.indexOf(l)
          if (at >= 0) listeners.splice(at, 1)
        },
      }))
      return (next: boolean) => {
        matches = next
        for (const l of [...listeners]) l({ matches: next })
      }
    }
    afterEach(() => {
      delete (window as unknown as { matchMedia?: unknown }).matchMedia
    })

    it('高さ500px以下か幅480px以下なら短縮形で出て、行数と順序は変わらない', () => {
      mockMatchMedia(true)
      const { container } = render(() => <App />)
      expect(container.querySelector('.screen-notes')).toBeNull() // 通常時は帯なし
      openCaregiverMenu(container)
      selectCaregiverTab(container, '状態')
      expect(behaviorNotes(container)).toEqual(['0.5秒以内の連打は無視（遷移直後も）。'])
      closeCaregiverMenu(container)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急
      expect(screenNotes(container)).toEqual(['緊急中は3秒ごとに振動（入力直後は休む）。'])
    })

    it('高さの条件が変わると(回転など)、その場で通常形と短縮形が切り替わる', () => {
      const setShort = mockMatchMedia(false)
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急
      expect(screenNotes(container)).toHaveLength(1)
      expect(notesText(container)).toContain('呼び出し継続の合図')
      setShort(true)
      expect(screenNotes(container)).toHaveLength(1)
      expect(notesText(container)).not.toContain('呼び出し継続の合図')
      expect(notesText(container)).toContain('入力直後は休む')
      setShort(false)
      expect(notesText(container)).toContain('呼び出し継続の合図')
    })

    it('介助者メニューの帯も、短縮形でも4行のまま', () => {
      mockMatchMedia(true)
      const { container } = render(() => <App />)
      openCaregiverMenu(container)
      const notes = caregiverNotes(container)
      expect(notes).toHaveLength(4)
      expect(notes[0]).toBe('60秒タップなしで閉じてホームへ（打鍵では延びず）。')
    })
  })

  describe('場所の固定(スタイル)', () => {
    // CSS の実体を読む(vitest は CSS を空にするため fs で読む。node の型は入れていない)
    let css = ''
    beforeAll(async () => {
      // @ts-expect-error node:fs の型定義は無い(実行時には存在する)
      const fs = (await import('node:fs')) as {
        readFileSync: (path: string, enc: string) => string
      }
      const cwd = (globalThis as unknown as { process: { cwd: () => string } }).process.cwd()
      css = fs.readFileSync(`${cwd}/src/styles/globals.css`, 'utf8')
    })
    const ruleBody = (selector: string): string => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const matches = [...css.matchAll(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
      return matches.map((m) => m[1]).join('\n')
    }

    it('.screen-notes は .app-shell の最終行(grid-row: 6)に固定され、行定義は6トラック', () => {
      expect(ruleBody('.screen-notes')).toMatch(/grid-row:\s*6\b/)
      const templates = [
        ...css.matchAll(/\.app-shell\s*\{[^}]*grid-template-rows:\s*([^;]+);/g),
      ].map((m) => m[1].trim())
      expect(templates.at(-1)?.split(/\s+/)).toHaveLength(6)
      expect(templates.at(-1)?.split(/\s+/).at(-1)).toBe('auto')
    })

    it('.screen-notes に非表示・位置変更の宣言が無く、画面ごとの上書きも無い', () => {
      const body = ruleBody('.screen-notes')
      expect(body).not.toMatch(/display:\s*none|visibility:\s*hidden|position:\s*(fixed|absolute)/)
      expect(css).not.toMatch(/\.(is-morse|screen-[a-z]+)\s+\.screen-notes/)
      expect(css).not.toMatch(/\.screen-notes[^{]*\{[^}]*grid-row:\s*(?!6\b)\d/)
    })

    it('.caregiver-notes はタブ列の前の固定帯(flex: none)', () => {
      expect(ruleBody('.caregiver-notes')).toMatch(/flex:\s*none/)
    })

    /** CSS 全体から、指定セレクタの規則(メディアクエリの内側も含む)の font-size の下限(rem)を全部集める */
    const fontSizesRem = (selector: string): number[] => {
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const rules = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
      const sizes: number[] = []
      for (const rule of rules) {
        const decl = rule[1].match(/font-size:\s*([^;]+);/)
        if (!decl) continue
        // clamp(下限, 推奨, 上限) は下限(1つ目)が実効の最小。単独の rem 指定はその値
        const first = decl[1].match(/(?:clamp\(\s*)?([\d.]+)rem/)
        expect(first, `${selector} の font-size「${decl[1]}」は rem で読めること`).not.toBeNull()
        sizes.push(Number(first?.[1]))
      }
      return sizes
    }

    it('帯の本文の文字は、画面案内・介助者メニューとも 0.7rem 以上(下限を静的に縛る)', () => {
      for (const selector of ['.screen-notes', '.caregiver-notes']) {
        const sizes = fontSizesRem(selector)
        expect(sizes.length, `${selector} の font-size 宣言`).toBeGreaterThan(0)
        for (const size of sizes) expect(size).toBeGreaterThanOrEqual(0.7)
      }
    })

    /** `@media <条件> { ... }` ブロックの本文(波括弧の対応を数えて取り出す) */
    const mediaBlocks = (): Array<{ query: string; body: string }> => {
      const blocks: Array<{ query: string; body: string }> = []
      for (const m of css.matchAll(/@media\s*([^{]+)\{/g)) {
        let depth = 1
        let k = (m.index ?? 0) + m[0].length
        const start = k
        while (k < css.length && depth > 0) {
          if (css[k] === '{') depth += 1
          else if (css[k] === '}') depth -= 1
          k += 1
        }
        blocks.push({ query: m[1].trim(), body: css.slice(start, k - 1) })
      }
      return blocks
    }

    it('帯の文字を縮める条件は「高さ」だけ(幅が狭いだけの縦長スマホは基本の clamp のまま)', () => {
      // 基本規則は clamp(0.72rem, 1.9vh, 0.95rem)
      expect(ruleBody('.screen-notes')).toMatch(
        /font-size:\s*clamp\(0\.72rem,\s*1\.9vh,\s*0\.95rem\)/,
      )
      for (const { query, body } of mediaBlocks()) {
        const shrinks = /\.screen-notes\s*\{[^}]*font-size/.test(body)
        if (shrinks) {
          expect(query).toMatch(/max-height/)
          expect(query).not.toMatch(/max-width/)
        }
      }
    })
  })
})
