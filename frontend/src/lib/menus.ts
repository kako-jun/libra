// 画面ごとの項目定義。ホーム以外の通常下位画面は「先頭=戻る、2番目=緊急」、
// 緊急詳細は「先頭=戻る、緊急項目なし」を構造で保証するビルダー。副作用は持たない。
// 正本: docs/requirements.md §2, §4

import {
  PAIN_INTENSITY_WORDS,
  composePainText,
  phrasesFor,
  type PainIntensity,
  type PhraseGroup,
  type PhraseSets,
} from './phrases'

export type Tone = 'neutral' | 'urgent'

export type ScreenId =
  | 'home'
  | 'urgentDetail'
  | 'discomfort'
  | 'discomfortOther'
  | 'painLocation'
  | 'painIntensity'
  | 'comfort'
  | 'requests'
  | 'feelings'
  | 'letters'
  | 'lettersRow'
  | 'lettersYesNo'
  | 'morse'

/** 本人画面の全 ScreenId。画面ツリーの追加時に、案内・親子関係・テストを追従させる正本。 */
export const PATIENT_SCREEN_IDS: readonly ScreenId[] = [
  'home',
  'urgentDetail',
  'discomfort',
  'discomfortOther',
  'painLocation',
  'painIntensity',
  'comfort',
  'requests',
  'feelings',
  'letters',
  'lettersRow',
  'lettersYesNo',
  'morse',
]

export type ActionId =
  | { type: 'emergency' }
  | { type: 'emergencyDetail'; label: string }
  | { type: 'undo' }
  | { type: 'back' }
  | { type: 'navigate'; screen: ScreenId }
  | { type: 'message'; text: string; tone?: Tone }
  | { type: 'painLocation'; label: string; text: string; tone?: Tone }
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
  painIntensity: 'painLocation',
  comfort: 'home',
  // 要望はホームから直接開く(Issue #93)。気分は快の下
  requests: 'home',
  feelings: 'comfort',
  letters: 'home',
  lettersRow: 'letters',
  lettersYesNo: 'letters',
  morse: 'home',
}

export const SCREEN_TITLES: Record<ScreenId, string> = {
  home: 'ホーム',
  urgentDetail: '緊急',
  discomfort: '不快',
  discomfortOther: '不快・その他',
  painLocation: '痛い場所',
  painIntensity: '痛みの強さ',
  comfort: '快',
  requests: '要望',
  feelings: '気分',
  letters: '文字盤',
  lettersRow: '文字盤・文字',
  lettersYesNo: '文字盤・はい/いいえ',
  morse: 'モールス入力',
}

export interface BreadcrumbItem {
  title: string
  /** 移動先。祖先だけが持つ。現在地と、移動先が現在地自身の動的要素は持たない。 */
  screen?: ScreenId
}

/** 現在地をホームからの親子経路として表示する。全ScreenIdをPARENT_SCREENから導出する。 */
export function buildScreenBreadcrumb(
  screen: ScreenId,
  dynamic?: { painLabel?: string; letterRowLabel?: string },
): BreadcrumbItem[] {
  const path: ScreenId[] = [screen]
  let current = screen
  while (current !== 'home') {
    current = PARENT_SCREEN[current]
    path.unshift(current)
  }
  const items: BreadcrumbItem[] = path.map((id, index) =>
    index === path.length - 1
      ? { title: SCREEN_TITLES[id] }
      : { title: SCREEN_TITLES[id], screen: id },
  )
  if (screen === 'painIntensity' && dynamic?.painLabel) {
    // 選んだ場所のラベルは痛い場所の選択階層にあたる。移動先は painLocation
    items[items.length - 2] = { title: dynamic.painLabel, screen: 'painLocation' }
  }
  if (screen === 'lettersRow' && dynamic?.letterRowLabel) {
    // 行ラベルの移動先は現在地自身なのでリンクにしない
    items.splice(items.length - 1, 0, { title: dynamic.letterRowLabel })
  }
  return items
}

/** 画面上部に常に出す、本人向けの目的と操作案内。選択結果や緊急状態はここへ混ぜない。 */
export const SCREEN_GUIDANCE: Record<ScreenId, string> = {
  home: '伝えたいことを選んでください。',
  urgentDetail: '緊急です。いま伝えたい状態を選んでください。',
  discomfort: 'つらいことを選んでください。',
  discomfortOther: 'つらいことを選んでください。',
  painLocation: '痛い場所を選んでください。',
  painIntensity: '痛みの強さを選んでください。',
  comfort: '今していることへの希望を選んでください。',
  requests: 'してほしいことを選んでください。',
  feelings: '今の気持ちを選んでください。',
  letters: '文字の行を選んでください。',
  lettersRow: '入力する文字を選んでください。',
  lettersYesNo: '質問への答えを選んでください。',
  morse: '短押し・長押しで文字を入力します。',
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

/** 通常下位画面共通: 先頭は戻る、2番目は緊急。 */
function subScreen(items: MenuItem[]): MenuItem[] {
  return [makeBackItem(), EMERGENCY_ITEM, ...items]
}

function message(id: string, label: string, text: string, tone?: Tone): MenuItem {
  return { id, label, tone, action: { type: 'message', text, tone } }
}

const PREVIEW_ITEM_COUNT = 6

/** 遷移先メニューの中身の予告テキストを自動生成する。緊急・戻るは除き、
 *  項目数が PREVIEW_ITEM_COUNT 以下なら全項目のラベルを「・」で繋ぐ(「…」は付けない)。
 *  超えるときだけ先頭 PREVIEW_ITEM_COUNT 項目＋末尾に「…」(本当に省略したときだけ付ける。Issue #74)。
 *  遷移項目(要望・気分など)も名前で並べる(矢印は付けない)。ハードコードしない
 *  ことで menus.ts の項目定義を変更しても自動で追従する。 */
function buildPreview(screen: ScreenId, phrases?: PhraseSets): string {
  const items = buildMenu(screen, { showUndo: false, emergencyActive: false, phrases })
  const contentLabels = items
    .filter((item) => item.action.type !== 'emergency' && item.action.type !== 'back')
    .map((item) => item.label)
  if (contentLabels.length === 0) return ''
  if (contentLabels.length <= PREVIEW_ITEM_COUNT) return contentLabels.join('・')
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
  return phrasesFor(group, phrases).map((p) =>
    group === 'painLocation'
      ? // 痛い場所は、選んだあとに強さを選ぶ(Issue #12)
        {
          id: p.id,
          label: p.label,
          tone: p.tone,
          action: { type: 'painLocation', label: p.label, text: p.text, tone: p.tone },
        }
      : message(p.id, p.label, p.text, p.tone),
  )
}

/** 痛い場所として選ばれた項目(強さの画面で使う) */
export interface PainChoice {
  label: string
  text: string
  tone?: Tone
}

export interface HomeMenuOptions {
  /** 痛みの強さの画面で、直前に選んだ痛い場所(Issue #12) */
  pain?: PainChoice
  /** モールス入力を使うか(Issue #14)。介助者が ON にしたときだけホームに入口を出す */
  morseEnabled?: boolean
  /** 介助者が編集したフレーズ(Issue #8)。省略時は既定のプリセット */
  phrases?: PhraseSets
  /** 伝達直後の2周だけ true。渡された値に関わらず emergencyActive 中は無視する */
  showUndo: boolean
  /** 緊急中は取り消しを出さない（requirements.md §4.3: 本人のスイッチ入力で上書き・取り消しされない）。
   *  この判定を App 側に置かず、ここで一元的に保証する。 */
  emergencyActive: boolean
  /** 緊急詳細ですでに伝えた状態。候補と選択済み表示を重複させないため除外する。 */
  emergencyDetails?: readonly string[]
  /** 文字盤の文字段階(lettersRow)で表示する行の添字(LETTER_ROWS)。省略時は先頭の行 */
  letterRow?: number
}

export function buildHomeMenu(options: HomeMenuOptions): MenuItem[] {
  const showUndo = options.showUndo && !options.emergencyActive
  return homeScreen([
    ...(showUndo ? [{ id: 'undo', label: '取り消し', action: { type: 'undo' } } as MenuItem] : []),
    message('yes', 'はい', 'はい。'),
    message('no', 'いいえ', 'いいえ。'),
    // 並びは 快 → 不快 → 要望(Issue #93)。続けて・やめて・変えて(質問への受動の答え)を
    // 先に、要望(会話寄り)を後ろに置く
    navigate('comfort-nav', '快', 'comfort', options.phrases),
    navigate('discomfort-nav', '不快', 'discomfort', options.phrases),
    navigate('requests-nav', '要望', 'requests', options.phrases),
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

export function buildUrgentDetailMenu(selectedDetails: readonly string[] = []): MenuItem[] {
  // 緊急状態はこの画面へ入る前に既に成立しており、上部の専用領域で常時示す。
  // 候補内にもう一度「緊急」を置くと、状態と操作を取り違えるため置かない(Issue #44)。
  return [
    makeBackItem(),
    ...URGENT_DETAIL_ITEMS.filter(({ label }) => !selectedDetails.includes(label)).map(
      ({ id, label }) => ({
        id,
        label,
        tone: 'urgent' as const,
        action: { type: 'emergencyDetail' as const, label },
      }),
    ),
  ]
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

/**
 * 痛みの強さ(Issue #12): 戻る / 緊急 / 場所だけ / 少し / かなり / とても。
 * 「場所だけ」を先頭に置き、強さを選べない・選びたくない場合でも最短で伝えられる。
 * 「とても」は緊急色。例: 不快→痛い→胸→とても →「胸がとても痛いです」。
 */
export function buildPainIntensityMenu(pain?: PainChoice): MenuItem[] {
  if (!pain) return subScreen([])
  const tone = (intensity?: PainIntensity): Tone | undefined =>
    intensity === 'very' ? 'urgent' : pain.tone
  const intensityItem = (intensity: PainIntensity): MenuItem =>
    message(
      `pain-${intensity}`,
      PAIN_INTENSITY_WORDS[intensity],
      composePainText(pain.text, intensity),
      tone(intensity),
    )
  return subScreen([
    message('pain-only', '場所だけ', pain.text, pain.tone),
    intensityItem('little'),
    intensityItem('quite'),
    intensityItem('very'),
  ])
}

/**
 * 快(Issue #12 で「快・要望」として導入、Issue #93 で「快」と「要望」に分離): 二値の入口「続けて・やめて・変えて」を
 * 最上位に置き(「もっと」は「続けて」と意味が同じため置かない。Issue #78)、気分(不安・さみしい・落ち着かない)は
 * 「気分 →」に置く。要望はホーム直下の別画面(buildRequestsMenu)で、ここには入口を置かない。
 * 続けて/やめて/変えて は、はい・いいえと同じく編集できない固定項目。
 */
export function buildComfortMenu(phrases?: PhraseSets): MenuItem[] {
  return subScreen([
    message('continue', '続けて', '続けてください。'),
    message('stop', 'やめて', 'やめてください。'),
    message('change', '変えて', '変えてください。'),
    navigate('feelings-nav', '気分', 'feelings', phrases),
  ])
}

/**
 * 要望(大丈夫・ありがとう・眠りたい…)。ホーム直下(Issue #93)。介助者が編集できる。
 * 保存キー名 `moodRequest` は、この「要望」のフレーズグループ(画面ID `requests`)。画面ID `comfort`(快)ではない。
 */
export function buildRequestsMenu(phrases?: PhraseSets): MenuItem[] {
  return subScreen(phraseItems('moodRequest', phrases))
}

/** 快 → 気分(不安・さみしい・落ち着かない)。介助者が編集できる */
export function buildFeelingsMenu(phrases?: PhraseSets): MenuItem[] {
  return subScreen(phraseItems('feelings', phrases))
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

/** 文字盤の行段階: 戻る / 緊急 / あ〜わ行 / 確定 / 1字消す / はい・いいえ → */
export function buildLettersMenu(): MenuItem[] {
  const rowItems: MenuItem[] = LETTER_ROWS.map((row, index) => ({
    id: `letter-row-${index}`,
    label: row.name,
    action: { type: 'letterRow', row: index },
  }))
  return subScreen([
    ...rowItems,
    { id: 'commit', label: '確定', action: { type: 'letterCommit' } },
    { id: 'backspace', label: '1字消す', action: { type: 'letterBackspace' } },
    navigate('letters-yesno-nav', 'はい・いいえ', 'lettersYesNo'),
  ])
}

/** 文字盤の文字段階: 戻る(行段階へ) / 緊急 / その行の文字 */
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
  return subScreen([
    message('yes', 'はい', 'はい。'),
    message('no', 'いいえ', 'いいえ。'),
  ])
}

/** モールス入力画面。符号の入力に使うので項目は選ばない。戻る・緊急だけを構造として持つ */
export function buildMorseMenu(): MenuItem[] {
  return subScreen([])
}

export function buildMenu(screen: ScreenId, homeOptions: HomeMenuOptions): MenuItem[] {
  switch (screen) {
    case 'home':
      return buildHomeMenu(homeOptions)
    case 'urgentDetail':
      return buildUrgentDetailMenu(homeOptions.emergencyDetails)
    case 'discomfort':
      return buildDiscomfortMenu(homeOptions.phrases)
    case 'discomfortOther':
      return buildDiscomfortOtherMenu(homeOptions.phrases)
    case 'painLocation':
      return buildPainLocationMenu(homeOptions.phrases)
    case 'painIntensity':
      return buildPainIntensityMenu(homeOptions.pain)
    case 'comfort':
      return buildComfortMenu(homeOptions.phrases)
    case 'requests':
      return buildRequestsMenu(homeOptions.phrases)
    case 'feelings':
      return buildFeelingsMenu(homeOptions.phrases)
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
