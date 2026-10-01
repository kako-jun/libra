import { describe, expect, it } from 'vitest'
import {
  LETTER_ROWS,
  PARENT_SCREEN,
  buildHomeMenu,
  buildLettersRowMenu,
  buildMenu,
  type ScreenId,
} from '../menus'

const ALL_SCREENS: ScreenId[] = [
  'home',
  'urgentDetail',
  'discomfort',
  'discomfortOther',
  'painLocation',
  'moodRequest',
  'letters',
  'lettersRow',
  'lettersYesNo',
]

const homeOptions = { showUndo: false, emergencyActive: false }

describe('buildMenu の共通規則', () => {
  it.each(ALL_SCREENS)('%s: 先頭項目(items[0])は緊急である', (screen) => {
    const items = buildMenu(screen, homeOptions)
    expect(items[0].action).toEqual({ type: 'emergency' })
  })

  it.each(ALL_SCREENS.filter((s) => s !== 'home'))(
    '%s: home以外は items[1] が戻るである',
    (screen) => {
      const items = buildMenu(screen, homeOptions)
      expect(items[1].action).toEqual({ type: 'back' })
    },
  )

  // 文字盤の行段階(letters)は あ〜わ行 + 確定/1字消す/はい・いいえ で8項目を超える(§4.6)。
  it.each(ALL_SCREENS.filter((s) => s !== 'letters'))('%s: 項目数は8以内である', (screen) => {
    const items = buildMenu(screen, { showUndo: true, emergencyActive: false })
    expect(items.length).toBeLessThanOrEqual(8)
  })
})

describe('buildHomeMenu の取り消し表示デシジョンテーブル', () => {
  it('showUndo=true & emergencyActive=false のとき items[1] が取り消しになる', () => {
    const items = buildHomeMenu({ showUndo: true, emergencyActive: false })
    expect(items[1].action).toEqual({ type: 'undo' })
  })

  it('showUndo=false & emergencyActive=false のとき取り消しは含まれない', () => {
    const items = buildHomeMenu({ showUndo: false, emergencyActive: false })
    expect(items.some((item) => item.action.type === 'undo')).toBe(false)
  })

  it('showUndo=true & emergencyActive=true のとき取り消しは含まれない（緊急中は取り消し無効）', () => {
    const items = buildHomeMenu({ showUndo: true, emergencyActive: true })
    expect(items.some((item) => item.action.type === 'undo')).toBe(false)
  })

  it('showUndo=false & emergencyActive=true のとき取り消しは含まれない', () => {
    const items = buildHomeMenu({ showUndo: false, emergencyActive: true })
    expect(items.some((item) => item.action.type === 'undo')).toBe(false)
  })
})

describe('戻る先(PARENT_SCREEN)', () => {
  it('painLocation の戻る先は discomfort', () => {
    expect(PARENT_SCREEN.painLocation).toBe('discomfort')
  })

  it('discomfortOther の戻る先は discomfort', () => {
    expect(PARENT_SCREEN.discomfortOther).toBe('discomfort')
  })

  it.each(['urgentDetail', 'moodRequest', 'letters'] as const)('%s の戻る先は home', (screen) => {
    expect(PARENT_SCREEN[screen]).toBe('home')
  })

  it.each(['lettersRow', 'lettersYesNo'] as const)('%s の戻る先は letters(行段階)', (screen) => {
    expect(PARENT_SCREEN[screen]).toBe('letters')
  })
})

describe('ホームの並び順(安全の優先順位 §2 の回帰テスト)', () => {
  it('緊急→取り消し→はい→いいえ→不快→快・要望→文字盤の順になる', () => {
    const items = buildHomeMenu({ showUndo: true, emergencyActive: false })
    expect(items.map((item) => item.label)).toEqual([
      '緊急',
      '取り消し',
      'はい',
      'いいえ',
      '不快',
      '快・要望',
      '文字盤',
    ])
  })

  it('取り消しなしのときは緊急→はい→いいえ→不快→快・要望→文字盤の順になる', () => {
    const items = buildHomeMenu({ showUndo: false, emergencyActive: false })
    expect(items.map((item) => item.label)).toEqual([
      '緊急',
      'はい',
      'いいえ',
      '不快',
      '快・要望',
      '文字盤',
    ])
  })
})

describe('Issue #3 追加指示: navigate タイルの予告(preview)', () => {
  it('不快タイルの予告は遷移先(discomfort)の緊急・戻るを除いた先頭項目から自動生成される', () => {
    const items = buildHomeMenu({ showUndo: false, emergencyActive: false })
    const discomfortTile = items.find((item) => item.id === 'discomfort-nav')
    expect(discomfortTile?.preview).toBe('痛い・苦しい・痰を取ってほしい・体の向きを変えたい…')
  })

  it('快・要望タイルの予告は遷移先(moodRequest)から自動生成される', () => {
    const items = buildHomeMenu({ showUndo: false, emergencyActive: false })
    const moodTile = items.find((item) => item.id === 'mood-nav')
    expect(moodTile?.preview).toBe('大丈夫・ありがとう・眠りたい・静かにしてほしい…')
  })

  it('文字盤タイルの予告は遷移先(letters)から自動生成される', () => {
    const items = buildHomeMenu({ showUndo: false, emergencyActive: false })
    const lettersTile = items.find((item) => item.id === 'letters-nav')
    expect(lettersTile?.preview).toBe('あ行・か行・さ行・た行…')
  })

  it('message/emergency/back/undo などの navigate 以外のアイテムは preview を持たない', () => {
    const items = buildHomeMenu({ showUndo: true, emergencyActive: false })
    for (const item of items) {
      if (item.action.type !== 'navigate') {
        expect(item.preview).toBeUndefined()
      }
    }
  })
})

describe('文字盤(§4.6)', () => {
  it('清音46字 + 長音「ー」を過不足なく持ち、濁点・半濁点・小書きを含まない', () => {
    const all = LETTER_ROWS.flatMap((row) => row.chars)
    expect(all).toHaveLength(47)
    expect(new Set(all).size).toBe(47)
    expect(all).toContain('ー')
    expect(all.join('')).toBe(
      'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをんー',
    )
  })

  it('わ行は わ・を・ん・ー', () => {
    expect(LETTER_ROWS[9].chars).toEqual(['わ', 'を', 'ん', 'ー'])
  })

  it('行段階: 緊急→戻る→あ〜わ行→確定→1字消す→はい・いいえ', () => {
    const labels = buildMenu('letters', homeOptions).map((item) => item.label)
    expect(labels).toEqual([
      '緊急',
      '戻る',
      ...LETTER_ROWS.map((row) => row.name),
      '確定',
      '1字消す',
      'はい・いいえ',
    ])
  })

  it('文字段階: 緊急→戻る→その行の文字(8項目以内)', () => {
    LETTER_ROWS.forEach((row, index) => {
      const items = buildLettersRowMenu(index)
      expect(items.map((item) => item.label)).toEqual(['緊急', '戻る', ...row.chars])
      expect(items.length).toBeLessThanOrEqual(8)
    })
  })

  it('はい・いいえ画面: 緊急→戻る→はい→いいえ', () => {
    const labels = buildMenu('lettersYesNo', homeOptions).map((item) => item.label)
    expect(labels).toEqual(['緊急', '戻る', 'はい', 'いいえ'])
  })
})
