import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTINGS_SECTION_KEYS,
  exportSettingsJson,
  loadSettings,
  normalizeSettings,
  parseSettingsJson,
  resetSettingsSection,
  saveSettings,
  type Settings,
  type SettingsSection,
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
    it('既定は 4/3(間隔 1.5 秒で 2.0 秒。Issue #92)。保存済みの 2 はそのまま尊重する', () => {
      expect(DEFAULT_SETTINGS.headHoldMultiplier).toBe(4 / 3)
      expect(Math.round(DEFAULT_SETTINGS.intervalMs * DEFAULT_SETTINGS.headHoldMultiplier)).toBe(
        2000,
      )
      expect(normalizeSettings({ headHoldMultiplier: 2 }).headHoldMultiplier).toBe(2)
    })
    it('書き出し JSON の往復で 4/3 が変わらない', () => {
      const json = exportSettingsJson(DEFAULT_SETTINGS)
      const parsed = parseSettingsJson(json, DEFAULT_SETTINGS)
      expect(parsed?.headHoldMultiplier).toBe(4 / 3)
      expect(exportSettingsJson(parsed as typeof DEFAULT_SETTINGS)).toBe(json)
    })
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

  describe('debounceMs の範囲(100〜3000。Issue #164)', () => {
    it.each([-1, 0, 1, 50, 99])('下限未満の数値(%d)は下限の 100 にする', (value) => {
      expect(normalizeSettings({ debounceMs: value }).debounceMs).toBe(100)
    })
    it.each([100, 101])('下限以上(%d)はそのまま通過する', (value) => {
      expect(normalizeSettings({ debounceMs: value }).debounceMs).toBe(value)
    })
    it.each(['0', null, Number.NaN, Number.NEGATIVE_INFINITY])(
      '数値でない値・有限でない値(%s)は既定値にフォールバックする',
      (value) => {
        expect(normalizeSettings({ debounceMs: value }).debounceMs).toBe(DEFAULT_SETTINGS.debounceMs)
      },
    )
    it('既定値は 500 のまま', () => {
      expect(DEFAULT_SETTINGS.debounceMs).toBe(500)
    })
    it('保存値の 0 は読み込むと 100 になる', () => {
      window.localStorage.setItem('libra', JSON.stringify({ debounceMs: 0 }))
      expect(loadSettings().debounceMs).toBe(100)
    })
    it('取り込みの 0.1 秒未満は、今の値に関わらず 100 になる', () => {
      const text = JSON.stringify({ app: 'libra', version: 1, debounceMs: 0 })
      expect(parseSettingsJson(text, { ...DEFAULT_SETTINGS, debounceMs: 1200 })?.debounceMs).toBe(100)
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

// Issue #117: タブごとの「初期値に戻す」。戻す対象は SETTINGS_SECTION_KEYS が正本。
//
// 観点
//   分割性     | 全ての設定キーが、ちょうど 1 つのまとまりに属する(漏れると「どのタブでも戻せない設定」、重複すると「別のタブの設定まで戻る」)
//   まとまり   | 介助者用メニューのタブと同じ 5 つ(scan / input / feedback / display / phrases)。端末の状態・データ・このアプリは持たない
//   戻す範囲   | 指定したまとまりのキーだけが初期値になり、ほかは 1 つも変わらない
//   副作用なし | 渡した設定オブジェクトを書き換えない・保存しない
describe('Issue #117: resetSettingsSection(タブごとに初期値へ戻す)', () => {
  // 全キーを初期値と違う値にした設定(どのキーが戻ったかを判別できる)
  const customized: Settings = {
    intervalMs: 3000,
    headHoldMultiplier: 4,
    debounceMs: 1500,
    minHoldMs: 700,
    activateOn: 'release',
    auditoryScan: true,
    morseEnabled: true,
    morseDashMs: 900,
    morseLetterGapMs: 2500,
    morseWordGapMs: 7000,
    voiceMode: 'full',
    hapticsEnabled: false,
    hapticsStrength: 'strong',
    hapticSoundWhenVoiceOff: true,
    hapticSoundAlso: true,
    fontSize: 'xlarge',
    theme: 'dark',
    highContrast: true,
    phrases: { moodRequest: [{ id: 'x', label: 'えっくす', text: 'えっくす。' }] },
    phrasesVersion: 0,
  }
  const SECTIONS = Object.keys(SETTINGS_SECTION_KEYS) as SettingsSection[]
  const ALL_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]

  it('前提: 検査用の設定は、全キーが初期値と違う', () => {
    for (const key of ALL_KEYS) {
      expect(customized[key], key).not.toEqual(DEFAULT_SETTINGS[key])
    }
  })

  it('まとまりは、初期値に戻せる 5 つのタブと同じ', () => {
    expect(SECTIONS).toEqual(['scan', 'input', 'feedback', 'display', 'phrases'])
  })

  it('全ての設定キーが、ちょうど 1 つのまとまりに属する(漏れ・重複なし)', () => {
    const listed = SECTIONS.flatMap((section) => [...SETTINGS_SECTION_KEYS[section]])
    expect([...listed].sort()).toEqual([...ALL_KEYS].sort())
    expect(new Set(listed).size).toBe(listed.length)
  })

  it('各まとまりのキーは、仕様(requirements.md §6)の対象と一致する', () => {
    expect([...SETTINGS_SECTION_KEYS.scan].sort()).toEqual(
      [
        'intervalMs',
        'headHoldMultiplier',
        'debounceMs',
        'minHoldMs',
        'activateOn',
        'auditoryScan',
      ].sort(),
    )
    expect([...SETTINGS_SECTION_KEYS.input].sort()).toEqual(
      ['morseEnabled', 'morseDashMs', 'morseLetterGapMs', 'morseWordGapMs'].sort(),
    )
    expect([...SETTINGS_SECTION_KEYS.feedback].sort()).toEqual(
      [
        'voiceMode',
        'hapticsEnabled',
        'hapticsStrength',
        'hapticSoundWhenVoiceOff',
        'hapticSoundAlso',
      ].sort(),
    )
    expect([...SETTINGS_SECTION_KEYS.display].sort()).toEqual(
      ['fontSize', 'theme', 'highContrast'].sort(),
    )
    expect([...SETTINGS_SECTION_KEYS.phrases].sort()).toEqual(['phrases', 'phrasesVersion'].sort())
  })

  it.each(['scan', 'input', 'feedback', 'display', 'phrases'] as const)(
    '%s: そのまとまりのキーだけが初期値に戻り、ほかのキーは 1 つも変わらない',
    (section) => {
      const result = resetSettingsSection(customized, section)
      const own = new Set<keyof Settings>(SETTINGS_SECTION_KEYS[section])
      for (const key of ALL_KEYS) {
        if (own.has(key))
          expect(result[key], `${key} は初期値に戻る`).toEqual(DEFAULT_SETTINGS[key])
        else expect(result[key], `${key} は変わらない`).toEqual(customized[key])
      }
    },
  )

  it('渡した設定を書き換えず、新しいオブジェクトを返す', () => {
    const before = JSON.parse(JSON.stringify(customized))
    const result = resetSettingsSection(customized, 'scan')
    expect(result).not.toBe(customized)
    expect(customized).toEqual(before)
  })

  it('保存はしない(保存は呼び出し側の責務)', () => {
    localStorage.removeItem('libra')
    resetSettingsSection(customized, 'display')
    expect(localStorage.getItem('libra')).toBeNull()
  })

  it('全部のまとまりを順に戻すと、初期値と同じになる', () => {
    const result = SECTIONS.reduce(
      (settings, section) => resetSettingsSection(settings, section),
      customized,
    )
    expect(result).toEqual(DEFAULT_SETTINGS)
  })

  it('初期値のままの設定に実行しても変わらない(冪等)', () => {
    for (const section of SECTIONS) {
      expect(resetSettingsSection(DEFAULT_SETTINGS, section)).toEqual(DEFAULT_SETTINGS)
    }
  })

  it('戻したあとの設定は、正規化しても変わらない(範囲・不変条件を満たす)', () => {
    for (const section of SECTIONS) {
      const result = resetSettingsSection(customized, section)
      // phrasesVersion が古い保存値は読み込み時に昇格されるので、フレーズ以外のまとまりでは対象外にする
      const { phrases: _p, phrasesVersion: _v, ...rest } = normalizeSettings(result)
      const { phrases: _p2, phrasesVersion: _v2, ...expected } = result
      expect(rest, section).toEqual(expected)
    }
  })

  it('モールスだけ戻しても、語の区切りは文字の確定より 0.5 秒以上長い', () => {
    const result = resetSettingsSection(customized, 'input')
    expect(result.morseWordGapMs).toBeGreaterThanOrEqual(result.morseLetterGapMs + 500)
  })
})
