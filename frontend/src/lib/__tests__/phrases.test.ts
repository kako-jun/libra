import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PHRASES,
  MAX_PHRASES_PER_GROUP,
  PHRASE_GROUPS,
  PHRASE_GROUP_SCREEN,
  SCREEN_ITEM_LIMIT,
  composePainText,
  isOverItemLimit,
  newPhraseId,
  phraseProblem,
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

describe('緊急と取り違える項目・画面の項目数', () => {
  it.each([
    ['緊急です', 'x'],
    ['緊急!', 'x'],
    ['緊 急', 'x'],
    ['緊急', 'x'],
    ['きんきゅう', 'x'],
    ['キンキュウ', 'x'],
    ['戻る', 'x'],
    ['はい', 'x'],
    ['ｲｲｴ', ''],
    ['テレビ', '緊急です。来てください。'],
    ['テレビ', '緊急です。来て ください'],
  ])('ラベル「%s」/ 全文「%s」は表示に使えない', (label, text) => {
    expect(phraseProblem({ id: 'a', label, text })).not.toBeNull()
  })

  it('全角のはい・いいえも予約ラベルとして弾く', () => {
    expect(phraseProblem({ id: 'a', label: 'はい', text: 'x' })).not.toBeNull()
    expect(phraseProblem({ id: 'a', label: ' いいえ ', text: 'x' })).not.toBeNull()
  })

  it('普通のフレーズは使える', () => {
    expect(phraseProblem({ id: 'a', label: 'テレビ', text: 'テレビを見たいです' })).toBeNull()
  })

  it('長さの丸めは絵文字を途中で切らない', () => {
    const result = normalizePhraseSets({
      moodRequest: [{ id: 'a', label: '😀'.repeat(30), text: 'x' }],
    })
    expect(result.moodRequest?.[0].label).toBe('😀'.repeat(20))
  })

  // FIXED_ITEM_COUNT を手書きで持っているため、menus.ts の構造とずれたら検出する
  it.each(PHRASE_GROUPS)('%s: screenItemCount は実際のメニューの項目数と一致する', (group) => {
    const phrases = {
      [group]: [
        { id: 'a', label: 'A', text: 'A' },
        { id: 'b', label: 'B', text: 'B' },
        { id: 'c', label: '', text: 'C' }, // 表示されない項目は数えない
      ],
    }
    for (const sets of [undefined, phrases]) {
      expect(
        buildMenu(PHRASE_GROUP_SCREEN[group], {
          showUndo: false,
          emergencyActive: false,
          phrases: sets,
        }).length,
      ).toBe(screenItemCount(group, sets))
    }
  })
})

describe('編集しても戻る・緊急の位置が固定される(安全の優先順位 §2・§4.1)', () => {
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

  it.each([
    'discomfort',
    'discomfortOther',
    'painLocation',
    'moodRequest',
    'requests',
    'feelings',
  ] as const)('%s: 空・予約ラベル・上限いっぱいでも items[0]=戻る, items[1]=緊急', (screen) => {
    for (const phrases of [undefined, {}, hostile]) {
      const items = buildMenu(screen, { showUndo: false, emergencyActive: false, phrases })
      expect(items[0].action).toEqual({ type: 'back' })
      expect(items[1].action).toEqual({ type: 'emergency' })
    }
  })

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
    expect(labels).toEqual(['戻る', '緊急', '痛い', 'のど', 'その他'])
  })

  it('下位画面へ進むタイルの予告に、編集後のフレーズが反映される', () => {
    const phrases = { moodRequest: [{ id: 'a', label: 'テレビ', text: 'テレビを見たいです' }] }
    const moodRequest = buildMenu('moodRequest', {
      showUndo: false,
      emergencyActive: false,
      phrases,
    })
    expect(moodRequest.find((i) => i.id === 'requests-nav')?.preview).toBe('テレビ…')
  })
})

describe('composePainText(痛みの強さ)', () => {
  it('「痛いです」の前に強さを入れる', () => {
    expect(composePainText('胸が痛いです', 'very')).toBe('胸がとても痛いです')
    expect(composePainText('背中・腰が痛いです', 'quite')).toBe('背中・腰がかなり痛いです')
    expect(composePainText('頭が痛いです', 'little')).toBe('頭が少し痛いです')
  })

  it('「痛いです」を含まない(介助者が編集した)全文は、末尾に強さを足す', () => {
    expect(composePainText('首が重い', 'very')).toBe('首が重い（とても）')
  })

  it('既定の痛い場所はすべて強さを入れられる(「痛いです」を含む)', () => {
    for (const p of DEFAULT_PHRASES.painLocation) expect(p.text).toContain('痛いです')
  })

  it('#77: 旧い保存値の tone: positive / calm は読み込み時に neutral(tone なし)へ正規化し、urgent は残す', () => {
    const sets = normalizePhraseSets({
      moodRequest: [
        { id: 'a', label: 'あ', text: 'あ。', tone: 'positive' },
        { id: 'b', label: 'い', text: 'い。', tone: 'calm' },
        { id: 'c', label: 'う', text: 'う。', tone: 'urgent' },
      ],
    })
    const list = sets.moodRequest ?? []
    expect(list).toHaveLength(3)
    expect(list[0].tone).toBeUndefined()
    expect(list[1].tone).toBeUndefined()
    expect(list[2].tone).toBe('urgent')
  })

  it('#77: 既定フレーズに positive / calm は残っていない', () => {
    for (const group of PHRASE_GROUPS) {
      for (const p of DEFAULT_PHRASES[group]) expect(['positive', 'calm']).not.toContain(p.tone)
    }
  })
})
