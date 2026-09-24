import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render } from '@solidjs/testing-library'
import App from '../App'
import * as alarmModule from '../lib/alarm'

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
    expect(scanningLabel(container)).toBe('文字盤 →')
    fireEvent.keyDown(window, { key: ' ' }) // letters 画面へ遷移
    expect(container.querySelector('.letter-strip')).not.toBeNull()

    // letters 画面: index0=緊急, index1=戻る, index2=最初の文字(letterAppend)
    vi.advanceTimersByTime(HEAD_HOLD_MS) // index1(戻る)
    vi.advanceTimersByTime(INTERVAL_MS) // index2(最初の文字)
    fireEvent.keyDown(window, { key: ' ' }) // 1回目: 文字を追加
    fireEvent.keyDown(window, { key: ' ' }) // 2回目: 連打無視区間内なので無視されるはず
    const output = container.querySelector('.letter-strip output')
    expect(output?.textContent?.length).toBe(1)
  })

  it('緊急選択で確認なしに即「緊急です。来てください」を表示し緊急詳細画面へ遷移する', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // index0=緊急
    expect(h1Text(container)).toBe('緊急です。来てください')
    expect(container.querySelector('.status-stack')?.textContent).toContain('緊急')
  })

  it('緊急中にホームで「はい」を選んでも見出しは緊急のまま副表示に「最新: はい」が出る', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // 緊急選択 → urgentDetail
    vi.advanceTimersByTime(HEAD_HOLD_MS) // urgentDetail index1=戻る
    fireEvent.keyDown(window, { key: ' ' }) // home へ戻る
    vi.advanceTimersByTime(HEAD_HOLD_MS) // home index1=はい
    expect(scanningLabel(container)).toBe('はい')
    fireEvent.keyDown(window, { key: ' ' }) // はい を選択
    expect(h1Text(container)).toBe('緊急です。来てください')
    expect(container.querySelector('.emergency-sub')?.textContent).toContain('最新: はい')
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
    expect(scanningLabel(container)).toBe('不快 →')
    fireEvent.keyDown(window, { key: ' ' }) // discomfort へ遷移(goTo)

    expect(speak).toHaveBeenCalled()
    const lastUtterance = speak.mock.calls[speak.mock.calls.length - 1][0] as { text: string }
    expect(lastUtterance.text).toBe('緊急')
  })

  it('S-new-1: 聴覚スキャンON時、伝達の読み上げが画面遷移直後の先頭読み上げに打ち切られない', () => {
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
  })

  it('S1: 緊急詳細は積み上げ式で表示され、緊急の再選択でも消えない', () => {
    const { container } = render(() => <App />)
    fireEvent.keyDown(window, { key: ' ' }) // home index0=緊急 → urgentDetail
    expect(scanningLabel(container)).toBe('緊急')

    // urgentDetail: 0緊急,1戻る,2苦しい,3痛い,...
    vi.advanceTimersByTime(HEAD_HOLD_MS) // index1=戻る
    vi.advanceTimersByTime(INTERVAL_MS) // index2=苦しい
    expect(scanningLabel(container)).toBe('苦しい')
    fireEvent.keyDown(window, { key: ' ' }) // 苦しい選択 → home
    expect(container.querySelector('.emergency-details')?.textContent).toContain('苦しい')

    // 緊急を再選択しても詳細は消えない(home index0はまだ先頭待機中)
    vi.advanceTimersByTime(600) // 連打無視(500ms)を超えて次の押下を有効にする
    fireEvent.keyDown(window, { key: ' ' })
    expect(h1Text(container)).toBe('緊急です。来てください')
    expect(container.querySelector('.emergency-details')?.textContent).toContain('苦しい')

    // 別の詳細(痛い)を追加すると積み上がる
    vi.advanceTimersByTime(HEAD_HOLD_MS) // urgentDetail index1=戻る
    vi.advanceTimersByTime(INTERVAL_MS) // index2=苦しい
    vi.advanceTimersByTime(INTERVAL_MS) // index3=痛い
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
    expect(container.querySelector('h1')?.textContent).toBe('緊急です。来てください')
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
})
