import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../settings'

describe('normalizeSettings', () => {
  it('すべて正常値なら変更せず通過する', () => {
    const input = {
      intervalMs: 2000,
      headHoldMultiplier: 3,
      debounceMs: 1000,
      auditoryScan: true,
      voiceMode: 'short',
      fontSize: 'large',
      highContrast: true,
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
})
