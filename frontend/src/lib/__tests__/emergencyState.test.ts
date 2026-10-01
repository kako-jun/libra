import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  EMERGENCY_RESTORE_TTL_MS,
  clearSavedEmergency,
  loadEmergency,
  saveEmergency,
} from '../emergencyState'

describe('emergencyState', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('保存がなければ null', () => {
    expect(loadEmergency()).toBeNull()
  })

  it('保存した緊急を読める', () => {
    saveEmergency({ since: 1000, details: ['苦しい'] })
    expect(loadEmergency(2000)).toEqual({ since: 1000, details: ['苦しい'] })
  })

  it('解除すると読めなくなる', () => {
    saveEmergency({ since: 1000, details: [] })
    clearSavedEmergency()
    expect(loadEmergency(2000)).toBeNull()
  })

  it('期限切れは復元せず保存も消す', () => {
    saveEmergency({ since: 0, details: [] })
    expect(loadEmergency(EMERGENCY_RESTORE_TTL_MS + 1)).toBeNull()
    expect(window.localStorage.getItem('libra-emergency')).toBeNull()
  })

  it('壊れた値は null', () => {
    window.localStorage.setItem('libra-emergency', '{not json')
    expect(loadEmergency()).toBeNull()
    window.localStorage.setItem('libra-emergency', JSON.stringify({ since: 'x' }))
    expect(loadEmergency()).toBeNull()
  })

  it('details の不正な要素は捨てる', () => {
    window.localStorage.setItem(
      'libra-emergency',
      JSON.stringify({ since: 1000, details: ['痛い', 5, null] }),
    )
    expect(loadEmergency(2000)?.details).toEqual(['痛い'])
  })
})
