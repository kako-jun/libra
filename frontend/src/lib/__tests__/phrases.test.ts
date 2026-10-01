import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PHRASES,
  MAX_PHRASES_PER_GROUP,
  PHRASE_GROUPS,
  SCREEN_ITEM_LIMIT,
  isOverItemLimit,
  newPhraseId,
  normalizePhraseSets,
  phrasesFor,
  screenItemCount,
} from '../phrases'
import { buildMenu } from '../menus'

describe('phrases', () => {
  it('編集がなければ既定、既定は各画面とも目安(8項目)以内', () => {
    for (const group of PHRASE_GROUPS) {
      expect(phrasesFor(group)).toBe(DEFAULT_PHRASES[group])
      expect(isOverItemLimit(group)).toBe(false)
    }
  })

  it('編集したグループは編集内容を使い、他のグループは既定のまま', () => {
    const sets = { moodRequest: [{ id: 'a', label: 'テレビ', text: 'テレビを見たいです' }] }
    expect(phrasesFor('moodRequest', sets).map((p) => p.label)).toEqual(['テレビ'])
    expect(phrasesFor('painLocation', sets)).toBe(DEFAULT_PHRASES.painLocation)
  })

  it('空のラベル/全文や、緊急・戻る・はい・いいえ等の予約ラベルは表示に使わない', () => {
    const sets = {
      moodRequest: [
        { id: 'a', label: '', text: 'x' },
        { id: 'b', label: 'y', text: '  ' },
        { id: 'c', label: '緊急', text: '緊急です' },
        { id: 'd', label: 'はい', text: 'はい' },
        { id: 'e', label: '戻る', text: '戻る' },
        { id: 'f', label: 'テレビ', text: 'テレビを見たいです' },
      ],
    }
    expect(phrasesFor('moodRequest', sets).map((p) => p.id)).toEqual(['f'])
  })

  it('項目数が目安を超えると警告対象になる(緊急・戻るを含めて数える)', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i}`,
      label: `L${i}`,
      text: `T${i}`,
    }))
    expect(screenItemCount('moodRequest', { moodRequest: many })).toBe(9)
    expect(isOverItemLimit('moodRequest', { moodRequest: many })).toBe(true)
    expect(
      isOverItemLimit('moodRequest', { moodRequest: many.slice(0, SCREEN_ITEM_LIMIT - 2) }),
    ).toBe(false)
    // 不快は遷移項目2つを含むので、フレーズは4つまで
    expect(screenItemCount('discomfort')).toBe(8)
  })

  describe('normalizePhraseSets', () => {
    it('壊れた値は空にする', () => {
      expect(normalizePhraseSets(null)).toEqual({})
      expect(normalizePhraseSets('x')).toEqual({})
      expect(normalizePhraseSets({ moodRequest: 'x' })).toEqual({})
    })

    it('不正な項目・id の重複・未知のグループを捨て、長さを丸める', () => {
      const result = normalizePhraseSets({
        unknown: [{ id: 'a', label: 'x', text: 'y' }],
        moodRequest: [
          { id: 'a', label: 'x'.repeat(100), text: 'y'.repeat(500), tone: 'urgent' },
          { id: 'a', label: 'dup', text: 'dup' },
          { id: '', label: 'noid', text: 'noid' },
          { label: 'noid2', text: 'noid2' },
          { id: 'n', label: 5, text: 'x' },
          null,
        ],
      })
      expect(Object.keys(result)).toEqual(['moodRequest'])
      expect(result.moodRequest).toHaveLength(1)
      expect(result.moodRequest?.[0].label).toHaveLength(20)
      expect(result.moodRequest?.[0].text).toHaveLength(100)
      expect(result.moodRequest?.[0].tone).toBe('urgent')
    })

    it('1グループの上限を超える項目は捨てる', () => {
      const list = Array.from({ length: 50 }, (_, i) => ({ id: `c${i}`, label: 'a', text: 'b' }))
      expect(normalizePhraseSets({ moodRequest: list }).moodRequest).toHaveLength(
        MAX_PHRASES_PER_GROUP,
      )
    })
  })

  it('newPhraseId は既存と重ならない', () => {
    expect(newPhraseId([])).toBe('custom-1')
    expect(newPhraseId([{ id: 'custom-2', label: 'a', text: 'b' }])).toBe('custom-3')
  })
})

describe('編集しても緊急が先頭・戻るが2番目から外れない(安全の優先順位 §2・§4.1)', () => {
  const hostile = {
    discomfort: [],
    discomfortOther: [{ id: 'x', label: '緊急', text: '緊急です' }],
    painLocation: Array.from({ length: 20 }, (_, i) => ({
      id: `c${i}`,
      label: `L${i}`,
      text: `T${i}`,
    })),
    moodRequest: [{ id: 'emergency', label: 'はい', text: 'はい' }],
  }

  it.each(['discomfort', 'discomfortOther', 'painLocation', 'moodRequest'] as const)(
    '%s: 空・予約ラベル・上限いっぱいでも items[0]=緊急, items[1]=戻る',
    (screen) => {
      for (const phrases of [undefined, {}, hostile]) {
        const items = buildMenu(screen, { showUndo: false, emergencyActive: false, phrases })
        expect(items[0].action).toEqual({ type: 'emergency' })
        expect(items[1].action).toEqual({ type: 'back' })
      }
    },
  )

  it('ホームの並び(緊急→はい→いいえ→…)はフレーズ編集の影響を受けない', () => {
    const items = buildMenu('home', { showUndo: false, emergencyActive: false, phrases: hostile })
    expect(items.slice(0, 3).map((i) => i.label)).toEqual(['緊急', 'はい', 'いいえ'])
  })

  it('追加したフレーズはその画面の項目になり、不快の遷移項目は固定位置のまま', () => {
    const phrases = { discomfort: [{ id: 'custom-1', label: 'のど', text: 'のどが痛いです' }] }
    const labels = buildMenu('discomfort', {
      showUndo: false,
      emergencyActive: false,
      phrases,
    }).map((i) => i.label)
    expect(labels).toEqual(['緊急', '戻る', '痛い', 'のど', 'その他'])
  })

  it('下位画面へ進むタイルの予告に、編集後のフレーズが反映される', () => {
    const phrases = { moodRequest: [{ id: 'a', label: 'テレビ', text: 'テレビを見たいです' }] }
    const home = buildMenu('home', { showUndo: false, emergencyActive: false, phrases })
    expect(home.find((i) => i.id === 'mood-nav')?.preview).toBe('テレビ…')
  })
})
