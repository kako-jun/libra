// 画面ごとの項目定義。純粋データ + 「先頭=緊急」「下位画面の2番目=戻る」を
// 構造で保証するビルダー。副作用は持たない（実行そのものは ActionId を App.tsx が解釈する）。
// 正本: docs/requirements.md §2, §4

export type Tone = 'neutral' | 'urgent' | 'calm' | 'positive'

export type ScreenId =
  | 'home'
  | 'urgentDetail'
  | 'discomfort'
  | 'discomfortOther'
  | 'painLocation'
  | 'moodRequest'
  | 'letters'

export type ActionId =
  | { type: 'emergency' }
  | { type: 'emergencyDetail'; label: string }
  | { type: 'undo' }
  | { type: 'back' }
  | { type: 'navigate'; screen: ScreenId }
  | { type: 'message'; text: string; tone?: Tone }
  | { type: 'letterAppend'; char: string }
  | { type: 'letterBackspace' }
  | { type: 'letterCommit' }

export interface MenuItem {
  id: string
  label: string
  detail?: string
  tone?: Tone
  action: ActionId
}

/** 下位画面の「戻る」の遷移先。画面ツリーに従う（painLocation は discomfort の子）。 */
export const PARENT_SCREEN: Record<Exclude<ScreenId, 'home'>, ScreenId> = {
  urgentDetail: 'home',
  discomfort: 'home',
  discomfortOther: 'discomfort',
  painLocation: 'discomfort',
  moodRequest: 'home',
  letters: 'home',
}

export const SCREEN_TITLES: Record<ScreenId, string> = {
  home: 'libra',
  urgentDetail: '緊急',
  discomfort: '不快',
  discomfortOther: '不快・その他',
  painLocation: '痛い場所',
  moodRequest: '快・要望',
  letters: '文字盤',
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

function navigate(id: string, label: string, screen: ScreenId): MenuItem {
  return { id, label, action: { type: 'navigate', screen } }
}

export interface HomeMenuOptions {
  /** 伝達直後の1周だけ true。渡された値に関わらず emergencyActive 中は無視する */
  showUndo: boolean
  /** 緊急中は取り消しを出さない（requirements.md §4.3: 本人のスイッチ入力で上書き・取り消しされない）。
   *  この判定を App 側に置かず、ここで一元的に保証する。 */
  emergencyActive: boolean
}

export function buildHomeMenu(options: HomeMenuOptions): MenuItem[] {
  const showUndo = options.showUndo && !options.emergencyActive
  return homeScreen([
    ...(showUndo ? [{ id: 'undo', label: '取り消し', action: { type: 'undo' } } as MenuItem] : []),
    message('yes', 'はい', 'はい', 'positive'),
    message('no', 'いいえ', 'いいえ'),
    navigate('discomfort-nav', '不快 →', 'discomfort'),
    navigate('mood-nav', '快・要望 →', 'moodRequest'),
    navigate('letters-nav', '文字盤 →', 'letters'),
  ])
}

export function buildUrgentDetailMenu(): MenuItem[] {
  return subScreen([
    {
      id: 'suffering',
      label: '苦しい',
      tone: 'urgent',
      action: { type: 'emergencyDetail', label: '苦しい' },
    },
    {
      id: 'pain',
      label: '痛い',
      tone: 'urgent',
      action: { type: 'emergencyDetail', label: '痛い' },
    },
    {
      id: 'cant-breathe',
      label: '息ができない',
      tone: 'urgent',
      action: { type: 'emergencyDetail', label: '息ができない' },
    },
    {
      id: 'nausea',
      label: '吐きそう',
      tone: 'urgent',
      action: { type: 'emergencyDetail', label: '吐きそう' },
    },
    {
      id: 'chest-pain',
      label: '胸が痛い',
      tone: 'urgent',
      action: { type: 'emergencyDetail', label: '胸が痛い' },
    },
  ])
}

// 1画面の項目数は緊急・戻るを含めて8以内(requirements.md §4.1)。
// 「その他」は暑い/寒い/喉が渇いた/かゆい/眠れないを discomfortOther へ退避する。
export function buildDiscomfortMenu(): MenuItem[] {
  return subScreen([
    navigate('pain-nav', '痛い →', 'painLocation'),
    message('suffering', '苦しい', '苦しいです', 'urgent'),
    message('phlegm', '痰を取ってほしい', '痰を取ってほしいです'),
    message('reposition', '体の向きを変えたい', '体の向きを変えたいです'),
    message('toilet', 'トイレ', 'トイレに行きたいです'),
    navigate('discomfort-other-nav', 'その他 →', 'discomfortOther'),
  ])
}

export function buildDiscomfortOtherMenu(): MenuItem[] {
  return subScreen([
    message('hot', '暑い', '暑いです'),
    message('cold', '寒い', '寒いです'),
    message('thirsty', '喉が渇いた', '喉が渇きました'),
    message('itchy', 'かゆい', 'かゆいです'),
    message('cant-sleep', '眠れない', '眠れません'),
  ])
}

export function buildPainLocationMenu(): MenuItem[] {
  return subScreen([
    message('head', '頭', '頭が痛いです'),
    message('chest', '胸', '胸が痛いです', 'urgent'),
    message('stomach', 'おなか', 'おなかが痛いです'),
    message('back', '背中腰', '背中・腰が痛いです'),
    message('limbs', '手足', '手足が痛いです'),
    message('other', 'その他', 'その他の場所が痛いです'),
  ])
}

// テレビ・音楽は #8（フレーズ編集）で追加可能な位置にする。1画面8項目以内の枠に収めるため撤去。
export function buildMoodRequestMenu(): MenuItem[] {
  return subScreen([
    message('fine', '大丈夫', '大丈夫です', 'positive'),
    message('thanks', 'ありがとう', 'ありがとう', 'positive'),
    message('sleep', '眠りたい', '眠りたいです'),
    message('quiet', '静かにしてほしい', '静かにしてほしいです'),
    message('family', '家族に会いたい', '家族に会いたいです'),
    message('talk', '話したい', '話したいです'),
  ])
}

export const LETTERS = ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け', 'こ']

export function buildLettersMenu(): MenuItem[] {
  const letterItems: MenuItem[] = LETTERS.map((char) => ({
    id: `letter-${char}`,
    label: char,
    action: { type: 'letterAppend', char },
  }))
  return subScreen([
    ...letterItems,
    { id: 'backspace', label: '1字消す', action: { type: 'letterBackspace' } },
    { id: 'commit', label: '確定', tone: 'positive', action: { type: 'letterCommit' } },
  ])
}

export function buildMenu(screen: ScreenId, homeOptions: HomeMenuOptions): MenuItem[] {
  switch (screen) {
    case 'home':
      return buildHomeMenu(homeOptions)
    case 'urgentDetail':
      return buildUrgentDetailMenu()
    case 'discomfort':
      return buildDiscomfortMenu()
    case 'discomfortOther':
      return buildDiscomfortOtherMenu()
    case 'painLocation':
      return buildPainLocationMenu()
    case 'moodRequest':
      return buildMoodRequestMenu()
    case 'letters':
      return buildLettersMenu()
  }
}
