// 定型フレーズ(不快・快・要望・痛い場所)の既定値と、介助者による編集内容の検証。
// 正本: docs/requirements.md §4.4, §4.5, §6 / Issue #8
//
// ここで編集できるのは「伝達メッセージ」の項目だけ。緊急・戻る・はい・いいえ・下位画面への
// 遷移項目は menus.ts のビルダーが構造で固定するため、編集内容がどうであっても
// ホームは先頭が緊急、通常下位画面は「戻る→緊急」、緊急詳細は「戻る→詳細候補」(§4.1)を保つ。

import type { ScreenId, Tone } from './menus'

export type PhraseGroup =
  | 'discomfort'
  | 'discomfortOther'
  | 'painLocation'
  | 'moodRequest'
  | 'feelings'

export interface Phrase {
  id: string
  /** タイルに出す短い表示ラベル */
  label: string
  /** 伝達として表示・読み上げる全文 */
  text: string
  tone?: Tone
}

/** 介助者が編集した項目。キーが無いグループは既定値を使う */
export type PhraseSets = Partial<Record<PhraseGroup, Phrase[]>>

export const PHRASE_GROUPS: PhraseGroup[] = [
  'discomfort',
  'discomfortOther',
  'painLocation',
  'moodRequest',
  'feelings',
]

export const PHRASE_GROUP_LABELS: Record<PhraseGroup, string> = {
  discomfort: '不快',
  discomfortOther: '不快・その他',
  painLocation: '痛い場所',
  // 保存キー名 `moodRequest` は「要望」のフレーズグループ(画面ID `requests`)。保存済み設定を壊さないため
  // キー名は変えない(Issue #93 で画面ID `moodRequest` は `comfort`(快)へ改名した)。快の続けて/やめて/変えては編集できない固定項目
  moodRequest: '要望',
  feelings: '気分',
}

/** 各フレーズの一覧を表示する画面 */
export const PHRASE_GROUP_SCREEN: Record<PhraseGroup, ScreenId> = {
  discomfort: 'discomfort',
  discomfortOther: 'discomfortOther',
  painLocation: 'painLocation',
  moodRequest: 'requests',
  feelings: 'feelings',
}

/** 1画面の項目数の目安(緊急・戻る・遷移項目を含む)。超えたら警告する(requirements.md §4.1) */
export const SCREEN_ITEM_LIMIT = 8

/** 1グループに置ける上限（これは警告ではなく保存時の安全上限） */
export const MAX_PHRASES_PER_GROUP = 20
export const PHRASE_LABEL_MAX = 20
export const PHRASE_TEXT_MAX = 100

/** 編集不可の固定項目の数(緊急・戻る + 下位画面へ進む項目)。フレーズ以外で画面を占める数 */
export const FIXED_ITEM_COUNT: Record<PhraseGroup, number> = {
  discomfort: 4, // 緊急・戻る・痛い→・その他→
  discomfortOther: 2,
  painLocation: 2,
  moodRequest: 2,
  feelings: 2,
}

/** 編集で作らせない表示ラベル(応答や操作と取り違える・位置を奪うのを防ぐ) */
const RESERVED_LABELS = ['戻る', 'はい', 'いいえ', '取り消し']

/** 緊急と取り違えさせない。ラベルにこれらを含む項目は作れない */
const EMERGENCY_WORDS = ['緊急', 'きんきゅう', 'キンキュウ']
/** 緊急の主文(上部の緊急表示・読み上げ・緊急と同じ文の拒否判定の正本)。本文なので句点を付ける(requirements.md §4.1.3) */
export const EMERGENCY_MESSAGE = '緊急です。来てください。'

/** 句読点・「…」「・」の有無や違いで同一判定を回避されないよう、比較用にこれらと空白を除く */
function stripPunctuation(value: string): string {
  return compact(value).replace(/[。、．，.,！!？?…・]/g, '')
}

/** 全角/半角・空白の違いで予約語を回避されないよう揃える */
function compact(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '')
}

export const DEFAULT_PHRASES: Record<PhraseGroup, Phrase[]> = {
  discomfort: [
    { id: 'suffering', label: '苦しい', text: '苦しいです。', tone: 'urgent' },
    { id: 'phlegm', label: '痰を取ってほしい', text: '痰を取ってほしいです。' },
    { id: 'reposition', label: '体の向きを変えたい', text: '体の向きを変えたいです。' },
    { id: 'toilet', label: 'トイレ', text: 'トイレに行きたいです。' },
  ],
  discomfortOther: [
    { id: 'hot', label: '暑い', text: '暑いです。' },
    { id: 'cold', label: '寒い', text: '寒いです。' },
    { id: 'thirsty', label: '喉が渇いた', text: '喉が渇きました。' },
    { id: 'itchy', label: 'かゆい', text: 'かゆいです。' },
    { id: 'cant-sleep', label: '眠れない', text: '眠れません。' },
  ],
  painLocation: [
    { id: 'head', label: '頭', text: '頭が痛いです。' },
    { id: 'chest', label: '胸', text: '胸が痛いです。', tone: 'urgent' },
    { id: 'stomach', label: 'おなか', text: 'おなかが痛いです。' },
    { id: 'back', label: '背中腰', text: '背中・腰が痛いです。' },
    { id: 'limbs', label: '手足', text: '手足が痛いです。' },
    { id: 'other', label: 'その他', text: 'その他の場所が痛いです。' },
  ],
  moodRequest: [
    { id: 'fine', label: '大丈夫', text: '大丈夫です。' },
    { id: 'thanks', label: 'ありがとう', text: 'ありがとう。' },
    { id: 'sleep', label: '眠りたい', text: '眠りたいです。' },
    { id: 'quiet', label: '静かにしてほしい', text: '静かにしてほしいです。' },
    { id: 'family', label: '家族に会いたい', text: '家族に会いたいです。' },
    { id: 'talk', label: '話したい', text: '話したいです。' },
  ],
  feelings: [
    { id: 'anxious', label: '不安', text: '不安です。' },
    { id: 'lonely', label: 'さみしい', text: 'さみしいです。' },
    { id: 'restless', label: '落ち着かない', text: '落ち着かないです。' },
  ],
}

const TONES: Tone[] = ['neutral', 'urgent']

/** 表示に使えない理由。使える項目なら null(編集画面で理由を示すのに使う) */
export function phraseProblem(phrase: Phrase): string | null {
  const label = compact(phrase.label)
  const text = compact(phrase.text)
  if (label === '') return '表示ラベルが空です。'
  if (text === '') return '伝える文が空です。'
  if (RESERVED_LABELS.includes(stripPunctuation(label))) return `「${label}」は予約された名前です。`
  if (EMERGENCY_WORDS.some((word) => label.includes(word))) {
    return '緊急と取り違えるため「緊急」を含むラベルは使えません。'
  }
  if (stripPunctuation(text) === stripPunctuation(EMERGENCY_MESSAGE)) {
    return '緊急の表示と同じ文は使えません。'
  }
  return null
}

/** 表示に使える項目か */
export function isUsablePhrase(phrase: Phrase): boolean {
  return phraseProblem(phrase) === null
}

/** そのグループで表示するフレーズ。編集がなければ既定、編集内容のうち使えない項目は除く */
export function phrasesFor(group: PhraseGroup, sets?: PhraseSets): Phrase[] {
  const custom = sets?.[group]
  if (!custom) return DEFAULT_PHRASES[group]
  return custom.filter(isUsablePhrase)
}

/** その画面の総項目数(緊急・戻る・遷移項目を含む) */
export function screenItemCount(group: PhraseGroup, sets?: PhraseSets): number {
  return FIXED_ITEM_COUNT[group] + phrasesFor(group, sets).length
}

/** 目安(SCREEN_ITEM_LIMIT)を超えているか。超えたら2段階化か削除を促す */
export function isOverItemLimit(group: PhraseGroup, sets?: PhraseSets): boolean {
  return screenItemCount(group, sets) > SCREEN_ITEM_LIMIT
}

/** 絵文字などのサロゲートペアを途中で切らずに、文字数で切り詰める */
function truncate(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('')
}

function normalizePhrase(input: unknown): Phrase | null {
  if (typeof input !== 'object' || input === null) return null
  const raw = input as Record<string, unknown>
  if (typeof raw.id !== 'string' || raw.id === '') return null
  if (typeof raw.label !== 'string' || typeof raw.text !== 'string') return null
  const phrase: Phrase = {
    id: raw.id.slice(0, 64),
    label: truncate(raw.label, PHRASE_LABEL_MAX),
    text: truncate(raw.text, PHRASE_TEXT_MAX),
  }
  if (TONES.includes(raw.tone as Tone) && raw.tone !== 'neutral') phrase.tone = raw.tone as Tone
  return phrase
}

/**
 * フレーズ保存値の世代。設定(settings.ts の phrasesVersion)に印として保存・書き出しする。
 * 1 = 句点導入(Issue #46)後。印が無い・1 未満の保存値と取り込みJSONだけを一度だけ昇格し、
 * 昇格後は印を付けて以降の読み込みでは昇格しない(介助者が句点を意図的に消した文を戻さない)。
 */
export const PHRASES_VERSION = 1

/**
 * 句点導入(Issue #46)前に保存された「既定そのままの文」を、新しい既定(句点つき)へ揃える。
 * 同じグループ・同じ id の既定と、句点を除いて完全一致するときだけ。介助者が書き換えた文は触らない。
 * 呼び出すのは印(phrasesVersion)が古い保存値だけ。
 */
function upgradeLegacyDefaultText(group: PhraseGroup, phrase: Phrase): Phrase {
  const base = DEFAULT_PHRASES[group].find((p) => p.id === phrase.id)
  if (base && base.text.endsWith('。') && phrase.text === base.text.slice(0, -1)) {
    return { ...phrase, text: base.text }
  }
  return phrase
}

/** 未知の値を安全な PhraseSets へ丸める。壊れた項目は捨て、id の重複は後ろを捨てる。 */
export function normalizePhraseSets(
  input: unknown,
  /** 旧既定(句点なし)を新既定へ昇格するか。既定は false。settings.ts が印の古い保存値・取り込みにだけ true を渡す */
  upgradeLegacy = false,
): PhraseSets {
  if (typeof input !== 'object' || input === null) return {}
  const raw = input as Record<string, unknown>
  const result: PhraseSets = {}
  for (const group of PHRASE_GROUPS) {
    const list = raw[group]
    if (!Array.isArray(list)) continue
    const seen = new Set<string>()
    const phrases: Phrase[] = []
    for (const item of list) {
      const parsed = normalizePhrase(item)
      if (!parsed || seen.has(parsed.id)) continue
      seen.add(parsed.id)
      phrases.push(upgradeLegacy ? upgradeLegacyDefaultText(group, parsed) : parsed)
      if (phrases.length >= MAX_PHRASES_PER_GROUP) break
    }
    result[group] = phrases
  }
  return result
}

/** 追加フレーズの id。既存と重ならない値にする */
export function newPhraseId(existing: Phrase[]): string {
  const used = new Set(existing.map((p) => p.id))
  let n = existing.length + 1
  while (used.has(`custom-${n}`)) n += 1
  return `custom-${n}`
}

/** 痛みの強さ(Issue #12)。場所を選んだあとに選ぶ */
export type PainIntensity = 'little' | 'quite' | 'very'

export const PAIN_INTENSITY_WORDS: Record<PainIntensity, string> = {
  little: '少し',
  quite: 'かなり',
  very: 'とても',
}

/**
 * 痛い場所の全文に強さを入れる。「胸が痛いです」→「胸がとても痛いです」。
 * 全文に「痛いです」が無い(介助者が自由に編集した)ときは、強さを（とても）の形で足す。
 * 句点で終わる文は句点の前に入れ(「…変です（とても）。」)、句点がない文は末尾に足す。
 */
export function composePainText(text: string, intensity: PainIntensity): string {
  const word = PAIN_INTENSITY_WORDS[intensity]
  if (text.includes('痛いです')) return text.replace('痛いです', `${word}痛いです`)
  // 句点で終わる文は、強さを句点の前に入れる(「…。（とても）」にしない)
  if (text.endsWith('。')) return `${text.slice(0, -1)}（${word}）。`
  return `${text}（${word}）`
}
