import { describe, expect, it } from 'vitest'
import { fitHeadingSize } from '../fitHeading'

// 全角 15 字(1px あたり 15px 幅)を想定
const base = { textWidthPerPx: 15, maxSize: 54, minSize: 38 }

describe('fitHeadingSize', () => {
  it('余裕があれば上限サイズで 1 行', () => {
    expect(fitHeadingSize({ ...base, availableWidth: 900 })).toEqual({ singleLine: true, size: 54 })
  })
  it('幅が足りなければ収まる最大サイズへ縮める', () => {
    const r = fitHeadingSize({ ...base, availableWidth: 602 })
    expect(r.singleLine).toBe(true)
    expect(r.size).toBe(40)
    expect(r.size * 15).toBeLessThanOrEqual(600)
  })
  it('下限でも収まらなければ折り返し(1 行にしない)', () => {
    expect(fitHeadingSize({ ...base, availableWidth: 500 }).singleLine).toBe(false)
  })
  it('測れない入力では折り返し扱い', () => {
    expect(fitHeadingSize({ ...base, textWidthPerPx: 0, availableWidth: 500 }).singleLine).toBe(
      false,
    )
    expect(fitHeadingSize({ ...base, availableWidth: 0 }).singleLine).toBe(false)
  })
})
