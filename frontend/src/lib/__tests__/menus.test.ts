import { describe, expect, it } from 'vitest'
import { PARENT_SCREEN, buildHomeMenu, buildMenu, type ScreenId } from '../menus'

const ALL_SCREENS: ScreenId[] = [
  'home',
  'urgentDetail',
  'discomfort',
  'discomfortOther',
  'painLocation',
  'moodRequest',
  'letters',
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

  // letters は46字の本実装(#4)前の簡易版のため対象外。
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
    expect(lettersTile?.preview).toBe('あ・い・う・え…')
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
