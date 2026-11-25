// Issue #108: 本人が自分で緊急を解除できる(緊急 → 緊急を解除 → 解除する)。
// 正本: docs/requirements.md §4.3「本人による解除」
//
// デシジョンテーブル(緊急中の本人の操作 → 緊急が残るか)
//   緊急詳細の「緊急を解除」(入口)        | 残る(確認画面へ進むだけ)
//   確認画面の「戻る」(先頭)              | 残る(緊急詳細へ戻る)
//   確認画面で放置(無入力 3 周)           | 残る(ホームへ戻る)
//   確認画面の「解除する」                | 解除(帯・保存状態・周期の振動が止まる)
//   入口からスイッチを連打(カーソルは先頭) | 残る(先頭は「戻る」)
//   それ以外の本人入力(はい・もう一度 等)  | 残る
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import { HAPTIC_PATTERNS } from '../lib/feedback'
import { IDLE_LAPS_BEFORE_HOME } from '../lib/idleLaps'
import {
  DEFAULT_MESSAGE,
  EMERGENCY_MESSAGE,
  RELEASED_MESSAGE,
  advanceSteps,
  breadcrumb,
  clearDeviceCalls,
  closeCaregiverMenu,
  isEmergency,
  isHome,
  lastVibration,
  openCaregiverMenu,
  panelLabel,
  pressSwitch,
  scanningLabel,
  selectByScan,
  setSettings,
  setupApp,
  shownMessage,
  spoken,
  tap,
  teardownApp,
  tileLabels,
  vibrateMock,
  vibrations,
} from './appTestKit'

const savedEmergency = () => window.localStorage.getItem('libra:emergency')

/** 緊急を選び、緊急詳細(urgentDetail)にいる状態にする */
function startEmergency() {
  const view = render(() => <App />)
  tap(view.container, '緊急')
  expect(isEmergency(view.container)).toBe(true)
  expect(breadcrumb(view.container)).toEqual(['ホーム', '緊急'])
  return view
}

/** 緊急中に、解除の確認画面(emergencyRelease)まで進んだ状態にする */
function openReleaseConfirm() {
  const view = startEmergency()
  tap(view.container, '緊急を解除')
  expect(breadcrumb(view.container)).toEqual(['ホーム', '緊急', '緊急を解除'])
  return view
}

describe('Issue #108: 本人による緊急の解除', () => {
  beforeEach(setupApp)
  afterEach(teardownApp)

  describe('入口と確認画面', () => {
    it('緊急詳細の末尾に「緊急を解除」があり、選んでも解除されず確認画面へ進むだけ', () => {
      const { container } = startEmergency()
      expect(tileLabels(container).at(-1)).toBe('緊急を解除')
      expect(tileLabels(container)[0]).toBe('戻る')

      clearDeviceCalls()
      tap(container, '緊急を解除')

      expect(isEmergency(container)).toBe(true)
      expect(savedEmergency()).not.toBeNull()
      // 解除の振動(500ms)も読み上げも出ない
      expect(vibrations()).not.toContainEqual(HAPTIC_PATTERNS.cleared)
      expect(spoken()).toEqual([])
    })

    it('確認画面は「戻る → 解除する」の 2 項目だけで、緊急タイルを置かない。カーソルは先頭の「戻る」', () => {
      const { container } = openReleaseConfirm()
      expect(tileLabels(container)).toEqual(['戻る', '解除する'])
      expect(scanningLabel(container)).toBe('戻る')
      expect(container.querySelector('.grid-board .tile-emergency')).toBeNull()
      expect(container.querySelector('.screen-guide h2')?.textContent).toBe(
        '緊急を解除するときは「解除する」を選んでください。',
      )
    })

    it('入口を選んだ直後にスイッチを押し続けても(連打)、先頭が「戻る」なので解除されない', () => {
      const { container } = startEmergency()
      selectByScan(container, '緊急を解除') // スイッチで入口を選ぶ
      expect(breadcrumb(container)).toEqual(['ホーム', '緊急', '緊急を解除'])

      // 連打無視の区間内の連打は数えない
      pressSwitch()
      pressSwitch()
      expect(breadcrumb(container)).toEqual(['ホーム', '緊急', '緊急を解除'])
      expect(isEmergency(container)).toBe(true)

      // 連打無視を過ぎた押下は、先頭の「戻る」を実行するだけ
      vi.advanceTimersByTime(600)
      pressSwitch()
      expect(breadcrumb(container)).toEqual(['ホーム', '緊急'])
      expect(isEmergency(container)).toBe(true)
      expect(savedEmergency()).not.toBeNull()
    })

    it('確認画面の「戻る」は緊急詳細へ戻り、緊急は残る', () => {
      const { container } = openReleaseConfirm()
      tap(container, '戻る')
      expect(breadcrumb(container)).toEqual(['ホーム', '緊急'])
      expect(isEmergency(container)).toBe(true)
    })

    it('確認画面からパンくずで分かる現在地は ホーム > 緊急 > 緊急を解除(末尾が現在地)', () => {
      const { container } = openReleaseConfirm()
      const items = container.querySelectorAll('.screen-breadcrumb li')
      expect(items[items.length - 1].getAttribute('aria-current')).toBe('location')
      expect(items[0].getAttribute('aria-current')).toBeNull()
    })
  })

  describe('確認画面で放置(無入力 3 周)', () => {
    it('3 周の 1 歩手前では確認画面のまま、3 周でホームへ戻る。緊急は解除されず残る', () => {
      const { container } = openReleaseConfirm()
      const n = tileLabels(container).length
      expect(n).toBe(2)
      clearDeviceCalls()

      advanceSteps(container, n * IDLE_LAPS_BEFORE_HOME - 1)
      expect(breadcrumb(container)).toEqual(['ホーム', '緊急', '緊急を解除'])

      advanceSteps(container, 1)
      expect(isHome(container)).toBe(true)
      expect(scanningLabel(container)).toBe('緊急') // ホームの先頭から再開する

      expect(isEmergency(container)).toBe(true)
      expect(JSON.parse(savedEmergency() ?? 'null')).toMatchObject({ active: true })
      // 放置の間に解除の合図(500ms の振動・「緊急を解除しました。」)は出ない
      expect(vibrations()).not.toContainEqual(HAPTIC_PATTERNS.cleared)
      expect(shownMessage(container)).not.toBe(RELEASED_MESSAGE)
    })

    it('放置でホームへ戻ったあとも、緊急中の周期の振動は続く', () => {
      const { container } = openReleaseConfirm()
      advanceSteps(container, 2 * IDLE_LAPS_BEFORE_HOME)
      expect(isHome(container)).toBe(true)
      vibrateMock().mockClear()
      vi.advanceTimersByTime(6500)
      expect(vibrations()).toContainEqual(HAPTIC_PATTERNS.emergencyActive)
    })
  })

  describe('「解除する」を選ぶ', () => {
    it('緊急の帯が消え、伝達欄に「緊急を解除しました。」が出て、ホームへ戻る', () => {
      const { container } = openReleaseConfirm()
      tap(container, '解除する')

      expect(isEmergency(container)).toBe(false)
      expect(isHome(container)).toBe(true)
      expect(scanningLabel(container)).toBe('緊急')
      expect(shownMessage(container)).toBe(RELEASED_MESSAGE)
      expect(panelLabel(container)).toBe('直前に伝えたこと')
      // 緊急色調(赤)は残さない
      expect(document.documentElement.dataset.messageTone).toBe('neutral')
    })

    it('解除の振動(500ms の 1 回)が最後に出る', () => {
      const { container } = openReleaseConfirm()
      vibrateMock().mockClear()
      tap(container, '解除する')
      expect(lastVibration()).toEqual(HAPTIC_PATTERNS.cleared)
      expect(HAPTIC_PATTERNS.cleared).toEqual([500])
    })

    it.each([
      ['全部', 'full'],
      ['短く', 'short'],
    ])('音声モード「%s」では「緊急を解除しました。」を読み上げる', (_name, voiceMode) => {
      setSettings({ voiceMode })
      const { container } = openReleaseConfirm()
      clearDeviceCalls()
      tap(container, '解除する')
      expect(spoken()).toEqual([RELEASED_MESSAGE])
    })

    it.each([
      ['OFF', 'off'],
      ['効果音だけ', 'tone'],
    ])('音声モード「%s」では読み上げない(表示と振動で知らせる)', (_name, voiceMode) => {
      setSettings({ voiceMode })
      const { container } = openReleaseConfirm()
      clearDeviceCalls()
      tap(container, '解除する')
      expect(spoken()).toEqual([])
      expect(shownMessage(container)).toBe(RELEASED_MESSAGE)
      expect(vibrations()).toContainEqual(HAPTIC_PATTERNS.cleared)
    })

    it('振動 OFF の設定では振動せず、表示だけで知らせる', () => {
      setSettings({ hapticsEnabled: false })
      const { container } = openReleaseConfirm()
      vibrateMock().mockClear()
      tap(container, '解除する')
      expect(vibrateMock()).not.toHaveBeenCalled()
      expect(shownMessage(container)).toBe(RELEASED_MESSAGE)
      expect(isEmergency(container)).toBe(false)
    })

    it('緊急中の周期の振動が止まる', () => {
      const { container } = openReleaseConfirm()
      tap(container, '解除する')
      vibrateMock().mockClear()
      vi.advanceTimersByTime(15000)
      expect(vibrateMock()).not.toHaveBeenCalled()
    })

    it('保存状態(libra:emergency)が消え、再読み込みしても緊急に戻らない', () => {
      const first = openReleaseConfirm()
      expect(savedEmergency()).not.toBeNull()
      tap(first.container, '解除する')
      expect(savedEmergency()).toBeNull()

      first.unmount()
      cleanup()
      const second = render(() => <App />)
      expect(isEmergency(second.container)).toBe(false)
      // 履歴は保存しないので、「緊急を解除しました。」も残らない
      expect(shownMessage(second.container)).toBeNull()
      expect(second.container.querySelector('.message-panel')?.classList.contains('is-empty')).toBe(
        true,
      )
    })

    it('選択済みの詳細・緊急中の伝達も一緒に消える', () => {
      const { container } = startEmergency()
      tap(container, '苦しい') // 詳細を選ぶとホームへ戻る
      tap(container, 'はい') // 緊急中の伝達
      expect(container.querySelector('.emergency-detail-status')?.textContent).toContain('苦しい')
      expect(shownMessage(container)).toBe('はい。')

      tap(container, '緊急')
      tap(container, '緊急を解除')
      tap(container, '解除する')

      expect(isEmergency(container)).toBe(false)
      expect(container.querySelector('.emergency-detail-status')).toBeNull()
      // 帯は消えるが、解除の文に選んだ詳細が残る(M1)
      expect(shownMessage(container)).toBe('緊急（苦しい）を解除しました。')
    })

    it('取り消しは出さない(解除の取り消しは無い)。2 周待っても出ない', () => {
      const { container } = openReleaseConfirm()
      tap(container, '解除する')
      expect(tileLabels(container)).not.toContain('取り消し')
      advanceSteps(container, tileLabels(container).length * 2)
      expect(tileLabels(container)).not.toContain('取り消し')
      expect(shownMessage(container)).toBe(RELEASED_MESSAGE)
    })

    it('解除のあと、緊急を選び直すとふたたび緊急になる(前の詳細は引き継がない)', () => {
      const { container } = startEmergency()
      tap(container, '苦しい')
      tap(container, '緊急')
      tap(container, '緊急を解除')
      tap(container, '解除する')

      tap(container, '緊急')
      expect(isEmergency(container)).toBe(true)
      expect(container.querySelector('.emergency-status-message')?.textContent).toBe(
        EMERGENCY_MESSAGE,
      )
      expect(container.querySelector('.emergency-detail-status')).toBeNull()
      expect(JSON.parse(savedEmergency() ?? 'null')).toEqual({
        active: true,
        details: [],
        sub: null,
      })
    })

    it('スイッチ(キー)だけでも 緊急 → 緊急を解除 → 解除する を通せる', () => {
      const { container } = render(() => <App />)
      selectByScan(container, '緊急')
      selectByScan(container, '緊急を解除')
      selectByScan(container, '解除する')
      expect(isEmergency(container)).toBe(false)
      expect(shownMessage(container)).toBe(RELEASED_MESSAGE)
      expect(isHome(container)).toBe(true)
    })
  })

  describe('解除にならない本人入力', () => {
    it('緊急中の はい・いいえ・もう一度・快の伝達では、緊急は残る', () => {
      const { container } = startEmergency()
      tap(container, '戻る')
      for (const label of ['はい', 'いいえ', 'もう一度']) {
        tap(container, label)
        expect(isEmergency(container), label).toBe(true)
      }
      tap(container, '快')
      tap(container, '続けて')
      expect(isEmergency(container)).toBe(true)
      expect(savedEmergency()).not.toBeNull()
    })

    it('緊急中のホームには「緊急を解除」「解除する」を直接出さない(緊急 → 緊急を解除 → 解除する の 3 段だけ)', () => {
      const { container } = startEmergency()
      tap(container, '戻る')
      expect(isHome(container)).toBe(true)
      expect(tileLabels(container)).not.toContain('緊急を解除')
      expect(tileLabels(container)).not.toContain('解除する')
    })

    it('緊急詳細の入口は、詳細を全部選んだあとも残る', () => {
      const { container } = startEmergency()
      for (const label of ['苦しい', '痛い', '息ができない', '吐きそう', '胸が痛い']) {
        tap(container, label)
        tap(container, '緊急')
      }
      expect(tileLabels(container)).toEqual(['戻る', '緊急を解除'])
    })
  })

  describe('介助者の解除との関係', () => {
    it('確認画面を開いたまま介助者が解除したあと、本人が「解除する」を押しても何も伝えない', () => {
      const { container } = openReleaseConfirm()
      openCaregiverMenu(container)
      ;(container.querySelector('.caregiver-emergency-clear') as HTMLElement).click()
      expect(isEmergency(container)).toBe(false)
      closeCaregiverMenu(container) // 閉じるとホームへ戻る
      expect(isHome(container)).toBe(true)
      expect(shownMessage(container)).toBeNull()
      expect(tileLabels(container)).not.toContain('解除する')
    })

    it('本人の解除と介助者の解除は、どちらも同じ状態(帯なし・保存なし・周期の振動なし)になる', () => {
      const self = openReleaseConfirm()
      tap(self.container, '解除する')
      const selfState = { band: isEmergency(self.container), saved: savedEmergency() }
      self.unmount()
      cleanup()
      window.localStorage.clear()

      const caregiver = startEmergency()
      openCaregiverMenu(caregiver.container)
      ;(caregiver.container.querySelector('.caregiver-emergency-clear') as HTMLElement).click()
      expect({ band: isEmergency(caregiver.container), saved: savedEmergency() }).toEqual(selfState)
      // 違いは伝達欄だけ: 介助者の解除では「緊急を解除しました。」を出さない
      closeCaregiverMenu(caregiver.container)
      expect(shownMessage(caregiver.container)).toBeNull()
    })
  })

  describe('再読み込みで復元した緊急', () => {
    it('復元した緊急も、本人が解除できる', () => {
      window.localStorage.setItem(
        'libra:emergency',
        JSON.stringify({ active: true, details: ['苦しい'], sub: 'はい。' }),
      )
      const { container } = render(() => <App />)
      expect(isEmergency(container)).toBe(true)
      expect(shownMessage(container)).toBe('はい。')

      tap(container, '緊急')
      tap(container, '緊急を解除')
      tap(container, '解除する')

      expect(isEmergency(container)).toBe(false)
      expect(savedEmergency()).toBeNull()
      // 復元した詳細も解除の文に入る
      expect(shownMessage(container)).toBe('緊急（苦しい）を解除しました。')
    })
  })

  describe('解除の後も緊急の中身が残る(後から来た介助者が分かる)', () => {
    const prevButton = (c: HTMLElement) =>
      c.querySelector<HTMLButtonElement>('.history-nav[aria-label="前の伝達を表示"]')

    it('詳細を選ばずに解除: 解除文は「緊急を解除しました。」。1件前に緊急の呼び出しが残る', () => {
      const { container } = openReleaseConfirm()
      tap(container, '解除する')
      expect(shownMessage(container)).toBe(RELEASED_MESSAGE)
      fireEvent.click(prevButton(container) as HTMLElement)
      expect(shownMessage(container)).toBe(EMERGENCY_MESSAGE)
      expect(panelLabel(container)).toBe('過去に伝えたこと（1件前）')
    })

    it('詳細を2つ選んで解除: 解除文に選んだ順で詳細が入り(読み上げも同じ)、矢印で詳細と緊急の呼び出しを振り返れる', () => {
      setSettings({ voiceMode: 'full' })
      const { container } = startEmergency()
      tap(container, '息ができない')
      tap(container, '緊急')
      tap(container, '痛い')
      tap(container, '緊急')
      tap(container, '緊急を解除')
      clearDeviceCalls()
      tap(container, '解除する')

      expect(shownMessage(container)).toBe('緊急（息ができない・痛い）を解除しました。')
      expect(spoken()).toEqual(['緊急（息ができない・痛い）を解除しました。'])

      const prev = prevButton(container) as HTMLElement
      fireEvent.click(prev)
      expect(shownMessage(container)).toBe(`${EMERGENCY_MESSAGE}痛い`)
      fireEvent.click(prev)
      expect(shownMessage(container)).toBe(`${EMERGENCY_MESSAGE}息ができない`)
      fireEvent.click(prev)
      expect(shownMessage(container)).toBe(EMERGENCY_MESSAGE)
      expect(panelLabel(container)).toBe('過去に伝えたこと（3件前）')
      // それより前は無い(緊急の再選択・同じ詳細は二重に積まない)
      expect(prev.hasAttribute('disabled')).toBe(true)
    })

    it('緊急中の伝達(はい)の後に詳細を選んでも、最新は「はい。」のまま。解除後は順に振り返れる', () => {
      const { container } = startEmergency()
      tap(container, '戻る')
      tap(container, 'はい')
      tap(container, '緊急')
      tap(container, '苦しい')
      expect(shownMessage(container)).toBe('はい。')
      expect(panelLabel(container)).toBe('直前に伝えたこと')

      tap(container, '緊急')
      tap(container, '緊急を解除')
      tap(container, '解除する')
      expect(shownMessage(container)).toBe('緊急（苦しい）を解除しました。')
      const prev = prevButton(container) as HTMLElement
      fireEvent.click(prev)
      expect(shownMessage(container)).toBe(`${EMERGENCY_MESSAGE}苦しい`)
      fireEvent.click(prev)
      expect(shownMessage(container)).toBe('はい。')
      fireEvent.click(prev)
      expect(shownMessage(container)).toBe(EMERGENCY_MESSAGE)
    })

    it('緊急中、帯と同じ中身(緊急の呼び出し・詳細)しか無い間は伝達欄を出さない', () => {
      const { container } = startEmergency()
      tap(container, '苦しい')
      expect(container.querySelector('.message-panel')?.classList.contains('is-empty')).toBe(true)
    })
  })

  it('緊急でないときは、既定の案内文(伝達なし)のまま(解除の文は出ない)', () => {
    const { container } = render(() => <App />)
    expect(shownMessage(container)).toBeNull()
    expect(container.querySelector('.message-panel h1')?.textContent).toBe(DEFAULT_MESSAGE)
  })
})
