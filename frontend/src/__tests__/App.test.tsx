import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import * as alarmModule from '../lib/alarm'
import * as wakeLockModule from '../lib/wakeLock'
import * as offlineReadyModule from '../lib/offlineReady'
import { HAPTIC_PATTERNS, feedbackPattern } from '../lib/feedback'

// requirements.md 既定値: intervalMs=1500, headHoldMultiplier=2(=headHoldMs 3000), debounceMs=500
const HEAD_HOLD_MS = 3000
const INTERVAL_MS = 1500

// createOscillator が呼ばれる = 実際に警告音を鳴らそうとした回数(S6用)
let oscillatorStartCount = 0

class MockAudioContext {
  state: 'running' | 'suspended' = 'running'
  currentTime = 0
  destination = {}
  resume = vi.fn().mockResolvedValue(undefined)
  createOscillator() {
    oscillatorStartCount += 1
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

function tileLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.tile-label')).map((el) => el.textContent ?? '')
}

function scanningLabel(container: HTMLElement): string | null {
  const el = container.querySelector('.tile.scanning .tile-label')
  return el ? el.textContent : null
}

function h1Text(container: HTMLElement): string | null {
  const emergency = container.querySelector('.emergency-status-message')
  if (emergency) return emergency.textContent
  return container.querySelector('h1')?.textContent ?? null
}

describe('App', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    window.localStorage.clear()
    oscillatorStartCount = 0
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
    // PR#11 3巡目 should-B: 介助者メニューを開くたびに実装(recheckOfflineReady)を呼ぶが、
    // 個別にその呼び出し自体を検証するテスト以外では、jsdom上でのcaches/serviceWorker
    // 未実装への実際の問い合わせ(非同期)が他のテストの検証タイミングに影響しないよう、
    // 既定では何もしないモックにしておく
    vi.spyOn(offlineReadyModule, 'recheckOfflineReady').mockResolvedValue(undefined)
    // Issue #22: 見出しフィットが canvas を使う。jsdom は getContext 未実装で警告を出すので
    // 「canvas 不可(測れない)」として黙らせる(フィット自体の検証は fitHeading のテスト側)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('起動直後は先頭待機中のためカーソルは index 0 のまま', () => {
    const { container } = render(() => <App />)
    expect(scanningLabel(container)).toBe('緊急')
    vi.advanceTimersByTime(HEAD_HOLD_MS - 1)
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('先頭待機の経過後は interval ごとにカーソルが進む', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS)
    expect(scanningLabel(container)).toBe('はい')
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(scanningLabel(container)).toBe('いいえ')
  })

  it('Space キーでカーソル位置の項目が実行される', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // カーソルは「はい」
    fireEvent.keyDown(window, { key: ' ' })
    expect(h1Text(container)).toBe('はい')
  })

  it('画面クリック（pointerdown）でも同じ項目が実行される', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // カーソルは「はい」
    const board = container.querySelector('.grid-board') as HTMLElement
    fireEvent.pointerDown(board)
    expect(h1Text(container)).toBe('はい')
  })

  it('event.repeat の keydown は無視される', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // カーソルは「はい」
    fireEvent.keyDown(window, { key: ' ', repeat: true })
    expect(h1Text(container)).not.toBe('はい')
    expect(scanningLabel(container)).toBe('はい')
  })

  it('連打無視区間内の2回目の押下では二重に遷移しない', () => {
    const { container } = render(() => <App />)
    // 文字盤ナビへ進める(index5)
    vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 4)
    expect(scanningLabel(container)).toBe('文字盤')
    fireEvent.keyDown(window, { key: ' ' }) // letters 画面へ遷移
    expect(container.querySelector('.letter-strip')).not.toBeNull()

    // letters 画面(行段階): index0=緊急, index1=戻る, index2=あ行
    vi.advanceTimersByTime(HEAD_HOLD_MS) // index1(戻る)
    vi.advanceTimersByTime(INTERVAL_MS) // index2(あ行)
    fireEvent.keyDown(window, { key: ' ' }) // 1回目: あ行へ(文字段階)
    fireEvent.keyDown(window, { key: ' ' }) // 2回目: 連打無視区間内なので無視されるはず
    expect(h1Text(container)).not.toBe('緊急です。来てください') // 文字段階の先頭(緊急)を実行しない
    expect(scanningLabel(container)).toBe('緊急') // 文字段階の先頭
    const output = container.querySelector('.letter-strip output')
    expect(output?.textContent).toBe('文字を選んでください')
  })

  // 文字盤(#4): Space キー1種だけで「めかね」を入力・確定できる
  function selectByScan(container: HTMLElement, label: string) {
    for (let i = 0; i < 40 && scanningLabel(container) !== label; i += 1) {
      vi.advanceTimersByTime(INTERVAL_MS)
    }
    expect(scanningLabel(container)).toBe(label)
    vi.advanceTimersByTime(600) // 連打無視(0.5秒)を過ぎる
    fireEvent.keyDown(window, { key: ' ' })
  }

  it('Issue #4: Space キーだけで「めかね」を入力・確定できる', () => {
    const { container } = render(() => <App />)
    selectByScan(container, '文字盤')
    for (const [row, char] of [
      ['ま行', 'め'],
      ['か行', 'か'],
      ['な行', 'ね'],
    ]) {
      selectByScan(container, row)
      selectByScan(container, char)
    }
    expect(container.querySelector('.letter-strip output')?.textContent).toBe('めかね')

    selectByScan(container, '確定')
    expect(h1Text(container)).toBe('めかね')
    expect(container.querySelector('.letter-strip')).toBeNull()
    expect(scanningLabel(container)).toBe('緊急') // ホームの先頭から再開する
  })

  it('Issue #4: はい・いいえで答えて戻っても入力途中の文字列が保持される', () => {
    const { container } = render(() => <App />)
    selectByScan(container, '文字盤')
    selectByScan(container, 'あ行')
    selectByScan(container, 'あ')
    selectByScan(container, 'はい・いいえ')
    selectByScan(container, '戻る')
    expect(container.querySelector('.letter-strip output')?.textContent).toBe('あ')

    selectByScan(container, 'はい・いいえ')
    selectByScan(container, 'はい')
    expect(h1Text(container)).toBe('はい')
    selectByScan(container, '文字盤')
    expect(container.querySelector('.letter-strip output')?.textContent).toBe('あ')
  })

  it('Issue #4: 文字入力の途中(文字段階)でも先頭は緊急で、1周以内に届く', () => {
    const { container } = render(() => <App />)
    selectByScan(container, '文字盤')
    selectByScan(container, 'わ行')
    expect(scanningLabel(container)).toBe('緊急')
    // 文字段階の末尾(ー)まで進めても、次の1ステップで先頭(緊急)へ戻り、そこで届く
    vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 4)
    expect(scanningLabel(container)).toBe('ー')
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(scanningLabel(container)).toBe('緊急')
    fireEvent.keyDown(window, { key: ' ' })
    expect(h1Text(container)).toBe('緊急です。来てください')
  })

  it('緊急選択で確認なしに即「緊急です。来てください」を表示し緊急詳細画面へ遷移する', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // index0=緊急
    expect(h1Text(container)).toBe('緊急です。来てください')
    expect(container.querySelector('.grid-board')?.getAttribute('aria-label')).toContain('緊急')
  })

  it('Issue #44: 緊急中の「はい」は緊急状態と混ぜず「直前に伝えたこと」へ出る', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急選択 → urgentDetail
    vi.advanceTimersByTime(HEAD_HOLD_MS) // urgentDetail index1=戻る
    fireEvent.keyDown(window, { key: ' ' }) // home へ戻る
    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
    expect(scanningLabel(container)).toBe('はい')
    fireEvent.keyDown(window, { key: ' ' }) // はい を選択
    expect(h1Text(container)).toBe('緊急です。来てください')
    expect(container.querySelector('.message-panel-label')?.textContent).toBe('直前に伝えたこと')
    expect(container.querySelector('.message-panel h1')?.textContent).toBe('はい')
    expect(container.querySelector('.emergency-sub')).toBeNull()
  })

  it('Issue #44: 緊急状態・選択済み詳細・画面案内・候補を分離したまま画面移動できる', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急 → urgentDetail

    expect(container.querySelector('.emergency-status-message')?.textContent).toBe(
      '緊急です。来てください',
    )
    expect(container.querySelector('.screen-guide h2')?.textContent).toBe(
      '緊急です。いま伝えたい状態を選んでください。',
    )
    expect(tileLabels(container)).not.toContain('緊急')

    selectByLabel(container, '苦しい') // 選択済み詳細へ移し、home
    expect(container.querySelector('.emergency-detail-label')?.textContent).toBe('伝えた状態:')
    expect(container.querySelector('.emergency-details')?.textContent).toContain('苦しい')

    selectByLabel(container, '緊急') // urgentDetail を再度開く
    expect(tileLabels(container)).not.toContain('苦しい') // 状態と候補を重複させない
    selectByLabel(container, '戻る')
    selectByLabel(container, '不快')
    expect(container.querySelector('.screen-guide h2')?.textContent).toBe(
      'つらいことを選んでください。',
    )
    expect(container.querySelector('.emergency-status-message')).not.toBeNull()
    expect(container.querySelector('.emergency-details')?.textContent).toContain('苦しい')
  })

  it('緊急中はホームに取り消しが出ない', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急選択
    vi.advanceTimersByTime(HEAD_HOLD_MS)
    fireEvent.keyDown(window, { key: ' ' }) // 戻る → home
    expect(tileLabels(container)).not.toContain('取り消し')
  })

  it('伝達直後の1周だけ取り消しが出て、1周後に消え、消えた後もカーソルは正しい項目を指す', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
    fireEvent.keyDown(window, { key: ' ' }) // はい を選択 → home に戻る、取り消し表示
    expect(tileLabels(container)).toContain('取り消し')
    expect(tileLabels(container).length).toBe(7)

    // 1周(7項目)分進めて index が 0 に戻るまで進める
    vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 6)
    expect(tileLabels(container)).not.toContain('取り消し')
    expect(tileLabels(container).length).toBe(6)
    expect(scanningLabel(container)).toBe('緊急')

    // ずれ回帰: 取り消しが消えた後も次の項目は正しく「はい」を指す
    vi.advanceTimersByTime(INTERVAL_MS)
    expect(scanningLabel(container)).toBe('はい')
  })

  it('介助者ボタンの2秒未満の長押しではメニューが開かず、スイッチ扱いにもならない', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(1000)
    fireEvent.pointerUp(button)
    expect(container.querySelector('.caregiver-overlay')).toBeNull()
    expect(h1Text(container)).not.toBe('緊急です。来てください')
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('Issue #22: 介助者ボタンは「介助者用」と表示され、aria-label は介助者メニュー（2秒長押し）', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    expect(button.textContent?.trim()).toBe('介助者用')
    expect(button.getAttribute('aria-label')).toBe('介助者メニュー（2秒長押し）')
  })

  it('介助者ボタンを2秒以上長押しするとメニューが開く', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)
    expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
  })

  it('介助者メニュー中はパネル内の操作ではスイッチとして効かず、メニューは開いたまま', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000) // メニュー開く
    const before = h1Text(container)

    const panel = container.querySelector('.caregiver-panel') as HTMLElement
    fireEvent.pointerDown(panel)
    vi.advanceTimersByTime(10000) // スキャンが進むはずの時間(メニュー中は止まっている)

    expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
    expect(h1Text(container)).toBe(before)
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('M3(b): 介助者メニュー中の keydown はメニューを閉じてホーム先頭から再開する(項目は実行しない)', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000) // メニュー開く

    fireEvent.keyDown(window, { key: ' ' })

    expect(container.querySelector('.caregiver-overlay')).toBeNull()
    // その keydown 自体では項目(緊急)は実行されない
    expect(h1Text(container)).not.toBe('緊急です。来てください')
    // ホーム先頭から再開している(先頭待機中なのでまだ緊急のまま)
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('M3(b): 介助者メニューのパネル外(オーバーレイ背景)へのタップはメニューを閉じてホーム先頭から再開する', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000) // メニュー開く

    const overlay = container.querySelector('.caregiver-overlay') as HTMLElement
    fireEvent.pointerDown(overlay)

    expect(container.querySelector('.caregiver-overlay')).toBeNull()
    expect(h1Text(container)).not.toBe('緊急です。来てください')
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('M3(a): 介助者メニュー内の操作が60秒ないと自動で閉じ、スキャンが再開する', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000) // メニュー開く
    expect(container.querySelector('.caregiver-overlay')).not.toBeNull()

    vi.advanceTimersByTime(60000) // 放置60秒
    expect(container.querySelector('.caregiver-overlay')).toBeNull()

    // 閉じた後はホーム先頭待機を経てスキャンが進む
    vi.advanceTimersByTime(HEAD_HOLD_MS)
    expect(scanningLabel(container)).toBe('はい')
  })

  it('M3(a): パネル内操作があれば60秒の無操作タイマーが延長される', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000) // メニュー開く

    vi.advanceTimersByTime(50000)
    const panel = container.querySelector('.caregiver-panel') as HTMLElement
    fireEvent.pointerDown(panel) // 操作でタイマーが延長される

    vi.advanceTimersByTime(50000) // 合計100秒経過だが最後の操作から50秒しか経っていない
    expect(container.querySelector('.caregiver-overlay')).not.toBeNull()
  })

  it('介助者メニューの緊急解除ボタンで緊急表示が消える', () => {
    const { container, getByText } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急選択
    expect(h1Text(container)).toBe('緊急です。来てください')

    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)

    const clearButton = getByText(/緊急解除/)
    fireEvent.click(clearButton)

    expect(container.querySelector('.emergency-sub')).toBeNull()
    expect(h1Text(container)).not.toBe('緊急です。来てください')
  })

  // Issue #8: スキャンで目的の項目まで進めて選ぶ(連打無視を過ぎてから押す)
  function selectByLabel(container: HTMLElement, label: string) {
    for (let i = 0; i < 40 && scanningLabel(container) !== label; i += 1) {
      vi.advanceTimersByTime(INTERVAL_MS)
    }
    expect(scanningLabel(container)).toBe(label)
    vi.advanceTimersByTime(600)
    fireEvent.keyDown(window, { key: ' ' })
  }

  function openCaregiverMenu(container: HTMLElement) {
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)
  }

  function clickButton(root: Element, text: string) {
    const target = Array.from(root.querySelectorAll('button')).find((b) =>
      b.textContent?.includes(text),
    ) as HTMLElement
    expect(target).toBeTruthy()
    fireEvent.click(target)
  }

  it('Issue #8: 介助者が追加したフレーズはスキャンで選べ、再読み込み後も保持される', () => {
    const first = render(() => <App />)
    openCaregiverMenu(first.container)
    const editor = first.container.querySelector('.phrase-editor') as HTMLElement
    clickButton(editor, '要望')
    clickButton(editor, 'フレーズを追加')
    const rows = editor.querySelectorAll('.phrase-row')
    const inputs = rows[rows.length - 1].querySelectorAll('input')
    fireEvent.input(inputs[0], { target: { value: 'テレビ' } })
    fireEvent.input(inputs[1], { target: { value: 'テレビを見たいです' } })
    // 入力欄での打鍵では介助者メニューが閉じない
    fireEvent.keyDown(inputs[0], { key: 'a' })
    expect(first.container.querySelector('.caregiver-panel')).not.toBeNull()
    clickButton(first.container.querySelector('.caregiver-panel') as HTMLElement, '閉じる')
    first.unmount()
    cleanup()

    const second = render(() => <App />)
    selectByLabel(second.container, '快・要望')
    selectByLabel(second.container, '要望')
    selectByLabel(second.container, 'テレビ')
    expect(h1Text(second.container)).toBe('テレビを見たいです')
  })

  // 入力欄にフォーカスが残ったまま本人がスイッチを押しても、介助者メニューに取り残さない
  function openEditorWithFocusedInput() {
    const view = render(() => <App />)
    openCaregiverMenu(view.container)
    const editor = view.container.querySelector('.phrase-editor') as HTMLElement
    clickButton(editor, '要望')
    const input = editor.querySelector('.phrase-row input') as HTMLInputElement
    input.focus()
    return { ...view, input }
  }

  it.each(['a', 'あ', 'Backspace', 'ArrowLeft'])(
    'Issue #8: 入力欄で「%s」を打っても介助者メニューは閉じない',
    (key) => {
      const { container, input } = openEditorWithFocusedInput()
      fireEvent.keyDown(input, { key })
      expect(container.querySelector('.caregiver-panel')).not.toBeNull()
    },
  )

  it.each(['Enter', ' ', 'Tab', 'AudioVolumeUp', 'Escape', 'Unidentified', 'MediaPlayPause'])(
    'Issue #8: 入力欄にフォーカスが残っていても、本人のスイッチ(%s)でメニューは閉じる',
    (key) => {
      const { container, input } = openEditorWithFocusedInput()
      fireEvent.keyDown(input, { key })
      expect(container.querySelector('.caregiver-panel')).toBeNull()
    },
  )

  it('Issue #8: 入力欄での打鍵では無操作60秒の自動クローズを延ばさない', () => {
    const { container, input } = openEditorWithFocusedInput()
    for (let i = 0; i < 8; i += 1) {
      vi.advanceTimersByTime(10000)
      fireEvent.keyDown(input, { key: 'a' })
    }
    expect(container.querySelector('.caregiver-panel')).toBeNull() // 80秒後には閉じている
  })

  it('Issue #8: 取り込みは1回目は確認、2回目で既存設定の上に反映される', () => {
    window.localStorage.setItem('libra', JSON.stringify({ intervalMs: 3000 }))
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    const editor = container.querySelector('.phrase-editor') as HTMLElement
    const textarea = editor.querySelector('textarea') as HTMLTextAreaElement
    fireEvent.input(textarea, {
      target: { value: JSON.stringify({ app: 'libra', version: 1, headHoldMultiplier: 4 }) },
    })
    clickButton(editor, '取り込み')
    expect(editor.textContent).toContain('もう一度')
    expect(
      JSON.parse(window.localStorage.getItem('libra') ?? '{}').headHoldMultiplier,
    ).toBeUndefined()
    clickButton(editor, '取り込み')
    const saved = JSON.parse(window.localStorage.getItem('libra') ?? '{}')
    expect(saved.headHoldMultiplier).toBe(4)
    expect(saved.intervalMs).toBe(3000) // 取り込みに無かった項目は今の値のまま
  })

  it('Issue #8: 表示されない項目には編集画面で理由が出る', () => {
    window.localStorage.setItem(
      'libra',
      JSON.stringify({ phrases: { moodRequest: [{ id: 'c1', label: 'はい', text: 'x' }] } }),
    )
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    const editor = container.querySelector('.phrase-editor') as HTMLElement
    clickButton(editor, '要望')
    expect(editor.querySelector('[role="note"]')?.textContent).toContain('表示されません')
  })

  it('Issue #8: 編集してもスキャンの先頭は緊急、戻るは2番目のまま', () => {
    window.localStorage.setItem(
      'libra',
      JSON.stringify({ phrases: { moodRequest: [{ id: 'c1', label: 'テレビ', text: 'テレビ' }] } }),
    )
    const { container } = render(() => <App />)
    selectByLabel(container, '快・要望')
    selectByLabel(container, '要望')
    expect(scanningLabel(container)).toBe('緊急')
    expect(tileLabels(container).slice(0, 3)).toEqual(['緊急', '戻る', 'テレビ'])
  })

  it('Issue #8: 「この画面を既定に戻す」で既定のフレーズに戻る', () => {
    window.localStorage.setItem(
      'libra',
      JSON.stringify({ phrases: { moodRequest: [{ id: 'c1', label: 'テレビ', text: 'テレビ' }] } }),
    )
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    const editor = container.querySelector('.phrase-editor') as HTMLElement
    clickButton(editor, '要望')
    clickButton(editor, 'この画面を既定に戻す')
    clickButton(container.querySelector('.caregiver-panel') as HTMLElement, '閉じる')
    selectByLabel(container, '快・要望')
    selectByLabel(container, '要望')
    expect(tileLabels(container)).toContain('大丈夫')
    expect(JSON.parse(window.localStorage.getItem('libra') ?? '{}').phrases).toEqual({})
  })

  it('Issue #8: 目安(8項目)を超えると警告を出す', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      label: `L${i}`,
      text: `T${i}`,
    }))
    window.localStorage.setItem('libra', JSON.stringify({ phrases: { moodRequest: many } }))
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    const editor = container.querySelector('.phrase-editor') as HTMLElement
    clickButton(editor, '要望')
    expect(editor.querySelector('[role="alert"]')?.textContent).toContain('9 項目')
  })

  it('Issue #6: 下限0.5秒で、0.2秒のキー押下は無視され0.6秒の押下は下限到達時点で決定される', () => {
    window.localStorage.setItem('libra', JSON.stringify({ minHoldMs: 500 }))
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    vi.advanceTimersByTime(200)
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    vi.advanceTimersByTime(1000)
    expect(h1Text(container)).not.toBe('緊急です。来てください')

    // カーソルはまだ先頭(緊急)。押し始めの項目が下限に達した時点(keyUp より前)で決定される
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    vi.advanceTimersByTime(499)
    expect(h1Text(container)).not.toBe('緊急です。来てください')
    vi.advanceTimersByTime(1)
    expect(h1Text(container)).toBe('緊急です。来てください')
  })

  it('Issue #6: タップ(pointerdown/pointerup)にも同じ下限が効く', () => {
    window.localStorage.setItem('libra', JSON.stringify({ minHoldMs: 500 }))
    const { container } = render(() => <App />)
    fireEvent.pointerDown(document.body, { pointerId: 1 })
    vi.advanceTimersByTime(200)
    fireEvent.pointerUp(document.body, { pointerId: 1 })
    vi.advanceTimersByTime(1000)
    expect(h1Text(container)).not.toBe('緊急です。来てください')

    fireEvent.pointerDown(document.body, { pointerId: 1 })
    vi.advanceTimersByTime(600)
    fireEvent.pointerUp(document.body, { pointerId: 1 })
    expect(h1Text(container)).toBe('緊急です。来てください')
  })

  it('Issue #6: 離して決定モードで blur すると、離しても決定しない', () => {
    window.localStorage.setItem('libra', JSON.stringify({ activateOn: 'release' }))
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    fireEvent.blur(window)
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    expect(h1Text(container)).not.toBe('緊急です。来てください')
  })

  it('Issue #6: 押している間に項目の並びが変わったら、別の項目(緊急など)を実行せず無視する', () => {
    window.localStorage.setItem('libra', JSON.stringify({ minHoldMs: 1500 }))
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // index1=はい
    expect(scanningLabel(container)).toBe('はい')
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    vi.advanceTimersByTime(1500)
    fireEvent.keyUp(window, { key: ' ', code: 'Space' }) // はい → home(取り消しが1周だけ出る)
    expect(h1Text(container)).toBe('はい')

    // 取り消しを含む7項目の末尾(文字盤)で押し始める。押している間に1周して取り消しが消える
    vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 5 + 500)
    expect(scanningLabel(container)).toBe('文字盤')
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    vi.advanceTimersByTime(1500)
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    expect(h1Text(container)).toBe('はい')
    expect(container.querySelector('.letter-strip')).toBeNull()
  })

  it('Issue #6: 離して決定モードでは押下中は実行されず、離した時点で実行される', () => {
    window.localStorage.setItem('libra', JSON.stringify({ activateOn: 'release' }))
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ', code: 'Space' }) // index0=緊急
    expect(h1Text(container)).not.toBe('緊急です。来てください')
    vi.advanceTimersByTime(100)
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    expect(h1Text(container)).toBe('緊急です。来てください')
  })

  // Issue #12: 痛みの強さ・快/要望・気分
  it('Issue #12: 不快→痛い→胸→とても が「胸がとても痛いです」(緊急色)として伝わる', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '不快')
    selectByLabel(container, '痛い')
    selectByLabel(container, '胸')
    expect(tileLabels(container)).toEqual(['緊急', '戻る', '場所だけ', '少し', 'かなり', 'とても'])
    expect(h1Text(container)).not.toBe('胸がとても痛いです') // まだ伝達していない
    selectByLabel(container, 'とても')
    expect(h1Text(container)).toBe('胸がとても痛いです')
    expect(document.documentElement.dataset.messageTone).toBe('urgent')
    expect(scanningLabel(container)).toBe('緊急') // ホーム先頭に戻る
  })

  it('Issue #12: 場所だけでも伝達できる(強さを選ばなくてよい)', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '不快')
    selectByLabel(container, '痛い')
    selectByLabel(container, '頭')
    selectByLabel(container, '場所だけ')
    expect(h1Text(container)).toBe('頭が痛いです')
  })

  it('Issue #12: 痛みを伝えた直後は「取り消し」で戻せる', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '不快')
    selectByLabel(container, '痛い')
    selectByLabel(container, '頭')
    selectByLabel(container, '少し')
    expect(h1Text(container)).toBe('頭が少し痛いです')
    selectByLabel(container, '取り消し')
    expect(h1Text(container)).toBe('選んだ内容がここに大きく出ます')
  })

  it('Issue #12/#44: 緊急中の痛みは緊急状態を保ち、独立した直前の伝達に出る', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急
    selectByLabel(container, '戻る') // home へ
    selectByLabel(container, '不快')
    selectByLabel(container, '痛い')
    selectByLabel(container, '胸')
    selectByLabel(container, 'とても')
    expect(h1Text(container)).toBe('緊急です。来てください')
    expect(container.querySelector('.message-panel h1')?.textContent).toBe('胸がとても痛いです')
  })

  it('Issue #12: 強さの画面でも先頭は緊急、戻るで痛い場所へ戻れる', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '不快')
    selectByLabel(container, '痛い')
    selectByLabel(container, 'おなか')
    expect(scanningLabel(container)).toBe('緊急')
    selectByLabel(container, '戻る')
    expect(tileLabels(container)).toContain('おなか') // 痛い場所の一覧
  })

  it('Issue #12: 快・要望の「続けて」を選ぶと伝わる', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '快・要望')
    selectByLabel(container, '続けて')
    expect(h1Text(container)).toBe('続けてください')
  })

  it('Issue #12: 快・要望 → 要望 → 大丈夫、快・要望 → 気分 → 不安 の2段階で伝わる', () => {
    const first = render(() => <App />)
    selectByLabel(first.container, '快・要望')
    selectByLabel(first.container, '要望')
    selectByLabel(first.container, '大丈夫')
    expect(h1Text(first.container)).toBe('大丈夫です')
    first.unmount()
    cleanup()

    const second = render(() => <App />)
    selectByLabel(second.container, '快・要望')
    selectByLabel(second.container, '気分')
    selectByLabel(second.container, '不安')
    expect(h1Text(second.container)).toBe('不安です')
  })

  // Issue #13: 本人への触覚フィードバック(はい/いいえ・緊急・解除が区別できる)
  const vibrateMock = () => (navigator as unknown as { vibrate: ReturnType<typeof vi.fn> }).vibrate
  const lastVibration = () => {
    const calls = vibrateMock().mock.calls
    return calls[calls.length - 1]?.[0]
  }

  it('Issue #13: はい(長め1回)といいえ(長め2回)を別パターンで返す', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, 'はい')
    expect(lastVibration()).toEqual(HAPTIC_PATTERNS.yes)
    vi.advanceTimersByTime(HEAD_HOLD_MS)
    selectByLabel(container, 'いいえ')
    expect(lastVibration()).toEqual(HAPTIC_PATTERNS.no)
  })

  it('Issue #13: 画面遷移(受理)は軽い短い振動、緊急は専用パターン', () => {
    const { container } = render(() => <App />)
    selectByLabel(container, '不快')
    expect(lastVibration()).toEqual(HAPTIC_PATTERNS.accepted)
    selectByLabel(container, '緊急')
    expect(lastVibration()).toEqual(HAPTIC_PATTERNS.emergency)
  })

  it('Issue #13: 緊急の呼び出し中は警告音と同じ周期で振動し、解除で専用パターンが出て止まる', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急
    vibrateMock().mockClear()
    vi.advanceTimersByTime(3000)
    expect(lastVibration()).toEqual(HAPTIC_PATTERNS.emergencyActive)

    openCaregiverMenu(container)
    clickButton(container.querySelector('.caregiver-panel') as HTMLElement, '緊急解除')
    expect(lastVibration()).toEqual(HAPTIC_PATTERNS.cleared)
    vibrateMock().mockClear()
    vi.advanceTimersByTime(10000)
    expect(vibrateMock()).not.toHaveBeenCalled()
  })

  it('Issue #13: 緊急中に本人が「はい」を選んだ直後は、周期の振動が重なって打ち消さない', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急 → urgentDetail
    selectByLabel(container, '戻る') // home へ
    selectByLabel(container, 'はい')
    expect(lastVibration()).toEqual(HAPTIC_PATTERNS.yes)
    vi.advanceTimersByTime(2900) // 周期(3秒)が来ても、直前の本人の振動を打ち消さない
    expect(lastVibration()).toEqual(HAPTIC_PATTERNS.yes)
    vi.advanceTimersByTime(3200)
    expect(lastVibration()).toEqual(HAPTIC_PATTERNS.emergencyActive) // その後は周期の振動に戻る
  })

  it('Issue #13: 設定の強さが振動パターンに反映され、OFF なら振動しない', () => {
    window.localStorage.setItem('libra', JSON.stringify({ hapticsStrength: 'strong' }))
    const strong = render(() => <App />)
    selectByLabel(strong.container, 'はい')
    expect(lastVibration()).toEqual(feedbackPattern('yes', 'strong'))
    strong.unmount()
    cleanup()

    window.localStorage.setItem('libra', JSON.stringify({ hapticsEnabled: false }))
    vibrateMock().mockClear()
    const off = render(() => <App />)
    selectByLabel(off.container, 'はい')
    expect(vibrateMock()).not.toHaveBeenCalled()
  })

  it('Issue #13: 触覚OFFで音声モードが「効果音だけ」のときは、従来の短い振動を出す', () => {
    window.localStorage.setItem(
      'libra',
      JSON.stringify({ hapticsEnabled: false, voiceMode: 'tone' }),
    )
    const { container } = render(() => <App />)
    selectByLabel(container, 'はい')
    expect(lastVibration()).toBe(35)
  })

  it('Issue #13: 触覚ONでは、音声モード「効果音だけ」の短い振動がはい/いいえのパターンを打ち消さない', () => {
    window.localStorage.setItem('libra', JSON.stringify({ voiceMode: 'tone' }))
    const { container } = render(() => <App />)
    selectByLabel(container, 'はい')
    expect(lastVibration()).toEqual(HAPTIC_PATTERNS.yes)
  })

  // Issue #14: モールス。押している長さが符号になる(短い=・、長い=－)
  function tap(ms: number) {
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    vi.advanceTimersByTime(ms)
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    vi.advanceTimersByTime(150)
  }
  const DOT = 100
  const DASH = 600
  function sendCode(code: string) {
    for (const symbol of code) tap(symbol === '.' ? DOT : DASH)
  }
  function enterMorse() {
    window.localStorage.setItem('libra', JSON.stringify({ morseEnabled: true }))
    const view = render(() => <App />)
    selectByLabel(view.container, 'モールス')
    expect(view.container.querySelector('.morse-panel')).not.toBeNull()
    return view
  }
  const morseTextOf = (container: HTMLElement) =>
    container.querySelector('.morse-text')?.textContent ?? ''

  it('Issue #14: 既定ではホームにモールスの入口が出ない', () => {
    const { container } = render(() => <App />)
    expect(tileLabels(container)).not.toContain('モールス')
  })

  it('Issue #14: ON にすると入口が出て、短押し・長押しで「めかね」を入力できる', () => {
    const { container } = enterMorse()
    for (const code of ['-...-', '.-..', '--.-']) {
      sendCode(code)
      vi.advanceTimersByTime(1600) // 文字の確定
    }
    expect(morseTextOf(container)).toBe('めかね')
  })

  it('Issue #14: モールス中はスキャンのカーソルが動かず、押下は項目を選ばない', () => {
    const { container } = enterMorse()
    const before = scanningLabel(container)
    vi.advanceTimersByTime(10000)
    expect(scanningLabel(container)).toBe(before) // カーソルは動かない
    expect(container.querySelector('.grid-board.is-hidden')).not.toBeNull()
    sendCode('.-')
    expect(h1Text(container)).not.toBe('緊急です。来てください')
    expect(container.querySelector('.morse-panel')).not.toBeNull()
  })

  it('Issue #14: 長押し5つの連続で、確定を待たず即緊急(警告音も鳴る)', () => {
    const { container } = enterMorse()
    oscillatorStartCount = 0
    sendCode('----')
    expect(h1Text(container)).not.toBe('緊急です。来てください') // 4つではまだ
    sendCode('-')
    expect(h1Text(container)).toBe('緊急です。来てください')
    expect(oscillatorStartCount).toBeGreaterThan(0)
    expect(container.querySelector('.morse-panel')).toBeNull() // スキャンの緊急詳細へ
    expect(scanningLabel(container)).toBe('戻る')
  })

  it('Issue #14: ゆっくり押す人(0.9秒押して0.7秒空ける)でも、－5つで緊急に届く', () => {
    const { container } = enterMorse()
    for (let i = 0; i < 5; i += 1) {
      fireEvent.keyDown(window, { key: ' ', code: 'Space' })
      vi.advanceTimersByTime(900)
      fireEvent.keyUp(window, { key: ' ', code: 'Space' })
      vi.advanceTimersByTime(700)
    }
    expect(h1Text(container)).toBe('緊急です。来てください')
  })

  it('Issue #14: 介助者メニューを開いている間は、裏で語の区切りが入ったり自動復帰したりしない', () => {
    const { container } = enterMorse()
    sendCode('.-')
    openCaregiverMenu(container) // 開くまでの2秒で「い」が確定する
    expect(morseTextOf(container)).toBe('い')
    vi.advanceTimersByTime(40000) // 語の区切り(4秒)も無操作の復帰(30秒)も、裏では進まない
    expect(morseTextOf(container)).toBe('い')
    expect(container.querySelector('.morse-panel')).not.toBeNull()
  })

  it('Issue #14: 直前に誤って短押しが入っていても、続けて長押し5つで緊急になる', () => {
    const { container } = enterMorse()
    sendCode('.')
    sendCode('-----')
    expect(h1Text(container)).toBe('緊急です。来てください')
  })

  it('Issue #14: 短押し5つ+待つ でスキャンへ戻り、入力途中の文字列は残る', () => {
    const { container } = enterMorse()
    sendCode('.-')
    vi.advanceTimersByTime(1600)
    expect(morseTextOf(container)).toBe('い')
    sendCode('.....')
    vi.advanceTimersByTime(1600)
    expect(container.querySelector('.morse-panel')).toBeNull()
    expect(scanningLabel(container)).toBe('緊急') // スキャンが再開している
    selectByLabel(container, 'モールス')
    expect(morseTextOf(container)).toBe('い')
  })

  it('Issue #14: 無操作が続くと、本人が取り残されずスキャンへ戻る', () => {
    const { container } = enterMorse()
    vi.advanceTimersByTime(30500)
    expect(container.querySelector('.morse-panel')).toBeNull()
    expect(scanningLabel(container)).toBe('緊急')
  })

  it('Issue #14: 確定の符号で入力した文字列を伝達として表示しホームへ戻る', () => {
    const { container } = enterMorse()
    sendCode('.-')
    vi.advanceTimersByTime(1600)
    sendCode('.-.-.-')
    vi.advanceTimersByTime(1600)
    expect(h1Text(container)).toBe('い')
    expect(container.querySelector('.morse-panel')).toBeNull()
  })

  it('Issue #14: 押している間は符号の見込みを表示する', () => {
    const { container } = enterMorse()
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    vi.advanceTimersByTime(700)
    expect(container.querySelector('.morse-code.holding')).not.toBeNull()
    fireEvent.keyUp(window, { key: ' ', code: 'Space' })
    expect(container.querySelector('.morse-code.holding')).toBeNull()
  })

  it('Issue #14: 介助者メニューにモールスの設定が出る(ON のときだけ時間の設定)', () => {
    const { container } = render(() => <App />)
    openCaregiverMenu(container)
    const panel = container.querySelector('.caregiver-panel') as HTMLElement
    expect(panel.textContent).toContain('モールス入力を使う')
    expect(panel.textContent).not.toContain('長押し(－)の境目')
    const checkbox = Array.from(panel.querySelectorAll('label'))
      .find((l) => l.textContent?.includes('モールス入力を使う'))
      ?.querySelector('input') as HTMLInputElement
    fireEvent.click(checkbox)
    expect(panel.textContent).toContain('長押し(－)の境目')
    expect(JSON.parse(window.localStorage.getItem('libra') ?? '{}').morseEnabled).toBe(true)
  })

  it('?dev なしでは数字キー "3" はカーソル位置の項目を実行する(直接ジャンプしない)', () => {
    const { container } = render(() => <App />)
    // カーソルは index0(緊急)。"3"キーは index2(いいえ)への直接ジャンプではなく
    // カーソル位置(緊急)を実行するはず
    fireEvent.keyDown(window, { key: '3' })
    expect(h1Text(container)).toBe('緊急です。来てください')
  })

  it('M1: 押下→画面遷移→連打無視区間内の2回目は遷移先の先頭を誤って実行しない', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
    fireEvent.keyDown(window, { key: ' ' }) // はい選択 → home先頭(緊急)へ遷移
    expect(h1Text(container)).toBe('はい')

    vi.advanceTimersByTime(100) // debounceMs(500)未満
    fireEvent.keyDown(window, { key: ' ' }) // 連打: 遷移先の先頭(緊急)を誤って実行してはいけない
    expect(h1Text(container)).toBe('はい')
    expect(h1Text(container)).not.toBe('緊急です。来てください')
  })

  it('S4: 聴覚スキャンON時、画面遷移直後にも先頭項目(通常は緊急)を読む', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000) // メニューが開く
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox) // 聴覚スキャンON
    const closeButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '閉じる',
    ) as HTMLElement
    fireEvent.click(closeButton) // home へ戻る(この goTo は検証対象外)

    const speak = (window as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } })
      .speechSynthesis.speak as ReturnType<typeof vi.fn>
    speak.mockClear()

    // home: 0緊急,1はい,2いいえ,3不快→,... index3まで進めて不快へ遷移する
    vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 2)
    expect(scanningLabel(container)).toBe('不快')
    fireEvent.keyDown(window, { key: ' ' }) // discomfort へ遷移(goTo)

    expect(speak).toHaveBeenCalled()
    const lastUtterance = speak.mock.calls[speak.mock.calls.length - 1][0] as { text: string }
    expect(lastUtterance.text).toBe('緊急')
  })

  it('Issue #3 追加指示: navigate タイルの聴覚スキャン読み上げはラベルのみ(山形アイコン・予告の記号は読まない)', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox) // 聴覚スキャンON
    const closeButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '閉じる',
    ) as HTMLElement
    fireEvent.click(closeButton) // home へ戻る

    const speak = (window as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } })
      .speechSynthesis.speak as ReturnType<typeof vi.fn>
    speak.mockClear()

    // home: 0緊急,1はい,2いいえ,3不快(navigate) までカーソルを進める
    vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 2)
    expect(scanningLabel(container)).toBe('不快')

    expect(speak).toHaveBeenCalled()
    const lastUtterance = speak.mock.calls[speak.mock.calls.length - 1][0] as { text: string }
    expect(lastUtterance.text).toBe('不快')
    expect(lastUtterance.text).not.toContain('→')
    expect(lastUtterance.text).not.toContain('…')
    expect(lastUtterance.text).not.toContain('・')
  })

  it('S-new-1/nit: 伝達の読み上げは画面遷移直後の読み上げ1回だけ打ち切られず、その次のカーソル移動は通常どおりcancelされる', () => {
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000) // メニューが開く
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox) // 聴覚スキャンON
    const fullVoiceButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '全部読む',
    ) as HTMLElement
    fireEvent.click(fullVoiceButton) // 音声モードを全部読むに(伝達自体も読み上げさせる)
    const closeButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '閉じる',
    ) as HTMLElement
    fireEvent.click(closeButton) // home へ戻る(この goTo は検証対象外)

    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい(カーソル移動の読み上げも入る)

    const speak = (window as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } })
      .speechSynthesis.speak as ReturnType<typeof vi.fn>
    const cancel = (window as unknown as { speechSynthesis: { cancel: ReturnType<typeof vi.fn> } })
      .speechSynthesis.cancel as ReturnType<typeof vi.fn>
    const calls: string[] = []
    speak.mockImplementation((utterance: { text: string }) => calls.push(`speak:${utterance.text}`))
    cancel.mockImplementation(() => calls.push('cancel'))

    fireEvent.keyDown(window, { key: ' ' }) // はい選択(announce) → home先頭(緊急)へ遷移(goTo)

    // announce('はい') が cancel してから speak し、goTo直後の先頭読み上げ(緊急)は
    // それを打ち切らずに(cancel を挟まず)後ろに積まれる
    const yesIndex = calls.indexOf('speak:はい')
    expect(yesIndex).toBeGreaterThanOrEqual(0)
    expect(calls[yesIndex + 1]).toBe('speak:緊急')

    // nit: 素通しは1回だけ。その次の通常のカーソル移動の読み上げは従来どおり cancel される
    // (この時点の home は伝達直後の1周なので index1=取り消し)
    vi.advanceTimersByTime(HEAD_HOLD_MS)
    expect(calls[calls.length - 2]).toBe('cancel')
    expect(calls[calls.length - 1]).toBe('speak:取り消し')
  })

  // 聴覚スキャンON + 音声モード全部読む にして介助者メニューを閉じるところまでの共通セットアップ
  function enableAuditoryScanAndFullVoice(container: HTMLElement) {
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement
    fireEvent.click(checkbox)
    const fullVoiceButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '全部読む',
    ) as HTMLElement
    fireEvent.click(fullVoiceButton)
    const closeButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '閉じる',
    ) as HTMLElement
    fireEvent.click(closeButton) // home へ戻る(この goTo は検証対象外)
  }

  function captureSpeechCalls(): string[] {
    const speak = (window as unknown as { speechSynthesis: { speak: ReturnType<typeof vi.fn> } })
      .speechSynthesis.speak as ReturnType<typeof vi.fn>
    const cancel = (window as unknown as { speechSynthesis: { cancel: ReturnType<typeof vi.fn> } })
      .speechSynthesis.cancel as ReturnType<typeof vi.fn>
    const calls: string[] = []
    speak.mockImplementation((utterance: { text: string }) => calls.push(`speak:${utterance.text}`))
    cancel.mockImplementation(() => calls.push('cancel'))
    return calls
  }

  it('S-new-6: 緊急詳細の読み上げが遷移直後の先頭読み上げで打ち切られない', () => {
    const { container } = render(() => <App />)
    enableAuditoryScanAndFullVoice(container)

    fireEvent.keyDown(window, { key: ' ' }) // home index0=緊急 → urgentDetail

    // urgentDetail: 0戻る,1苦しい（成立済みの緊急タイルは重複させない）
    vi.advanceTimersByTime(HEAD_HOLD_MS) // index1=苦しい

    const calls = captureSpeechCalls()
    fireEvent.keyDown(window, { key: ' ' }) // 苦しい選択(announce) → home先頭(緊急)へ遷移(goTo)

    const detailIndex = calls.findIndex((c) => c === 'speak:緊急です。来てください。苦しい')
    expect(detailIndex).toBeGreaterThanOrEqual(0)
    // cancel を挟まずに後ろへ積まれる
    expect(calls[detailIndex + 1]).toBe('speak:緊急')
  })

  it('S-new-6: 緊急中の伝達(はい等)の読み上げも遷移直後の先頭読み上げで打ち切られない', () => {
    const { container } = render(() => <App />)
    enableAuditoryScanAndFullVoice(container)

    fireEvent.keyDown(window, { key: ' ' }) // home index0=緊急 → urgentDetail
    vi.advanceTimersByTime(600) // 連打無視を超える。urgentDetail index0=戻る
    fireEvent.keyDown(window, { key: ' ' }) // home へ戻る(緊急は継続)

    // home(緊急中、取り消し無し): 0緊急,1はい,2いいえ,...
    vi.advanceTimersByTime(HEAD_HOLD_MS) // index1=はい

    const calls = captureSpeechCalls()
    fireEvent.keyDown(window, { key: ' ' }) // はい選択(emergencyActive分岐のannounce) → home先頭(緊急)へ

    const yesIndex = calls.indexOf('speak:はい')
    expect(yesIndex).toBeGreaterThanOrEqual(0)
    expect(calls[yesIndex + 1]).toBe('speak:緊急')
  })

  it('S1: 緊急詳細は積み上げ式で表示され、緊急の再選択でも消えない', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // home index0=緊急 → urgentDetail
    expect(scanningLabel(container)).toBe('戻る')

    // urgentDetail: 0戻る,1苦しい,2痛い,...
    vi.advanceTimersByTime(HEAD_HOLD_MS) // index1=苦しい
    expect(scanningLabel(container)).toBe('苦しい')
    fireEvent.keyDown(window, { key: ' ' }) // 苦しい選択 → home
    expect(container.querySelector('.emergency-details')?.textContent).toContain('苦しい')

    // 緊急を再選択しても詳細は消えない(home index0はまだ先頭待機中)
    vi.advanceTimersByTime(600) // 連打無視(500ms)を超えて次の押下を有効にする
    fireEvent.keyDown(window, { key: ' ' })
    expect(h1Text(container)).toBe('緊急です。来てください')
    expect(container.querySelector('.emergency-details')?.textContent).toContain('苦しい')

    // 別の詳細(痛い)を追加すると積み上がる
    vi.advanceTimersByTime(HEAD_HOLD_MS) // 選択済みの苦しいは除外され、index1=痛い
    expect(scanningLabel(container)).toBe('痛い')
    fireEvent.keyDown(window, { key: ' ' })
    const detailsText = container.querySelector('.emergency-details')?.textContent
    expect(detailsText).toContain('苦しい')
    expect(detailsText).toContain('痛い')
  })

  it('S2: 緊急発生時に取り消しの猶予を終わらせ、解除後も取り消しが復活しない', () => {
    const { container } = render(() => <App />)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
    fireEvent.keyDown(window, { key: ' ' }) // はい → home、取り消し表示
    expect(tileLabels(container)).toContain('取り消し')

    vi.advanceTimersByTime(600) // 連打無視を超えて次の押下を有効にする(先頭待機中なのでindex0のまま)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急を選択
    expect(h1Text(container)).toBe('緊急です。来てください')

    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000) // 介助者メニューが開く
    const clearButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('緊急解除'),
    ) as HTMLElement
    fireEvent.click(clearButton)
    const closeButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === '閉じる',
    ) as HTMLElement
    fireEvent.click(closeButton)

    expect(tileLabels(container)).not.toContain('取り消し')
  })

  it('S6: voiceMode=off でも緊急選択で警告音(oscillator)が鳴る', () => {
    render(() => <App />)
    expect(oscillatorStartCount).toBe(0)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急選択(音声モードは既定でOFF)
    expect(oscillatorStartCount).toBeGreaterThan(0)
  })

  it('S6: 緊急解除でアラームが止まる(以後 oscillator が増えない)', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急選択
    vi.advanceTimersByTime(3000) // アラーム周期を1回進める
    const countBeforeClear = oscillatorStartCount
    expect(countBeforeClear).toBeGreaterThan(0)

    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)
    const clearButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('緊急解除'),
    ) as HTMLElement
    fireEvent.click(clearButton)

    vi.advanceTimersByTime(10000) // アラーム周期を何度も進める
    expect(oscillatorStartCount).toBe(countBeforeClear)
  })

  it('nit: 取り消しで戻したメッセージのトーン(緊急以外)も復元される', () => {
    const { container } = render(() => <App />)
    // 「はい」(positive) を表示させてから「いいえ」(neutral)を選ぶと、取り消しで
    // 「はい」のトーン(positive)まで復元されるべき
    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
    fireEvent.keyDown(window, { key: ' ' }) // はい(positive) → home
    expect(document.documentElement.dataset.messageTone).toBe('positive')

    // home(取り消しあり): 0緊急,1取り消し,2はい,3いいえ,...
    vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 2) // index3=いいえ
    expect(scanningLabel(container)).toBe('いいえ')
    fireEvent.keyDown(window, { key: ' ' }) // いいえ(neutral) → home
    expect(document.documentElement.dataset.messageTone).toBe('neutral')

    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=取り消し
    expect(scanningLabel(container)).toBe('取り消し')
    fireEvent.keyDown(window, { key: ' ' }) // 取り消し → 「はい」に戻る
    expect(h1Text(container)).toBe('はい')
    expect(document.documentElement.dataset.messageTone).toBe('positive')
  })

  it('nit: AudioContextがrunningでない間は警告音停止中の表示が出て、runningになると消える', () => {
    // alarm.ts はモジュール内に audioContext をキャッシュし他テストとも共有されるため、
    // getAlarmAudioStatus 自体を spy して状態を確定的に制御する
    const statusSpy = vi.spyOn(alarmModule, 'getAlarmAudioStatus').mockReturnValue('not-running')
    const { container } = render(() => <App />)
    expect(container.querySelector('.audio-status-hint')).not.toBeNull()

    statusSpy.mockReturnValue('running')
    vi.advanceTimersByTime(500) // ポーリング反映
    expect(container.querySelector('.audio-status-hint')).toBeNull()
  })

  it('nit: not-running のままではヒントが出続ける', () => {
    const statusSpy = vi.spyOn(alarmModule, 'getAlarmAudioStatus').mockReturnValue('not-running')
    const { container } = render(() => <App />)
    expect(container.querySelector('.audio-status-hint')).not.toBeNull()

    vi.advanceTimersByTime(2000) // 何度ポーリングしても not-running のままならヒントは残る
    expect(container.querySelector('.audio-status-hint')).not.toBeNull()
    expect(statusSpy).toHaveBeenCalled()
  })

  it('S-new-4: 「警告音停止中」表示にはdata-caregiver-controlが無く、その位置へのタップはスイッチとして扱われる', () => {
    vi.spyOn(alarmModule, 'getAlarmAudioStatus').mockReturnValue('not-running')
    const { container } = render(() => <App />)
    const hint = container.querySelector('.audio-status-hint') as HTMLElement
    expect(hint).not.toBeNull()
    expect(hint.closest('[data-caregiver-control]')).toBeNull()

    // pointer-events:none は実ブラウザでのヒットテストにのみ影響するため、jsdom上では
    // このタップがハンドラの除外対象(data-caregiver-control)に当たらないことを確認する
    fireEvent.pointerDown(hint) // カーソルは index0(緊急、先頭待機中)
    expect(container.querySelector('.emergency-status-message')?.textContent).toBe(
      '緊急です。来てください',
    )
  })

  it('Issue #5: 介助者メニューに Wake Lock 取得中の状態が表示される', () => {
    vi.spyOn(wakeLockModule, 'initWakeLock').mockImplementation((notify) => {
      notify?.('active')
      return () => {}
    })
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000) // メニュー開く

    const status = container.querySelector('.caregiver-status') as HTMLElement
    expect(status.textContent).toBe('画面スリープ防止: 有効')
    expect(status.classList.contains('warn')).toBe(false)
  })

  it('Issue #5: Wake Lock が非対応/失敗のときは端末の自動ロック解除を促す表示になる', () => {
    vi.spyOn(wakeLockModule, 'initWakeLock').mockImplementation((notify) => {
      notify?.('unsupported')
      return () => {}
    })
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)

    const status = container.querySelector('.caregiver-status') as HTMLElement
    expect(status.textContent).toBe('画面スリープ防止: 無効 — 端末の自動ロックを切ってください')
    expect(status.classList.contains('warn')).toBe(true)
  })

  it('Issue #5: requestFullscreen 非対応環境では「全画面にする」ボタンを出さない', () => {
    const original = document.documentElement.requestFullscreen
    // @ts-expect-error テストのため非対応を模す
    delete document.documentElement.requestFullscreen
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)

    const fullscreenButton = Array.from(container.querySelectorAll('.caregiver-action')).find(
      (el) => el.textContent?.includes('全画面'),
    )
    expect(fullscreenButton).toBeUndefined()
    document.documentElement.requestFullscreen = original
  })

  it('Issue #5: 「全画面にする」ボタンで requestFullscreen が呼ばれる', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    document.documentElement.requestFullscreen = requestFullscreen
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)

    const fullscreenButton = Array.from(container.querySelectorAll('.caregiver-action')).find(
      (el) => el.textContent?.includes('全画面'),
    ) as HTMLElement
    fireEvent.click(fullscreenButton)
    expect(requestFullscreen).toHaveBeenCalled()
  })

  it('PR#11 should-1: 介助者メニューにオフライン準備完了の状態が表示される', () => {
    vi.spyOn(offlineReadyModule, 'initOfflineReadyWatch').mockImplementation((notify) => {
      notify?.('ready')
      return () => {}
    })
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)

    const statuses = Array.from(container.querySelectorAll('.caregiver-status'))
    const offlineStatus = statuses.find((el) => el.textContent?.includes('オフライン準備'))
    expect(offlineStatus?.textContent).toBe('オフライン準備: 完了')
    expect(offlineStatus?.classList.contains('warn')).toBe(false)
  })

  it('PR#11 should-1: オフライン未準備のときは警告表示になる', () => {
    vi.spyOn(offlineReadyModule, 'initOfflineReadyWatch').mockImplementation((notify) => {
      notify?.('not-ready')
      return () => {}
    })
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)

    const statuses = Array.from(container.querySelectorAll('.caregiver-status'))
    const offlineStatus = statuses.find((el) => el.textContent?.includes('オフライン準備'))
    expect(offlineStatus?.textContent).toBe('オフライン準備: 未完了')
    expect(offlineStatus?.classList.contains('warn')).toBe(true)
  })

  it('nit-3: すでに Fullscreen API で全画面のときは「全画面にする」ボタンを出さない', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    document.documentElement.requestFullscreen = requestFullscreen
    Object.defineProperty(document, 'fullscreenElement', {
      value: document.documentElement,
      configurable: true,
    })
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)

    const fullscreenButton = Array.from(container.querySelectorAll('.caregiver-action')).find(
      (el) => el.textContent?.includes('全画面'),
    )
    expect(fullscreenButton).toBeUndefined()
    Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true })
  })

  it('nit-3: display-mode:fullscreen で起動済み(PWA)のときも「全画面にする」ボタンを出さない', () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    document.documentElement.requestFullscreen = requestFullscreen
    const matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
    ;(window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia = matchMedia
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)

    const fullscreenButton = Array.from(container.querySelectorAll('.caregiver-action')).find(
      (el) => el.textContent?.includes('全画面'),
    )
    expect(fullscreenButton).toBeUndefined()
  })

  it('PR#11 must-4: スキャン対象が変わるたびに scrollIntoView が呼ばれる', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    render(() => <App />)
    scrollIntoView.mockClear()

    vi.advanceTimersByTime(HEAD_HOLD_MS) // 先頭待機終了、index1へ進む
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  })

  it('PR#11 3巡目 should-B: 介助者メニューを開くたびにオフライン準備状態を再計算する', () => {
    const recheck = vi.spyOn(offlineReadyModule, 'recheckOfflineReady').mockResolvedValue(undefined)
    const { container } = render(() => <App />)
    const button = container.querySelector('.caregiver-button') as HTMLElement

    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)
    expect(recheck).toHaveBeenCalledTimes(1)

    // オーバーレイ外タップで閉じてホームへ戻り、もう一度開くと再度呼ぶ
    const overlay = container.querySelector('.caregiver-overlay') as HTMLElement
    fireEvent.pointerDown(overlay)
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)
    expect(recheck).toHaveBeenCalledTimes(2)
  })

  it('設定変更がリロード相当（再マウント）後も localStorage から復元される', () => {
    const first = render(() => <App />)
    const button = first.container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button)
    vi.advanceTimersByTime(2000)
    const slider = first.container.querySelector(
      'input[type="range"][min="500"]',
    ) as HTMLInputElement
    fireEvent.input(slider, { target: { value: '2500' } })
    first.unmount()

    const second = render(() => <App />)
    const button2 = second.container.querySelector('.caregiver-button') as HTMLElement
    fireEvent.pointerDown(button2)
    vi.advanceTimersByTime(2000)
    expect(second.container.textContent).toContain('スキャン間隔: 2.5 秒')
  })

  describe('libra#17: 緊急状態の保存と再起動後の復元', () => {
    const KEY = 'libra:emergency'
    const stored = () => {
      const raw = window.localStorage.getItem(KEY)
      return raw === null ? null : JSON.parse(raw)
    }
    const clearEmergencyViaMenu = (container: HTMLElement) => {
      const button = container.querySelector('.caregiver-button') as HTMLElement
      fireEvent.pointerDown(button)
      vi.advanceTimersByTime(2000)
      const clearButton = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('緊急解除'),
      ) as HTMLElement
      fireEvent.click(clearButton)
    }
    const closeCaregiverMenu = (container: HTMLElement) => {
      const closeButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === '閉じる',
      ) as HTMLElement
      fireEvent.click(closeButton)
    }

    it('緊急を選ぶと保存され、通常起動では何も保存されない', () => {
      const { container } = render(() => <App />)
      expect(window.localStorage.getItem(KEY)).toBeNull()
      fireEvent.keyDown(window, { key: ' ' }) // 緊急
      expect(h1Text(container)).toBe('緊急です。来てください')
      expect(stored()).toEqual({ active: true, details: [], sub: null })
    })

    it('詳細・副表示ごと再マウントで復元され、警告音が再開し、振動・読み上げは出ない', () => {
      const first = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急 → urgentDetail
      vi.advanceTimersByTime(HEAD_HOLD_MS) // index1=苦しい
      fireEvent.keyDown(window, { key: ' ' }) // 苦しい → home
      vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
      fireEvent.keyDown(window, { key: ' ' }) // はい → 副表示
      expect(stored()).toEqual({ active: true, details: ['苦しい'], sub: 'はい' })
      first.unmount()
      cleanup()
      // 復元で urgent が立つことを確認するため、前回の値を消しておく
      delete document.documentElement.dataset.messageTone

      oscillatorStartCount = 0
      const vibrate = vi.fn()
      ;(navigator as unknown as { vibrate?: unknown }).vibrate = vibrate
      const speak = vi.fn()
      ;(window as unknown as { speechSynthesis?: unknown }).speechSynthesis = {
        cancel: vi.fn(),
        speak,
      }

      const second = render(() => <App />)
      expect(h1Text(second.container)).toBe('緊急です。来てください')
      expect(document.documentElement.dataset.messageTone).toBe('neutral')
      expect(second.container.querySelector('.emergency-details')?.textContent).toContain('苦しい')
      expect(second.container.querySelector('.message-panel-label')?.textContent).toBe(
        '直前に伝えたこと',
      )
      expect(second.container.querySelector('.message-panel h1')?.textContent).toBe('はい')
      expect(oscillatorStartCount).toBeGreaterThan(0)
      expect(vibrate).not.toHaveBeenCalled() // 復元の直後に、緊急発生時の振動は出さない
      vi.advanceTimersByTime(3000)
      const afterOneCycle = oscillatorStartCount
      vi.advanceTimersByTime(3000)
      expect(oscillatorStartCount).toBeGreaterThan(afterOneCycle)
      // 呼び出し中の周期の振動(#13)だけが、警告音と同じ周期で出る
      expect(vibrate).toHaveBeenCalled()
      for (const call of vibrate.mock.calls) {
        expect(call[0]).toEqual(HAPTIC_PATTERNS.emergencyActive)
      }
      expect(speak).not.toHaveBeenCalled()
    })

    it('解除→伝達→取り消しでも、緊急でないのに赤い緊急文言は戻らない', () => {
      const { container } = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急
      expect(h1Text(container)).toBe('緊急です。来てください')
      clearEmergencyViaMenu(container)
      closeCaregiverMenu(container)
      vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
      fireEvent.keyDown(window, { key: ' ' }) // はい
      expect(h1Text(container)).toBe('はい')
      vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=取り消し
      fireEvent.keyDown(window, { key: ' ' }) // 取り消し
      expect(h1Text(container)).toBe('選んだ内容がここに大きく出ます')
      expect(document.documentElement.dataset.messageTone).toBe('neutral')
    })

    it('緊急なしの解除ボタンは無効で、取り消し履歴は消えない(A→解除→B→取り消し→A)', () => {
      const { container } = render(() => <App />)
      vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
      fireEvent.keyDown(window, { key: ' ' }) // はい (A)
      expect(h1Text(container)).toBe('はい')
      clearEmergencyViaMenu(container) // 緊急なしの解除ボタン(disabled で何も起きない)
      closeCaregiverMenu(container)
      vi.advanceTimersByTime(HEAD_HOLD_MS + INTERVAL_MS * 2) // 緊急→取り消し→はい→いいえ
      fireEvent.keyDown(window, { key: ' ' }) // いいえ (B)
      expect(h1Text(container)).toBe('いいえ')
      vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=取り消し
      fireEvent.keyDown(window, { key: ' ' }) // 取り消し
      expect(h1Text(container)).toBe('はい')
    })

    it('復元後に警告音が鳴れない状態なら「警告音停止中」表示が出る', () => {
      window.localStorage.setItem(KEY, JSON.stringify({ active: true, details: [], sub: null }))
      vi.spyOn(alarmModule, 'getAlarmAudioStatus').mockReturnValue('not-running')
      const { container } = render(() => <App />)
      expect(h1Text(container)).toBe('緊急です。来てください')
      expect(container.querySelector('.audio-status-hint')).not.toBeNull()
    })

    it('介助者メニューの緊急解除で保存が消え、再マウントで通常起動・警告音なし', () => {
      const first = render(() => <App />)
      fireEvent.keyDown(window, { key: ' ' })
      expect(stored()).not.toBeNull()
      clearEmergencyViaMenu(first.container)
      expect(window.localStorage.getItem(KEY)).toBeNull()
      first.unmount()
      cleanup()

      oscillatorStartCount = 0
      const second = render(() => <App />)
      expect(h1Text(second.container)).toBe('選んだ内容がここに大きく出ます')
      expect(second.container.querySelector('.emergency-details')).toBeNull()
      vi.advanceTimersByTime(10000)
      expect(oscillatorStartCount).toBe(0)
    })

    it('壊れた保存値では通常起動する(例外で落ちない)', () => {
      window.localStorage.setItem(KEY, '{broken')
      const { container } = render(() => <App />)
      expect(h1Text(container)).toBe('選んだ内容がここに大きく出ます')
      expect(oscillatorStartCount).toBe(0)
    })

    it('緊急の保存・解除は設定(libra)の保存と干渉しない', () => {
      const first = render(() => <App />)
      const button = first.container.querySelector('.caregiver-button') as HTMLElement
      fireEvent.pointerDown(button)
      vi.advanceTimersByTime(2000)
      const slider = first.container.querySelector(
        'input[type="range"][min="500"]',
      ) as HTMLInputElement
      fireEvent.input(slider, { target: { value: '2500' } })
      const settingsBefore = window.localStorage.getItem('libra')
      expect(settingsBefore).not.toBeNull()
      const closeButton = Array.from(first.container.querySelectorAll('button')).find(
        (b) => b.textContent === '閉じる',
      ) as HTMLElement
      fireEvent.click(closeButton)
      fireEvent.keyDown(window, { key: ' ' }) // 緊急
      expect(window.localStorage.getItem('libra')).toBe(settingsBefore)
      clearEmergencyViaMenu(first.container)
      expect(window.localStorage.getItem('libra')).toBe(settingsBefore)
      expect(window.localStorage.getItem(KEY)).toBeNull()
    })
  })

  describe('Issue #3 追加指示: 表示テーマ(明るい/夜間/自動)・文字サイズ・高コントラスト', () => {
    // window.matchMedia の複雑なモック。複数のクエリ(prefers-color-scheme, display-mode)を
    // 個別に扱い、addEventListener で登録されたリスナーを trigger() で発火できるようにする。
    // App.tsx は起動時に matchMedia を同期的に呼ぶため、render() より前に呼び出しておく。
    function mockMatchMedia(initial: Record<string, boolean> = {}) {
      const instances = new Map<
        string,
        Array<{ mql: { matches: boolean }; listeners: Set<(e: { matches: boolean }) => void> }>
      >()
      const matchMediaFn = vi.fn((query: string) => {
        const listeners = new Set<(e: { matches: boolean }) => void>()
        const mql = {
          matches: initial[query] ?? false,
          media: query,
          addEventListener: (_event: string, cb: (e: { matches: boolean }) => void) =>
            listeners.add(cb),
          removeEventListener: (_event: string, cb: (e: { matches: boolean }) => void) =>
            listeners.delete(cb),
        }
        if (!instances.has(query)) instances.set(query, [])
        instances.get(query)?.push({ mql, listeners })
        return mql
      })
      ;(window as unknown as { matchMedia: typeof window.matchMedia }).matchMedia =
        matchMediaFn as unknown as typeof window.matchMedia
      return {
        trigger(query: string, matches: boolean) {
          for (const entry of instances.get(query) ?? []) {
            entry.mql.matches = matches
            for (const cb of entry.listeners) cb({ matches })
          }
        },
      }
    }

    afterEach(() => {
      delete document.documentElement.dataset.theme
      delete document.documentElement.dataset.fontSize
      delete document.documentElement.dataset.highContrast
    })

    it('theme=auto(既定)かつ OS が明るい設定なら data-theme は light になる', () => {
      mockMatchMedia({ '(prefers-color-scheme: dark)': false })
      render(() => <App />)
      expect(document.documentElement.dataset.theme).toBe('light')
    })

    it('theme=auto(既定)かつ OS が暗い設定なら data-theme は dark になる', () => {
      mockMatchMedia({ '(prefers-color-scheme: dark)': true })
      render(() => <App />)
      expect(document.documentElement.dataset.theme).toBe('dark')
    })

    it('auto中にOSのテーマ変更(matchMediaのchangeイベント)が来ると即座に data-theme が追従する', () => {
      const media = mockMatchMedia({ '(prefers-color-scheme: dark)': false })
      render(() => <App />)
      expect(document.documentElement.dataset.theme).toBe('light')
      media.trigger('(prefers-color-scheme: dark)', true)
      expect(document.documentElement.dataset.theme).toBe('dark')
      media.trigger('(prefers-color-scheme: dark)', false)
      expect(document.documentElement.dataset.theme).toBe('light')
    })

    it('介助者メニューで表示「夜間」を選ぶと、OSが明るくても data-theme は dark に固定される', () => {
      mockMatchMedia({ '(prefers-color-scheme: dark)': false })
      const { container } = render(() => <App />)
      const button = container.querySelector('.caregiver-button') as HTMLElement
      fireEvent.pointerDown(button)
      vi.advanceTimersByTime(2000)
      const darkButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === '夜間',
      ) as HTMLElement
      fireEvent.click(darkButton)
      expect(document.documentElement.dataset.theme).toBe('dark')
    })

    it('介助者メニューで表示「明るい」を選ぶと、OSが暗くても data-theme は light に固定される', () => {
      mockMatchMedia({ '(prefers-color-scheme: dark)': true })
      const { container } = render(() => <App />)
      const button = container.querySelector('.caregiver-button') as HTMLElement
      fireEvent.pointerDown(button)
      vi.advanceTimersByTime(2000)
      const lightButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === '明るい',
      ) as HTMLElement
      fireEvent.click(lightButton)
      expect(document.documentElement.dataset.theme).toBe('light')
    })

    it('起動直後は文字サイズ standard・高コントラスト false が data 属性に反映される', () => {
      render(() => <App />)
      expect(document.documentElement.dataset.fontSize).toBe('standard')
      expect(document.documentElement.dataset.highContrast).toBe('false')
    })

    it('介助者メニューで文字サイズ「特大」を選ぶと data-font-size が xlarge になる', () => {
      const { container } = render(() => <App />)
      const button = container.querySelector('.caregiver-button') as HTMLElement
      fireEvent.pointerDown(button)
      vi.advanceTimersByTime(2000)
      const xlargeButton = Array.from(container.querySelectorAll('button')).find(
        (b) => b.textContent === '特大',
      ) as HTMLElement
      fireEvent.click(xlargeButton)
      expect(document.documentElement.dataset.fontSize).toBe('xlarge')
    })

    it('介助者メニューで高コントラストを ON にすると data-high-contrast が true になる', () => {
      const { container } = render(() => <App />)
      const button = container.querySelector('.caregiver-button') as HTMLElement
      fireEvent.pointerDown(button)
      vi.advanceTimersByTime(2000)
      const checkboxes = Array.from(
        container.querySelectorAll('input[type="checkbox"]'),
      ) as HTMLInputElement[]
      const highContrastCheckbox = checkboxes.find(
        (input) => input.closest('label')?.textContent === '高コントラスト',
      ) as HTMLInputElement
      fireEvent.click(highContrastCheckbox)
      expect(document.documentElement.dataset.highContrast).toBe('true')
    })
  })

  describe('Issue #3 追加指示: navigate タイルの山形アイコン・予告表示', () => {
    it('不快タイル(navigate)には山形アイコンと予告が表示され、ラベルに矢印文字は含まない', () => {
      const { container } = render(() => <App />)
      const tiles = Array.from(container.querySelectorAll('.tile'))
      const discomfortTile = tiles.find(
        (tile) => tile.querySelector('.tile-label')?.textContent === '不快',
      ) as HTMLElement
      expect(discomfortTile.querySelector('.tile-label')?.textContent).not.toContain('→')
      expect(discomfortTile.querySelector('.tile-chevron')).not.toBeNull()
      expect(discomfortTile.querySelector('.tile-preview')?.textContent).toContain('痛い')
    })

    it('はい(message)タイルには山形アイコン・予告が表示されない', () => {
      const { container } = render(() => <App />)
      const tiles = Array.from(container.querySelectorAll('.tile'))
      const yesTile = tiles.find(
        (tile) => tile.querySelector('.tile-label')?.textContent === 'はい',
      ) as HTMLElement
      expect(yesTile.querySelector('.tile-chevron')).toBeNull()
      expect(yesTile.querySelector('.tile-preview')).toBeNull()
    })
  })

  describe('PR#16 Opus レビュー should-4: ResizeObserver 実測 → 列数 → 最後のタイルのspan', () => {
    // jsdom には ResizeObserver が無いため、App.tsx の `new ResizeObserver(cb)` を
    // 差し替えて捕まえ、trigger() で実測イベントを手動発火できるようにする
    class MockResizeObserver {
      static instances: MockResizeObserver[] = []
      callback: (entries: unknown[]) => void
      constructor(callback: (entries: unknown[]) => void) {
        this.callback = callback
        MockResizeObserver.instances.push(this)
      }
      observe() {}
      unobserve() {}
      disconnect() {}
      trigger(width: number, height: number) {
        this.callback([
          {
            contentBoxSize: [{ inlineSize: width, blockSize: height }],
            contentRect: { width, height },
          },
        ])
      }
    }

    beforeEach(() => {
      MockResizeObserver.instances = []
      ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = MockResizeObserver
    })

    it('横長 1000x500 で7項目(ホーム+取り消し)なら 4列×2行、最後のタイルが span 2 になる', () => {
      const { container } = render(() => <App />)
      // 「はい」を選んで home+取り消しの7項目状態にする(緊急,取り消し,はい,いいえ,不快,快要望,文字盤)
      vi.advanceTimersByTime(HEAD_HOLD_MS)
      fireEvent.keyDown(window, { key: ' ' }) // はい選択 → home(取り消し表示)
      expect(tileLabels(container)).toHaveLength(7)

      const observer = MockResizeObserver.instances[MockResizeObserver.instances.length - 1]
      observer.trigger(1000, 500)

      const board = container.querySelector('.grid-board') as HTMLElement
      expect(board.classList.contains('grid-fill')).toBe(true)
      expect(board.style.getPropertyValue('--cols')).toBe('4')
      expect(board.style.getPropertyValue('--rows')).toBe('2')

      const tiles = Array.from(container.querySelectorAll('.tile'))
      const lastTile = tiles[tiles.length - 1] as HTMLElement
      expect(lastTile.style.gridColumn).toBe('span 2')
    })

    it('画面サイズが変わり列数が変化すると --cols が追従する', () => {
      const { container } = render(() => <App />)
      const observer = MockResizeObserver.instances[MockResizeObserver.instances.length - 1]

      observer.trigger(1000, 500) // 横長: 6項目(ホーム)は3列×2行になるはず
      const board = container.querySelector('.grid-board') as HTMLElement
      expect(board.style.getPropertyValue('--cols')).toBe('3')

      observer.trigger(500, 1000) // 縦長に変化: 2列側に変わる
      expect(board.style.getPropertyValue('--cols')).toBe('2')
      expect(board.style.getPropertyValue('--rows')).toBe('3')
    })
  })
})
