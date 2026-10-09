// Issue #46: 句読点規則(docs/requirements.md §4.1.3)の横断テスト。
//
// デシジョンテーブル
//  (A) 文言の種別 × 末尾記号(静的検査)
//   種別                                         | 末尾の期待
//   本文(伝達文・案内文・既定フレーズtext・状態文) | 全角「。」で終わる(括弧内の「。」は許容。疑問形は「？」)
//   短いラベル(menus の label・グループ名・画面名・パンくず) | 句読点で終わらない
//   「項目名: 値」で値が語(例: 画面スリープ防止: 有効)   | 付けない(値が文のときだけ付く)
//   共通                                          | 半角「...」なし・「？。」の重複なし
//
//  (B) normalizePhraseSets: 保存データ × 期待
//   保存データ(同グループ・同id)                   | 結果
//   既定から句点だけ欠けた文(旧既定)               | 新既定(句点つき)へ昇格。label/toneは保存値のまま
//   既に新既定(句点つき)                           | そのまま
//   書き換え済み(句点を除いても既定と違う)         | そのまま
//   旧既定の文面だが別グループのid                 | そのまま(同グループ・同idの既定が無い)
//   未知id(custom)                                 | そのまま
//   句点が既定にない文(ありがとう等はあり。無しの既定なし) | 不変
//   2回かけても同じ(冪等) / 空文字・非文字列・null・undefinedで落ちない
//
//  (C) composePainText: 文 × 結果
//   「痛いです。」入り         | 強さが「痛いです」の前に入り句点は保たれる
//   「痛いです」を含まない句点つき文 | 「…（とても）。」(括弧は句点の前)
//   句点なし文                 | 「…（とても）」(末尾に括弧)
//
//  (D) phraseProblem: 緊急文と同一視 × 結果
//   「緊急です来てください」「緊急です。来てください」「緊急です、来てください」(半角/全角空白混在含む) | 拒否
//   句点の有無・種類で結果が変わらない / 通常文 | 許可
import { describe, expect, it } from 'vitest'
import appSrc from '../../App.tsx?raw'
import phraseEditorSrc from '../../PhraseEditor.tsx?raw'
import menusSrc from '../menus.ts?raw'
import phrasesSrc from '../phrases.ts?raw'
import guidanceSrc from '../guidance.ts?raw'
import {
  DEFAULT_PHRASES,
  EMERGENCY_MESSAGE,
  PHRASE_GROUPS,
  PHRASE_GROUP_LABELS,
  composePainText,
  normalizePhraseSets,
  phraseProblem,
  type PainIntensity,
  type PhraseGroup,
} from '../phrases'
import {
  PATIENT_SCREEN_IDS,
  SCREEN_GUIDANCE,
  SCREEN_TITLES,
  URGENT_DETAIL_ITEMS,
  buildMenu,
  buildScreenBreadcrumb,
  type ScreenId,
} from '../menus'
import {
  buildBehaviorNotes,
  buildCaregiverMenuNotes,
  buildScreenNotes,
  type BehaviorNotesContext,
  type ScreenNotesContext,
} from '../guidance'
import { DEFAULT_SETTINGS, parseSettingsJson } from '../settings'

const SOURCES: Record<string, string> = {
  'App.tsx': appSrc,
  'PhraseEditor.tsx': phraseEditorSrc,
  'lib/menus.ts': menusSrc,
  'lib/phrases.ts': phrasesSrc,
  'lib/guidance.ts': guidanceSrc,
}
const read = (file: string) => SOURCES[file]

/** 末尾が「。」か、「。）」「）。」などで閉じている(本文の終端) */
const endsWithKuten = (s: string) => s.endsWith('。')
const LABEL_END = /[。、．，.,！!？?]$/

/** 旧既定の昇格を明示して使う(normalizePhraseSets の既定は昇格しない) */
const upgradeLegacy = (input: unknown) => normalizePhraseSets(input, true)

function legacy(text: string): string {
  return text.replace(/。$/, '')
}

describe('Issue #46 EMERGENCY_MESSAGE は単一の正本', () => {
  it('句点つきの本文で、App.tsx は再定義せず phrases.ts から import している', () => {
    expect(EMERGENCY_MESSAGE).toBe('緊急です。来てください。')
    const app = read('App.tsx')
    expect(app).not.toMatch(/const\s+EMERGENCY_MESSAGE\s*=/)
    expect(app).toMatch(/import\s*\{\s*EMERGENCY_MESSAGE\s*\}\s*from\s*'\.\/lib\/phrases'/)
    // 「緊急です。来てください」の直書きはどこにも無い(phrases.ts の定義だけ)
    for (const file of ['App.tsx', 'PhraseEditor.tsx', 'lib/menus.ts', 'lib/guidance.ts']) {
      expect(read(file), file).not.toContain('緊急です。来てください')
    }
    expect(read('lib/phrases.ts').match(/緊急です。来てください/g)?.length).toBe(1)
  })
})

describe('Issue #46 normalizePhraseSets: 旧既定の昇格', () => {
  const allLegacy = Object.fromEntries(
    PHRASE_GROUPS.map((g) => [g, DEFAULT_PHRASES[g].map((p) => ({ ...p, text: legacy(p.text) }))]),
  )

  it('全グループの旧既定(句点なし)が、新既定へ昇格する(label/tone/idは保たれる)', () => {
    const result = upgradeLegacy(allLegacy)
    for (const g of PHRASE_GROUPS) expect(result[g]).toEqual(DEFAULT_PHRASES[g])
  })

  it('昇格しても label と tone は保存値のまま(label だけ書き換えた既定は label を保つ)', () => {
    const result = upgradeLegacy({
      discomfort: [{ id: 'suffering', label: 'つらい', text: '苦しいです', tone: 'urgent' }],
    })
    expect(result.discomfort).toEqual([
      { id: 'suffering', label: 'つらい', text: '苦しいです。', tone: 'urgent' },
    ])
  })

  it('既に新既定のものはそのまま', () => {
    const result = upgradeLegacy({ discomfort: DEFAULT_PHRASES.discomfort })
    expect(result.discomfort).toEqual(DEFAULT_PHRASES.discomfort)
  })

  it('書き換え済み(句点を除いても既定と違う)は据え置き', () => {
    const rewritten = [
      { id: 'suffering', label: '苦しい', text: '苦しいです、助けて' },
      { id: 'phlegm', label: '痰', text: '痰を取ってほしいです！' },
      { id: 'reposition', label: '向き', text: '' + '体の向きを変えたいです。。' },
      { id: 'toilet', label: 'トイレ', text: 'トイレ' },
    ]
    expect(upgradeLegacy({ discomfort: rewritten }).discomfort).toEqual(rewritten)
  })

  it('旧既定の文面でも、別グループの id なら不変(同グループ・同id の既定が無い)', () => {
    // 'hot' は discomfortOther の id。discomfort には無い
    const other = [{ id: 'hot', label: '暑い', text: '暑いです' }]
    expect(upgradeLegacy({ discomfort: other }).discomfort).toEqual(other)
    // 同じ id で別グループの既定文(discomfortOther の hot)を moodRequest に置いても不変
    const crossText = [{ id: 'fine', label: '大丈夫', text: '寒いです' }]
    expect(upgradeLegacy({ moodRequest: crossText }).moodRequest).toEqual(crossText)
  })

  it('未知 id(カスタム)は旧既定と同じ文面でも不変', () => {
    const custom = [
      { id: 'c1', label: '苦しい', text: '苦しいです' },
      { id: 'xyz', label: 'ありがとう', text: 'ありがとう' },
    ]
    expect(upgradeLegacy({ discomfort: custom }).discomfort).toEqual(custom)
  })

  it('別グループ・同 id の既定の文が別の文なら、自グループの既定とも違うので不変', () => {
    const edited = [{ id: 'head', label: '頭', text: '頭が痛いです' + '!' }]
    expect(upgradeLegacy({ painLocation: edited }).painLocation).toEqual(edited)
  })

  it('取り込みJSON(parseSettingsJson)経由でも同じに昇格し、書き換え済みは据え置き', () => {
    const json = JSON.stringify({
      app: 'libra',
      version: 1,
      phrases: {
        discomfort: [
          { id: 'suffering', label: '苦しい', text: '苦しいです', tone: 'urgent' },
          { id: 'toilet', label: 'トイレ', text: 'お手洗いに行きたい' },
        ],
      },
    })
    const parsed = parseSettingsJson(json, DEFAULT_SETTINGS)
    expect(parsed).not.toBeNull()
    expect(parsed!.phrases.discomfort).toEqual([
      { id: 'suffering', label: '苦しい', text: '苦しいです。', tone: 'urgent' },
      { id: 'toilet', label: 'トイレ', text: 'お手洗いに行きたい' },
    ])
  })

  it('冪等: 2回かけても1回と同じ', () => {
    const once = upgradeLegacy(allLegacy)
    expect(upgradeLegacy(once)).toEqual(once)
    const mixed = {
      discomfort: [
        { id: 'suffering', label: 'a', text: '苦しいです' },
        { id: 'zzz', label: 'b', text: '苦しいです' },
      ],
    }
    const m1 = upgradeLegacy(mixed)
    expect(upgradeLegacy(m1)).toEqual(m1)
  })

  it('空文字・非文字列・null/undefined・custom id が混ざっても落ちず、壊れた項目だけ捨てる', () => {
    const input = {
      discomfort: [
        null,
        undefined,
        42,
        'str',
        { id: 'suffering', label: 'x', text: '' },
        { id: 'phlegm', label: 'x', text: 5 },
        { id: 7, label: 'x', text: 'y' },
        { id: 'toilet', label: null, text: 'y' },
        { id: 'reposition', label: 'x', text: '体の向きを変えたいです' },
      ],
      moodRequest: undefined,
      feelings: null,
    }
    let result: ReturnType<typeof normalizePhraseSets> = {}
    expect(() => {
      result = upgradeLegacy(input)
    }).not.toThrow()
    expect(result.discomfort?.map((p) => p.id)).toEqual(['suffering', 'reposition'])
    expect(result.discomfort?.[0].text).toBe('') // 空文字は昇格しない
    expect(result.discomfort?.[1].text).toBe('体の向きを変えたいです。')
    expect(upgradeLegacy(undefined)).toEqual({})
  })
})

describe('Issue #46 composePainText', () => {
  const cases: [string, PainIntensity, string][] = [
    ['頭が痛いです。', 'very', '頭がとても痛いです。'],
    ['胸が痛いです。', 'little', '胸が少し痛いです。'],
    ['背中・腰が痛いです。', 'quite', '背中・腰がかなり痛いです。'],
    ['その他の場所が痛いです。', 'very', 'その他の場所がとても痛いです。'],
    // 「痛いです」を含まない: 句点つきは括弧を句点の前へ
    ['ずきずきします。', 'very', 'ずきずきします（とても）。'],
    ['痛い。', 'little', '痛い（少し）。'],
    // 句点なしは末尾に括弧
    ['ずきずきします', 'very', 'ずきずきします（とても）'],
    ['ずきずきします！', 'quite', 'ずきずきします！（かなり）'],
  ]
  it.each(cases)('%s × %s → %s', (text, intensity, expected) => {
    expect(composePainText(text, intensity)).toBe(expected)
  })

  it('句点つき文の出力に「。（」は現れない・句点は1つだけ末尾', () => {
    for (const i of ['little', 'quite', 'very'] as PainIntensity[]) {
      const out = composePainText('ずきずきします。', i)
      expect(out).not.toContain('。（')
      expect(out.match(/。/g)?.length).toBe(1)
      expect(out.endsWith('。')).toBe(true)
    }
  })

  it('既定の痛み場所は全て「痛いです。」を含み、強さ込みの文が句点で終わる', () => {
    for (const p of DEFAULT_PHRASES.painLocation) {
      const out = composePainText(p.text, 'very')
      expect(out).toContain('とても痛いです')
      expect(endsWithKuten(out)).toBe(true)
    }
  })
})

describe('Issue #46 phraseProblem', () => {
  const emergencyLike = [
    '緊急です来てください',
    '緊急です。来てください',
    '緊急です。来てください。',
    '緊急です、来てください',
    '緊急です 来てください',
    '緊急です　来てください',
    ' 緊急です。 来てください。　',
    '緊急です， 来てください．',
    '緊急です！来てください！',
    '緊急です.来てください.',
  ]
  it.each(emergencyLike)('緊急文と同一視して拒否: 「%s」', (text) => {
    expect(phraseProblem({ id: 'a', label: 'テスト', text })).toBe(
      '緊急の表示と同じ文は使えません。',
    )
  })

  it('通常文は許可され、句点の有無で結果が変わらない', () => {
    for (const text of ['苦しいです', '苦しいです。', '苦しいです、助けて', 'ありがとう。']) {
      expect(phraseProblem({ id: 'a', label: 'ラベル', text })).toBeNull()
    }
    for (const base of ['苦しいです', '来てください', '緊急です', '緊急です。来て']) {
      const a = phraseProblem({ id: 'a', label: 'L', text: base })
      const b = phraseProblem({ id: 'a', label: 'L', text: `${base}。` })
      expect(b).toBe(a)
    }
  })

  it('既定フレーズは全て問題なし', () => {
    for (const g of PHRASE_GROUPS) {
      for (const p of DEFAULT_PHRASES[g]) expect(phraseProblem(p), p.id).toBeNull()
    }
  })

  it('理由の文は句点で終わる', () => {
    const reasons = [
      phraseProblem({ id: 'a', label: '', text: 'x' }),
      phraseProblem({ id: 'a', label: 'x', text: ' ' }),
      phraseProblem({ id: 'a', label: 'はい', text: 'x' }),
      phraseProblem({ id: 'a', label: '緊急ボタン', text: 'x' }),
      phraseProblem({ id: 'a', label: 'x', text: EMERGENCY_MESSAGE }),
    ]
    for (const r of reasons) {
      expect(r).not.toBeNull()
      expect(endsWithKuten(r!)).toBe(true)
    }
  })
})

describe('Issue #46 文言の規則(静的検査)', () => {
  const baseSettings: ScreenNotesContext['settings'] & BehaviorNotesContext['settings'] = {
    ...DEFAULT_SETTINGS,
    minHoldMs: 800,
    activateOn: 'release',
    hapticsEnabled: true,
    auditoryScan: true,
    voiceMode: 'full',
  }
  const allNotes = (): string[] => {
    const out: string[] = []
    {
      for (const compact of [false, true]) {
        for (const emergencyActive of [false, true]) {
          for (const activateOn of ['press', 'release'] as const) {
            for (const minHoldMs of [0, 800]) {
              for (const canVibrate of [true, false]) {
                out.push(
                  ...buildScreenNotes({
                    emergencyActive,
                    vibrationAwaitsTouch: true,
                    canVibrate,
                    compact,
                    settings: baseSettings,
                  }),
                  ...buildBehaviorNotes({
                    settings: { ...baseSettings, activateOn, minHoldMs },
                  }),
                )
              }
            }
          }
        }
      }
    }
    for (const compact of [false, true]) {
      for (const morseEnabled of [false, true]) {
        out.push(...buildCaregiverMenuNotes(60000, { morseEnabled, compact }))
      }
    }
    return out
  }

  it('全画面の SCREEN_GUIDANCE が「。」で終わる(PATIENT_SCREEN_IDS を網羅)', () => {
    for (const id of PATIENT_SCREEN_IDS as readonly ScreenId[]) {
      expect(SCREEN_GUIDANCE[id], id).toBeTruthy()
      expect(endsWithKuten(SCREEN_GUIDANCE[id]), `${id}: ${SCREEN_GUIDANCE[id]}`).toBe(true)
    }
    for (const text of Object.values(SCREEN_GUIDANCE)) expect(endsWithKuten(text)).toBe(true)
  })

  it('guidance.ts の全行(通常/compact・全組み合わせ)が「。」で終わる', () => {
    const notes = allNotes()
    expect(notes.length).toBeGreaterThan(20)
    for (const n of notes) expect(endsWithKuten(n), n).toBe(true)
  })

  it('DEFAULT_PHRASES の text は「。」で終わり、label は句読点で終わらない', () => {
    let count = 0
    for (const g of PHRASE_GROUPS) {
      for (const p of DEFAULT_PHRASES[g]) {
        count += 1
        expect(endsWithKuten(p.text), `${g}/${p.id}: ${p.text}`).toBe(true)
        expect(LABEL_END.test(p.label), `${g}/${p.id}: ${p.label}`).toBe(false)
      }
    }
    expect(count).toBe(24)
  })

  it('メニュー項目の label・detail 以外のラベル(画面名・グループ名・パンくず・緊急詳細)に句読点がない', () => {
    const labels: string[] = []
    for (const screen of Object.keys(SCREEN_TITLES) as ScreenId[]) {
      for (const emergencyActive of [false, true]) {
        for (const item of buildMenu(screen, {
          showUndo: true,
          emergencyActive,
          morseEnabled: true,
          pain: { label: '胸', text: '胸が痛いです。' },
        })) {
          labels.push(item.label)
          if (item.preview) expect(item.preview.endsWith('。')).toBe(false)
        }
      }
      labels.push(SCREEN_TITLES[screen], ...buildScreenBreadcrumb(screen).map((item) => item.title))
    }
    labels.push(...Object.values(PHRASE_GROUP_LABELS), ...URGENT_DETAIL_ITEMS.map((i) => i.label))
    // タブ名・アクションラベル(App.tsx の CAREGIVER_TABS)
    const app = read('App.tsx')
    const tabs = app.match(/CAREGIVER_TABS = \[([\s\S]*?)\] as const/)?.[1] ?? ''
    for (const m of tabs.matchAll(/label: '([^']*)'/g)) labels.push(m[1])
    expect(labels.length).toBeGreaterThan(40)
    for (const l of labels) expect(LABEL_END.test(l), `ラベル「${l}」`).toBe(false)
  })

  it('伝達メッセージ(message アクションの text)は全て「。」で終わる(はい/いいえ/続けて等)', () => {
    const texts: string[] = []
    for (const screen of Object.keys(SCREEN_TITLES) as ScreenId[]) {
      for (const item of buildMenu(screen, { showUndo: false, emergencyActive: false })) {
        const a = item.action as { type: string; text?: string }
        if (a.type === 'message' && typeof a.text === 'string') texts.push(a.text)
      }
    }
    expect(texts).toEqual(expect.arrayContaining(['はい。', 'いいえ。', '続けてください。']))
    for (const t of texts) expect(endsWithKuten(t), t).toBe(true)
  })

  it('ソース全体に半角「...」と「？。」「。。」の重複がない', () => {
    for (const file of [
      'App.tsx',
      'PhraseEditor.tsx',
      'lib/menus.ts',
      'lib/phrases.ts',
      'lib/guidance.ts',
    ]) {
      const src = read(file)
      // コード中の spread(...)は除外し、日本語に続く「...」だけ見る
      expect(src, `${file} の半角三点`).not.toMatch(/[぀-ヿ一-鿿]\.\.\./)
      expect(src, `${file} の「？。」`).not.toContain('？。')
      expect(src, `${file} の「。。」`).not.toContain('。。')
    }
    for (const t of [...Object.values(SCREEN_GUIDANCE), ...allNotes()]) {
      expect(t).not.toContain('...')
      expect(t).not.toContain('？。')
      expect(t).not.toContain('。。')
    }
  })

  it('「項目名: 値」で値が語の行は句点なし、値が文の行だけ句点あり(スリープ防止の表示)', () => {
    const app = read('App.tsx')
    expect(app).toMatch(/active: '画面スリープ防止: 有効',/)
    const bad = [...app.matchAll(/'画面スリープ防止: 無効 — ([^']*)'/g)].map((m) => m[1])
    expect(bad.length).toBe(3)
    for (const b of bad) expect(b.endsWith('。')).toBe(true)
  })

  it('設定バックアップ/リセットの状態文(PhraseEditor)は全て句点で終わる', () => {
    const src = read('PhraseEditor.tsx')
    const statuses = [...src.matchAll(/setBackupStatus\(\s*'([^']*)'\s*,?\s*\)/g)].map((m) => m[1])
    expect(statuses.length).toBe(7)
    for (const s of statuses) expect(endsWithKuten(s), s).toBe(true)
  })
})
