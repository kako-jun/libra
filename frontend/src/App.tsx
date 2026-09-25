import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { buildMenu, PARENT_SCREEN, SCREEN_TITLES, type ScreenId, type Tone } from './lib/menus'
import { press, resync, startScan, tick, type ScanConfig, type ScanState } from './lib/scan'
import { loadSettings, saveSettings, type Settings } from './lib/settings'
import {
  getAlarmAudioStatus,
  initAlarmVisibilityResume,
  resumeAlarmAudioContext,
  startAlarm,
  stopAlarm,
} from './lib/alarm'
import { initWakeLock, type WakeLockStatus } from './lib/wakeLock'
import {
  initOfflineReadyWatch,
  recheckOfflineReady,
  type OfflineReadyStatus,
} from './lib/offlineReady'
import { computeGridLayout } from './lib/gridLayout'

const DEFAULT_MESSAGE = '選んだ内容がここに大きく出ます'
const ALARM_REPEAT_MS = 3000
/** 介助者メニュー内の操作が途絶えたときに自動で閉じるまでの時間(requirements.md §6) */
const CAREGIVER_MENU_IDLE_TIMEOUT_MS = 60000

const VOICE_LABELS: Record<Settings['voiceMode'], string> = {
  off: 'OFF',
  tone: '効果音だけ',
  short: '短く読む',
  full: '全部読む',
}

const VOICE_MODES: Settings['voiceMode'][] = ['off', 'tone', 'short', 'full']

// Issue #5: 画面スリープ防止(Wake Lock)の状態を介助者メニューに表示する文言。
// 'active' 以外は本人の入力が届かなくなる恐れがあるため、端末側の自動ロック解除を促す。
const WAKE_LOCK_LABELS: Record<WakeLockStatus, string> = {
  active: '画面スリープ防止: 有効',
  unsupported: '画面スリープ防止: 無効 — 端末の自動ロックを切ってください',
  error: '画面スリープ防止: 無効 — 端末の自動ロックを切ってください',
  released: '画面スリープ防止: 無効 — 端末の自動ロックを切ってください',
}

// PR #11 レビュー対応(should-1): オフラインで動く準備(Service Worker がこのページを
// 制御しているか)を Wake Lock と同じ扱いで介助者メニューに表示する。
const OFFLINE_READY_LABELS: Record<OfflineReadyStatus, string> = {
  ready: 'オフライン準備: 完了',
  'not-ready': 'オフライン準備: 未完了',
}

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

const FONT_SIZE_LABELS: Record<Settings['fontSize'], string> = {
  standard: '標準',
  large: '大',
  xlarge: '特大',
}

const FONT_SIZES: Settings['fontSize'][] = ['standard', 'large', 'xlarge']

const THEME_LABELS: Record<Settings['theme'], string> = {
  light: '明るい',
  dark: '夜間',
  auto: '自動',
}

const THEMES: Settings['theme'][] = ['light', 'dark', 'auto']

// PR#16 Opus レビュー nit: <meta name="theme-color"> をテーマに追従させる。
// --message-bg(通常時)と同じ値にする(globals.cssのトークンと目視で揃えている)
const THEME_COLOR: Record<'light' | 'dark', string> = {
  light: '#0f5132',
  dark: '#0a2318',
}

export default function App() {
  // 開発補助: URL に ?dev を付けると番号バッジを表示する（既定は非表示）
  const showDevNumbers = new URLSearchParams(window.location.search).has('dev')

  const [settings, setSettings] = createSignal<Settings>(loadSettings())

  // Issue #3 追加指示: 表示テーマ(明るい/夜間/自動)。auto は端末の prefers-color-scheme に
  // 追従し、OS側の設定変更にも即座に反応する(matchMedia の change を購読)。
  const prefersDarkQuery =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null
  const [systemPrefersDark, setSystemPrefersDark] = createSignal(prefersDarkQuery?.matches ?? false)
  onMount(() => {
    if (!prefersDarkQuery) return
    const onChange = () => setSystemPrefersDark(prefersDarkQuery.matches)
    prefersDarkQuery.addEventListener('change', onChange)
    onCleanup(() => prefersDarkQuery.removeEventListener('change', onChange))
  })
  const resolvedTheme = createMemo<'light' | 'dark'>(() => {
    const theme = settings().theme
    if (theme === 'auto') return systemPrefersDark() ? 'dark' : 'light'
    return theme
  })

  createEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme()
    document.documentElement.dataset.fontSize = settings().fontSize
    document.documentElement.dataset.highContrast = String(settings().highContrast)
    // PR#16 Opus レビュー nit: ブラウザ/OSのUI色(タブバー等)もテーマに追従させる
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) meta.setAttribute('content', THEME_COLOR[resolvedTheme()])
  })
  const scanConfig = createMemo<ScanConfig>(() => ({
    intervalMs: settings().intervalMs,
    headHoldMs: settings().intervalMs * settings().headHoldMultiplier,
    debounceMs: settings().debounceMs,
  }))

  const [screen, setScreen] = createSignal<ScreenId>('home')
  const [emergencyActive, setEmergencyActive] = createSignal(false)
  // 緊急の詳細（苦しい/痛い等）は積み上げ式。緊急の再選択では消さない(S1)
  const [emergencyDetails, setEmergencyDetails] = createSignal<string[]>([])
  const [message, setMessage] = createSignal(DEFAULT_MESSAGE)
  const [messageTone, setMessageTone] = createSignal<Tone>('neutral')
  const [messageHistory, setMessageHistory] = createSignal<{ text: string; tone: Tone }[]>([])
  // 緊急中に選ばれた伝達（はい等）は見出しを上書きせず、この副表示にのみ出す
  const [emergencySubMessage, setEmergencySubMessage] = createSignal<string | null>(null)
  const [showUndo, setShowUndo] = createSignal(false)
  let undoLapsRemaining = 0

  const [caregiverMenuOpen, setCaregiverMenuOpen] = createSignal(false)
  const [letterText, setLetterText] = createSignal('')
  // 警告音が鳴らない状態(AudioContextがrunningでない)を介助者に知らせる表示の元
  const [alarmAudioRunning, setAlarmAudioRunning] = createSignal(false)
  // Issue #5: 画面スリープ防止の状態。介助者メニューに表示する
  const [wakeLockStatus, setWakeLockStatus] = createSignal<WakeLockStatus>('unsupported')
  const fullscreenSupported =
    typeof document !== 'undefined' &&
    typeof document.documentElement.requestFullscreen === 'function'
  const [isFullscreen, setIsFullscreen] = createSignal(
    typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  )
  // nit-3: ホーム画面から起動した PWA が既に display-mode:fullscreen で立ち上がっている場合、
  // Fullscreen API の document.fullscreenElement は null のままなので isFullscreen() だけでは
  // 判定できない。matchMedia でも確認し、どちらか一方でも全画面なら「全画面にする」を隠す
  const [isDisplayModeFullscreen, setIsDisplayModeFullscreen] = createSignal(
    typeof window !== 'undefined' && window.matchMedia?.('(display-mode: fullscreen)').matches,
  )
  // Issue #5 / PR#11 should-1: オフラインで動く準備(SWがこのページを制御しているか)
  const [offlineReadyStatus, setOfflineReadyStatus] = createSignal<OfflineReadyStatus>('not-ready')

  // 表示中メニューはここでしか作らない。スキャン状態・レンダリングの双方が
  // 必ずこの同じ配列を参照することで、カーソルと項目のずれを防ぐ。
  const currentMenu = createMemo(() =>
    buildMenu(screen(), { showUndo: showUndo(), emergencyActive: emergencyActive() }),
  )

  // Issue #3 再レビュー: grid-board 自身の実測サイズ(縦横比)から列数を決める。
  // ResizeObserver で追従するので、回転・キャレギバー設定変更後の再計算も自動で効く。
  // PR#16 再レビュー must-A/B: 最小セル寸法は文字サイズに関係なく既定(160x84)のまま
  // 固定する。「収まらない」問題は最小セル寸法をここで引き上げてスクロールへ逃がすのでは
  // なく、CSS側で文字をセルに合わせて縮める(--tile-label-font の min())ことで解決する。
  // これにより8項目以下の画面は常に全面充填(fill)され、スクロールに落ちない。
  let gridBoardEl: HTMLElement | undefined
  const [gridSize, setGridSize] = createSignal({ width: 0, height: 0 })
  // PR#16 5巡目 must-G: --tile-label-font の cqi/cqb 係数(globals.css 側で
  // ブレークポイントごとに違う値、--label-cqi/--label-cqb)をここにハードコード
  // せず、実際に描画されている grid-board から getComputedStyle で読み取って
  // computeGridLayout に渡す。CSS側の値を変えてもJS側の定数を追従して直す
  // 必要が無くなる(4巡目でCSS側だけ揃えて起きた食い違いの再発防止)
  const [labelFactors, setLabelFactors] = createSignal({ width: 0.15, height: 0.2 })
  const gridLayout = createMemo(() =>
    computeGridLayout(currentMenu().length, gridSize().width, gridSize().height, {
      labelWidthFactor: labelFactors().width,
      labelHeightFactor: labelFactors().height,
    }),
  )

  const [scanState, setScanState] = createSignal<ScanState>(startScan(Date.now(), scanConfig()))

  // PR#11 must-4: orientation:any(縦横両対応)のため、横向き小画面(例 844x390)では
  // 文字盤等の項目数が多い画面で下段のタイルがビューポート外に出ることがある。
  // touch-action:none で本人のスクロール操作自体は塞いでいるため、代わりにスキャン対象が
  // 変わるたびプログラム的に scrollIntoView して必ず画面内に入れる。scanState() 自体は
  // 毎tickで新しいオブジェクトになるため、index の値だけを createMemo で取り出して
  // 実際に index が変わったときだけ effect が走るようにする(不要な scrollIntoView 呼び出しを防ぐ)
  const scanIndex = createMemo(() => scanState().index)
  createEffect(() => {
    scanIndex()
    screen() // 画面遷移直後、遷移前と同じ index(例: どちらも先頭)でも再度スクロールする
    // PR#16 Opus レビュー nit: 画面サイズ変化(回転・キーボード開閉等)でタイル位置が
    // ずれた場合にも追従して再スクロールする
    gridSize()
    if (typeof document === 'undefined') return
    const el = document.querySelector('.tile.scanning')
    el?.scrollIntoView?.({ block: 'nearest' })
  })

  // S-new-1 / S-new-6 / nit: 伝達の読み上げ(announce。showMessage経由に限らず、緊急詳細や
  // 緊急中の伝達も含む)を行った直後は、次の1回のスキャン読み上げ(通常は goTo 直後の
  // 遷移先の先頭読み上げ)をcancelせず後ろに積む。素通しは1回だけで、それより先の
  // スキャン読み上げ(通常のカーソル移動)は従来どおり cancel する。聴覚スキャンOFFの
  // ときは announceScanItem が呼ばれず消費されないまま残ってしまうため、立てない。
  let messageAnnounceGrace = false

  const announce = (text: string, shortText = text) => {
    speak(settings().voiceMode, text, shortText)
    if (settings().auditoryScan) messageAnnounceGrace = true
  }

  const announceScanItem = (label: string) => {
    if (!settings().auditoryScan) return
    const interrupt = !messageAnnounceGrace
    messageAnnounceGrace = false
    if (interrupt) window.speechSynthesis?.cancel()
    const utterance = new SpeechSynthesisUtterance(label.replace(/\n/g, ' '))
    utterance.lang = 'ja-JP'
    utterance.rate = 1.0
    window.speechSynthesis?.speak(utterance)
  }

  const showMessage = (text: string, tone: Tone = 'neutral') => {
    setMessage(text)
    setMessageTone(tone)
    setMessageHistory((items) => [{ text, tone }, ...items].slice(0, 5))
    document.documentElement.dataset.messageTone = tone
    navigator.vibrate?.(tone === 'urgent' ? [60, 40, 60] : 35)
    announce(text)
  }

  // home 以外へ遷移するときは「取り消し」の1周猶予を終わらせる(nit: 積み残した猶予が
  // 後で home に戻った際に誤って復活しないように)。home への遷移(伝達完了の帰着点)では
  // 呼び出し元が設定した showUndo/undoLapsRemaining をそのまま尊重する。
  const goTo = (next: ScreenId) => {
    if (next !== 'home' && (showUndo() || undoLapsRemaining > 0)) {
      setShowUndo(false)
      undoLapsRemaining = 0
    }
    setScreen(next)
    setScanState((previous) => startScan(Date.now(), scanConfig(), previous.lastPressAt))
    // S4: 聴覚スキャンON時、遷移直後の先頭項目(通常は緊急)も読む。
    // 直前の伝達読み上げが済んでいれば messageAnnounceGrace により cancel されない(S-new-1)
    if (settings().auditoryScan) {
      const first = buildMenu(next, { showUndo: showUndo(), emergencyActive: emergencyActive() })[0]
      if (first) announceScanItem(first.label)
    }
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

  // M3(a): 介助者メニュー内の操作が60秒ないと自動で閉じ、スキャンを再開する。
  // パネル内での操作(pointerdown)のたびに resetCaregiverIdleTimer を呼んで先延ばしする。
  let caregiverIdleTimer: number | undefined

  const resetCaregiverIdleTimer = () => {
    if (caregiverIdleTimer !== undefined) window.clearTimeout(caregiverIdleTimer)
    caregiverIdleTimer = window.setTimeout(() => {
      closeCaregiverMenu()
    }, CAREGIVER_MENU_IDLE_TIMEOUT_MS)
  }

  const clearCaregiverIdleTimer = () => {
    if (caregiverIdleTimer !== undefined) {
      window.clearTimeout(caregiverIdleTimer)
      caregiverIdleTimer = undefined
    }
  }

  const clearEmergency = () => {
    setEmergencyActive(false)
    setEmergencyDetails([])
    setEmergencySubMessage(null)
    stopAlarm()
    setMessage(DEFAULT_MESSAGE)
    setMessageTone('neutral')
    document.documentElement.dataset.messageTone = 'neutral'
    // S2: 解除後に緊急中分の古い取り消しが復活しないようにする
    setShowUndo(false)
    undoLapsRemaining = 0
  }

  const closeCaregiverMenu = () => {
    setCaregiverMenuOpen(false)
    clearCaregiverIdleTimer()
    goTo('home')
  }

  // Issue #5: 全画面化。誤操作防止(ダブルタップ拡大等)の効果を確実にするため、
  // 常設運用では全画面での起動を推奨する。非対応環境ではボタン自体を出さない
  const enterFullscreen = () => {
    void document.documentElement.requestFullscreen?.().catch(() => {
      // ユーザー操作起因でない・非対応等で失敗しても、通常表示のまま使い続けられる
    })
  }

  const runAction = (item: ReturnType<typeof currentMenu>[number]) => {
    const action = item.action
    switch (action.type) {
      case 'emergency': {
        // S1: 緊急の再選択は詳細を消さずアラーム再開のみ。初回選択時だけ見出しを立てる
        const alreadyActive = emergencyActive()
        setEmergencyActive(true)
        // S2: 緊急発生時は取り消しの猶予を必ず終わらせる
        setShowUndo(false)
        undoLapsRemaining = 0
        if (!alreadyActive) {
          setEmergencyDetails([])
          showMessage('緊急です。来てください', 'urgent')
        }
        startAlarm(ALARM_REPEAT_MS)
        goTo('urgentDetail')
        return
      }
      case 'emergencyDetail': {
        // S1: 見出しは変えず、詳細を積み上げ式(重複なし)で見出し下に表示する
        setEmergencyDetails((details) =>
          details.includes(action.label) ? details : [...details, action.label],
        )
        navigator.vibrate?.([60, 40, 60])
        announce(`緊急です。来てください。${action.label}`, action.label)
        setShowUndo(false)
        goTo('home')
        return
      }
      case 'undo': {
        // menus.ts の buildHomeMenu が緊急中は取り消しをメニューに含めないが、
        // 数字キー等での直接実行に備えてここでも二重に防ぐ
        if (emergencyActive()) return
        const previous = messageHistory()[1] ?? { text: DEFAULT_MESSAGE, tone: 'neutral' as Tone }
        setMessageHistory((items) => items.slice(1))
        setMessage(previous.text)
        setMessageTone(previous.tone)
        document.documentElement.dataset.messageTone = previous.tone
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

  // 警告音が鳴らない状態(AudioContext が running でない)を介助者に知らせるための定期確認。
  // ミリ秒単位の精度は不要なので、スキャンループとは別に緩い間隔でポーリングする。
  onMount(() => {
    const checkAlarmAudioStatus = () => setAlarmAudioRunning(getAlarmAudioStatus() === 'running')
    checkAlarmAudioStatus()
    const id = window.setInterval(checkAlarmAudioStatus, 500)
    onCleanup(() => window.clearInterval(id))
  })

  // Issue #3 再レビュー: grid-board の実測サイズを追従し、列数計算(computeGridLayout)へ渡す
  onMount(() => {
    if (!gridBoardEl || typeof ResizeObserver === 'undefined') return
    const readLabelFactors = () => {
      if (!gridBoardEl || typeof getComputedStyle === 'undefined') return
      const style = getComputedStyle(gridBoardEl)
      const cqi = Number.parseFloat(style.getPropertyValue('--label-cqi'))
      const cqb = Number.parseFloat(style.getPropertyValue('--label-cqb'))
      if (Number.isFinite(cqi) && Number.isFinite(cqb)) {
        setLabelFactors({ width: cqi / 100, height: cqb / 100 })
      }
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const box = entry.contentBoxSize?.[0]
      const width = box ? box.inlineSize : entry.contentRect.width
      const height = box ? box.blockSize : entry.contentRect.height
      setGridSize({ width, height })
      // ブレークポイント(画面幅)が変わるのも実質「サイズが変わる」ときなので、
      // resize のたびに --label-cqi/--label-cqb の実効値も読み直す
      readLabelFactors()
    })
    observer.observe(gridBoardEl)
    readLabelFactors()
    onCleanup(() => observer.disconnect())
  })

  // Issue #5: 画面スリープ防止。起動時に取得し、タブが再表示されたときに再取得する。
  // PR#11 must-2: 可視のまま error/released になった場合の再取得(スイッチ入力毎・
  // 30秒間隔タイマー)も initWakeLock 内でまとめて行う
  onMount(() => {
    const stopWakeLock = initWakeLock(setWakeLockStatus)
    onCleanup(stopWakeLock)
  })

  // PR#11 should-1: オフラインで動く準備(SWの制御下にあるか)を介助者メニューに表示する
  onMount(() => {
    const stopOfflineReadyWatch = initOfflineReadyWatch(setOfflineReadyStatus)
    onCleanup(stopOfflineReadyWatch)
  })

  // nit-3: display-mode(ホーム画面追加で起動した際の全画面表示)の変化を追従する
  onMount(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const query = window.matchMedia('(display-mode: fullscreen)')
    const onChange = () => setIsDisplayModeFullscreen(query.matches)
    query.addEventListener('change', onChange)
    onCleanup(() => query.removeEventListener('change', onChange))
  })

  // Issue #5: 全画面状態の表示・介助者メニューからの解除操作にも追従させる
  onMount(() => {
    if (typeof document === 'undefined') return
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreenChange)
    onCleanup(() => document.removeEventListener('fullscreenchange', onFullscreenChange))
  })

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
      // M2: タッチでは pointerdown にユーザーアクティベーションが伴わないことがあるため、
      // 介助者ボタン除外より前に resume を試みる(緊急の警告音を取りこぼさないため)
      resumeAlarmAudioContext()
      const target = event.target as HTMLElement | null

      if (caregiverMenuOpen()) {
        // M3(b): パネル内のタップは通常の介助者操作。パネル外(オーバーレイ背景)へのタップは
        // メニューを閉じてスキャンをホーム先頭から再開する。この押下自体では項目を実行しない
        if (target?.closest('.caregiver-panel')) {
          resetCaregiverIdleTimer()
          return
        }
        closeCaregiverMenu()
        return
      }

      if (target?.closest('[data-caregiver-control]')) return
      handleSwitchOn(Date.now())
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      resumeAlarmAudioContext()

      if (caregiverMenuOpen()) {
        // M3(b): 介助者はタッチで操作する想定。メニュー表示中の keydown は閉じて
        // ホーム先頭から再開する(その押下では項目を実行しない)
        event.preventDefault()
        closeCaregiverMenu()
        return
      }

      if (showDevNumbers && /^[1-9]$/.test(event.key)) {
        // 開発補助(?dev限定): 数字キーで先頭9項目を直接実行する。スイッチ扱いより先に処理し二重実行しない
        event.preventDefault()
        activateIndex(Number(event.key) - 1)
        return
      }
      event.preventDefault()
      handleSwitchOn(Date.now())
    }

    // M2: タッチ端末では pointerdown だけでは AudioContext の resume が保証されないため、
    // pointerup/touchend/click(capture) でも試す。介助者ボタンを含め常に呼んでよい。
    const onUserActivation = () => resumeAlarmAudioContext()

    // 右クリック等でコンテキストメニューを出さない(介助者ボタンの誤操作対策 S3含む)
    const onContextMenu = (event: Event) => event.preventDefault()

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('pointerup', onUserActivation, true)
    window.addEventListener('touchend', onUserActivation, true)
    window.addEventListener('click', onUserActivation, true)
    window.addEventListener('contextmenu', onContextMenu)
    const stopVisibilityResume = initAlarmVisibilityResume()

    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('pointerup', onUserActivation, true)
      window.removeEventListener('touchend', onUserActivation, true)
      window.removeEventListener('click', onUserActivation, true)
      window.removeEventListener('contextmenu', onContextMenu)
      stopVisibilityResume()
      clearCaregiverIdleTimer()
      stopAlarm()
    })
  })

  let longPressTimer: number | undefined
  const onCaregiverButtonDown = () => {
    // PR#16 Opus レビュー nit: 前回分のタイマーが残っていたら先に消してから開始する
    if (longPressTimer !== undefined) window.clearTimeout(longPressTimer)
    longPressTimer = window.setTimeout(() => {
      setCaregiverMenuOpen(true)
      resetCaregiverIdleTimer()
      // PR#11 3巡目 should-A/should-B: 開くたびに再計算し(未完了表示が古いままにならない)、
      // 未完了ならSWの更新チェックも試みる(recheckOfflineReady内部で判定)
      void recheckOfflineReady(setOfflineReadyStatus)
    }, 2000)
  }
  const onCaregiverButtonUp = () => {
    if (longPressTimer !== undefined) {
      window.clearTimeout(longPressTimer)
      longPressTimer = undefined
    }
  }
  onCleanup(() => {
    if (longPressTimer !== undefined) window.clearTimeout(longPressTimer)
  })

  return (
    <main class="app-shell">
      <section class="message-panel" aria-live="polite">
        <h1>{message()}</h1>
        <Show when={emergencyActive() && emergencyDetails().length > 0}>
          <ul class="emergency-details">
            <For each={emergencyDetails()}>{(label) => <li>{label}</li>}</For>
          </ul>
        </Show>
        <Show when={emergencyActive() && emergencySubMessage()}>
          <p class="emergency-sub">最新: {emergencySubMessage()}</p>
        </Show>

        {/* kako-jun 追加指示: 下部の帯(介助ボタン・警告音停止中)を廃止し、タイル領域を
            画面下端まで使う。両方ともメッセージ欄右上、文字と重ならない位置へ移す */}
        <div class="message-panel-controls">
          {/* PR#16 Opus レビュー should-6: 警告音停止中表示の有無でボタン位置が
              跳ねないよう、介助ボタンを先頭固定にする(常に同じ位置)。表示が
              現れる/消えるのはボタンの下だけ */}
          <button
            type="button"
            class="caregiver-button"
            data-caregiver-control
            onPointerDown={onCaregiverButtonDown}
            onPointerUp={onCaregiverButtonUp}
            onPointerLeave={onCaregiverButtonUp}
            onPointerCancel={onCaregiverButtonUp}
            onContextMenu={(event) => event.preventDefault()}
            aria-label="介助者メニュー（2秒長押し）"
          >
            介助
          </button>

          <Show when={!alarmAudioRunning()}>
            {/* S-new-4: data-caregiver-control を外し pointer-events:none にする。
                本人のタップは下のタイルへ届き、通常のスイッチ入力として扱われる(resumeも走る) */}
            <p class="audio-status-hint">警告音停止中：画面をタップしてください</p>
          </Show>
        </div>
      </section>

      <Show when={screen() === 'letters'}>
        <section class="letter-strip">
          <output>{letterText() || '文字を選んでください'}</output>
        </section>
      </Show>

      <section
        class="grid-board"
        classList={{ 'show-numbers': showDevNumbers, 'grid-fill': gridLayout().fill }}
        style={{
          '--cols': String(gridLayout().cols),
          '--rows': String(gridLayout().rows),
        }}
        aria-label={`${SCREEN_TITLES[screen()]}の選択肢`}
        ref={(el) => {
          gridBoardEl = el
        }}
      >
        <For each={currentMenu()}>
          {(item, index) => (
            <div
              class={`tile tile-${item.tone ?? 'neutral'}`}
              classList={{
                scanning: scanState().index === index(),
                'tile-nav': item.action.type === 'navigate',
              }}
              style={
                gridLayout().fill &&
                index() === currentMenu().length - 1 &&
                gridLayout().lastSpan > 1
                  ? { 'grid-column': `span ${gridLayout().lastSpan}` }
                  : undefined
              }
              aria-hidden="true"
            >
              <span class="tile-number">{index() + 1}</span>
              <span class="tile-label">{item.label}</span>
              <Show when={item.detail}>
                <span class="tile-detail">{item.detail}</span>
              </Show>
              {/* Issue #3 追加指示: 下位画面へ進むタイルは矢印文字ではなく、山形アイコン+
                  中身の予告(menus.ts で自動生成)で示す。読み上げはラベルのみ(記号は読まない) */}
              <Show when={item.action.type === 'navigate'}>
                <svg
                  class="tile-chevron"
                  viewBox="0 0 20 24"
                  aria-hidden="true"
                >
                  <path
                    d="M5 3 L15 12 L5 21"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="3.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
                <Show when={item.preview}>
                  <span class="tile-preview">{item.preview}</span>
                </Show>
              </Show>
            </div>
          )}
        </For>
      </section>

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

            <p class="caregiver-status" classList={{ warn: wakeLockStatus() !== 'active' }}>
              {WAKE_LOCK_LABELS[wakeLockStatus()]}
            </p>

            <p class="caregiver-status" classList={{ warn: offlineReadyStatus() !== 'ready' }}>
              {OFFLINE_READY_LABELS[offlineReadyStatus()]}
            </p>

            <Show when={fullscreenSupported && !isFullscreen() && !isDisplayModeFullscreen()}>
              <button type="button" class="caregiver-action" onClick={enterFullscreen}>
                全画面にする
              </button>
            </Show>

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

            <div class="caregiver-field">
              <span>文字サイズ</span>
              <div class="caregiver-choice-options">
                <For each={FONT_SIZES}>
                  {(size) => (
                    <button
                      type="button"
                      classList={{ active: settings().fontSize === size }}
                      onClick={() => updateSettings({ fontSize: size })}
                    >
                      {FONT_SIZE_LABELS[size]}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <div class="caregiver-field">
              <span>表示</span>
              <div class="caregiver-choice-options">
                <For each={THEMES}>
                  {(theme) => (
                    <button
                      type="button"
                      classList={{ active: settings().theme === theme }}
                      onClick={() => updateSettings({ theme })}
                    >
                      {THEME_LABELS[theme]}
                    </button>
                  )}
                </For>
              </div>
            </div>

            <label class="caregiver-field caregiver-checkbox">
              <input
                type="checkbox"
                checked={settings().highContrast}
                onChange={(event) => updateSettings({ highContrast: event.currentTarget.checked })}
              />
              <span>高コントラスト</span>
            </label>

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
