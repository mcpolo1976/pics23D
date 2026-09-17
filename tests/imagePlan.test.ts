import { describe, expect, it } from 'vitest'
import {
  computeResizePlan,
  scaledSize,
  TARGET_RAW_BYTES,
  JPEG_QUALITY
} from '../src/renderer/src/lib/imagePlan'

describe('computeResizePlan', () => {
  it('长边 ≤4096 不降采样，仅 JPEG 重编码', () => {
    expect(computeResizePlan(1024, 768)).toEqual({ steps: [], quality: JPEG_QUALITY })
    expect(computeResizePlan(4096, 4096)).toEqual({ steps: [], quality: JPEG_QUALITY })
  })

  it('长边 >4096 从 4096 起阶梯降采样', () => {
    expect(computeResizePlan(8000, 6000).steps).toEqual([4096, 2048, 1024])
    expect(computeResizePlan(6000, 6000).steps).toEqual([4096, 2048, 1024])
  })

  it('长边在阶梯之间时只取更小的档位', () => {
    expect(computeResizePlan(5000, 3000).steps).toEqual([4096, 2048, 1024])
    expect(computeResizePlan(4097, 1000).steps).toEqual([4096, 2048, 1024])
  })

  it('极限小图不降采样', () => {
    expect(computeResizePlan(1, 1).steps).toEqual([])
  })

  it('目标原始字节上限与质量常量', () => {
    expect(TARGET_RAW_BYTES).toBe(4.5 * 1024 * 1024)
    expect(JPEG_QUALITY).toBe(0.92)
  })
})

describe('scaledSize', () => {
  it('等比缩放，长边 = targetEdge', () => {
    expect(scaledSize(8000, 4000, 4096)).toEqual({ width: 4096, height: 2048 })
    expect(scaledSize(4000, 8000, 2048)).toEqual({ width: 1024, height: 2048 })
  })

  it('短于目标长边时保持原尺寸', () => {
    expect(scaledSize(1920, 1080, 4096)).toEqual({ width: 1920, height: 1080 })
  })

  it('最小 1px 兜底', () => {
    const r = scaledSize(3, 1, 2)
    expect(r.width).toBeGreaterThanOrEqual(1)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })

  it('零尺寸防御', () => {
    expect(scaledSize(0, 0, 4096)).toEqual({ width: 0, height: 0 })
  })
})
