import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import {
  buildMenu,
  buildScreenBreadcrumb,
  LETTER_ROWS,
  PARENT_SCREEN,
  SCREEN_GUIDANCE,
  SCREEN_TITLES,
  type PainChoice,
  type ScreenId,
  type Tone,
} from './lib/menus'
import { advanceIdleSteps, UNDO_LAPS } from './lib/idleLaps'
import { press, resync, startScan, tick, type ScanConfig, type ScanState } from './lib/scan'
import {
  MORSE_WORD_GAP_MARGIN_MS,
  loadSettings,
  resetSettingsSection,
  saveSettings,
  type Settings,
  type SettingsSection,
} from './lib/settings'
import { initToneVisibilityResume, resumeToneAudioContext } from './lib/tone'
import { initWakeLock, type WakeLockStatus } from './lib/wakeLock'
import {
  initOfflineReadyWatch,
  recheckOfflineReady,
  type OfflineReadyStatus,
} from './lib/offlineReady'
import { computeGridLayout } from './lib/gridLayout'
import { applyHeadingFit } from './lib/fitHeading'
import PhraseEditor, { SettingsBackup } from './PhraseEditor'
import { createSwitchInput } from './lib/switchInput'
import { EMERGENCY_MESSAGE } from './lib/phrases'
import {
  EMERGENCY_REPEAT_MS,
  HAPTIC_STRENGTHS,
  canVibrate,
  playFeedback,
  type FeedbackEvent,
} from './lib/feedback'
import { MORSE_MAX_HOLD_MS, createMorseInput } from './lib/morseInput'
import {
  effectiveDashMs,
  MORSE_IDLE_EXIT_MS,
  formatMorseCode,
  morseNoiseMs,
  type MorseState,
  type MorseSymbol,
} from './lib/morse'
import { buildBehaviorNoteMap, buildCaregiverMenuNotes, buildScreenNotes } from './lib/guidance'
import { clearEmergencyState, loadEmergencyState, saveEmergencyState } from './lib/emergencyState'

/** 案内を短縮形にする画面(globals.css の低い/狭い画面のブレークポイントと同じ) */
const COMPACT_NOTES_QUERY = '(max-height: 500px), (max-width: 480px)'
const DEFAULT_MESSAGE = '選んだ内容がここに大きく出ます。'
/** 本人が緊急を解除したときに伝達欄へ出す文(Issue #108) */
const EMERGENCY_RELEASED_MESSAGE = '緊急を解除しました。'
/** 振り返れる伝達の件数の上限(Issue #120)。古いものから捨てる */
const HISTORY_MAX = 50
/** 介助者用メニューのカテゴリタブ(Issue #31)。並びは requirements.md §4.1.1 の木に合わせる */
const CAREGIVER_TABS = [
  { id: 'status', label: '端末の状態' },
  { id: 'scan', label: 'スキャン' },
  { id: 'input', label: 'モールス' },
  { id: 'feedback', label: '音と振動' },
  { id: 'display', label: '表示' },
  { id: 'phrases', label: 'フレーズ' },
  { id: 'backup', label: 'データ' },
] as const
const CAREGIVER_TAB_NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'Home', 'End']
/** タブ移動に使うキーか。Ctrl/Alt/Meta 付きはブラウザ/OS のショートカット(Alt+←=戻る等)なので対象外 */
function isCaregiverTabNavKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return false
  return CAREGIVER_TAB_NAV_KEYS.includes(event.key)
}
type CaregiverTabId = (typeof CAREGIVER_TABS)[number]['id']

/** 介助者用メニュー内の操作が途絶えたときに自動で閉じるまでの時間(requirements.md §6) */
const CAREGIVER_MENU_IDLE_TIMEOUT_MS = 60000

const VOICE_LABELS: Record<Settings['voiceMode'], string> = {
  off: 'OFF',
  tone: '効果音だけ',
  short: '短く読む',
  full: '全部読む',
}

const VOICE_MODES: Settings['voiceMode'][] = ['off', 'tone', 'short', 'full']

// Issue #5: 画面スリープ防止(Wake Lock)の状態を介助者用メニューに表示する文言。
// 'active' 以外は本人の入力が届かなくなる恐れがあるため、端末側の自動ロック解除を促す。
export const WAKE_LOCK_LABELS: Record<WakeLockStatus, string> = {
  active: '画面スリープ防止: 有効',
  unsupported: '画面スリープ防止: 無効 — 端末の自動ロックを切ってください。',
  error: '画面スリープ防止: 無効 — 端末の自動ロックを切ってください。',
  released: '画面スリープ防止: 無効 — 端末の自動ロックを切ってください。',
}

// PR #11 レビュー対応(should-1): オフラインで動く準備(Service Worker がこのページを
// 制御しているか)を Wake Lock と同じ扱いで介助者用メニューに表示する。
export const OFFLINE_READY_LABELS: Record<OfflineReadyStatus, string> = {
  ready: 'オフライン準備: 完了',
  'not-ready': 'オフライン準備: 未完了 — 通信できる場所で、このページを開き直してください。',
}

function speak(mode: Settings['voiceMode'], text: string, shortText = text, legacyVibrate = false) {
  window.speechSynthesis?.cancel()
  if (mode === 'off') return
  if (mode === 'tone') {
    // 効果音だけ(バイブ)。触覚フィードバック(#13)が有効なら、そちらの区別できるパターンを
    // 打ち消さないよう、ここでは振動しない。触覚が OFF のときだけ従来の短い振動を出す
    if (legacyVibrate) navigator.vibrate?.(35)
    return
  }
  const utterance = new SpeechSynthesisUtterance(mode === 'short' ? shortText : text)
  utterance.lang = 'ja-JP'
  utterance.rate = 0.85
  utterance.pitch = 0.9
  window.speechSynthesis?.speak(utterance)
}

const HAPTIC_STRENGTH_LABELS: Record<Settings['hapticsStrength'], string> = {
  light: '弱',
  standard: '標準',
  strong: '強',
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

/** 入力欄で文字を打つ・編集するキーか。Enter・Space(変換中以外)・Tab・メディア/音量キー等は含めない */
function isTextEditingKey(event: KeyboardEvent): boolean {
  if (event.isComposing || event.key === 'Process') return true
  if (event.key.length === 1) return event.key !== ' '
  return [
    'Backspace',
    'Delete',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Home',
    'End',
  ].includes(event.key)
}

const LETTER_SCREENS: ScreenId[] = ['letters', 'lettersRow']

const ACTIVATE_ON_LABELS: Record<Settings['activateOn'], string> = {
  press: '押した瞬間',
  release: '離した瞬間',
}

const ACTIVATE_ONS: Settings['activateOn'][] = ['press', 'release']

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
    // 倍率が 4/3 などのとき浮動小数の端数(2000.0000000000002)でタイマーが1拍ずれないよう、ms に丸める
    headHoldMs: Math.round(settings().intervalMs * settings().headHoldMultiplier),
    debounceMs: settings().debounceMs,
  }))

  const [screen, setScreen] = createSignal<ScreenId>('home')
  // 再読み込み・再起動後も、介助者が解除するまで緊急状態を復元する(requirements.md §4.3)
  const restoredEmergency = loadEmergencyState()
  const [emergencyActive, setEmergencyActive] = createSignal(restoredEmergency !== null)
  // 緊急の詳細（苦しい/痛い等）は積み上げ式。緊急の再選択では消さない(S1)
  const [emergencyDetails, setEmergencyDetails] = createSignal<string[]>(
    restoredEmergency?.details ?? [],
  )
  // 緊急状態は message へ入れず、専用の emergency-status に表示する。
  // 緊急中の後続伝達だけは、通常の選択結果と同じ message 領域へ明示的に分離して出す。
  const [message, setMessage] = createSignal(restoredEmergency?.sub ?? DEFAULT_MESSAGE)
  const [messageTone, setMessageTone] = createSignal<Tone>('neutral')

  // Issue #120: 伝達の履歴(介助者が左右の矢印で振り返る)。端末のメモリ内だけに持ち、保存しない。
  // historyBack は「何件前を表示しているか」(0 = 最新)。新しい伝達・緊急・取り消しで必ず 0 に戻し、
  // 過去の表示が本人の新しい伝達を隠さないようにする
  const [history, setHistory] = createSignal<string[]>(
    restoredEmergency?.sub ? [restoredEmergency.sub] : [],
  )
  const [historyBack, setHistoryBack] = createSignal(0)
  // Issue #123: 「もう一度」。直前の伝達の振動パターン(はい/いいえ等)を覚えておき、同じものを出し直す
  let lastMessageEvent: FeedbackEvent = 'message'
  // もう一度伝えた回数。伝達欄(緊急の再伝達なら緊急の帯)を点滅させ、音声が無くても周囲に分かるようにする
  const [repeatPulse, setRepeatPulse] = createSignal(0)
  const [repeatedMessage, setRepeatedMessage] = createSignal(false)
  const [repeatedEmergency, setRepeatedEmergency] = createSignal(false)
  const clearRepeatMarks = () => {
    setRepeatedMessage(false)
    setRepeatedEmergency(false)
  }
  const pushHistory = (text: string) => {
    setHistory((items) => [...items, text].slice(-HISTORY_MAX))
    setHistoryBack(0)
  }
  // 最新の表示(message)が履歴の末尾と同じ伝達を指しているか。取り消し・緊急の解除で最新が空のときは false
  const liveIsLatestEntry = () => message() !== DEFAULT_MESSAGE
  /** いまの最新より前にある伝達の件数(= 戻れる最大の件数) */
  const olderCount = createMemo(() => history().length - (liveIsLatestEntry() ? 1 : 0))
  const pastEntry = createMemo(() => {
    const back = historyBack()
    if (back <= 0) return null
    const items = history()
    return items[items.length - back - (liveIsLatestEntry() ? 1 : 0)] ?? null
  })
  const displayedMessage = createMemo(() => pastEntry() ?? message())
  /** 「もう一度」で伝え直せるものがあるか(直前の伝達、または緊急の呼び出し) */
  const canRepeat = () => message() !== DEFAULT_MESSAGE || emergencyActive()
  const stepHistory = (delta: -1 | 1) => {
    // 介助者用メニュー表示中は、背後の矢印を押しても動かさない(パンくずと同じガード)
    if (caregiverMenuOpen()) return
    setHistoryBack((back) => Math.min(olderCount(), Math.max(0, back + delta)))
  }

  // Issue #22: 上部メッセージ(h1)を 1 行に収まる最大サイズで表示する。再計算は
  // メッセージ変更・幅変化・回転/リサイズ・Web フォント読み込み後だけ(h1 は文字サイズ設定の対象外)
  // (rAF でまとめる。毎フレームの DOM 測定はしない)
  let headingEl: HTMLHeadingElement | undefined
  let headingFitFrame: number | undefined
  const scheduleHeadingFit = () => {
    if (headingFitFrame !== undefined) return
    headingFitFrame = window.requestAnimationFrame(() => {
      headingFitFrame = undefined
      if (headingEl) applyHeadingFit(headingEl)
    })
  }
  createEffect(() => {
    displayedMessage()
    scheduleHeadingFit()
  })
  onMount(() => {
    const panel = headingEl?.parentElement
    let lastWidth = panel?.clientWidth ?? 0
    const observer =
      panel && typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
            // h1 のサイズ変更で panel の高さが変わっても再計算しない(幅の変化だけ見る)
            if (panel.clientWidth === lastWidth) return
            lastWidth = panel.clientWidth
            scheduleHeadingFit()
          })
        : null
    if (panel) observer?.observe(panel)
    window.addEventListener('resize', scheduleHeadingFit)
    window.addEventListener('orientationchange', scheduleHeadingFit)
    const fonts = document.fonts
    let disposed = false
    void fonts?.ready.then(() => {
      if (!disposed) scheduleHeadingFit()
    })
    fonts?.addEventListener?.('loadingdone', scheduleHeadingFit)
    onCleanup(() => {
      disposed = true
      observer?.disconnect()
      window.removeEventListener('resize', scheduleHeadingFit)
      window.removeEventListener('orientationchange', scheduleHeadingFit)
      fonts?.removeEventListener?.('loadingdone', scheduleHeadingFit)
      if (headingFitFrame !== undefined) window.cancelAnimationFrame(headingFitFrame)
    })
  })
  // 緊急中に選ばれた直前の伝達。保存形式の互換性のため emergencyState の sub を使うが、
  // 表示は曖昧な「最新」ではなく、独立した「直前に伝えたこと」領域へ出す。
  const [emergencySubMessage, setEmergencySubMessage] = createSignal<string | null>(
    restoredEmergency?.sub ?? null,
  )
  const [showUndo, setShowUndo] = createSignal(false)
  let undoLapsRemaining = 0
  // 下位画面での無入力ステップ数(カーソルが進んだ項目数。Issue #76)。画面遷移・本人の入力・押下中で 0 に戻す
  let idleSteps = 0
  // 押している最中の入力元(キー・ポインター)。押している間は無入力として数えない(Issue #76)
  const heldInputs = new Set<string>()

  const [caregiverMenuOpen, setCaregiverMenuOpen] = createSignal(false)
  const [caregiverTab, setCaregiverTab] = createSignal<CaregiverTabId>('status')
  const [letterText, setLetterText] = createSignal('')
  // 痛みの強さの画面で使う、直前に選んだ痛い場所(Issue #12)
  const [painChoice, setPainChoice] = createSignal<PainChoice | undefined>(undefined)
  // 文字盤の文字段階で表示している行(LETTER_ROWS の添字)
  const [letterRow, setLetterRow] = createSignal(0)
  // Issue #5: 画面スリープ防止の状態。介助者用メニューに表示する
  const [wakeLockStatus, setWakeLockStatus] = createSignal<WakeLockStatus>('unsupported')
  // Issue #5 / PR#11 should-1: オフラインで動く準備(SWがこのページを制御しているか)
  const [offlineReadyStatus, setOfflineReadyStatus] = createSignal<OfflineReadyStatus>('not-ready')

  // 表示中メニューはここでしか作らない。スキャン状態・レンダリングの双方が
  // 必ずこの同じ配列を参照することで、カーソルと項目のずれを防ぐ。
  const currentMenu = createMemo(() =>
    buildMenu(screen(), {
      showUndo: showUndo(),
      emergencyActive: emergencyActive(),
      emergencyDetails: emergencyDetails(),
      letterRow: letterRow(),
      phrases: settings().phrases,
      morseEnabled: settings().morseEnabled,
      pain: painChoice(),
    }),
  )

  // 再起動で復元した緊急は、ブラウザが振動を許す(ユーザー操作を一度受ける)まで振動しない。
  // 案内の出し分け用。解除はブラウザ自身の判定(navigator.userActivation.hasBeenActive)に合わせ、
  // 非対応環境では最初の触れる/キー操作で解除する。音量キー等が操作として数えられない端末では、
  // 操作しても解除されず案内が残る(実際にまだ振動しないので正しい)
  const [awaitingFirstTouch, setAwaitingFirstTouch] = createSignal(restoredEmergency !== null)
  onMount(() => {
    if (!awaitingFirstTouch()) return
    const events = ['pointerdown', 'pointerup', 'click', 'keydown'] as const
    const stop = () => {
      for (const name of events) window.removeEventListener(name, check, true)
    }
    const check = () => {
      // 操作の種類によって activation が付くのは次のタスク。そこで判定する
      window.setTimeout(() => {
        const activation = (
          navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }
        ).userActivation
        if (activation && !activation.hasBeenActive) return
        setAwaitingFirstTouch(false)
        stop()
      }, 0)
    }
    for (const name of events) window.addEventListener(name, check, true)
    onCleanup(stop)
  })
  // 低い画面(高さ500px以下)か狭い画面(幅480px以下)では案内を短縮形にする。本人は画面をスクロールできず、
  // 帯が格子を押し潰さないため。出す・出さないは変えない
  const compactQuery =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia(COMPACT_NOTES_QUERY)
      : null
  const [compactNotes, setCompactNotes] = createSignal(compactQuery?.matches === true)
  onMount(() => {
    if (!compactQuery) return
    const onChange = () => setCompactNotes(compactQuery.matches)
    compactQuery.addEventListener?.('change', onChange)
    onCleanup(() => compactQuery.removeEventListener?.('change', onChange))
  })
  // 介助者用メニュー上部の案内を短縮形にするのは、高さが足りない画面だけ(Issue #111。縦長スマホは通常の文言)
  const lowScreenQuery =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(max-height: 500px)')
      : null
  const [lowScreen, setLowScreen] = createSignal(lowScreenQuery?.matches === true)
  onMount(() => {
    if (!lowScreenQuery) return
    const onChange = () => setLowScreen(lowScreenQuery.matches)
    lowScreenQuery.addEventListener?.('change', onChange)
    onCleanup(() => lowScreenQuery.removeEventListener?.('change', onChange))
  })
  // Issue #58/#79: 画面下の固定案内は緊急中の振動だけ。通常時は空で、帯ごと出さない
  const screenNotes = createMemo(() =>
    buildScreenNotes({
      emergencyActive: emergencyActive(),
      vibrationAwaitsTouch: awaitingFirstTouch(),
      canVibrate: canVibrate(),
      compact: compactNotes(),
      settings: settings(),
    }),
  )
  const behaviorNotes = createMemo(() => buildBehaviorNoteMap({ settings: settings() }))
  const currentScreenGuidance = createMemo(() => {
    if (screen() === 'painIntensity' && painChoice()) {
      return `${painChoice()?.label}の痛みの強さを選んでください。`
    }
    return SCREEN_GUIDANCE[screen()]
  })
  const screenBreadcrumb = createMemo(() =>
    buildScreenBreadcrumb(screen(), {
      painLabel: painChoice()?.label,
      letterRowLabel: LETTER_ROWS[letterRow()]?.name,
    }),
  )

  // Issue #47: 通常画面の格子はビューポートの縦横だけで決まる固定格子(gridLayout.ts)。
  // grid-board 自身の実測サイズは、画面外へのスクロール追従(scrollIntoView)の再実行契機にだけ使う。
  let gridBoardEl: HTMLElement | undefined
  const [gridSize, setGridSize] = createSignal({ width: 0, height: 0 })
  const readViewport = () =>
    typeof window === 'undefined'
      ? { width: 0, height: 0 }
      : { width: window.innerWidth, height: window.innerHeight }
  const [viewportSize, setViewportSize] = createSignal(readViewport())
  const gridLayout = createMemo(() =>
    computeGridLayout(
      currentMenu().length,
      viewportSize().width,
      viewportSize().height,
      screen() === 'home' ? 'home' : screen() === 'letters' ? 'letters' : 'standard',
    ),
  )
  // 固定格子の空きセル数(項目数が格子より少ないぶん。非操作のセルとして描く)
  const emptyCellCount = createMemo(() => {
    const layout = gridLayout()
    return layout.fill ? Math.max(0, layout.cols * layout.rows - currentMenu().length) : 0
  })

  // 入力途中の文字列は折り返して大きく出し、長くなっても直近の入力(末尾)が見えるようにする
  let letterOutputEl: HTMLOutputElement | undefined
  createEffect(() => {
    letterText()
    // 文字盤を離れると入力欄ごと破棄され、戻ると作り直されて先頭へ戻るので、画面遷移でも追う
    screen()
    if (letterOutputEl) letterOutputEl.scrollTop = letterOutputEl.scrollHeight
  })

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
    speak(settings().voiceMode, text, shortText, !settings().hapticsEnabled)
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

  // Issue #13: 本人への触覚フィードバック。パターンは lib/feedback.ts に集約している
  // 本人の入力へのフィードバックを最後に出した時刻。緊急中の周期の振動が、直後に重なって
  // はい/いいえなどの振動を打ち消さないよう、周期の振動はこの直後には出さない
  let lastFeedbackAt = 0
  const feedback = (event: FeedbackEvent) => {
    if (event !== 'emergencyActive') lastFeedbackAt = Date.now()
    playFeedback(event, {
      enabled: settings().hapticsEnabled,
      strength: settings().hapticsStrength,
      soundWhenVoiceOff: settings().hapticSoundWhenVoiceOff,
      soundAlso: settings().hapticSoundAlso,
      voiceMode: settings().voiceMode,
    })
  }

  const showMessage = (text: string, tone: Tone = 'neutral', event?: FeedbackEvent) => {
    setMessage(text)
    setMessageTone(tone)
    document.documentElement.dataset.messageTone = tone
    feedback(event ?? (tone === 'urgent' ? 'urgentMessage' : 'message'))
    announce(text)
  }

  // home 以外へ遷移するときは「取り消し」の2周猶予を終わらせる(nit: 積み残した猶予が
  // 後で home に戻った際に誤って復活しないように)。home への遷移(伝達完了の帰着点)では
  // 呼び出し元が設定した showUndo/undoLapsRemaining をそのまま尊重する。
  // Issue #14: モールス入力。確定済みの文字列は画面を出入りしても残す(伝達したら消す)
  const [morseText, setMorseText] = createSignal('')
  const [morseView, setMorseView] = createSignal<MorseState | null>(null)
  const [morseHold, setMorseHold] = createSignal<MorseSymbol | null>(null)
  const morseConfig = () => {
    const s = settings()
    // 押下時間の下限(#6)は雑音除去として効く。長押しの境目はそれより長くする。
    // 語の区切りが文字の確定より長いことは、設定の保存値で保証している(settings.ts)
    return {
      noiseMs: morseNoiseMs(s.minHoldMs),
      dashMs: effectiveDashMs(s.morseDashMs, s.minHoldMs),
      letterGapMs: s.morseLetterGapMs,
      wordGapMs: s.morseWordGapMs,
    }
  }
  const morseInput = createMorseInput({
    getConfig: morseConfig,
    // 介助者用メニューを開いている間は、裏で文字が確定したり復帰したりしないよう時間を止める
    isPaused: caregiverMenuOpen,
    onHold: setMorseHold,
    onState: (state) => {
      const previous = morseText()
      setMorseView(state)
      setMorseText(state.text)
      // 確定した文字を、音声モードに応じて読む。濁点・半濁点で文字が変わったとき(か→が)も読む。
      // 1字消したときは読まない
      if (state.text !== previous && state.text.length >= previous.length) {
        const added = (
          state.text.length > previous.length
            ? state.text.slice(previous.length)
            : (Array.from(state.text).pop() ?? '')
        ).trim()
        if (added) announce(added, added)
      }
    },
    onEvent: (event) => {
      if (event.type === 'emergency') {
        // SOS(・・・－－－・・・)の連続9押下: 確定を待たず即緊急(モールス中でも緊急に届く)
        // 並び順に頼らず、緊急のアクションを直接実行する
        runAction({ id: 'emergency', label: '緊急', tone: 'urgent', action: { type: 'emergency' } })
      } else if (event.type === 'exit') {
        goTo('home')
      } else {
        setMorseText('')
        completeTransmission(event.text, 'neutral')
      }
    },
  })

  const goTo = (next: ScreenId) => {
    if (next === 'morse') morseInput.start(morseText())
    else morseInput.stop()
    if (next !== 'home' && (showUndo() || undoLapsRemaining > 0)) {
      setShowUndo(false)
      undoLapsRemaining = 0
    }
    idleSteps = 0
    setScreen(next)
    setScanState((previous) => startScan(Date.now(), scanConfig(), previous.lastPressAt))
    // S4: 聴覚スキャンON時、遷移直後の先頭項目(通常下位画面では戻る)も読む。
    // 直前の伝達読み上げが済んでいれば messageAnnounceGrace により cancel されない(S-new-1)
    if (settings().auditoryScan) {
      const first = buildMenu(next, {
        showUndo: showUndo(),
        emergencyActive: emergencyActive(),
        emergencyDetails: emergencyDetails(),
        letterRow: letterRow(),
        phrases: settings().phrases,
        morseEnabled: settings().morseEnabled,
        pain: painChoice(),
      })[0]
      if (first) announceScanItem(first.label)
    }
  }

  // 通常の伝達完了。緊急状態は専用領域に残したまま、後続伝達を別の結果領域へ出す。
  const completeTransmission = (text: string, tone: Tone = 'neutral', event?: FeedbackEvent) => {
    pushHistory(text)
    clearRepeatMarks()
    lastMessageEvent = event ?? (tone === 'urgent' ? 'urgentMessage' : 'message')
    if (emergencyActive()) {
      setEmergencySubMessage(text)
      setMessage(text)
      setMessageTone(tone)
      document.documentElement.dataset.messageTone = tone
      feedback(event ?? 'message')
      announce(text)
      goTo('home')
      return
    }
    showMessage(text, tone, event)
    setShowUndo(true)
    undoLapsRemaining = UNDO_LAPS
    goTo('home')
  }

  // Issue #8: 書き出した設定の取り込み。検証済みの設定で丸ごと置き換える
  const replaceSettings = (next: Settings) => {
    saveSettings(next)
    setSettings(next)
  }

  // Issue #117: 開いているタブの設定だけを初期値に戻す。ほかのタブの設定・緊急状態・スキャンには触れない
  const resetSection = (section: SettingsSection) => {
    replaceSettings(resetSettingsSection(settings(), section))
  }

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      saveSettings(next)
      return next
    })
  }

  // M3(a): 介助者用メニュー内の操作が60秒ないと自動で閉じ、スキャンを再開する。
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
    feedback('cleared')
    clearRepeatMarks()
    setHistoryBack(0)
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

  const runAction = (item: ReturnType<typeof currentMenu>[number]) => {
    const action = item.action
    switch (action.type) {
      case 'emergency': {
        // S1: 緊急の再選択は詳細を消さない。緊急主文は専用領域に立てる
        const alreadyActive = emergencyActive()
        setEmergencyActive(true)
        setHistoryBack(0)
        clearRepeatMarks()
        // S2: 緊急発生時は取り消しの猶予を必ず終わらせる
        setShowUndo(false)
        undoLapsRemaining = 0
        if (!alreadyActive) {
          setEmergencyDetails([])
          setEmergencySubMessage(null)
          setMessage(DEFAULT_MESSAGE)
          setMessageTone('neutral')
          document.documentElement.dataset.messageTone = 'neutral'
          feedback('emergency')
          announce(EMERGENCY_MESSAGE)
        } else {
          feedback('emergency')
        }
        goTo('urgentDetail')
        return
      }
      case 'emergencyDetail': {
        // S1: 見出しは変えず、詳細を積み上げ式(重複なし)で見出し下に表示する
        setEmergencyDetails((details) =>
          details.includes(action.label) ? details : [...details, action.label],
        )
        clearRepeatMarks()
        feedback('urgentMessage')
        announce(`${EMERGENCY_MESSAGE}${action.label}`, action.label)
        setShowUndo(false)
        goTo('home')
        return
      }
      case 'emergencyRelease': {
        // Issue #108: 本人による緊急の解除。緊急 → 緊急を解除 → 解除する の明示操作でだけ届く。
        // 緊急の帯・保存状態・周期の振動を介助者の解除と同じ処理(clearEmergency)で止め、解除したことを
        // 伝達欄と読み上げで本人と周囲に知らせる。取り消しは出さない(解除の取り消しは緊急を選び直す)
        if (!emergencyActive()) {
          goTo('home')
          return
        }
        clearEmergency()
        pushHistory(EMERGENCY_RELEASED_MESSAGE)
        lastMessageEvent = 'message'
        setMessage(EMERGENCY_RELEASED_MESSAGE)
        announce(EMERGENCY_RELEASED_MESSAGE)
        goTo('home')
        return
      }
      case 'undo': {
        // menus.ts の buildHomeMenu が緊急中は取り消しをメニューに含めないが、
        // 数字キー等での直接実行に備えてここでも二重に防ぐ
        if (emergencyActive()) return
        // Issue #94: 取り消したら「直前に伝えたこと」自体を消し、何も伝えていない状態に戻す
        // (1つ前の返事は最新として復元しない)。取り消した伝達は履歴(Issue #120)からも消す
        if (liveIsLatestEntry()) setHistory((items) => items.slice(0, -1))
        setHistoryBack(0)
        clearRepeatMarks()
        setMessage(DEFAULT_MESSAGE)
        setMessageTone('neutral')
        document.documentElement.dataset.messageTone = 'neutral'
        setShowUndo(false)
        undoLapsRemaining = 0
        goTo('home')
        return
      }
      case 'repeat': {
        // Issue #123: 直前の伝達をもう一度伝える。新しい伝達ではないので、履歴・取り消しの猶予は変えない。
        // 伝達が無く緊急中なら、緊急の呼び出しをもう一度伝える。どちらも無ければ何も伝えない
        setHistoryBack(0)
        if (message() !== DEFAULT_MESSAGE) {
          feedback(lastMessageEvent)
          announce(message())
          setRepeatedMessage(true)
          setRepeatedEmergency(false)
          setRepeatPulse((n) => n + 1)
        } else if (emergencyActive()) {
          const details = emergencyDetails()
          feedback('emergency')
          announce(`${EMERGENCY_MESSAGE}${details.join('、')}`, EMERGENCY_MESSAGE)
          setRepeatedEmergency(true)
          setRepeatPulse((n) => n + 1)
        }
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
        // はい・いいえは、本人が他人の反応なしに区別できる専用の振動パターンで返す
        const event: FeedbackEvent = item.id === 'yes' ? 'yes' : item.id === 'no' ? 'no' : 'message'
        completeTransmission(action.text, action.tone ?? 'neutral', event)
        return
      }
      case 'painLocation': {
        // 痛い場所を選んだら、強さ(場所だけ/少し/かなり/とても)を選ぶ画面へ
        setPainChoice({ label: action.label, text: action.text, tone: action.tone })
        goTo('painIntensity')
        return
      }
      case 'letterRow': {
        setLetterRow(action.row)
        goTo('lettersRow')
        return
      }
      case 'letterAppend': {
        setLetterText((text) => text + action.char)
        announce(action.char, action.char)
        // 1字入れたら行段階へ戻る(次の文字も 行 → 文字 の2段階で選ぶ)
        goTo('letters')
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

  // Issue #6: 押している間の進捗(押下時間の下限があるときだけ値が入る)
  const [holdProgress, setHoldProgress] = createSignal<number | null>(null)

  const handleSwitchOn = (
    now: number,
    target?: { index: number; screen: ScreenId; itemId: string | undefined },
  ) => {
    if (caregiverMenuOpen()) return
    // 押しっぱなし中に画面が変わった、または同じ画面でも項目の並びが変わった(例: 取り消しが
    // 消えた)場合、押し始めの項目はもう同じ位置にない。別の項目(特に緊急)を誤って
    // 実行しないよう無視する
    if (
      target &&
      (target.screen !== screen() || currentMenu()[target.index]?.id !== target.itemId)
    ) {
      return
    }
    const itemCount = currentMenu().length
    const resynced = resync(scanState(), itemCount)
    const result = press(resynced, itemCount, now, scanConfig(), target?.index)
    setScanState(result.state)
    if (result.activatedIndex === null) return
    // 入力が受理されたことを、まず軽い振動で返す。この後の伝達・緊急のパターンが置き換える
    feedback('accepted')
    activateIndex(result.activatedIndex)
  }

  // Issue #6: 押下時間の下限・離して決定。キー/タイルの直接タップ/Bluetooth シャッターすべてここを通す。
  // 決定するのは押し始めの対象(キーはカーソルが乗っていた項目、タイルの直接タップは押したタイル)。
  const switchInput = createSwitchInput<{
    index: number
    screen: ScreenId
    itemId: string | undefined
  }>({
    getConfig: () => ({ minHoldMs: settings().minHoldMs, activateOn: settings().activateOn }),
    snapshot: () => {
      const index = resync(scanState(), currentMenu().length).index
      return { index, screen: screen(), itemId: currentMenu()[index]?.id }
    },
    onActivate: (target) => handleSwitchOn(Date.now(), target),
    onProgress: setHoldProgress,
  })

  // 緊急の呼び出し中は、一定周期で振動を繰り返し、まだ続いていることを本人が知れるようにする
  createEffect(() => {
    if (!emergencyActive()) return
    const id = window.setInterval(() => {
      if (Date.now() - lastFeedbackAt < EMERGENCY_REPEAT_MS) return // 本人の直前の振動を打ち消さない
      feedback('emergencyActive')
    }, EMERGENCY_REPEAT_MS)
    onCleanup(() => window.clearInterval(id))
  })

  // 本人のスイッチ入力の振り分け。モールス画面では押下の長さが符号になり、それ以外は
  // 従来のスキャン選択(switchInput)に渡す。解放・取り消しはどちらにも渡して取りこぼさない。
  const input = {
    down: (
      sourceId: string,
      tile?: { index: number; screen: ScreenId; itemId: string | undefined },
    ) => {
      if (screen() === 'morse') morseInput.down(sourceId)
      else switchInput.down(sourceId, tile)
    },
    up: (sourceId: string) => {
      switchInput.up(sourceId)
      morseInput.up(sourceId)
    },
    cancel: (sourceId: string) => {
      switchInput.cancel(sourceId)
      morseInput.cancel(sourceId)
    },
    cancelAll: () => {
      switchInput.cancelAll()
      morseInput.cancelAll()
    },
  }

  // 緊急状態の保存。有効な間は内容の変化ごとに保存し、解除されたら保存ごと消す。
  createEffect(() => {
    if (emergencyActive()) {
      saveEmergencyState({ details: emergencyDetails(), sub: emergencySubMessage() })
    } else {
      clearEmergencyState()
    }
  })

  // 復元した緊急は、静かな視覚表示(緊急パネル)だけで再開する
  onMount(() => {
    if (restoredEmergency) {
      document.documentElement.dataset.messageTone = 'neutral'
    }
  })

  // grid-board の実測サイズとビューポートの縦横を追従する(回転・キーボード開閉・
  // 介助者設定変更後の再計算も自動で効く)
  onMount(() => {
    const onResize = () => setViewportSize(readViewport())
    window.addEventListener('resize', onResize)
    onCleanup(() => window.removeEventListener('resize', onResize))
    if (!gridBoardEl || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const box = entry.contentBoxSize?.[0]
      const width = box ? box.inlineSize : entry.contentRect.width
      const height = box ? box.blockSize : entry.contentRect.height
      setGridSize({ width, height })
      setViewportSize(readViewport())
    })
    observer.observe(gridBoardEl)
    onCleanup(() => observer.disconnect())
  })

  // Issue #5: 画面スリープ防止。起動時に取得し、タブが再表示されたときに再取得する。
  // PR#11 must-2: 可視のまま error/released になった場合の再取得(スイッチ入力毎・
  // 30秒間隔タイマー)も initWakeLock 内でまとめて行う
  onMount(() => {
    const stopWakeLock = initWakeLock(setWakeLockStatus)
    onCleanup(stopWakeLock)
  })

  // PR#11 should-1: オフラインで動く準備(SWの制御下にあるか)を介助者用メニューに表示する
  onMount(() => {
    const stopOfflineReadyWatch = initOfflineReadyWatch(setOfflineReadyStatus)
    onCleanup(stopOfflineReadyWatch)
  })

  // スキャンの進行ループ。setTimeout を自己再スケジュールし、次に進めるべき時刻に合わせる。
  // 毎回 currentMenu() から項目数を取り、表示中メニューとスキャン状態を同じ配列から導出する。
  onMount(() => {
    let timeoutId: number | undefined

    const schedule = (delay: number) => {
      timeoutId = window.setTimeout(step, Math.max(16, delay))
    }

    function step() {
      // モールス入力中は押下が符号になるので、スキャンのカーソルは動かさない
      if (!caregiverMenuOpen() && screen() !== 'morse') {
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
          // 下位画面で入力がないまま規定の周回数を回ったらホームへ戻す(ホーム・モールスは数えない)
          if (screen() !== 'home') {
            // 押している間は数えない(離して決定・押下時間の下限で押したままの操作を、復帰で捨てない)
            const lap =
              heldInputs.size > 0
                ? { steps: 0, returnHome: false }
                : advanceIdleSteps(idleSteps, items.length)
            idleSteps = lap.steps
            if (lap.returnHome) {
              // goTo が先頭項目(ホームの緊急)の読み上げまで行う。古い画面の項目は読まない
              goTo('home')
              schedule(scanState().nextAdvanceAt - Date.now())
              return
            }
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

  // 本人の入力は2経路だけ。①タイルの直接タップ/クリック(押したタイルを実行。onTilePointerDown)
  // ②任意キー / Bluetooth シャッター(キー入力として届く。現在のスキャン対象を実行)。
  // 画面の背景(タイル以外)へのタップは何も実行しない。ここではポインターの「離し・取り消し」だけ拾い、
  // 押下(離して決定・押下時間の下限)の解放を取りこぼさないようにする。
  // pointerdown を見たポインターの記録(ポインター単位)。続く click は同じ操作の一部なので実行しない。
  // pointerdown を伴わない click だけを支援技術の合成として実行する。背景・オーバーレイ・介助者
  // メニューの押下も記録し、メニューを閉じた押下の click が下のタイルへ届いても実行されないようにする。
  // downAt: pointerdown の時刻 / upAt: pointerup の時刻(押下中は null)
  const pointerSeen = new Map<number, { downAt: number; upAt: number | null }>()
  const POINTER_CLICK_WINDOW_MS = 1000 // pointerup 後、click を待つ上限(取りこぼし記録の破棄)
  const POINTER_STALE_MS = 10000 // pointerup/pointercancel が届かなかった記録の破棄(保険)
  // 直近の click(capture で判定)が pointerdown に裏付けられていたか。タイルの click が読む
  let clickBackedByPointer = false
  // 介助者用メニューを開いた pointerdown のポインター(Issue #112)。タッチでは、同じタップの click が
  // 開いた直後のパネル(右上の「閉じる」は「介助者用」ボタンと同じ位置)へ届き、開いた瞬間に閉じていた。
  // その 1 回の click だけをパネルへ届けない。次の押下が始まったら忘れる
  let menuOpeningPointer: number | null = null
  onMount(() => {
    const onPointerDownCapture = (event: PointerEvent) => {
      menuOpeningPointer = null
      pointerSeen.set(event.pointerId, { downAt: Date.now(), upAt: null })
      heldInputs.add(`pointer:${event.pointerId}`)
      idleSteps = 0
    }
    const onClickCapture = (event: MouseEvent) => {
      const now = Date.now()
      const pointerId = (event as PointerEvent).pointerId
      // 判定: click の pointerId が数値なら、その記録があれば同じ操作の click(消費)、無ければ
      // pointerdown を伴わない合成 click(実行)。pointerId が無い(undefined)環境だけは、
      // 記録済みの押下を先頭から1つ消費する。TalkBack / Switch Access が合成する click の
      // pointerId が実際にどうなるかは未確認で、実機確認事項(Issue #38)。
      // 一致する記録は、期限切れの判定より先に探して消費する(メインスレッドが1秒以上止まっても、
      // その押下の click を合成扱いして二重実行しないため)
      let consumed: number | undefined
      if (typeof pointerId === 'number') {
        if (pointerSeen.delete(pointerId)) consumed = pointerId
      }
      // 期限切れの記録は、消費した記録以外だけを対象に破棄する
      for (const [id, rec] of pointerSeen) {
        const expired =
          rec.upAt !== null
            ? now - rec.upAt > POINTER_CLICK_WINDOW_MS
            : now - rec.downAt > POINTER_STALE_MS
        if (expired) pointerSeen.delete(id)
      }
      if (consumed === undefined && typeof pointerId !== 'number') {
        const first = pointerSeen.keys().next()
        if (!first.done) {
          pointerSeen.delete(first.value)
          consumed = first.value
        }
      }
      clickBackedByPointer = consumed !== undefined
      if (menuOpeningPointer !== null) {
        const sameGesture = typeof pointerId === 'number' ? pointerId === menuOpeningPointer : true
        menuOpeningPointer = null
        if (sameGesture && caregiverMenuOpen()) {
          event.stopPropagation()
          event.preventDefault()
        }
      }
    }
    const onPointerDown = (event: PointerEvent) => {
      // M2: タッチでは pointerdown にユーザーアクティベーションが伴わないことがあるため、
      // 介助者ボタン除外より前に resume を試みる(効果音を取りこぼさないため)
      resumeToneAudioContext()
      const target = event.target as HTMLElement | null

      // 通常タップで開く介助者ボタン自身の pointerdown は、ボタンのハンドラだけで
      // 処理する。メニューを開いた直後にウィンドウ側が「パネル外タップ」として
      // 閉じないよう、介助者用メニュー表示中かどうかより先に除外する。
      if (target?.closest('.caregiver-button')) return

      if (caregiverMenuOpen()) {
        // M3(b): パネル内のタップは通常の介助者操作。パネル外(オーバーレイ背景)へのタップは
        // メニューを閉じてスキャンをホーム先頭から再開する。この押下自体では項目を実行しない。
        // 全画面パネル化(#68)後は実ブラウザでパネル外が存在せず到達しない。合成イベント/支援技術への防御として残す
        if (target?.closest('.caregiver-panel')) {
          resetCaregiverIdleTimer()
          return
        }
        closeCaregiverMenu()
        return
      }

      // 背景(タイル以外)のタップは本人入力として扱わない。タイルは onTilePointerDown が処理する
    }

    const onPointerUp = (event: PointerEvent) => {
      const rec = pointerSeen.get(event.pointerId)
      if (rec) rec.upAt = Date.now()
      heldInputs.delete(`pointer:${event.pointerId}`)
      idleSteps = 0 // 離した時点から数え直す
      input.up(`pointer:${event.pointerId}`)
    }
    // 取り消された押下は決定しない(離して決定でも実行しない)。他の入力元の押下は残す
    const onPointerCancel = (event: PointerEvent) => {
      pointerSeen.delete(event.pointerId) // 他のポインターの記録は残す
      heldInputs.delete(`pointer:${event.pointerId}`)
      idleSteps = 0
      input.cancel(`pointer:${event.pointerId}`)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      idleSteps = 0 // キー/シャッターは(連打無視・長押しの繰り返しも)本人の入力
      heldInputs.add(`key:${event.code || event.key}`)
      if (event.repeat) return
      resumeToneAudioContext()

      if (caregiverMenuOpen()) {
        // Issue #8: フレーズ編集の入力欄での「文字を打つキー」では閉じない。入力欄にフォーカスが
        // 残ったまま本人がスイッチ(Enter・音量キー・Space 等)を押しても、従来どおり閉じて
        // 本人が取り残されないよう、文字入力・編集に使うキーだけを例外にする。無操作 60 秒の
        // 自動クローズ(§6)は打鍵では延ばさない(入力欄のタップ・フォーカスで延びる)
        const inField = (event.target as HTMLElement | null)?.closest?.(
          '.caregiver-panel input, .caregiver-panel textarea',
        )
        if (inField && isTextEditingKey(event)) return
        // Issue #31: カテゴリタブにフォーカスがあるときの左右/Home/End だけは、タブ移動(ARIA tablist)に使う。
        // Enter/Space など他のキーは従来どおり本人のスイッチ入力として扱い、閉じてスキャンへ戻す
        const onTab = (event.target as HTMLElement | null)?.closest?.('.caregiver-tab')
        // 無操作 60 秒タイマーは延ばさない(タブにフォーカスが残ったまま本人が矢印/Home/End の
        // スイッチを押し続けても、メニューが永久に開いたまま取り残されないようにする)
        if (onTab && isCaregiverTabNavKey(event)) return
        // M3(b): 介助者はタッチで操作する想定。メニュー表示中の keydown は閉じて
        // ホーム先頭から再開する(その押下では項目を実行しない)
        event.preventDefault()
        closeCaregiverMenu()
        return
      }

      // 介助者ボタンへフォーカスしている間の Enter / Space だけは、ブラウザ標準の
      // button activation に任せる。ほかの任意キーは本人のスイッチ入力として扱う。
      const caregiverControl = (event.target as HTMLElement | null)?.closest?.(
        '[data-caregiver-control]',
      )
      if (caregiverControl && (event.key === 'Enter' || event.key === ' ')) return
      // パンくずの祖先ボタンも同様。Enter / Space はボタン標準の click に任せ、本人のスイッチ入力にしない
      const breadcrumbControl = (event.target as HTMLElement | null)?.closest?.(
        '[data-breadcrumb-control]',
      )
      if (breadcrumbControl && (event.key === 'Enter' || event.key === ' ')) return
      if (showDevNumbers && /^[1-9]$/.test(event.key)) {
        // 開発補助(?dev限定): 数字キーで先頭9項目を直接実行する。スイッチ扱いより先に処理し二重実行しない
        event.preventDefault()
        activateIndex(Number(event.key) - 1)
        return
      }
      event.preventDefault()
      input.down(`key:${event.code || event.key}`)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      heldInputs.delete(`key:${event.code || event.key}`)
      idleSteps = 0 // 離した時点から数え直す
      input.up(`key:${event.code || event.key}`)
    }
    // 画面が見えなくなった・フォーカスを失った押下は、離す動作を取りこぼすので取り消す
    const releaseAll = () => {
      heldInputs.clear()
      idleSteps = 0
      input.cancelAll()
    }
    const onBlur = () => releaseAll()
    const onVisibilityHidden = () => {
      if (document.visibilityState === 'hidden') releaseAll()
    }

    // M2: タッチ端末では pointerdown だけでは AudioContext の resume が保証されないため、
    // pointerup/touchend/click(capture) でも試す。介助者ボタンを含め常に呼んでよい。
    const onUserActivation = () => resumeToneAudioContext()

    // 右クリック等でコンテキストメニューを出さない(介助者ボタンの誤操作対策 S3含む)
    const onContextMenu = (event: Event) => event.preventDefault()

    window.addEventListener('pointerdown', onPointerDownCapture, true)
    window.addEventListener('click', onClickCapture, true)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibilityHidden)
    window.addEventListener('pointerup', onUserActivation, true)
    window.addEventListener('touchend', onUserActivation, true)
    window.addEventListener('click', onUserActivation, true)
    window.addEventListener('contextmenu', onContextMenu)
    const stopVisibilityResume = initToneVisibilityResume()

    onCleanup(() => {
      window.removeEventListener('pointerdown', onPointerDownCapture, true)
      window.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibilityHidden)
      input.cancelAll()
      window.removeEventListener('pointerup', onUserActivation, true)
      window.removeEventListener('touchend', onUserActivation, true)
      window.removeEventListener('click', onUserActivation, true)
      window.removeEventListener('contextmenu', onContextMenu)
      stopVisibilityResume()
      clearCaregiverIdleTimer()
      morseInput.stop()
    })
  })

  // タイルの直接タップ/クリック。押したタイルを実行する(スキャン位置とは無関係)。
  // 実行は pointerdown で行い、続く click は無視して二重実行を防ぐ(判定は window の capture)。
  // 支援技術が合成する click(pointerdown を伴わない)だけは、フォールバックとして実行する。
  const onTilePointerDown = (event: PointerEvent, index: number) => {
    // 主ボタン(タッチ・左クリック・ペン先)以外(右/中クリック・ペンのバレルボタン)では実行しない
    if (event.button !== 0) return
    if (caregiverMenuOpen()) return
    idleSteps = 0
    resumeToneAudioContext()
    input.down(`pointer:${event.pointerId}`, {
      index,
      screen: screen(),
      itemId: currentMenu()[index]?.id,
    })
  }
  const onTileClick = (index: number) => {
    if (clickBackedByPointer) return
    if (caregiverMenuOpen()) return
    idleSteps = 0
    handleSwitchOn(Date.now(), {
      index,
      screen: screen(),
      itemId: currentMenu()[index]?.id,
    })
  }

  // ARIA tablist: フォーカスを動かすと同時に選択する(自動アクティベーション)
  const onCaregiverTabKeyDown = (event: KeyboardEvent) => {
    if (!isCaregiverTabNavKey(event)) return
    const last = CAREGIVER_TABS.length - 1
    const current = CAREGIVER_TABS.findIndex((tab) => tab.id === caregiverTab())
    let next = current
    if (event.key === 'ArrowRight') next = current >= last ? 0 : current + 1
    else if (event.key === 'ArrowLeft') next = current <= 0 ? last : current - 1
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    event.preventDefault()
    setCaregiverTab(CAREGIVER_TABS[next].id)
    const nextTab = document.getElementById(`caregiver-tab-${CAREGIVER_TABS[next].id}`)
    nextTab?.focus()
    // 横スクロールするタブ列で、選んだタブが領域外に隠れないようにする(jsdom 未実装のため ?. ガード)
    nextTab?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }

  // Issue #111: タブ列が横に続くとき、続きがある側の矢印だけを出す
  let tablistEl: HTMLDivElement | undefined
  const [tabScroll, setTabScroll] = createSignal({ left: false, right: false })
  const updateTabScroll = () => {
    const el = tablistEl
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    // 端数(DPR・小数スクロール)で矢印が残らないよう 2px の余裕を見る
    setTabScroll({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 })
  }
  const scrollCaregiverTabs = (direction: -1 | 1) => {
    const el = tablistEl
    if (!el) return
    const left = el.scrollLeft + direction * Math.max(120, el.clientWidth * 0.7)
    if (typeof el.scrollTo === 'function') el.scrollTo({ left, behavior: 'smooth' })
    else el.scrollLeft = left
    updateTabScroll()
  }
  createEffect(() => {
    if (!caregiverMenuOpen()) return
    caregiverTab() // タブを選ぶと選んだタブへスクロールするので、矢印の出し分けを取り直す
    viewportSize()
    queueMicrotask(updateTabScroll)
  })

  const openCaregiverMenu = (openingPointerId?: number) => {
    if (caregiverMenuOpen()) return
    menuOpeningPointer = openingPointerId ?? null
    idleSteps = 0
    input.cancelAll()
    setCaregiverTab('status')
    setCaregiverMenuOpen(true)
    resetCaregiverIdleTimer()
    // PR#11 3巡目 should-A/should-B: 開くたびに再計算し(未完了表示が古いままにならない)、
    // 未完了ならSWの更新チェックも試みる(recheckOfflineReady内部で判定)
    void recheckOfflineReady(setOfflineReadyStatus)
  }

  return (
    <main class="app-shell" classList={{ 'is-morse': screen() === 'morse' }}>
      <Show when={emergencyActive()}>
        <section
          class="emergency-status"
          classList={{
            'repeat-pulse-a': repeatedEmergency() && repeatPulse() % 2 === 1,
            'repeat-pulse-b': repeatedEmergency() && repeatPulse() % 2 === 0,
          }}
          role="status"
          aria-label="未解除の緊急状態"
        >
          <p class="emergency-status-message">{EMERGENCY_MESSAGE}</p>
          <Show when={emergencyDetails().length > 0}>
            <div class="emergency-detail-status">
              <span class="emergency-detail-label">伝えた状態:</span>
              <ul class="emergency-details">
                <For each={emergencyDetails()}>{(label) => <li>{label}</li>}</For>
              </ul>
            </div>
          </Show>
        </section>
      </Show>

      {/* Issue #114: 「直前に伝えたこと」は現在地(パンくず)より上位の情報なので、案内欄より上に置く */}
      <section
        class="message-panel"
        classList={{
          'is-empty': message() === DEFAULT_MESSAGE && history().length === 0,
          'is-past': pastEntry() !== null,
          'is-cleared': pastEntry() === null && message() === DEFAULT_MESSAGE,
          'repeat-pulse-a': repeatedMessage() && repeatPulse() % 2 === 1,
          'repeat-pulse-b': repeatedMessage() && repeatPulse() % 2 === 0,
        }}
        aria-live="polite"
        aria-label="直前に伝えたこと"
      >
        {/* Issue #120: 介助者が過去の伝達を振り返る矢印。スキャン対象ではない(タップ / クリックだけ)。
            data-caregiver-control は付けない: タップでフォーカスが残っても、続くキー(本人のスイッチ)は
            矢印を押さず、いつもどおりスキャン対象を実行する */}
        <Show when={olderCount() > 0 || historyBack() > 0}>
          <button
            type="button"
            class="history-nav"
            aria-label="前の伝達を表示"
            disabled={historyBack() >= olderCount()}
            onClick={() => stepHistory(1)}
          >
            <svg viewBox="0 0 20 24" aria-hidden="true">
              <path d="M15 3 L5 12 L15 21" />
            </svg>
          </button>
        </Show>
        <div class="message-panel-body">
          <p class="message-panel-label">
            {pastEntry() !== null
              ? `過去に伝えたこと（${historyBack()}件前）`
              : repeatedMessage()
                ? '直前に伝えたこと（もう一度）'
                : '直前に伝えたこと'}
          </p>
          {/* h1 は常に DOM に置く(1 行に収める再計算が h1 の親を監視するため)。最新が空のときだけ隠す */}
          <h1 ref={headingEl} hidden={pastEntry() === null && message() === DEFAULT_MESSAGE}>
            {displayedMessage()}
          </h1>
          <Show when={pastEntry() === null && message() === DEFAULT_MESSAGE}>
            <p class="message-panel-none">いまは、伝えたことがありません。</p>
          </Show>
        </div>
        <Show when={olderCount() > 0 || historyBack() > 0}>
          <button
            type="button"
            class="history-nav"
            aria-label="次の伝達を表示"
            disabled={historyBack() <= 0}
            onClick={() => stepHistory(-1)}
          >
            <svg viewBox="0 0 20 24" aria-hidden="true">
              <path d="M5 3 L15 12 L5 21" />
            </svg>
          </button>
        </Show>
      </section>

      <section class="screen-guide" aria-label="現在の画面">
        <div class="screen-guide-copy">
          <nav aria-label="現在地">
            <ol class="screen-breadcrumb">
              <For each={screenBreadcrumb()}>
                {(item, index) => (
                  <li
                    aria-current={
                      index() === screenBreadcrumb().length - 1 ? 'location' : undefined
                    }
                  >
                    <Show
                      when={item.screen}
                      fallback={
                        <>
                          <Show when={index() === 0}>
                            <HomeIcon />
                          </Show>
                          {item.title}
                        </>
                      }
                    >
                      {(target) => (
                        <button
                          type="button"
                          class="breadcrumb-link"
                          data-breadcrumb-control
                          onClick={() => {
                            // 介助者用メニュー表示中は背後のパンくずを押しても遷移しない(タイルの onTileClick と同じガード。支援技術が背後のボタンを合成 click で押す経路への備え)
                            if (caregiverMenuOpen()) return
                            idleSteps = 0
                            goTo(target())
                          }}
                        >
                          <Show when={index() === 0}>
                            <HomeIcon />
                          </Show>
                          {item.title}
                        </button>
                      )}
                    </Show>
                  </li>
                )}
              </For>
            </ol>
          </nav>
          <h2>{currentScreenGuidance()}</h2>
        </div>

        <div class="message-panel-controls">
          <button
            type="button"
            class="caregiver-button"
            data-caregiver-control
            onPointerDown={(event) => openCaregiverMenu(event.pointerId)}
            onClick={() => openCaregiverMenu()}
            onContextMenu={(event) => event.preventDefault()}
            aria-label="介助者用メニューを開く"
          >
            介助者用
          </button>
        </div>
      </section>

      <Show when={holdProgress() !== null}>
        <div class="hold-progress" role="progressbar" aria-label="押している間の進み具合">
          <div class="hold-progress-bar" style={{ width: `${(holdProgress() ?? 0) * 100}%` }} />
        </div>
      </Show>

      <Show when={LETTER_SCREENS.includes(screen())}>
        <section class="letter-strip">
          <output ref={letterOutputEl}>{letterText() || '文字を選んでください。'}</output>
        </section>
      </Show>

      <Show when={screen() === 'morse'}>
        <section class="morse-panel" aria-label="モールス入力">
          <p class="morse-code" classList={{ holding: morseHold() !== null }}>
            {morseHold() !== null
              ? `${formatMorseCode(morseView()?.code ?? '')} ${morseHold() === '-' ? '－' : '・'}`.trim()
              : formatMorseCode(morseView()?.code ?? '') || '　'}
          </p>
          <p class="morse-text" aria-live="polite">
            {morseText() || '　'}
          </p>
          <ul class="morse-legend" aria-label="モールスの操作と自動で起きること">
            <li>
              <b>短く押す</b>＝短点（・）、
              <b>{(morseConfig().dashMs / 1000).toFixed(1)}秒以上押す</b>＝長点（－）。
            </li>
            <Show when={settings().minHoldMs > 0}>
              <li>
                <b>{(settings().minHoldMs / 1000).toFixed(1)}秒未満</b>の押下は数えない。
              </li>
            </Show>
            <li>
              <b>緊急</b>＝<b>SOS</b>　・・・　－－－　・・・（<b>休まず続けて</b>
              {'打つと、待たずにすぐ。'}
              <b>{(settings().morseLetterGapMs / 1000).toFixed(1)}秒</b>
              {'休むと数え直し）。'}
            </li>
            <li>
              <b>・・・・・</b>（・を5つ）→ <b>待つと</b>スキャンへ戻る。
            </li>
            <li>
              <b>・・・・・・</b>（・を6つ）→ <b>待つと</b>1字消す。
            </li>
            <li>
              <b>・－・－・－</b> → <b>待つと</b>確定して伝える。
            </li>
            <li>
              <b>{(settings().morseLetterGapMs / 1000).toFixed(1)}秒</b>押さないと、1文字が決まる。
            </li>
            <li>
              <b>{(settings().morseWordGapMs / 1000).toFixed(1)}秒</b>押さないと、語の区切りが入る。
            </li>
            <li>
              <b>{MORSE_IDLE_EXIT_MS / 1000}秒</b>何も押さないと、スキャンへ戻る。
            </li>
            <li>
              <b>{MORSE_MAX_HOLD_MS / 1000}秒を超えて</b>押しっぱなしの入力は、無効になる。
            </li>
          </ul>
        </section>
      </Show>

      <section
        class="grid-board"
        classList={{
          'show-numbers': showDevNumbers,
          'grid-fill': gridLayout().fill,
          'grid-home': screen() === 'home',
          'is-hidden': screen() === 'morse',
        }}
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
              // tile-{tone}(例 tile-urgent)は意味を示すだけのクラスで、CSS にルールは無い(見た目は変えない。#36)
              class={`tile tile-${item.tone ?? 'neutral'}`}
              classList={{
                scanning: scanState().index === index(),
                'tile-nav': item.action.type === 'navigate',
                'tile-emergency': item.action.type === 'emergency',
                // Issue #123: もう一度伝えるものが無い間は薄く見せる(押しても何も伝えない)
                'tile-unavailable': item.action.type === 'repeat' && !canRepeat(),
              }}
              role="button"
              aria-label={item.label}
              aria-disabled={item.action.type === 'repeat' && !canRepeat() ? 'true' : undefined}
              onPointerDown={(event) => onTilePointerDown(event, index())}
              onClick={() => onTileClick(index())}
            >
              <span class="tile-number">{index() + 1}</span>
              <span class="tile-label">{item.label}</span>
              <Show when={item.detail}>
                <span class="tile-detail">{item.detail}</span>
              </Show>
              {/* Issue #3 追加指示: 下位画面へ進むタイルは矢印文字ではなく、山形アイコン+
                  中身の予告(menus.ts で自動生成)で示す。読み上げはラベルのみ(記号は読まない) */}
              <Show when={item.action.type === 'navigate'}>
                <svg class="tile-chevron" viewBox="0 0 20 24" aria-hidden="true">
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
        {/* Issue #47: 固定格子の余りは非操作の空きセル。スキャン・クリック・読み上げの対象外 */}
        <For each={Array.from({ length: emptyCellCount() })}>
          {() => <div class="tile-empty" aria-hidden="true" />}
        </For>
      </section>

      <Show when={screenNotes().length > 0}>
        <section class="screen-notes" aria-label="操作と自動で起きること">
          <ul>
            <For each={screenNotes()}>{(note) => <li>{note}</li>}</For>
          </ul>
        </section>
      </Show>

      <Show when={caregiverMenuOpen()}>
        <div class="caregiver-overlay" data-caregiver-control>
          <div class="caregiver-panel">
            <div class="caregiver-header">
              <div class="caregiver-header-grid">
                <h2>介助者用メニュー</h2>
                <button
                  type="button"
                  class="caregiver-action caregiver-emergency-clear"
                  onClick={clearEmergency}
                  disabled={!emergencyActive()}
                >
                  緊急を解除{emergencyActive() ? '' : '（緊急なし）'}
                </button>
                <button
                  type="button"
                  class="caregiver-action caregiver-close"
                  onClick={closeCaregiverMenu}
                >
                  閉じる
                </button>
              </div>
            </div>

            <ul class="caregiver-notes" aria-label="介助者用メニューの自動で起きること">
              <For
                each={buildCaregiverMenuNotes(CAREGIVER_MENU_IDLE_TIMEOUT_MS, {
                  morseEnabled: settings().morseEnabled,
                  compact: lowScreen(),
                })}
              >
                {(note) => <li>{note}</li>}
              </For>
            </ul>

            {/* Issue #111: タブが横に続くときは、続きがある側にだけ矢印を出す。タップで表示範囲を動かす */}
            <div class="caregiver-tabs">
              <button
                type="button"
                class="caregiver-tab-scroll"
                aria-label="前のタブを表示"
                hidden={!tabScroll().left}
                onClick={() => scrollCaregiverTabs(-1)}
              >
                <svg viewBox="0 0 20 24" aria-hidden="true">
                  <path d="M15 3 L5 12 L15 21" />
                </svg>
              </button>
              <div
                class="caregiver-tablist"
                role="tablist"
                aria-label="設定カテゴリ"
                ref={(el) => {
                  tablistEl = el
                }}
                onScroll={updateTabScroll}
              >
                <For each={CAREGIVER_TABS}>
                  {(tab) => (
                    <button
                      type="button"
                      role="tab"
                      class="caregiver-tab"
                      id={`caregiver-tab-${tab.id}`}
                      aria-selected={caregiverTab() === tab.id}
                      aria-controls="caregiver-tabpanel"
                      tabindex={caregiverTab() === tab.id ? 0 : -1}
                      classList={{ active: caregiverTab() === tab.id }}
                      onClick={() => setCaregiverTab(tab.id)}
                      onKeyDown={onCaregiverTabKeyDown}
                    >
                      {tab.label}
                    </button>
                  )}
                </For>
              </div>
              <button
                type="button"
                class="caregiver-tab-scroll"
                aria-label="次のタブを表示"
                hidden={!tabScroll().right}
                onClick={() => scrollCaregiverTabs(1)}
              >
                <svg viewBox="0 0 20 24" aria-hidden="true">
                  <path d="M5 3 L15 12 L5 21" />
                </svg>
              </button>
            </div>

            <Show when={caregiverTab() === 'status'}>
              <div
                class="caregiver-tabpanel"
                role="tabpanel"
                id="caregiver-tabpanel"
                aria-labelledby="caregiver-tab-status"
                tabindex="0"
              >
                {/* Issue #111: ここは端末の状態の表示だけ(操作できる設定は無い)。ボタンに見える囲みにしない */}
                <p class="caregiver-lead">
                  この端末のいまの状態です。ここで変える設定はありません。
                </p>
                <StatusRow
                  label={WAKE_LOCK_LABELS[wakeLockStatus()]}
                  ok={wakeLockStatus() === 'active'}
                />
                <StatusRow
                  label={OFFLINE_READY_LABELS[offlineReadyStatus()]}
                  ok={offlineReadyStatus() === 'ready'}
                />
              </div>
            </Show>

            <Show when={caregiverTab() === 'scan'}>
              <div
                class="caregiver-tabpanel"
                role="tabpanel"
                id="caregiver-tabpanel"
                aria-labelledby="caregiver-tab-scan"
                tabindex="0"
              >
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
                  <span>
                    先頭待機倍率: 間隔 × {Number(settings().headHoldMultiplier.toFixed(1))}（約
                    {((settings().intervalMs * settings().headHoldMultiplier) / 1000).toFixed(1)}
                    秒）
                  </span>
                  {/* 倍率は 1/3 刻み（既定 4/3 を丸めずに選べる）。値は整数（3倍した値）で扱う */}
                  <input
                    type="range"
                    min="3"
                    max="15"
                    step="1"
                    value={Math.round(settings().headHoldMultiplier * 3)}
                    onInput={(event) =>
                      updateSettings({ headHoldMultiplier: Number(event.currentTarget.value) / 3 })
                    }
                  />
                </label>

                <div class="caregiver-item">
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
                  <Show when={behaviorNotes().debounce}>
                    {(note) => <p class="caregiver-hint caregiver-behavior">{note()}</p>}
                  </Show>
                </div>

                <div class="caregiver-item">
                  <label class="caregiver-field">
                    <span>押下時間の下限: {(settings().minHoldMs / 1000).toFixed(1)} 秒</span>
                    <input
                      type="range"
                      min="0"
                      max="2000"
                      step="100"
                      value={settings().minHoldMs}
                      onInput={(event) =>
                        updateSettings({ minHoldMs: Number(event.currentTarget.value) })
                      }
                    />
                  </label>

                  <div class="caregiver-field">
                    <span>決定のタイミング</span>
                    <div class="caregiver-choice-options">
                      <For each={ACTIVATE_ONS}>
                        {(timing) => (
                          <button
                            type="button"
                            classList={{ active: settings().activateOn === timing }}
                            onClick={() => updateSettings({ activateOn: timing })}
                          >
                            {ACTIVATE_ON_LABELS[timing]}
                          </button>
                        )}
                      </For>
                    </div>
                  </div>
                  <Show when={behaviorNotes().hold}>
                    {(note) => <p class="caregiver-hint caregiver-behavior">{note()}</p>}
                  </Show>
                </div>

                <div class="caregiver-item">
                  <label class="caregiver-field caregiver-checkbox">
                    <input
                      type="checkbox"
                      checked={settings().auditoryScan}
                      onChange={(event) =>
                        updateSettings({ auditoryScan: event.currentTarget.checked })
                      }
                    />
                    <span>聴覚スキャン（カーソルが進むたびに項目名を読み上げる）</span>
                  </label>
                  <Show when={behaviorNotes().speech}>
                    {(note) => <p class="caregiver-hint caregiver-behavior">{note()}</p>}
                  </Show>
                </div>

                <TabReset
                  tabLabel="スキャン"
                  targets="スキャン間隔・先頭待機倍率・連打無視・押下時間の下限・決定のタイミング・聴覚スキャン"
                  onReset={() => resetSection('scan')}
                />
              </div>
            </Show>

            <Show when={caregiverTab() === 'input'}>
              <div
                class="caregiver-tabpanel"
                role="tabpanel"
                id="caregiver-tabpanel"
                aria-labelledby="caregiver-tab-input"
                tabindex="0"
              >
                <div class="caregiver-item">
                  <label class="caregiver-field caregiver-checkbox">
                    <input
                      type="checkbox"
                      checked={settings().morseEnabled}
                      onChange={(event) =>
                        updateSettings({ morseEnabled: event.currentTarget.checked })
                      }
                    />
                    <span>モールス入力を使う（上級者向け）</span>
                  </label>
                  <p class="caregiver-hint">
                    押下と解放を同時に送るシャッターでは長押しが使えず、緊急のSOS（・・・－－－・・・）も出せません。
                  </p>
                </div>

                <Show when={settings().morseEnabled}>
                  <div class="caregiver-sub">
                    <label class="caregiver-field">
                      <span>
                        長押し（－）の境目: {(settings().morseDashMs / 1000).toFixed(1)} 秒
                        {effectiveDashMs(settings().morseDashMs, settings().minHoldMs) >
                        settings().morseDashMs
                          ? `（押下時間の下限があるため、実際は ${(effectiveDashMs(settings().morseDashMs, settings().minHoldMs) / 1000).toFixed(1)} 秒）`
                          : ''}
                      </span>
                      <input
                        type="range"
                        min="150"
                        max="1500"
                        step="50"
                        value={settings().morseDashMs}
                        onInput={(event) =>
                          updateSettings({ morseDashMs: Number(event.currentTarget.value) })
                        }
                      />
                    </label>
                    <label class="caregiver-field">
                      <span>
                        文字の確定までの無入力: {(settings().morseLetterGapMs / 1000).toFixed(1)}{' '}
                        秒
                      </span>
                      <input
                        type="range"
                        min="500"
                        max="3000"
                        step="100"
                        value={settings().morseLetterGapMs}
                        onInput={(event) => {
                          const letterGap = Number(event.currentTarget.value)
                          // 語の区切りは文字の確定より常に長くする。足りなければ一緒に延ばす
                          updateSettings({
                            morseLetterGapMs: letterGap,
                            morseWordGapMs: Math.max(
                              settings().morseWordGapMs,
                              letterGap + MORSE_WORD_GAP_MARGIN_MS,
                            ),
                          })
                        }}
                      />
                    </label>
                    <label class="caregiver-field">
                      <span>
                        語の区切りまでの無入力: {(settings().morseWordGapMs / 1000).toFixed(1)} 秒
                      </span>
                      <input
                        type="range"
                        min="1500"
                        max="8000"
                        step="100"
                        value={settings().morseWordGapMs}
                        onInput={(event) =>
                          updateSettings({ morseWordGapMs: Number(event.currentTarget.value) })
                        }
                      />
                    </label>
                  </div>
                </Show>

                <TabReset
                  tabLabel="モールス"
                  targets="モールス入力を使うかどうかと、長押しの境目・文字の確定・語の区切りの時間"
                  onReset={() => resetSection('input')}
                />
              </div>
            </Show>

            <Show when={caregiverTab() === 'feedback'}>
              <div
                class="caregiver-tabpanel"
                role="tabpanel"
                id="caregiver-tabpanel"
                aria-labelledby="caregiver-tab-feedback"
                tabindex="0"
              >
                <div class="caregiver-field">
                  <span>音声モード（伝えた内容の読み上げ）</span>
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

                <label class="caregiver-field caregiver-checkbox">
                  <input
                    type="checkbox"
                    checked={settings().hapticsEnabled}
                    onChange={(event) =>
                      updateSettings({ hapticsEnabled: event.currentTarget.checked })
                    }
                  />
                  <span>本人に振動で知らせる（入力の受理・はい/いいえ・緊急）</span>
                </label>

                <Show when={settings().hapticsEnabled}>
                  <div class="caregiver-sub">
                    <div class="caregiver-field">
                      <span>振動の強さ</span>
                      <div class="caregiver-choice-options">
                        <For each={HAPTIC_STRENGTHS}>
                          {(strength) => (
                            <button
                              type="button"
                              classList={{ active: settings().hapticsStrength === strength }}
                              onClick={() => updateSettings({ hapticsStrength: strength })}
                            >
                              {HAPTIC_STRENGTH_LABELS[strength]}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>

                    <label class="caregiver-field caregiver-checkbox">
                      <input
                        type="checkbox"
                        checked={settings().hapticSoundAlso}
                        onChange={(event) =>
                          updateSettings({ hapticSoundAlso: event.currentTarget.checked })
                        }
                      />
                      <span>
                        振動に加えて、いつも短い効果音でも知らせる（振動モーターのない端末向け）
                      </span>
                    </label>

                    <label class="caregiver-field caregiver-checkbox">
                      <input
                        type="checkbox"
                        checked={settings().hapticSoundWhenVoiceOff}
                        onChange={(event) =>
                          updateSettings({ hapticSoundWhenVoiceOff: event.currentTarget.checked })
                        }
                      />
                      <span>振動できない端末では、音声モードが OFF でも短い効果音で知らせる</span>
                    </label>
                  </div>
                </Show>

                <TabReset
                  tabLabel="音と振動"
                  targets="音声モード・振動で知らせるかどうか・振動の強さ・効果音"
                  onReset={() => resetSection('feedback')}
                />
              </div>
            </Show>

            <Show when={caregiverTab() === 'display'}>
              <div
                class="caregiver-tabpanel"
                role="tabpanel"
                id="caregiver-tabpanel"
                aria-labelledby="caregiver-tab-display"
                tabindex="0"
              >
                <div class="caregiver-item">
                  <div class="caregiver-field">
                    <span>文字サイズ（選ぶタイルの文字）</span>
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
                  {/* Issue #111: 文字サイズも明るさと同じくその場で分かるよう、本人画面のタイルと同じ式で描くサンプル */}
                  <div class="font-size-sample" role="img" aria-label="文字サイズのサンプル">
                    <span class="tile-label">はい</span>
                  </div>
                </div>

                <div class="caregiver-field">
                  <span>明るさ</span>
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
                    onChange={(event) =>
                      updateSettings({ highContrast: event.currentTarget.checked })
                    }
                  />
                  <span>高コントラスト</span>
                </label>

                <TabReset
                  tabLabel="表示"
                  targets="文字サイズ・明るさ・高コントラスト"
                  onReset={() => resetSection('display')}
                />
              </div>
            </Show>

            <Show when={caregiverTab() === 'phrases'}>
              <div
                class="caregiver-tabpanel"
                role="tabpanel"
                id="caregiver-tabpanel"
                aria-labelledby="caregiver-tab-phrases"
                tabindex="0"
              >
                <PhraseEditor settings={settings()} updateSettings={updateSettings} />

                <TabReset
                  tabLabel="フレーズ"
                  targets="全部の画面（不快・不快・その他・痛い場所・要望・気分）のフレーズ"
                  onReset={() => resetSection('phrases')}
                />
              </div>
            </Show>

            <Show when={caregiverTab() === 'backup'}>
              <div
                class="caregiver-tabpanel"
                role="tabpanel"
                id="caregiver-tabpanel"
                aria-labelledby="caregiver-tab-backup"
                tabindex="0"
              >
                <SettingsBackup settings={settings()} replaceSettings={replaceSettings} />
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </main>
  )
}

/** 介助者用メニュー「端末の状態」の1行。操作できない状態表示なので、ボタンに見える囲みにしない(Issue #111) */
function StatusRow(props: { label: string; ok: boolean }) {
  // 「項目: 値 — 必要な対応」を、状態と対応に分けて出す
  const parts = () => props.label.split(' — ')
  return (
    <p class="caregiver-status" classList={{ warn: !props.ok }}>
      <span class="caregiver-status-mark" aria-hidden="true">
        {props.ok ? '✓' : '!'}
      </span>
      <span class="caregiver-status-text">
        <span>{parts()[0]}</span>
        <Show when={parts()[1]}>
          <span class="caregiver-status-todo">{parts()[1]}</span>
        </Show>
      </span>
    </p>
  )
}

/**
 * タブごとの「初期値に戻す」(Issue #117)。2 回押しで実行する。1 回目は、どのタブの何が戻るかを表示するだけ。
 * タブ切替・メニューを閉じるとこのコンポーネントごと消えるので、確認状態も解除される。
 */
function TabReset(props: { tabLabel: string; targets: string; onReset: () => void }) {
  const [armed, setArmed] = createSignal(false)
  const [done, setDone] = createSignal(false)
  const press = () => {
    if (!armed()) {
      setDone(false)
      setArmed(true)
      return
    }
    setArmed(false)
    props.onReset()
    setDone(true)
  }
  return (
    <div class="caregiver-reset">
      <Show when={armed()}>
        <p class="caregiver-status warn" role="status">
          <span class="caregiver-status-text">
            「{props.tabLabel}」タブの設定（{props.targets}
            ）が初期値に戻ります（元に戻せません）。ほかのタブの設定は変わりません。よければもう一度押してください。
          </span>
        </p>
      </Show>
      <Show when={done()}>
        <p class="caregiver-status" role="status">
          <span class="caregiver-status-text">
            「{props.tabLabel}」タブの設定を初期値に戻しました。
          </span>
        </p>
      </Show>
      <div class="phrase-actions">
        <Show when={armed()}>
          <button type="button" class="caregiver-action caregiver-reset-cancel" onClick={() => setArmed(false)}>
            やめる
          </button>
        </Show>
        <button type="button" class="caregiver-action caregiver-reset-button" onClick={press}>
          {armed() ? 'もう一度押すと初期値に戻す' : `「${props.tabLabel}」タブの設定を初期値に戻す`}
        </button>
      </div>
    </div>
  )
}

/** パンくずの「ホーム」に付ける家アイコン(Issue #113)。文字と同じ色・大きさ。読み上げには含めない */
function HomeIcon() {
  return (
    <svg class="breadcrumb-home" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v10h13V10" />
      <path d="M10 20v-6h4v6" />
    </svg>
  )
}
