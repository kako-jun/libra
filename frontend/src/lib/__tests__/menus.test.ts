import { describe, expect, it } from 'vitest'
import {
  LETTER_ROWS,
  PATIENT_SCREEN_IDS,
  PARENT_SCREEN,
  SCREEN_GUIDANCE,
  URGENT_DETAIL_LABELS,
  buildHomeMenu,
  buildLettersRowMenu,
  buildMenu,
  buildUrgentDetailMenu,
  type ScreenId,
} from '../menus'

const ALL_SCREENS: ScreenId[] = [...PATIENT_SCREEN_IDS]

const homeOptions = { showUndo: false, emergencyActive: false }

describe('buildMenu の共通規則', () => {
  it('home: 先頭項目は緊急である', () => {
    expect(buildMenu('home', homeOptions)[0].action).toEqual({ type: 'emergency' })
  })

  it.each(ALL_SCREENS.filter((screen) => screen !== 'home' && screen !== 'urgentDetail'))(
    '%s: 通常下位画面の先頭は戻る、2番目は緊急である',
    (screen) => {
      const items = buildMenu(screen, homeOptions)
      expect(items[0].action).toEqual({ type: 'back' })
      expect(items[1].action).toEqual({ type: 'emergency' })
    },
  )

  it('urgentDetail: 成立済みの緊急タイルを重複させず、先頭は戻る', () => {
    const items = buildMenu('urgentDetail', homeOptions)
    expect(items[0].action).toEqual({ type: 'back' })
    expect(items.some((item) => item.action.type === 'emergency')).toBe(false)
  })

  it('全 ScreenId が案内文を持ち、画面列挙と親定義から漏れない', () => {
    for (const screen of PATIENT_SCREEN_IDS) {
      expect(SCREEN_GUIDANCE[screen]).toMatch(/。$/)
      if (screen !== 'home') expect(PARENT_SCREEN[screen]).toBeDefined()
    }
  })

  // 文字盤の行段階(letters)は あ〜わ行 + 確定/1字消す/はい・いいえ で8項目を超える(§4.6)。
  it.each(ALL_SCREENS.filter((s) => s !== 'letters'))('%s: 項目数は8以内である', (screen) => {
    const items = buildMenu(screen, { showUndo: true, emergencyActive: false })
    expect(items.length).toBeLessThanOrEqual(8)
  })
})

describe('本人画面の階層構造', () => {
  const expectedScreens: ScreenId[] = [
    'home',
    'urgentDetail',
    'discomfort',
    'discomfortOther',
    'painLocation',
    'painIntensity',
    'moodRequest',
    'requests',
    'feelings',
    'letters',
    'lettersRow',
    'lettersYesNo',
    'morse',
  ]

  const expectedParents: Record<Exclude<ScreenId, 'home'>, ScreenId> = {
    urgentDetail: 'home',
    discomfort: 'home',
    discomfortOther: 'discomfort',
    painLocation: 'discomfort',
    painIntensity: 'painLocation',
    moodRequest: 'home',
    requests: 'moodRequest',
    feelings: 'moodRequest',
    letters: 'home',
    lettersRow: 'letters',
    lettersYesNo: 'letters',
    morse: 'home',
  }

  it('仕様書の全 ScreenId と親マップを過不足なく列挙する', () => {
    expect(PATIENT_SCREEN_IDS).toEqual(expectedScreens)
    expect(PARENT_SCREEN).toEqual(expectedParents)
    expect(Object.keys(PARENT_SCREEN)).toEqual(
      expectedScreens.filter((screen) => screen !== 'home'),
    )
  })

  it.each(expectedScreens.filter((screen) => screen !== 'home'))(
    '%s: 親をたどると循環せず home へ到達する',
    (start) => {
      const visited = new Set<ScreenId>()
      let current: ScreenId = start

      while (current !== 'home') {
        expect(visited.has(current), `${start} からの親経路が ${current} で循環`).toBe(false)
        visited.add(current)
        const parent: ScreenId | undefined = PARENT_SCREEN[current]
        expect(parent, `${current} の親が未定義`).toBeDefined()
        expect(expectedScreens, `${current} の親 ${parent} が未知の ScreenId`).toContain(parent)
        current = parent as ScreenId
      }
    },
  )
})

describe('urgentDetail の選択済み候補除外', () => {
  const labels = (selectedDetails?: readonly string[]) =>
    buildUrgentDetailMenu(selectedDetails).map((item) => item.label)

  it.each([
    ['未設定', undefined, ['戻る', ...URGENT_DETAIL_LABELS]],
    ['0件', [], ['戻る', ...URGENT_DETAIL_LABELS]],
    ['1件', ['苦しい'], ['戻る', '痛い', '息ができない', '吐きそう', '胸が痛い']],
    ['4件', URGENT_DETAIL_LABELS.slice(0, 4), ['戻る', '胸が痛い']],
    ['5件', URGENT_DETAIL_LABELS, ['戻る']],
  ] as const)('%s選択済みなら未選択候補だけを元の順序で返す', (_case, selected, expected) => {
    expect(labels(selected)).toEqual(expected)
  })

  it('未知値と重複値は候補を余分に除外せず、既知の選択済みだけを1件除く', () => {
    expect(labels(['苦しい', '苦しい', '未知の状態', ''])).toEqual([
      '戻る',
      '痛い',
      '息ができない',
      '吐きそう',
      '胸が痛い',
    ])
  })

  it('残る候補はすべて emergencyDetail で、戻るだけの境界では詳細アクションがない', () => {
    const remaining = buildUrgentDetailMenu(['苦しい', '痛い', '息ができない', '吐きそう'])
    expect(remaining[0].action).toEqual({ type: 'back' })
    expect(remaining.slice(1).map((item) => item.action)).toEqual([
      { type: 'emergencyDetail', label: '胸が痛い' },
    ])
    expect(buildUrgentDetailMenu(URGENT_DETAIL_LABELS).map((item) => item.action)).toEqual([
      { type: 'back' },
    ])
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
  it('不快タイルの予告は遷移先(discomfort)の戻る・緊急を除いた先頭項目から自動生成される', () => {
    const items = buildHomeMenu({ showUndo: false, emergencyActive: false })
    const discomfortTile = items.find((item) => item.id === 'discomfort-nav')
    expect(discomfortTile?.preview).toBe('痛い・苦しい・痰を取ってほしい・体の向きを変えたい…')
  })

  it('快・要望タイルの予告は遷移先(moodRequest)から自動生成される', () => {
    const items = buildHomeMenu({ showUndo: false, emergencyActive: false })
    const moodTile = items.find((item) => item.id === 'mood-nav')
    expect(moodTile?.preview).toBe('続けて・やめて・もっと・変えて…')
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

  it('行段階: 戻る→緊急→あ〜わ行→確定→1字消す→はい・いいえ', () => {
    const labels = buildMenu('letters', homeOptions).map((item) => item.label)
    expect(labels).toEqual([
      '戻る',
      '緊急',
      ...LETTER_ROWS.map((row) => row.name),
      '確定',
      '1字消す',
      'はい・いいえ',
    ])
  })

  it('文字段階: 戻る→緊急→その行の文字(8項目以内)', () => {
    LETTER_ROWS.forEach((row, index) => {
      const items = buildLettersRowMenu(index)
      expect(items.map((item) => item.label)).toEqual(['戻る', '緊急', ...row.chars])
      expect(items.length).toBeLessThanOrEqual(8)
    })
  })

  it('はい・いいえ画面: 戻る→緊急→はい→いいえ', () => {
    const labels = buildMenu('lettersYesNo', homeOptions).map((item) => item.label)
    expect(labels).toEqual(['戻る', '緊急', 'はい', 'いいえ'])
  })
})

describe('モールス入力(Issue #14)', () => {
  it('既定ではホームに入口を出さない', () => {
    const items = buildMenu('home', { showUndo: false, emergencyActive: false })
    expect(items.some((i) => i.id === 'morse-nav')).toBe(false)
  })

  it('有効にすると、文字盤の後ろ(ホームの最後)に入口が出て、緊急・はい・いいえの位置は変わらない', () => {
    const items = buildMenu('home', { showUndo: false, emergencyActive: false, morseEnabled: true })
    expect(items.map((i) => i.label)).toEqual([
      '緊急',
      'はい',
      'いいえ',
      '不快',
      '快・要望',
      '文字盤',
      'モールス',
    ])
  })

  it('取り消しが出ているときもホームは8項目以内', () => {
    const items = buildMenu('home', { showUndo: true, emergencyActive: false, morseEnabled: true })
    expect(items.length).toBeLessThanOrEqual(8)
  })

  it('モールス画面は戻る・緊急だけを構造として持ち、戻る先はホーム', () => {
    const items = buildMenu('morse', homeOptions)
    expect(items.map((i) => i.action.type)).toEqual(['back', 'emergency'])
    expect(PARENT_SCREEN.morse).toBe('home')
  })
})

describe('痛みの強さ・快/要望・気分(Issue #12)', () => {
  const chest = { label: '胸', text: '胸が痛いです', tone: 'urgent' as const }
  const head = { label: '頭', text: '頭が痛いです' }

  it('痛い場所を選ぶと強さの画面へ進む(場所だけでは伝達しない)', () => {
    const items = buildMenu('painLocation', homeOptions)
    const place = items.slice(2)
    expect(place.length).toBeGreaterThan(0)
    for (const item of place) expect(item.action.type).toBe('painLocation')
    expect(items.find((i) => i.label === '胸')?.action).toEqual({
      type: 'painLocation',
      label: '胸',
      text: '胸が痛いです',
      tone: 'urgent',
    })
  })

  it('強さの画面: 戻る→緊急→場所だけ→少し→かなり→とても(8項目以内)', () => {
    const items = buildMenu('painIntensity', { ...homeOptions, pain: head })
    expect(items.map((i) => i.label)).toEqual([
      '戻る',
      '緊急',
      '場所だけ',
      '少し',
      'かなり',
      'とても',
    ])
    expect(items.length).toBeLessThanOrEqual(8)
  })

  it('強さの画面の伝達文: 胸→とても = 胸がとても痛いです(緊急色)', () => {
    const items = buildMenu('painIntensity', { ...homeOptions, pain: chest })
    const text = (label: string) => {
      const item = items.find((i) => i.label === label)
      return item?.action.type === 'message' ? item.action : null
    }
    expect(text('とても')).toEqual({ type: 'message', text: '胸がとても痛いです', tone: 'urgent' })
    expect(text('かなり')?.text).toBe('胸がかなり痛いです')
    expect(text('少し')?.text).toBe('胸が少し痛いです')
    expect(text('場所だけ')?.text).toBe('胸が痛いです')
  })

  it('「とても」は緊急色、場所の色(胸=緊急色)は少し/かなり/場所だけにも引き継ぐ', () => {
    const head1 = buildMenu('painIntensity', { ...homeOptions, pain: head })
    const tone = (items: typeof head1, label: string) => items.find((i) => i.label === label)?.tone
    expect(tone(head1, 'とても')).toBe('urgent')
    expect(tone(head1, '少し')).toBeUndefined()
    const chest1 = buildMenu('painIntensity', { ...homeOptions, pain: chest })
    expect(tone(chest1, '少し')).toBe('urgent')
    expect(tone(chest1, '場所だけ')).toBe('urgent')
  })

  it('場所が未選択でも、強さの画面は戻る・緊急を持つ', () => {
    const items = buildMenu('painIntensity', homeOptions)
    expect(items.map((i) => i.action.type)).toEqual(['back', 'emergency'])
  })

  it('強さの画面の戻る先は痛い場所', () => {
    expect(PARENT_SCREEN.painIntensity).toBe('painLocation')
  })

  it('快・要望: 戻る→緊急→続けて→やめて→もっと→変えて→要望→気分(8項目)', () => {
    const items = buildMenu('moodRequest', homeOptions)
    expect(items.map((i) => i.label)).toEqual([
      '戻る',
      '緊急',
      '続けて',
      'やめて',
      'もっと',
      '変えて',
      '要望',
      '気分',
    ])
    expect(items.length).toBeLessThanOrEqual(8)
  })

  it('続けて・やめて・もっと・変えて は、はい・いいえと同じく編集できない固定項目(編集内容の影響を受けない)', () => {
    const phrases = { moodRequest: [], feelings: [] }
    const items = buildMenu('moodRequest', { ...homeOptions, phrases })
    expect(items.slice(2, 6).map((i) => i.label)).toEqual(['続けて', 'やめて', 'もっと', '変えて'])
    const texts = items.slice(2, 6).map((i) => (i.action.type === 'message' ? i.action.text : null))
    expect(texts).toEqual([
      '続けてください',
      'やめてください',
      'もっとお願いします',
      '変えてください',
    ])
  })

  it('要望(これまでの大丈夫・ありがとう…)と気分(不安・さみしい・落ち着かない)は快・要望の下位画面', () => {
    expect(PARENT_SCREEN.requests).toBe('moodRequest')
    expect(PARENT_SCREEN.feelings).toBe('moodRequest')
    expect(buildMenu('requests', homeOptions).map((i) => i.label)).toEqual([
      '戻る',
      '緊急',
      '大丈夫',
      'ありがとう',
      '眠りたい',
      '静かにしてほしい',
      '家族に会いたい',
      '話したい',
    ])
    expect(buildMenu('feelings', homeOptions).map((i) => i.label)).toEqual([
      '戻る',
      '緊急',
      '不安',
      'さみしい',
      '落ち着かない',
    ])
  })
})
