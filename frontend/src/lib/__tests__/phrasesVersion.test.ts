// Issue #46: フレーズ保存値の「一度きり昇格」。設定の移行済みの印(phrasesVersion)で制御する。
//
// デシジョンテーブル(入力 × 期待)
//   入力                                           | 印(phrasesVersion)    | 期待
//   保存値(localStorage)・既定idの旧文(句点なし)    | 無い / 0              | 新既定(句点つき)へ昇格し、印=現行を付ける
//   保存値・既定idの句点なしの文                     | 現行(1)               | 据え置き(介助者が意図して消した文を戻さない)
//   保存値・既定idの句点なしの文                     | 将来(2)               | 据え置き
//   取り込みJSON(書き出し形式)・旧文                 | 無い                  | 昇格
//   取り込みJSON・句点なしの文                       | 現行                  | 据え置き
//   書き出し→取り込みの往復                          | 書き出しに印が入る    | 文面が変わらない
//   昇格後に保存して再読み込み                       | 現行                  | 再昇格しない(後から句点を消しても戻らない)
//   phrases を含まない保存値/取り込み                | 問わない              | 今のフレーズと印をそのまま保つ
//   正規化の再適用                                   | -                     | 冪等
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PHRASES, PHRASES_VERSION } from '../phrases'
import {
  DEFAULT_SETTINGS,
  exportSettingsJson,
  loadSettings,
  normalizeSettings,
  parseSettingsJson,
  saveSettings,
} from '../settings'

const LEGACY_HEAD = { id: 'head', label: '頭', text: '頭が痛いです' }
const NEW_HEAD_TEXT = DEFAULT_PHRASES.painLocation.find((p) => p.id === 'head')?.text

const headText = (s: { phrases: { painLocation?: { id: string; text: string }[] } }) =>
  s.phrases.painLocation?.find((p) => p.id === 'head')?.text

describe('Issue #46 phrasesVersion: 一度きりの昇格', () => {
  beforeEach(() => window.localStorage.clear())

  it('既定は現行の印を持つ(既定に戻す・新規保存でも印が付く)', () => {
    expect(PHRASES_VERSION).toBe(1)
    expect(DEFAULT_SETTINGS.phrasesVersion).toBe(PHRASES_VERSION)
    expect(loadSettings().phrasesVersion).toBe(PHRASES_VERSION)
  })

  it('印が無い保存値の旧既定は昇格し、印が付く', () => {
    const s = normalizeSettings({ phrases: { painLocation: [LEGACY_HEAD] } })
    expect(headText(s)).toBe(NEW_HEAD_TEXT)
    expect(s.phrasesVersion).toBe(PHRASES_VERSION)
  })

  it('印が 0(古い)でも昇格する', () => {
    const s = normalizeSettings({ phrasesVersion: 0, phrases: { painLocation: [LEGACY_HEAD] } })
    expect(headText(s)).toBe(NEW_HEAD_TEXT)
  })

  it('印が現行なら、既定idの句点なしの文は据え置き(意図して消した文を戻さない)', () => {
    const s = normalizeSettings({
      phrasesVersion: PHRASES_VERSION,
      phrases: { painLocation: [LEGACY_HEAD] },
    })
    expect(headText(s)).toBe('頭が痛いです')
    expect(s.phrasesVersion).toBe(PHRASES_VERSION)
  })

  it('印が将来の版でも据え置き(新しい版のデータを壊さない)', () => {
    const s = normalizeSettings({ phrasesVersion: 2, phrases: { painLocation: [LEGACY_HEAD] } })
    expect(headText(s)).toBe('頭が痛いです')
    expect(s.phrasesVersion).toBe(2) // 印を現行(1)へ書き戻さない
  })

  it('印が数値でない(壊れた値)は印なしとして昇格する', () => {
    const s = normalizeSettings({ phrasesVersion: '1', phrases: { painLocation: [LEGACY_HEAD] } })
    expect(headText(s)).toBe(NEW_HEAD_TEXT)
  })

  it('印が無くても、書き換えた文・カスタム id は昇格しない', () => {
    const s = normalizeSettings({
      phrases: {
        painLocation: [
          { id: 'head', label: '頭', text: '頭がずきずきします' },
          { id: 'custom-1', label: 'x', text: '頭が痛いです' },
        ],
      },
    })
    expect(s.phrases.painLocation?.map((p) => p.text)).toEqual([
      '頭がずきずきします',
      '頭が痛いです',
    ])
  })

  it('昇格→保存→再起動: 介助者が句点を消して保存しても、次の起動で戻らない', () => {
    // 1) 印の無い旧保存値を起動時に読む(昇格される)
    window.localStorage.setItem(
      'libra',
      JSON.stringify({ phrases: { painLocation: [LEGACY_HEAD] } }),
    )
    const first = loadSettings()
    expect(headText(first)).toBe(NEW_HEAD_TEXT)
    // 2) 介助者が既定idの文から句点を消して保存する(印は保たれる)
    saveSettings({
      ...first,
      phrases: {
        painLocation: [{ ...first.phrases.painLocation![0], text: '頭が痛いです' }],
      },
    })
    // 3) 再起動しても戻らない。さらに何度読んでも同じ
    expect(headText(loadSettings())).toBe('頭が痛いです')
    expect(headText(loadSettings())).toBe('頭が痛いです')
  })

  it('昇格しただけで保存しなくても、再起動の結果は変わらない(冪等)', () => {
    window.localStorage.setItem(
      'libra',
      JSON.stringify({ phrases: { painLocation: [LEGACY_HEAD] } }),
    )
    expect(loadSettings()).toEqual(loadSettings())
  })

  it('正規化の再適用は冪等(昇格後の値は印つきなので変わらない)', () => {
    const once = normalizeSettings({ phrases: { painLocation: [LEGACY_HEAD] } })
    expect(normalizeSettings(once)).toEqual(once)
    expect(normalizeSettings(JSON.parse(JSON.stringify(once)))).toEqual(once)
  })

  it('phrases を含まない保存値・取り込みは、今のフレーズと印を保つ', () => {
    const base = normalizeSettings({
      phrasesVersion: PHRASES_VERSION,
      phrases: { painLocation: [LEGACY_HEAD] },
    })
    const next = normalizeSettings({ intervalMs: 2000 }, base)
    expect(headText(next)).toBe('頭が痛いです')
    expect(next.phrasesVersion).toBe(PHRASES_VERSION)
  })

  describe('取り込みJSON(parseSettingsJson)', () => {
    const importJson = (extra: Record<string, unknown>) =>
      JSON.stringify({ app: 'libra', version: 1, ...extra })

    it('印の無い(句点導入前に書き出した)JSON は昇格する', () => {
      const s = parseSettingsJson(importJson({ phrases: { painLocation: [LEGACY_HEAD] } }))
      expect(headText(s!)).toBe(NEW_HEAD_TEXT)
      expect(s!.phrasesVersion).toBe(PHRASES_VERSION)
    })

    it('印が現行の JSON は、句点なしの既定idの文も据え置く', () => {
      const s = parseSettingsJson(
        importJson({ phrasesVersion: PHRASES_VERSION, phrases: { painLocation: [LEGACY_HEAD] } }),
      )
      expect(headText(s!)).toBe('頭が痛いです')
    })

    it('将来の版の印(2)の JSON を取り込んでも、印は 1 に書き戻されず据え置く', () => {
      const s = parseSettingsJson(
        importJson({ phrasesVersion: 2, phrases: { painLocation: [LEGACY_HEAD] } }),
      )
      expect(s!.phrasesVersion).toBe(2)
      expect(headText(s!)).toBe('頭が痛いです')
      // 保存→再読み込みでも印は2のまま
      saveSettings(s!)
      expect(loadSettings().phrasesVersion).toBe(2)
    })

    it('書き出しに印が入り、書き出し→取り込みの往復で文面も印も変わらない', () => {
      const edited = normalizeSettings({
        phrasesVersion: PHRASES_VERSION,
        phrases: { painLocation: [LEGACY_HEAD] },
      })
      const json = exportSettingsJson(edited)
      expect(JSON.parse(json).phrasesVersion).toBe(PHRASES_VERSION)
      const back = parseSettingsJson(json)
      expect(back).toEqual(edited)
      expect(headText(back!)).toBe('頭が痛いです')
    })

    it('既定のままの設定を書き出し→取り込みしても印が付いたまま', () => {
      const back = parseSettingsJson(exportSettingsJson(DEFAULT_SETTINGS))
      expect(back).toEqual(DEFAULT_SETTINGS)
    })

    it('取り込みが phrases を含まないとき、今の印とフレーズを残す', () => {
      const base = normalizeSettings({
        phrasesVersion: PHRASES_VERSION,
        phrases: { painLocation: [LEGACY_HEAD] },
      })
      const s = parseSettingsJson(importJson({ intervalMs: 2500 }), base)
      expect(headText(s!)).toBe('頭が痛いです')
      expect(s!.phrasesVersion).toBe(PHRASES_VERSION)
    })
  })
})
