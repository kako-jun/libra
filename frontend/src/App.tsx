import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { buildMenu, PARENT_SCREEN, SCREEN_TITLES, type ScreenId, type Tone } from './lib/menus'
import { press, resync, startScan, tick, type ScanConfig, type ScanState } from './lib/scan'
import { loadSettings, saveSettings, type Settings } from './lib/settings'
import { resumeAlarmAudioContext, startAlarm, stopAlarm } from './lib/alarm'

const DEFAULT_MESSAGE = '選んだ内容がここに大きく出ます'
const ALARM_REPEAT_MS = 3000

const VOICE_LABELS: Record<Settings['voiceMode'], string> = {
  off: 'OFF',
  tone: '効果音だけ',
  short: '短く読む',
  full: '全部読む',
}

const VOICE_MODES: Settings['voiceMode'][] = ['off', 'tone', 'short', 'full']

function speak(mode: Settings['voiceMode'], text: string, shortText = text) {
  window.speechSynthesis?.cancel()
  if (mode === 'off') return
  if (mode === 'tone') {
    navigator.vibrate?.(35)
    return
  }
  const utterance = new SpeechSynthesisUtterance(mode === 'short' ? shortText : text)
  utterance.lang = 'ja-JP'
  utterance.rate = 0.85
  utterance.pitch = 0.9
  window.speechSynthesis?.speak(utterance)
}

export default function App() {
  // 開発補助: URL に ?dev を付けると番号バッジを表示する（既定は非表示）
  const showDevNumbers = new URLSearchParams(window.location.search).has('dev')

  const [settings, setSettings] = createSignal<Settings>(loadSettings())
  const scanConfig = createMemo<ScanConfig>(() => ({
    intervalMs: settings().intervalMs,
    headHoldMs: settings().intervalMs * settings().headHoldMultiplier,
    debounceMs: settings().debounceMs,
  }))

  const [screen, setScreen] = createSignal<ScreenId>('home')
  const [emergencyActive, setEmergencyActive] = createSignal(false)
  const [message, setMessage] = createSignal(DEFAULT_MESSAGE)
  const [messageTone, setMessageTone] = createSignal<Tone>('neutral')
  const [messageHistory, setMessageHistory] = createSignal<string[]>([])
  // 緊急中に選ばれた伝達（はい等）は見出しを上書きせず、この副表示にのみ出す
  const [emergencySubMessage, setEmergencySubMessage] = createSignal<string | null>(null)
  const [showUndo, setShowUndo] = createSignal(false)
  let undoLapsRemaining = 0

  const [caregiverMenuOpen, setCaregiverMenuOpen] = createSignal(false)
  const [letterText, setLetterText] = createSignal('')

  // 表示中メニューはここでしか作らない。スキャン状態・レンダリングの双方が
  // 必ずこの同じ配列を参照することで、カーソルと項目のずれを防ぐ。
  const currentMenu = createMemo(() =>
    buildMenu(screen(), { showUndo: showUndo(), emergencyActive: emergencyActive() }),
  )

  const [scanState, setScanState] = createSignal<ScanState>(startScan(Date.now(), scanConfig()))

  const announce = (text: string, shortText = text) => speak(settings().voiceMode, text, shortText)

  const announceScanItem = (label: string) => {
    if (!settings().auditoryScan) return
    window.speechSynthesis?.cancel()
    const utterance = new SpeechSynthesisUtterance(label.replace(/\n/g, ' '))
    utterance.lang = 'ja-JP'
    utterance.rate = 1.0
    window.speechSynthesis?.speak(utterance)
  }

  const showMessage = (text: string, tone: Tone = 'neutral') => {
    setMessage(text)
    setMessageTone(tone)
    setMessageHistory((items) => [text, ...items].slice(0, 5))
    document.documentElement.dataset.messageTone = tone
    navigator.vibrate?.(tone === 'urgent' ? [60, 40, 60] : 35)
    announce(text)
  }

  // M1: 画面遷移のたびに連打無視(lastPressAt)をリセットすると、遷移直後の連打で
  // 遷移先の先頭項目(通常は緊急)が誤って実行されてしまう。前の画面での lastPressAt を
  // 引き継ぎ、連打無視が画面をまたいで一貫して働くようにする。
  const goTo = (next: ScreenId) => {
    setScreen(next)
    setScanState((previous) => startScan(Date.now(), scanConfig(), previous.lastPressAt))
  }

  // 通常の伝達完了。緊急中は見出し(緊急表示)を上書きせず、副表示にだけ出す
  // （requirements.md §4.3: 緊急表示は介助者が解除するまで残り、本人入力で上書きされない）。
  const completeTransmission = (text: string, tone: Tone = 'neutral') => {
    if (emergencyActive()) {
      setEmergencySubMessage(text)
      navigator.vibrate?.(35)
      announce(text)
      goTo('home')
      return
    }
    showMessage(text, tone)
    setShowUndo(true)
    undoLapsRemaining = 1
    goTo('home')
  }

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      saveSettings(next)
      return next
    })
  }

  const clearEmergency = () => {
    setEmergencyActive(false)
    setEmergencySubMessage(null)
    stopAlarm()
    setMessage(DEFAULT_MESSAGE)
    setMessageTone('neutral')
    document.documentElement.dataset.messageTone = 'neutral'
  }

  const closeCaregiverMenu = () => {
    setCaregiverMenuOpen(false)
    goTo('home')
  }

  const runAction = (item: ReturnType<typeof currentMenu>[number]) => {
    const action = item.action
    switch (action.type) {
      case 'emergency': {
        setEmergencyActive(true)
        showMessage('緊急です。来てください', 'urgent')
        startAlarm(ALARM_REPEAT_MS)
        goTo('urgentDetail')
        return
      }
      case 'emergencyDetail': {
        showMessage(`緊急です。来てください — ${action.label}`, 'urgent')
        setShowUndo(false)
        goTo('home')
        return
      }
      case 'undo': {
        // menus.ts の buildHomeMenu が緊急中は取り消しをメニューに含めないが、
        // 数字キー等での直接実行に備えてここでも二重に防ぐ
        if (emergencyActive()) return
        const previous = messageHistory()[1] ?? DEFAULT_MESSAGE
        setMessageHistory((items) => items.slice(1))
        setMessage(previous)
        setMessageTone('neutral')
        document.documentElement.dataset.messageTone = 'neutral'
        setShowUndo(false)
        goTo('home')
        return
      }
      case 'back': {
        const current = screen()
        const parent = current === 'home' ? 'home' : PARENT_SCREEN[current]
        goTo(parent)
        return
      }
      case 'navigate': {
        goTo(action.screen)
        return
      }
      case 'message': {
        completeTransmission(action.text, action.tone ?? 'neutral')
        return
      }
      case 'letterAppend': {
        setLetterText((text) => text + action.char)
        announce(action.char, action.char)
        return
      }
      case 'letterBackspace': {
        setLetterText((text) => text.slice(0, -1))
        return
      }
      case 'letterCommit': {
        const text = letterText().trim()
        setLetterText('')
        if (!text) {
          goTo('letters')
          return
        }
        completeTransmission(text, 'neutral')
        return
      }
    }
  }

  const activateIndex = (index: number) => {
    const item = currentMenu()[index]
    if (!item) return
    runAction(item)
  }

  const handleSwitchOn = (now: number) => {
    if (caregiverMenuOpen()) return
    const itemCount = currentMenu().length
    const resynced = resync(scanState(), itemCount)
    const result = press(resynced, itemCount, now, scanConfig())
    setScanState(result.state)
    if (result.activatedIndex === null) return
    activateIndex(result.activatedIndex)
  }

  // スキャンの進行ループ。setTimeout を自己再スケジュールし、次に進めるべき時刻に合わせる。
  // 毎回 currentMenu() から項目数を取り、表示中メニューとスキャン状態を同じ配列から導出する。
  onMount(() => {
    let timeoutId: number | undefined

    const schedule = (delay: number) => {
      timeoutId = window.setTimeout(step, Math.max(16, delay))
    }

    function step() {
      if (!caregiverMenuOpen()) {
        const now = Date.now()
        const items = currentMenu()
        const previous = resync(scanState(), items.length)
        const next = tick(previous, items.length, now, scanConfig())
        if (next !== scanState()) {
          setScanState(next)
        }
        if (next.index !== previous.index) {
          if (next.index === 0 && screen() === 'home' && undoLapsRemaining > 0) {
            undoLapsRemaining -= 1
            if (undoLapsRemaining === 0) setShowUndo(false)
          }
          if (settings().auditoryScan) {
            const item = items[next.index]
            if (item) announceScanItem(item.label)
          }
        }
      }
      schedule(scanState().nextAdvanceAt - Date.now())
    }

    schedule(0)
    onCleanup(() => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
    })
  })

  // 本人のスイッチ入力: 画面タップ / 任意キー / Bluetooth シャッター(キー入力として届く)
  onMount(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[data-caregiver-control]')) return
      resumeAlarmAudioContext()
      if (caregiverMenuOpen()) return
      handleSwitchOn(Date.now())
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      resumeAlarmAudioContext()
      if (caregiverMenuOpen()) return
      if (showDevNumbers && /^[1-9]$/.test(event.key)) {
        // 開発補助(?dev限定): 数字キーで先頭9項目を直接実行する。スイッチ扱いより先に処理し二重実行しない
        event.preventDefault()
        activateIndex(Number(event.key) - 1)
        return
      }
      event.preventDefault()
      handleSwitchOn(Date.now())
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    })
  })

  let longPressTimer: number | undefined
  const onCaregiverButtonDown = () => {
    longPressTimer = window.setTimeout(() => {
      setCaregiverMenuOpen(true)
    }, 2000)
  }
  const onCaregiverButtonUp = () => {
    if (longPressTimer !== undefined) {
      window.clearTimeout(longPressTimer)
      longPressTimer = undefined
    }
  }

  return (
    <main class="app-shell">
      <section class="message-panel" aria-live="polite">
        <div>
          <p class="eyebrow">bedside communication</p>
          <h1>{message()}</h1>
          <Show when={emergencyActive() && emergencySubMessage()}>
            <p class="emergency-sub">最新: {emergencySubMessage()}</p>
          </Show>
        </div>
        <div class="status-stack" aria-label="現在の状態">
          <span>{SCREEN_TITLES[screen()]}</span>
          <span>音声 {VOICE_LABELS[settings().voiceMode]}</span>
          <span>
            {scanState().index + 1} / {currentMenu().length}
          </span>
        </div>
      </section>

      <Show when={screen() === 'letters'}>
        <section class="letter-strip">
          <output>{letterText() || '文字を選んでください'}</output>
        </section>
      </Show>

      <section
        class="grid-board"
        classList={{ 'show-numbers': showDevNumbers }}
        aria-label={`${SCREEN_TITLES[screen()]}の選択肢`}
      >
        <For each={currentMenu()}>
          {(item, index) => (
            <div
              class={`tile tile-${item.tone ?? 'neutral'}`}
              classList={{ scanning: scanState().index === index() }}
              aria-hidden="true"
            >
              <span class="tile-number">{index() + 1}</span>
              <span class="tile-label">{item.label}</span>
              <Show when={item.detail}>
                <span class="tile-detail">{item.detail}</span>
              </Show>
            </div>
          )}
        </For>
      </section>

      <button
        type="button"
        class="caregiver-button"
        data-caregiver-control
        onPointerDown={onCaregiverButtonDown}
        onPointerUp={onCaregiverButtonUp}
        onPointerLeave={onCaregiverButtonUp}
        onPointerCancel={onCaregiverButtonUp}
        aria-label="介助者メニュー（2秒長押し）"
      >
        介助
      </button>

      <Show when={caregiverMenuOpen()}>
        <div class="caregiver-overlay" data-caregiver-control>
          <div class="caregiver-panel">
            <h2>介助者メニュー</h2>

            <button
              type="button"
              class="caregiver-action"
              onClick={clearEmergency}
              disabled={!emergencyActive()}
            >
              緊急解除{emergencyActive() ? '' : '（緊急なし）'}
            </button>

            <label class="caregiver-field">
              <span>スキャン間隔: {(settings().intervalMs / 1000).toFixed(1)} 秒</span>
              <input
                type="range"
                min="500"
                max="5000"
                step="100"
                value={settings().intervalMs}
                onInput={(event) =>
                  updateSettings({ intervalMs: Number(event.currentTarget.value) })
                }
              />
            </label>

            <label class="caregiver-field">
              <span>先頭待機倍率: 間隔 × {settings().headHoldMultiplier}</span>
              <input
                type="range"
                min="1"
                max="5"
                step="0.5"
                value={settings().headHoldMultiplier}
                onInput={(event) =>
                  updateSettings({ headHoldMultiplier: Number(event.currentTarget.value) })
                }
              />
            </label>

            <label class="caregiver-field">
              <span>連打無視: {(settings().debounceMs / 1000).toFixed(1)} 秒</span>
              <input
                type="range"
                min="0"
                max="3000"
                step="100"
                value={settings().debounceMs}
                onInput={(event) =>
                  updateSettings({ debounceMs: Number(event.currentTarget.value) })
                }
              />
            </label>

            <label class="caregiver-field caregiver-checkbox">
              <input
                type="checkbox"
                checked={settings().auditoryScan}
                onChange={(event) => updateSettings({ auditoryScan: event.currentTarget.checked })}
              />
              <span>聴覚スキャン</span>
            </label>

            <div class="caregiver-field">
              <span>音声モード</span>
              <div class="caregiver-voice-options">
                <For each={VOICE_MODES}>
                  {(mode) => (
                    <button
                      type="button"
                      classList={{ active: settings().voiceMode === mode }}
                      onClick={() => updateSettings({ voiceMode: mode })}
                    >
                      {VOICE_LABELS[mode]}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <button
              type="button"
              class="caregiver-action caregiver-close"
              onClick={closeCaregiverMenu}
            >
              閉じる
            </button>
          </div>
        </div>
      </Show>
    </main>
  )
}
