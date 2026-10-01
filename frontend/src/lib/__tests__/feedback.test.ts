import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as alarm from '../alarm'
import {
  HAPTIC_PATTERNS,
  HAPTIC_STRENGTHS,
  feedbackPattern,
  playFeedback,
  type FeedbackEvent,
  type FeedbackOptions,
} from '../feedback'

const EVENTS = Object.keys(HAPTIC_PATTERNS) as FeedbackEvent[]

const base: FeedbackOptions = {
  enabled: true,
  strength: 'standard',
  soundWhenVoiceOff: false,
  voiceMode: 'short',
}

describe('フィードバックのパターン', () => {
  it('どのイベントのパターンも互いに区別できる(重複がない)', () => {
    const keys = EVENTS.map((e) => JSON.stringify(HAPTIC_PATTERNS[e]))
    expect(new Set(keys).size).toBe(EVENTS.length)
  })

  it('はい=長め1回、いいえ=長め2回で、受理(軽く短い)とも区別できる', () => {
    expect(HAPTIC_PATTERNS.yes).toHaveLength(1)
    expect(HAPTIC_PATTERNS.no).toHaveLength(3)
    expect(HAPTIC_PATTERNS.yes[0]).toBeGreaterThan(HAPTIC_PATTERNS.accepted[0])
  })

  it('緊急・緊急の呼び出し中・解除・伝達済みはそれぞれ別パターン', () => {
    const set = new Set(
      (['emergency', 'emergencyActive', 'cleared', 'delivered'] as const).map((e) =>
        JSON.stringify(HAPTIC_PATTERNS[e]),
      ),
    )
    expect(set.size).toBe(4)
  })

  it('強さは振動する長さだけを伸縮し、合間は変えない', () => {
    expect(feedbackPattern('no', 'standard')).toEqual([80, 100, 80])
    const light = feedbackPattern('no', 'light')
    const strong = feedbackPattern('no', 'strong')
    expect(light[0]).toBeLessThan(80)
    expect(strong[0]).toBeGreaterThan(80)
    expect(light[1]).toBe(100)
    expect(strong[1]).toBe(100)
  })

  it('どの強さでも、パターンは区別できるまま(弱でも重複しない・最低10ms)', () => {
    for (const strength of HAPTIC_STRENGTHS) {
      const keys = EVENTS.map((e) => JSON.stringify(feedbackPattern(e, strength)))
      expect(new Set(keys).size).toBe(EVENTS.length)
      for (const e of EVENTS) {
        feedbackPattern(e, strength).forEach((ms, i) => {
          if (i % 2 === 0) expect(ms).toBeGreaterThanOrEqual(10)
        })
      }
    }
  })
})

describe('playFeedback', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'vibrate')
  let tone: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    tone = vi.spyOn(alarm, 'playTonePattern').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (original) Object.defineProperty(navigator, 'vibrate', original)
    else delete (navigator as unknown as { vibrate?: unknown }).vibrate
  })

  function setVibrate(fn: unknown) {
    Object.defineProperty(navigator, 'vibrate', { configurable: true, writable: true, value: fn })
  }

  it.each(EVENTS)('%s: 定義したパターンが navigator.vibrate に渡る', (event) => {
    const vibrate = vi.fn()
    setVibrate(vibrate)
    playFeedback(event, base)
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_PATTERNS[event])
    expect(tone).not.toHaveBeenCalled()
  })

  it('強さの設定がパターンに反映される', () => {
    const vibrate = vi.fn()
    setVibrate(vibrate)
    playFeedback('yes', { ...base, strength: 'strong' })
    expect(vibrate).toHaveBeenCalledWith(feedbackPattern('yes', 'strong'))
  })

  it('OFF のときは振動も効果音も出さない', () => {
    const vibrate = vi.fn()
    setVibrate(vibrate)
    playFeedback('emergency', { ...base, enabled: false })
    expect(vibrate).not.toHaveBeenCalled()
    expect(tone).not.toHaveBeenCalled()
  })

  describe('振動に非対応の端末(iOS Safari など)', () => {
    beforeEach(() => setVibrate(undefined))

    it('同じパターンを効果音で代替する', () => {
      playFeedback('no', base)
      expect(tone).toHaveBeenCalledWith(HAPTIC_PATTERNS.no)
    })

    it('音声モード OFF のときは、設定で許さない限り鳴らさない', () => {
      playFeedback('no', { ...base, voiceMode: 'off' })
      expect(tone).not.toHaveBeenCalled()
      playFeedback('no', { ...base, voiceMode: 'off', soundWhenVoiceOff: true })
      expect(tone).toHaveBeenCalledWith(HAPTIC_PATTERNS.no)
    })
  })
})
