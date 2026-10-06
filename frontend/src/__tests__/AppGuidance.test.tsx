// Issue #58: 全画面の常時案内(.screen-notes / .caregiver-notes)の App 結合テスト。
// 文言と条件の表引きは lib/__tests__/guidance.test.ts。ここは「実際の状態遷移・設定変更・
// DOM 上の場所」に案内が追従すること(隠せない・場所固定)を確認する。
//
// デシジョンテーブル(App 結合):
//   操作/状態                         | .screen-notes の観測
//   起動直後(既定)                    | 連打無視+先頭待機のみ。取り消し・緊急系なし
//   伝達直後(home)                    | 取り消し案内あり → 1周後 / 他画面へ遷移で消える
//   緊急開始(urgentDetail)            | 振動案内あり(取り消しなしはホームで出る)→ 解除で消える
//   設定: 連打無視0 / 下限>0 / 離した瞬間 / 間隔×倍率 | 文言が即追従
//   聴覚スキャン ON                   | 読み上げ割り込み抑止の案内が出る(OFFで消える)
//   緊急復元+振動ON                   | 再起動後の振動注意 → 画面に触れると消える
//   緊急復元+振動OFF                  | 振動案内ごと出ない
//   モールス画面(通常)                | .screen-notes 自体が DOM に無い(.morse-legend は出る)
//   全本人画面                        | .screen-notes は同じ親(app-shell)・盤面の直後
//   介助者メニュー表示中              | .caregiver-notes が常に出る(タブを替えても残る)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

const UNDO = '「取り消し」は伝えた直後の1周だけ出ます。'
const VIBRATION_FRAGMENT = '3秒ごとに振動'
const AWAIT_TOUCH = '再起動後は、一度画面に触れるまで振動しません。'
const AUDITORY = '伝達の読み上げは、次項目の読み上げで途切れません。'

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

  describe('取り消しの案内', () => {
    it('起動直後は取り消し・緊急系の案内が無く、連打無視と先頭待機だけが出る', () => {
      const { container } = render(() => <App />)
      expect(screenNotes(container)).toEqual([
        '0.5秒以内の連打は数えません（画面遷移直後も。誤作動防止）。',
        '画面を開くと先頭に3.0秒とどまります。',
      ])
    })

    it('伝達直後に取り消し案内が出て、1周後に取り消しタイルと一緒に消える', () => {
      const { container } = render(() => <App />)
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      fireEvent.keyDown(window, { key: ' ' }) // はい → home
      expect(tileLabels(container)).toContain('取り消し')
      expect(screenNotes(container)[0]).toBe(UNDO)
      vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 6) // 7項目を1周
      expect(tileLabels(container)).not.toContain('取り消し')
      expect(notesText(container)).not.toContain(UNDO)
    })

    it('取り消し猶予中に他画面へ遷移すると案内も消え、ホームに戻っても復活しない', () => {
      const { container } = render(() => <App />)
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      fireEvent.keyDown(window, { key: ' ' }) // はい → home(取り消し)
      expect(notesText(container)).toContain(UNDO)
      selectByLabel(container, '文字盤') // 他画面へ
      expect(notesText(container)).not.toContain(UNDO)
      expect(container.querySelector('.screen-notes')).not.toBeNull() // 押し方等は出続ける
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
      expect(notesText(container)).not.toContain(VIBRATION_FRAGMENT)
    })

    it('緊急中のホームでは「取り消しなし」の案内が出て、取り消し案内は出ない。解除で消える', () => {
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      fireEvent.keyDown(window, { key: ' ' }) // 戻る → home
      expect(notesText(container)).toContain('緊急中は「取り消し」なし')
      expect(notesText(container)).not.toContain(UNDO)
      clearEmergencyViaMenu(container)
      expect(notesText(container)).not.toContain('緊急中は「取り消し」なし')
    })

    it('振動OFFなら緊急中でも振動の案内は出ない', () => {
      withSettings({ hapticsEnabled: false })
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' })
      expect(notesText(container)).not.toContain(VIBRATION_FRAGMENT)
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
      expect(notesText(container)).not.toContain(AWAIT_TOUCH)
    })

    it('緊急復元でも振動OFFなら振動案内も再起動後の注意も出ない', () => {
      withSettings({ hapticsEnabled: false })
      window.localStorage.setItem(
        'libra:emergency',
        JSON.stringify({ active: true, details: [], sub: null }),
      )
      const { container } = render(() => <App />)
      expect(notesText(container)).not.toContain(VIBRATION_FRAGMENT)
      expect(notesText(container)).not.toContain(AWAIT_TOUCH)
    })

    it('緊急でない通常起動では再起動後の注意は出ない', () => {
      const { container } = render(() => <App />)
      expect(notesText(container)).not.toContain(AWAIT_TOUCH)
    })
  })

  describe('設定への追従', () => {
    it('保存済み設定で起動すると、押し方と先頭待機の文言がその値になる', () => {
      withSettings({
        debounceMs: 0,
        minHoldMs: 800,
        activateOn: 'release',
        intervalMs: 2000,
        headHoldMultiplier: 3,
      })
      const { container } = render(() => <App />)
      expect(screenNotes(container)).toEqual([
        '0.8秒以上押し続けて離すと決まります（短押しは数えません）。',
        '画面を開くと先頭に6.0秒とどまります。',
      ])
    })

    it('介助者メニューで連打無視を 0 にすると、連打無視の行だけ消える', () => {
      const { container } = render(() => <App />)
      expect(notesText(container)).toContain('連打は数えません')
      changeSettingsViaMenu(container, () => {
        selectCaregiverTab(container, 'スキャン')
        setSlider(container, '連打無視', 0)
      })
      expect(notesText(container)).not.toContain('連打は数えません')
      expect(notesText(container)).toContain('画面を開くと先頭に3.0秒とどまります。')
    })

    it('押下時間の下限・決定のタイミングを変えると、押し方の行が追従する', () => {
      const { container } = render(() => <App />)
      expect(notesText(container)).not.toContain('押し続け')
      changeSettingsViaMenu(container, () => {
        selectCaregiverTab(container, 'スキャン')
        setSlider(container, '押下時間の下限', 700)
      })
      expect(notesText(container)).toContain(
        '0.7秒以上押し続けると決まります（短押しは数えません）。',
      )
      changeSettingsViaMenu(container, () => {
        selectCaregiverTab(container, 'スキャン')
        clickButtonText(container, '離した瞬間')
      })
      expect(notesText(container)).toContain(
        '0.7秒以上押し続けて離すと決まります（短押しは数えません）。',
      )
      changeSettingsViaMenu(container, () => {
        selectCaregiverTab(container, 'スキャン')
        setSlider(container, '押下時間の下限', 0)
      })
      expect(notesText(container)).toContain('押して離すと決まります（押した瞬間は決まりません）。')
    })

    it('スキャン間隔と先頭待機倍率を変えると、先頭待機の秒数(間隔×倍率)が追従する', () => {
      const { container } = render(() => <App />)
      changeSettingsViaMenu(container, () => {
        selectCaregiverTab(container, 'スキャン')
        setSlider(container, 'スキャン間隔', 2000)
        setSlider(container, '先頭待機倍率', 2.5)
      })
      expect(notesText(container)).toContain('画面を開くと先頭に5.0秒とどまります。')
    })

    it('聴覚スキャンを ON にしたときだけ読み上げ割り込み抑止の案内が出る', () => {
      const { container } = render(() => <App />)
      expect(notesText(container)).not.toContain(AUDITORY)
      openCaregiverMenu(container)
      selectCaregiverTab(container, '入力方式')
      const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
      fireEvent.click(checkbox)
      closeCaregiverMenu(container)
      expect(notesText(container)).toContain(AUDITORY)
      openCaregiverMenu(container)
      selectCaregiverTab(container, '入力方式')
      fireEvent.click(container.querySelector('input[type="checkbox"]') as HTMLInputElement)
      closeCaregiverMenu(container)
      expect(notesText(container)).not.toContain(AUDITORY)
    })

    it('振動をメニューで OFF にすると、緊急中の振動案内が消える', () => {
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
      expect(notesText(container)).not.toContain(VIBRATION_FRAGMENT)
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

    it('モールス画面でも緊急中は振動の案内だけ出る(連打無視・先頭待機は出ない)', () => {
      withSettings({ morseEnabled: true })
      window.localStorage.setItem(
        'libra:emergency',
        JSON.stringify({ active: true, details: [], sub: null }),
      )
      const { container } = render(() => <App />)
      selectByLabel(container, 'モールス')
      expect(container.querySelector('.morse-panel')).not.toBeNull()
      expect(container.querySelector('.emergency-status')).not.toBeNull()
      const notes = screenNotes(container)
      // モールスへ入るキー操作で「触れた」扱いなので注意は消え、振動だけ(取り消し・押し方・先頭待機なし)
      expect(notes).toHaveLength(1)
      expect(notes[0]).toContain(VIBRATION_FRAGMENT)
    })

    it('.screen-notes は全本人画面で同じ親(app-shell)・盤面の直後・aria-label付きに出る', () => {
      withSettings({ morseEnabled: true })
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
      selectByLabel(container, '不快') // discomfort 系
      expect(placement()).toEqual(expected)
      selectByLabel(container, '戻る')
      fireEvent.keyDown(window, { key: ' ' }) // 緊急 → urgentDetail
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
    })

    it('既存の .screen-guide は壊れておらず、常時案内の文言を含まない', () => {
      const { container } = render(() => <App />)
      const guide = container.querySelector('.screen-guide') as HTMLElement
      expect(guide).not.toBeNull()
      expect(guide.textContent?.length).toBeGreaterThan(0)
      expect(guide.contains(container.querySelector('.screen-notes'))).toBe(false)
      expect(guide.textContent).not.toContain('連打は数えません')
    })
  })

  describe('介助者メニューの常時案内', () => {
    it('閉じている間は出ず、開くと所定の3行が出る(60秒は自動閉じ時間に一致)', () => {
      const { container } = render(() => <App />)
      expect(container.querySelector('.caregiver-notes')).toBeNull()
      openCaregiverMenu(container)
      const notes = caregiverNotes(container)
      expect(notes).toHaveLength(3)
      expect(notes[0]).toBe('60秒操作しないと、自動で閉じてホームに戻ります。')
      expect(notes[1]).toContain('外側のタップやキー入力')
      expect(notes[1]).toContain('タブ移動')
      expect(notes[2]).toBe('開いている間は、モールス入力の時間が止まります。')
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
})
