// 画面ごとの項目定義。純粋データ + 「先頭=緊急」「下位画面の2番目=戻る」を
// 構造で保証するビルダー。副作用は持たない（実行そのものは ActionId を App.tsx が解釈する）。
// 正本: docs/requirements.md §2, §4

import { phrasesFor, type PhraseGroup, type PhraseSets } from './phrases'

export type Tone = 'neutral' | 'urgent' | 'calm' | 'positive'

export type ScreenId =
  | 'home'
  | 'urgentDetail'
  | 'discomfort'
  | 'discomfortOther'
  | 'painLocation'
  | 'moodRequest'
  | 'letters'
  | 'lettersRow'
  | 'lettersYesNo'
  | 'morse'

export type ActionId =
  | { type: 'emergency' }
  | { type: 'emergencyDetail'; label: string }
  | { type: 'undo' }
  | { type: 'back' }
  | { type: 'navigate'; screen: ScreenId }
  | { type: 'message'; text: string; tone?: Tone }
  | { type: 'letterRow'; row: number }
  | { type: 'letterAppend'; char: string }
  | { type: 'letterBackspace' }
  | { type: 'letterCommit' }

export interface MenuItem {
  id: string
  label: string
  detail?: string
  tone?: Tone
  action: ActionId
  /** 下位画面へ進むタイル(navigate)だけが持つ、遷移先の中身の予告(例:「痛い・苦しい・…」)。
   *  読み上げ対象外(ラベルのみ読む)。タイル表示でだけ使う。 */
  preview?: string
}

/** 下位画面の「戻る」の遷移先。画面ツリーに従う（painLocation は discomfort の子）。 */
export const PARENT_SCREEN: Record<Exclude<ScreenId, 'home'>, ScreenId> = {
  urgentDetail: 'home',
  discomfort: 'home',
  discomfortOther: 'discomfort',
  painLocation: 'discomfort',
  moodRequest: 'home',
  letters: 'home',
  lettersRow: 'letters',
  lettersYesNo: 'letters',
  morse: 'home',
}

export const SCREEN_TITLES: Record<ScreenId, string> = {
  home: 'libra',
  urgentDetail: '緊急',
  discomfort: '不快',
  discomfortOther: '不快・その他',
  painLocation: '痛い場所',
  moodRequest: '快・要望',
  letters: '文字盤',
  lettersRow: '文字盤・文字',
  lettersYesNo: '文字盤・はい/いいえ',
  morse: 'モールス入力',
}

const EMERGENCY_ITEM: MenuItem = {
  id: 'emergency',
  label: '緊急',
  tone: 'urgent',
  action: { type: 'emergency' },
}

// 戻るは常に { type: 'back' } のみ（遷移先は PARENT_SCREEN から解決する）。
function makeBackItem(): MenuItem {
  return { id: 'back', label: '戻る', action: { type: 'back' } }
}

/** ホーム画面: 先頭は緊急。他はここでしか組み立てない。 */
function homeScreen(items: MenuItem[]): MenuItem[] {
  return [EMERGENCY_ITEM, ...items]
}

/** 下位画面共通: 先頭は緊急、2番目は戻る。呼び出し側はこれをバイパスできない。 */
function subScreen(items: MenuItem[]): MenuItem[] {
  return [EMERGENCY_ITEM, makeBackItem(), ...items]
}

function message(id: string, label: string, text: string, tone?: Tone): MenuItem {
  return { id, label, tone, action: { type: 'message', text, tone } }
}

const PREVIEW_ITEM_COUNT = 4

/** 遷移先メニューの中身の予告テキストを自動生成する。緊急・戻るは除き、
 *  先頭から数項目のラベルを「・」で繋いで末尾に「…」を付ける。ハードコードしない
 *  ことで menus.ts の項目定義を変更しても自動で追従する。 */
function buildPreview(screen: ScreenId, phrases?: PhraseSets): string {
  const items = buildMenu(screen, { showUndo: false, emergencyActive: false, phrases })
  const contentLabels = items
    .filter((item) => item.action.type !== 'emergency' && item.action.type !== 'back')
    .map((item) => item.label)
  if (contentLabels.length === 0) return ''
  return `${contentLabels.slice(0, PREVIEW_ITEM_COUNT).join('・')}…`
}

function navigate(id: string, label: string, screen: ScreenId, phrases?: PhraseSets): MenuItem {
  return {
    id,
    label,
    action: { type: 'navigate', screen },
    preview: buildPreview(screen, phrases),
  }
}

/** 介助者が編集できるフレーズ項目(Issue #8)。編集内容がなければ既定値 */
function phraseItems(group: PhraseGroup, phrases?: PhraseSets): MenuItem[] {
  return phrasesFor(group, phrases).map((p) => message(p.id, p.label, p.text, p.tone))
}

export interface HomeMenuOptions {
  /** モールス入力を使うか(Issue #14)。介助者が ON にしたときだけホームに入口を出す */
  morseEnabled?: boolean
  /** 介助者が編集したフレーズ(Issue #8)。省略時は既定のプリセット */
  phrases?: PhraseSets
  /** 伝達直後の1周だけ true。渡された値に関わらず emergencyActive 中は無視する */
  showUndo: boolean
  /** 緊急中は取り消しを出さない（requirements.md §4.3: 本人のスイッチ入力で上書き・取り消しされない）。
   *  この判定を App 側に置かず、ここで一元的に保証する。 */
  emergencyActive: boolean
  /** 文字盤の文字段階(lettersRow)で表示する行の添字(LETTER_ROWS)。省略時は先頭の行 */
  letterRow?: number
}

export function buildHomeMenu(options: HomeMenuOptions): MenuItem[] {
  const showUndo = options.showUndo && !options.emergencyActive
  return homeScreen([
    ...(showUndo ? [{ id: 'undo', label: '取り消し', action: { type: 'undo' } } as MenuItem] : []),
    message('yes', 'はい', 'はい', 'positive'),
    message('no', 'いいえ', 'いいえ'),
    navigate('discomfort-nav', '不快', 'discomfort', options.phrases),
    navigate('mood-nav', '快・要望', 'moodRequest', options.phrases),
    navigate('letters-nav', '文字盤', 'letters'),
    // 上級者向けの逃げ道。文字盤より後ろ(優先度は最下位)
    ...(options.morseEnabled ? [navigate('morse-nav', 'モールス', 'morse')] : []),
  ])
}

/** 緊急詳細の項目(id とラベル)。ラベルの正本。保存値の検証(emergencyState.ts)も参照する。 */
export const URGENT_DETAIL_ITEMS = [
  { id: 'suffering', label: '苦しい' },
  { id: 'pain', label: '痛い' },
  { id: 'cant-breathe', label: '息ができない' },
  { id: 'nausea', label: '吐きそう' },
  { id: 'chest-pain', label: '胸が痛い' },
] as const

export const URGENT_DETAIL_LABELS: readonly string[] = URGENT_DETAIL_ITEMS.map((i) => i.label)

export function buildUrgentDetailMenu(): MenuItem[] {
  return subScreen(
    URGENT_DETAIL_ITEMS.map(({ id, label }) => ({
      id,
      label,
      tone: 'urgent' as const,
      action: { type: 'emergencyDetail' as const, label },
    })),
  )
}

// 1画面の項目数は緊急・戻るを含めて8以内(requirements.md §4.1)。既定はこれを満たし、
// 介助者が編集して超える場合は介助者メニューで警告する(phrases.ts)。
// 「その他」は暑い/寒い/喉が渇いた/かゆい/眠れないを discomfortOther へ退避する。
export function buildDiscomfortMenu(phrases?: PhraseSets): MenuItem[] {
  return subScreen([
    navigate('pain-nav', '痛い', 'painLocation', phrases),
    ...phraseItems('discomfort', phrases),
    navigate('discomfort-other-nav', 'その他', 'discomfortOther', phrases),
  ])
}

export function buildDiscomfortOtherMenu(phrases?: PhraseSets): MenuItem[] {
  return subScreen(phraseItems('discomfortOther', phrases))
}

export function buildPainLocationMenu(phrases?: PhraseSets): MenuItem[] {
  return subScreen(phraseItems('painLocation', phrases))
}

// テレビ・音楽は #8（フレーズ編集）で介助者が追加できる。1画面8項目以内の枠に収めるため既定からは撤去。
export function buildMoodRequestMenu(phrases?: PhraseSets): MenuItem[] {
  return subScreen(phraseItems('moodRequest', phrases))
}

/** 文字盤の行。清音 46 字 + 長音「ー」(requirements.md §4.6)。濁点・半濁点・小書きは置かない */
export const LETTER_ROWS: { name: string; chars: string[] }[] = [
  { name: 'あ行', chars: ['あ', 'い', 'う', 'え', 'お'] },
  { name: 'か行', chars: ['か', 'き', 'く', 'け', 'こ'] },
  { name: 'さ行', chars: ['さ', 'し', 'す', 'せ', 'そ'] },
  { name: 'た行', chars: ['た', 'ち', 'つ', 'て', 'と'] },
  { name: 'な行', chars: ['な', 'に', 'ぬ', 'ね', 'の'] },
  { name: 'は行', chars: ['は', 'ひ', 'ふ', 'へ', 'ほ'] },
  { name: 'ま行', chars: ['ま', 'み', 'む', 'め', 'も'] },
  { name: 'や行', chars: ['や', 'ゆ', 'よ'] },
  { name: 'ら行', chars: ['ら', 'り', 'る', 'れ', 'ろ'] },
  { name: 'わ行', chars: ['わ', 'を', 'ん', 'ー'] },
]

/** 文字盤の行段階: 緊急 / 戻る / あ〜わ行 / 確定 / 1字消す / はい・いいえ → */
export function buildLettersMenu(): MenuItem[] {
  const rowItems: MenuItem[] = LETTER_ROWS.map((row, index) => ({
    id: `letter-row-${index}`,
    label: row.name,
    action: { type: 'letterRow', row: index },
  }))
  return subScreen([
    ...rowItems,
    { id: 'commit', label: '確定', tone: 'positive', action: { type: 'letterCommit' } },
    { id: 'backspace', label: '1字消す', action: { type: 'letterBackspace' } },
    navigate('letters-yesno-nav', 'はい・いいえ', 'lettersYesNo'),
  ])
}

/** 文字盤の文字段階: 緊急 / 戻る(行段階へ) / その行の文字 */
export function buildLettersRowMenu(row = 0): MenuItem[] {
  const chars = LETTER_ROWS[row]?.chars ?? LETTER_ROWS[0].chars
  return subScreen(
    chars.map((char) => ({
      id: `letter-${char}`,
      label: char,
      action: { type: 'letterAppend', char } as ActionId,
    })),
  )
}

/** 入力途中の文字列への先読み(「○○？」)に即答する。戻ると入力途中の文字列は保持される */
export function buildLettersYesNoMenu(): MenuItem[] {
  return subScreen([message('yes', 'はい', 'はい', 'positive'), message('no', 'いいえ', 'いいえ')])
}

/** モールス入力画面。符号の入力に使うので項目は選ばない。緊急・戻るだけを構造として持つ */
export function buildMorseMenu(): MenuItem[] {
  return subScreen([])
}

export function buildMenu(screen: ScreenId, homeOptions: HomeMenuOptions): MenuItem[] {
  switch (screen) {
    case 'home':
      return buildHomeMenu(homeOptions)
    case 'urgentDetail':
      return buildUrgentDetailMenu()
    case 'discomfort':
      return buildDiscomfortMenu(homeOptions.phrases)
    case 'discomfortOther':
      return buildDiscomfortOtherMenu(homeOptions.phrases)
    case 'painLocation':
      return buildPainLocationMenu(homeOptions.phrases)
    case 'moodRequest':
      return buildMoodRequestMenu(homeOptions.phrases)
    case 'letters':
      return buildLettersMenu()
    case 'lettersRow':
      return buildLettersRowMenu(homeOptions.letterRow)
    case 'lettersYesNo':
      return buildLettersYesNoMenu()
    case 'morse':
      return buildMorseMenu()
  }
}
