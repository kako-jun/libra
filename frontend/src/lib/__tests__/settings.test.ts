import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  exportSettingsJson,
  loadSettings,
  normalizeSettings,
  parseSettingsJson,
  saveSettings,
} from '../settings'

describe('normalizeSettings', () => {
  it('すべて正常値なら変更せず通過する', () => {
    const input = {
      intervalMs: 2000,
      headHoldMultiplier: 3,
      debounceMs: 1000,
      minHoldMs: 500,
      activateOn: 'release',
      auditoryScan: true,
      voiceMode: 'short',
      fontSize: 'large',
      highContrast: true,
      theme: 'dark',
      phrases: {},
      phrasesVersion: 1,
      hapticsEnabled: false,
      hapticsStrength: 'strong',
      hapticSoundWhenVoiceOff: true,
      hapticSoundAlso: true,
      morseEnabled: true,
      morseDashMs: 600,
      morseLetterGapMs: 1200,
      morseWordGapMs: 3000,
    }
    expect(normalizeSettings(input)).toEqual(input)
  })

  describe('intervalMs の範囲(500〜5000)', () => {
    it('下限-1(499)は既定値にフォールバックする', () => {
      expect(normalizeSettings({ intervalMs: 499 }).intervalMs).toBe(DEFAULT_SETTINGS.intervalMs)
    })
    it('下限(500)はそのまま通過する', () => {
      expect(normalizeSettings({ intervalMs: 500 }).intervalMs).toBe(500)
    })
    it('上限(5000)はそのまま通過する', () => {
      expect(normalizeSettings({ intervalMs: 5000 }).intervalMs).toBe(5000)
    })
    it('上限+1(5001)は既定値にフォールバックする', () => {
      expect(normalizeSettings({ intervalMs: 5001 }).intervalMs).toBe(DEFAULT_SETTINGS.intervalMs)
    })
  })

  describe('headHoldMultiplier の範囲(1〜5)', () => {
    it('下限-1(0)は既定値にフォールバックする', () => {
      expect(normalizeSettings({ headHoldMultiplier: 0 }).headHoldMultiplier).toBe(
        DEFAULT_SETTINGS.headHoldMultiplier,
      )
    })
    it('下限(1)はそのまま通過する', () => {
      expect(normalizeSettings({ headHoldMultiplier: 1 }).headHoldMultiplier).toBe(1)
    })
    it('上限(5)はそのまま通過する', () => {
      expect(normalizeSettings({ headHoldMultiplier: 5 }).headHoldMultiplier).toBe(5)
    })
    it('上限+1(6)は既定値にフォールバックする', () => {
      expect(normalizeSettings({ headHoldMultiplier: 6 }).headHoldMultiplier).toBe(
        DEFAULT_SETTINGS.headHoldMultiplier,
      )
    })
  })

  describe('debounceMs の範囲(0〜3000)', () => {
    it('下限-1(-1)は既定値にフォールバックする', () => {
      expect(normalizeSettings({ debounceMs: -1 }).debounceMs).toBe(DEFAULT_SETTINGS.debounceMs)
    })
    it('下限(0)はそのまま通過する', () => {
      expect(normalizeSettings({ debounceMs: 0 }).debounceMs).toBe(0)
    })
    it('上限(3000)はそのまま通過する', () => {
      expect(normalizeSettings({ debounceMs: 3000 }).debounceMs).toBe(3000)
    })
    it('上限+1(3001)は既定値にフォールバックする', () => {
      expect(normalizeSettings({ debounceMs: 3001 }).debounceMs).toBe(DEFAULT_SETTINGS.debounceMs)
    })
  })

  it('数値設定が文字列型なら既定値にフォールバックする', () => {
    expect(normalizeSettings({ intervalMs: '2000' }).intervalMs).toBe(DEFAULT_SETTINGS.intervalMs)
  })

  it('数値設定が NaN なら既定値にフォールバックする', () => {
    expect(normalizeSettings({ intervalMs: NaN }).intervalMs).toBe(DEFAULT_SETTINGS.intervalMs)
  })

  it('数値設定が Infinity なら既定値にフォールバックする', () => {
    expect(normalizeSettings({ intervalMs: Infinity }).intervalMs).toBe(DEFAULT_SETTINGS.intervalMs)
  })

  it('auditoryScan が boolean 以外なら既定値にフォールバックする', () => {
    expect(normalizeSettings({ auditoryScan: 'true' }).auditoryScan).toBe(
      DEFAULT_SETTINGS.auditoryScan,
    )
  })

  it('fontSize が既知の値(large)ならそのまま通過する', () => {
    expect(normalizeSettings({ fontSize: 'large' }).fontSize).toBe('large')
  })

  it('fontSize が既知の値(xlarge)ならそのまま通過する', () => {
    expect(normalizeSettings({ fontSize: 'xlarge' }).fontSize).toBe('xlarge')
  })

  it('fontSize が未知の値なら既定値にフォールバックする', () => {
    expect(normalizeSettings({ fontSize: 'huge' }).fontSize).toBe(DEFAULT_SETTINGS.fontSize)
  })

  it('highContrast が boolean 以外なら既定値にフォールバックする', () => {
    expect(normalizeSettings({ highContrast: 'true' }).highContrast).toBe(
      DEFAULT_SETTINGS.highContrast,
    )
  })

  it('highContrast が true ならそのまま通過する', () => {
    expect(normalizeSettings({ highContrast: true }).highContrast).toBe(true)
  })

  it('theme が既知の値(light)ならそのまま通過する', () => {
    expect(normalizeSettings({ theme: 'light' }).theme).toBe('light')
  })

  it('theme が既知の値(dark)ならそのまま通過する', () => {
    expect(normalizeSettings({ theme: 'dark' }).theme).toBe('dark')
  })

  it('theme が既知の値(auto)ならそのまま通過する', () => {
    expect(normalizeSettings({ theme: 'auto' }).theme).toBe('auto')
  })

  it('theme が未知の値なら既定値(auto)にフォールバックする', () => {
    expect(normalizeSettings({ theme: 'sepia' }).theme).toBe(DEFAULT_SETTINGS.theme)
  })

  it('voiceMode が未知の値なら既定値にフォールバックする', () => {
    expect(normalizeSettings({ voiceMode: 'yell' }).voiceMode).toBe(DEFAULT_SETTINGS.voiceMode)
  })

  it('フィールドが欠損していれば既定値で埋める', () => {
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('入力が null なら全項目既定値になる', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
  })

  it('入力が undefined なら全項目既定値になる', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })

  it('入力が配列でも例外を出さず既定値になる', () => {
    expect(normalizeSettings([1, 2, 3])).toEqual(DEFAULT_SETTINGS)
  })

  it('入力が文字列でも例外を出さず既定値になる', () => {
    expect(normalizeSettings('not-an-object')).toEqual(DEFAULT_SETTINGS)
  })
})

describe('loadSettings', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('未保存(キーなし)のときは既定値を返す', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('壊れた JSON が保存されているときは既定値を返す', () => {
    window.localStorage.setItem('libra', '{not-json')
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it('getItem が例外を投げるときは既定値を返す', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('boom')
    })
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS)
  })
})

describe('saveSettings', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('setItem が例外を投げても外へ伝播しない', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    expect(() => saveSettings(DEFAULT_SETTINGS)).not.toThrow()
  })

  it('Issue #6: 押下時間の下限・決定タイミングを検証して丸める', () => {
    expect(normalizeSettings({}).minHoldMs).toBe(0)
    expect(normalizeSettings({}).activateOn).toBe('press')
    expect(normalizeSettings({ minHoldMs: 500, activateOn: 'release' })).toMatchObject({
      minHoldMs: 500,
      activateOn: 'release',
    })
    expect(normalizeSettings({ minHoldMs: 9999, activateOn: 'x' })).toMatchObject({
      minHoldMs: 0,
      activateOn: 'press',
    })
  })

  describe('Issue #8: フレーズの保存と書き出し・取り込み', () => {
    it('フレーズを保存して再読み込みで保持する', () => {
      const phrases = {
        moodRequest: [{ id: 'custom-1', label: 'テレビ', text: 'テレビを見たいです' }],
      }
      saveSettings({ ...DEFAULT_SETTINGS, phrases })
      expect(loadSettings().phrases).toEqual(phrases)
    })

    it('書き出した JSON を取り込むと同じ設定に戻る', () => {
      const settings = {
        ...DEFAULT_SETTINGS,
        intervalMs: 2500,
        phrases: { painLocation: [{ id: 'custom-1', label: '首', text: '首が痛いです' }] },
      }
      expect(parseSettingsJson(exportSettingsJson(settings))).toEqual(settings)
    })

    it('壊れた JSON・オブジェクトでない値は null(今の設定を変えない)', () => {
      expect(parseSettingsJson('{not json')).toBeNull()
      expect(parseSettingsJson('[1,2]')).toBeNull()
      expect(parseSettingsJson('"x"')).toBeNull()
      expect(parseSettingsJson('null')).toBeNull()
    })

    it('書き出しに識別子が無い・合わない JSON は取り込まない(他アプリの JSON・{} など)', () => {
      expect(parseSettingsJson('{}')).toBeNull()
      expect(parseSettingsJson(JSON.stringify({ intervalMs: 2000 }))).toBeNull()
      expect(parseSettingsJson(JSON.stringify({ app: 'other', version: 1 }))).toBeNull()
      expect(parseSettingsJson(JSON.stringify({ app: 'libra', version: 99 }))).toBeNull()
    })

    it('取り込みは今の設定を土台にし、欠けた・範囲外の項目は今の値のまま残す', () => {
      const current = {
        ...DEFAULT_SETTINGS,
        intervalMs: 3000,
        debounceMs: 1200,
        phrases: { painLocation: [{ id: 'c1', label: '首', text: '首が痛いです' }] },
      }
      const next = parseSettingsJson(
        JSON.stringify({ app: 'libra', version: 1, headHoldMultiplier: 4, intervalMs: 99999 }),
        current,
      )
      expect(next?.headHoldMultiplier).toBe(4) // 取り込んだ値
      expect(next?.intervalMs).toBe(3000) // 範囲外は今の値
      expect(next?.debounceMs).toBe(1200) // 無い項目は今の値
      expect(next?.phrases).toEqual(current.phrases) // フレーズが無ければ今のフレーズを残す
    })

    it('書き出しの phrases があればそれで置き換える', () => {
      const current = {
        ...DEFAULT_SETTINGS,
        phrases: { painLocation: [{ id: 'c1', label: '首', text: '首が痛いです' }] },
      }
      const next = parseSettingsJson(
        JSON.stringify({
          app: 'libra',
          version: 1,
          phrases: { moodRequest: [{ id: 'c2', label: 'テレビ', text: 'テレビ' }] },
        }),
        current,
      )
      expect(Object.keys(next?.phrases ?? {})).toEqual(['moodRequest'])
    })
  })

  describe('Issue #13: 触覚フィードバック設定', () => {
    it('既定は ON・標準・音声OFFでは効果音なしで、型違いは既定値に戻す', () => {
      expect(normalizeSettings({})).toMatchObject({
        hapticsEnabled: true,
        hapticsStrength: 'standard',
        hapticSoundWhenVoiceOff: false,
      })
      expect(
        normalizeSettings({
          hapticsEnabled: 'x',
          hapticsStrength: 'huge',
          hapticSoundWhenVoiceOff: 1,
        }),
      ).toMatchObject({
        hapticsEnabled: true,
        hapticsStrength: 'standard',
        hapticSoundWhenVoiceOff: false,
      })
    })
  })

  describe('Issue #14: モールス設定', () => {
    it('既定は OFF で、範囲外・型違いは既定値に戻す', () => {
      const d = normalizeSettings({})
      expect(d).toMatchObject({
        morseEnabled: false,
        morseDashMs: 500,
        morseLetterGapMs: 1500,
        morseWordGapMs: 4000,
      })
      const bad = normalizeSettings({
        morseEnabled: 'yes',
        morseDashMs: 10,
        morseLetterGapMs: 99999,
        morseWordGapMs: -1,
      })
      expect(bad).toMatchObject({
        morseEnabled: false,
        morseDashMs: 500,
        morseLetterGapMs: 1500,
        morseWordGapMs: 4000,
      })
    })

    it('語の区切りは文字の確定より常に 0.5 秒以上長くなる(保存値で保証)', () => {
      const n = normalizeSettings({ morseLetterGapMs: 3000, morseWordGapMs: 1500 })
      expect(n.morseLetterGapMs).toBe(3000)
      expect(n.morseWordGapMs).toBe(3500)
      const ok = normalizeSettings({ morseLetterGapMs: 1000, morseWordGapMs: 4000 })
      expect(ok.morseWordGapMs).toBe(4000)
    })
  })
})

describe('#77: 旧い tone(positive / calm)を含む設定', () => {
  const legacy = {
    moodRequest: [
      { id: 'a', label: 'あ', text: 'あ。', tone: 'positive' },
      { id: 'b', label: 'い', text: 'い。', tone: 'calm' },
    ],
  }

  it('書き出し JSON の取り込みは失敗せず、tone は neutral(なし)になる', () => {
    const text = JSON.stringify({ app: 'libra', version: 1, phrases: legacy })
    const result = parseSettingsJson(text)
    expect(result).not.toBeNull()
    expect(result?.phrases.moodRequest?.map((p) => p.tone)).toEqual([undefined, undefined])
  })

  it('localStorage の旧い保存値も読み込めて neutral になる', () => {
    localStorage.setItem('libra', JSON.stringify({ phrases: legacy }))
    const loaded = loadSettings()
    expect(loaded.phrases.moodRequest).toHaveLength(2)
    expect(loaded.phrases.moodRequest?.every((p) => p.tone === undefined)).toBe(true)
  })
})
