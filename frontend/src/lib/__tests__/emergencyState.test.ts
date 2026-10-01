import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EMERGENCY_STORAGE_KEY,
  clearEmergencyState,
  loadEmergencyState,
  normalizeEmergencyState,
  saveEmergencyState,
} from '../emergencyState'

describe('emergencyState', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('保存→読み出しで復元でき、解除で消える', () => {
    saveEmergencyState({ details: ['苦しい'], sub: 'はい' })
    expect(loadEmergencyState()).toEqual({ active: true, details: ['苦しい'], sub: 'はい' })
    clearEmergencyState()
    expect(loadEmergencyState()).toBeNull()
  })

  it('不正 JSON・型違いは null で例外を出さない', () => {
    window.localStorage.setItem(EMERGENCY_STORAGE_KEY, '{broken')
    expect(loadEmergencyState()).toBeNull()
    expect(normalizeEmergencyState({ active: 'yes' })).toBeNull()
    expect(normalizeEmergencyState(null)).toBeNull()
    expect(
      normalizeEmergencyState({ active: true, details: [1, '痛い', '痛い', 'ふめい'], sub: 3 }),
    ).toEqual({
      active: true,
      details: ['痛い'],
      sub: null,
    })
  })

  it('details は緊急詳細の既知ラベルだけ残し、未知の文字列は捨てる', () => {
    expect(
      normalizeEmergencyState({
        active: true,
        details: ['苦しい', '<script>', '', '胸が痛い', '息ができない', 'はい'],
        sub: null,
      })?.details,
    ).toEqual(['苦しい', '胸が痛い', '息ができない'])
  })

  it('保存形式は libra:emergency に {active:true, details, sub} で、設定キー libra とは別', () => {
    saveEmergencyState({ details: ['痛い'], sub: null })
    expect(EMERGENCY_STORAGE_KEY).toBe('libra:emergency')
    expect(JSON.parse(window.localStorage.getItem('libra:emergency') as string)).toEqual({
      active: true,
      details: ['痛い'],
      sub: null,
    })
    expect(window.localStorage.getItem('libra')).toBeNull()
  })

  it('空・object でない JSON・active が true 以外は通常起動、details が配列でなければ空に丸める', () => {
    expect(loadEmergencyState()).toBeNull()
    for (const v of ['[]', '"x"', '123', 'null', '{"active":false}', '{"active":"true"}', '{}']) {
      window.localStorage.setItem(EMERGENCY_STORAGE_KEY, v)
      expect(loadEmergencyState()).toBeNull()
    }
    window.localStorage.setItem(EMERGENCY_STORAGE_KEY, '{"active":true,"details":"x","sub":"はい"}')
    expect(loadEmergencyState()).toEqual({ active: true, details: [], sub: 'はい' })
  })

  it('localStorage の get/set/remove が例外を投げても握りつぶす', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(loadEmergencyState()).toBeNull()
    expect(() => saveEmergencyState({ details: [], sub: null })).not.toThrow()
    expect(() => clearEmergencyState()).not.toThrow()
  })

  it('複数回保存しても最新の内容だけが残り、解除の二重実行も安全', () => {
    saveEmergencyState({ details: ['苦しい'], sub: null })
    saveEmergencyState({ details: ['苦しい', '痛い'], sub: 'はい' })
    expect(loadEmergencyState()).toEqual({
      active: true,
      details: ['苦しい', '痛い'],
      sub: 'はい',
    })
    clearEmergencyState()
    expect(() => clearEmergencyState()).not.toThrow()
    expect(loadEmergencyState()).toBeNull()
  })
})
