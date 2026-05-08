import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'

type Page =
  | 'home'
  | 'urgent'
  | 'slow'
  | 'pain'
  | 'discomfort'
  | 'mood'
  | 'letters'
  | 'voice'
  | 'settings'
type VoiceMode = 'off' | 'tone' | 'short' | 'full'
type Tone = 'neutral' | 'urgent' | 'calm' | 'positive'

type Tile = {
  label: string
  detail?: string
  tone?: Tone
  disabled?: boolean
  action: () => void
}

const VOICE_LABELS: Record<VoiceMode, string> = {
  off: 'OFF',
  tone: '効果音だけ',
  short: '短く読む',
  full: '全部読む',
}

const PAGE_TITLES: Record<Page, string> = {
  home: 'libra',
  urgent: 'いそいで伝える',
  slow: 'ゆっくり伝える',
  pain: '痛い場所',
  discomfort: '困りごと',
  mood: '気分',
  letters: '文字盤',
  voice: '音声',
  settings: '設定',
}

const LETTERS = ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け', 'こ', '消す', '空白']

function speak(mode: VoiceMode, text: string, shortText = text) {
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
  const [page, setPage] = createSignal<Page>('home')
  const [voiceMode, setVoiceMode] = createSignal<VoiceMode>('off')
  const [scanEnabled, setScanEnabled] = createSignal(false)
  const [scanIndex, setScanIndex] = createSignal(0)
  const [message, setMessage] = createSignal('選んだ内容がここに大きく出ます')
  const [letterText, setLetterText] = createSignal('')
  const [history, setHistory] = createSignal<string[]>([])

  const announce = (full: string, shortText?: string) => speak(voiceMode(), full, shortText)

  const showMessage = (text: string, tone: Tone = 'neutral') => {
    setMessage(text)
    setHistory((items) => [text, ...items.filter((item) => item !== text)].slice(0, 4))
    document.documentElement.dataset.messageTone = tone
    navigator.vibrate?.(tone === 'urgent' ? [60, 40, 60] : 35)
    announce(text)
  }

  const go = (next: Page, spoken?: string) => {
    setPage(next)
    setScanIndex(0)
    if (spoken) announce(spoken)
  }

  const back = () => {
    const current = page()
    if (current === 'home') return
    if (['pain', 'discomfort', 'mood', 'letters'].includes(current))
      go('slow', 'ゆっくり伝えるに戻りました')
    else go('home', 'ホームに戻りました')
  }

  const homeTiles = (): Tile[] => [
    {
      label: 'いそいで\n伝える',
      detail: '緊急の短い用件',
      tone: 'urgent',
      action: () => go('urgent', 'いそいで伝える'),
    },
    {
      label: 'ゆっくり\n伝える',
      detail: '場所や気分を選ぶ',
      tone: 'calm',
      action: () => go('slow', 'ゆっくり伝える'),
    },
    { label: 'はい', tone: 'positive', action: () => showMessage('はい', 'positive') },
    { label: 'いいえ', action: () => showMessage('いいえ') },
    {
      label: '来て\nください',
      tone: 'urgent',
      action: () => showMessage('来てください', 'urgent'),
    },
    { label: '水', action: () => showMessage('水がほしいです') },
    { label: `音声\n${VOICE_LABELS[voiceMode()]}`, action: () => go('voice', '音声設定') },
    {
      label: scanEnabled() ? 'スキャン\n停止' : 'スキャン\n開始',
      action: () => setScanEnabled((value) => !value),
    },
    { label: '設定', action: () => go('settings', '設定') },
  ]

  const urgentTiles = (): Tile[] => [
    { label: '戻る', action: back },
    {
      label: '来て\nください',
      tone: 'urgent',
      action: () => showMessage('来てください', 'urgent'),
    },
    { label: '苦しい', tone: 'urgent', action: () => showMessage('苦しいです', 'urgent') },
    { label: '痛い', tone: 'urgent', action: () => showMessage('痛いです', 'urgent') },
    { label: '水', action: () => showMessage('水がほしいです') },
    { label: '体位を\n変えたい', action: () => showMessage('体の向きを変えたいです') },
    { label: 'はい', tone: 'positive', action: () => showMessage('はい', 'positive') },
    { label: 'いいえ', action: () => showMessage('いいえ') },
    {
      label: '止めて',
      tone: 'urgent',
      action: () => showMessage('いったん止めてください', 'urgent'),
    },
  ]

  const slowTiles = (): Tile[] => [
    { label: '戻る', action: back },
    { label: '痛い場所', action: () => go('pain', '痛い場所') },
    { label: '困りごと', action: () => go('discomfort', '困りごと') },
    { label: '気分', action: () => go('mood', '気分') },
    { label: '文字盤', action: () => go('letters', '文字盤') },
    { label: '家族に\n伝える', action: () => showMessage('家族に伝えたいことがあります') },
    { label: '少し待つ', action: () => showMessage('少し待ってください') },
    { label: 'もう一度', action: () => showMessage('もう一度お願いします') },
    {
      label: '読み上げ',
      action: () => announce('ゆっくり伝える画面です。痛い場所、困りごと、気分、文字盤を選べます'),
    },
  ]

  const painTiles = (): Tile[] => [
    { label: '戻る', action: back },
    { label: '頭', action: () => showMessage('頭が痛いです') },
    { label: '胸', action: () => showMessage('胸が痛いです', 'urgent') },
    { label: 'お腹', action: () => showMessage('お腹が痛いです') },
    { label: '背中', action: () => showMessage('背中が痛いです') },
    { label: '足', action: () => showMessage('足が痛いです') },
    { label: '少し', action: () => showMessage('少し痛いです') },
    { label: 'かなり', tone: 'urgent', action: () => showMessage('かなり痛いです', 'urgent') },
    { label: 'とても', tone: 'urgent', action: () => showMessage('とても痛いです', 'urgent') },
  ]

  const discomfortTiles = (): Tile[] => [
    { label: '戻る', action: back },
    { label: '暑い', action: () => showMessage('暑いです') },
    { label: '寒い', action: () => showMessage('寒いです') },
    { label: '眠れない', action: () => showMessage('眠れません') },
    { label: '痰', action: () => showMessage('痰がつらいです', 'urgent') },
    { label: 'トイレ', action: () => showMessage('トイレに行きたいです') },
    { label: '向きを\n変えたい', action: () => showMessage('体の向きを変えたいです') },
    { label: '明るい', action: () => showMessage('部屋が明るいです') },
    { label: '静かに', action: () => showMessage('静かにしてほしいです') },
  ]

  const moodTiles = (): Tile[] => [
    { label: '戻る', action: back },
    { label: '不安', action: () => showMessage('不安です') },
    { label: 'さみしい', action: () => showMessage('さみしいです') },
    { label: '落ち着かない', action: () => showMessage('落ち着きません') },
    { label: '大丈夫', tone: 'positive', action: () => showMessage('大丈夫です', 'positive') },
    { label: '疲れた', action: () => showMessage('疲れました') },
    { label: '眠い', action: () => showMessage('眠いです') },
    { label: '会いたい', action: () => showMessage('会いたいです') },
    { label: 'ありがとう', tone: 'positive', action: () => showMessage('ありがとう', 'positive') },
  ]

  const letterTiles = (): Tile[] =>
    LETTERS.map((char) => ({
      label: char,
      action: () => {
        if (char === '消す') setLetterText((text) => text.slice(0, -1))
        else if (char === '空白') setLetterText((text) => `${text} `)
        else setLetterText((text) => text + char)
        announce(char === '空白' ? '空白' : char)
      },
    }))

  const voiceTiles = (): Tile[] => [
    { label: '戻る', action: back },
    {
      label: 'OFF',
      action: () => {
        setVoiceMode('off')
        window.speechSynthesis?.cancel()
      },
    },
    {
      label: '効果音\nだけ',
      action: () => {
        setVoiceMode('tone')
        navigator.vibrate?.(35)
      },
    },
    {
      label: '短く\n読む',
      action: () => {
        setVoiceMode('short')
        speak('short', '短く読みます')
      },
    },
    {
      label: '全部\n読む',
      action: () => {
        setVoiceMode('full')
        speak('full', '全文読み上げにしました')
      },
    },
    { label: '停止', action: () => window.speechSynthesis?.cancel() },
    { label: '音量は\n端末側', disabled: true, action: () => {} },
    { label: '夜間は\nOFF推奨', disabled: true, action: () => {} },
    { label: 'テスト', action: () => speak('full', 'libra の読み上げテストです') },
  ]

  const settingsTiles = (): Tile[] => [
    { label: '戻る', action: back },
    {
      label: scanEnabled() ? 'スキャン\n停止' : 'スキャン\n開始',
      action: () => setScanEnabled((value) => !value),
    },
    { label: '速度\nゆっくり', action: () => showMessage('スキャン速度は今後設定できます') },
    { label: '文字\n大きく', action: () => document.body.classList.toggle('large-text') },
    { label: '高コントラスト', action: () => document.body.classList.toggle('high-contrast') },
    { label: '横向き\n対応', disabled: true, action: () => {} },
    {
      label: 'ボタン入力',
      detail: 'Space / Enter',
      action: () => showMessage('Space または Enter で決定できます'),
    },
    { label: '履歴\n消去', action: () => setHistory([]) },
    {
      label: '読み上げ',
      action: () => announce('設定画面です。スキャン、文字サイズ、高コントラストを試せます'),
    },
  ]

  const tiles = createMemo<Tile[]>(() => {
    switch (page()) {
      case 'urgent':
        return urgentTiles()
      case 'slow':
        return slowTiles()
      case 'pain':
        return painTiles()
      case 'discomfort':
        return discomfortTiles()
      case 'mood':
        return moodTiles()
      case 'letters':
        return letterTiles()
      case 'voice':
        return voiceTiles()
      case 'settings':
        return settingsTiles()
      default:
        return homeTiles()
    }
  })

  const visibleTiles = createMemo(() => tiles())

  const activateTile = (index: number) => {
    const tile = visibleTiles()[index]
    if (!tile || tile.disabled) return
    tile.action()
  }

  createEffect(() => {
    if (scanIndex() >= visibleTiles().length) setScanIndex(0)
  })

  onMount(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (/^[1-9]$/.test(event.key)) {
        event.preventDefault()
        activateTile(Number(event.key) - 1)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        back()
      } else if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault()
        if (scanEnabled()) activateTile(scanIndex())
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        setScanIndex((index) => (index + 1) % visibleTiles().length)
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        setScanIndex((index) => (index + visibleTiles().length - 1) % visibleTiles().length)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })

  createEffect(() => {
    if (!scanEnabled()) return
    const id = window.setInterval(() => {
      setScanIndex((index) => (index + 1) % visibleTiles().length)
    }, 1500)
    onCleanup(() => window.clearInterval(id))
  })

  const commitLetters = () => {
    const text = letterText().trim()
    if (!text) return
    showMessage(text)
    setLetterText('')
  }

  return (
    <main class="app-shell">
      <section class="message-panel" aria-live="polite">
        <div>
          <p class="eyebrow">bedside communication</p>
          <h1>{message()}</h1>
        </div>
        <div class="status-stack" aria-label="現在の状態">
          <span>{PAGE_TITLES[page()]}</span>
          <span>音声 {VOICE_LABELS[voiceMode()]}</span>
          <span>{scanEnabled() ? `スキャン ${scanIndex() + 1}` : '手動'}</span>
        </div>
      </section>

      <Show when={page() === 'letters'}>
        <section class="letter-strip">
          <output>{letterText() || '文字を選んでください'}</output>
          <button type="button" onClick={commitLetters}>
            表示する
          </button>
          <button type="button" onClick={() => setLetterText((text) => text.slice(0, -1))}>
            消す
          </button>
        </section>
      </Show>

      <section class="grid-board" aria-label={`${PAGE_TITLES[page()]}の選択肢`}>
        <For each={visibleTiles()}>
          {(tile, index) => (
            <button
              type="button"
              class={`tile tile-${tile.tone ?? 'neutral'}`}
              classList={{
                scanning: scanEnabled() && scanIndex() === index(),
                disabled: tile.disabled,
              }}
              disabled={tile.disabled}
              onClick={() => activateTile(index())}
            >
              <span class="tile-number">{index() + 1}</span>
              <span class="tile-label">{tile.label}</span>
              <Show when={tile.detail}>
                <span class="tile-detail">{tile.detail}</span>
              </Show>
            </button>
          )}
        </For>
      </section>

      <section class="history-row" aria-label="最近の表示">
        <For each={history()}>
          {(item) => (
            <button type="button" onClick={() => showMessage(item)}>
              {item}
            </button>
          )}
        </For>
      </section>
    </main>
  )
}
