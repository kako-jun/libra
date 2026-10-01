import { beforeEach, describe, expect, it } from 'vitest'
import {
  EMERGENCY_STORAGE_KEY,
  clearEmergencyState,
  loadEmergencyState,
  normalizeEmergencyState,
  saveEmergencyState,
} from '../emergencyState'

describe('emergencyState', () => {
  beforeEach(() => window.localStorage.clear())

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
    expect(normalizeEmergencyState({ active: true, details: [1, '痛い', '痛い'], sub: 3 })).toEqual(
      {
        active: true,
        details: ['痛い'],
        sub: null,
      },
    )
  })
})
