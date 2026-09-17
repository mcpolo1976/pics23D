import { describe, expect, it } from 'vitest'
import { interpretProbeError, mapJobStatus, tencentErrorToMessage } from '../src/main/providers/hunyuan3d/mappers'
import { Hunyuan3DProvider } from '../src/main/providers/hunyuan3d/Hunyuan3DProvider'
import type { GenerateRequest } from '../src/shared/types'

describe('mapJobStatus', () => {
  const files = [{ type: 'GLB' as const, url: 'https://example.com/a.glb' }]

  it('DONE → succeeded（含文件与实扣积分）', () => {
    const r = mapJobStatus('DONE', files, { creditConsumed: 25 })
    expect(r).toEqual({ status: 'succeeded', files, creditConsumed: 25 })
  })

  it('FAIL → failed（错误码转中文）', () => {
    const r = mapJobStatus('FAIL', [], { errorCode: 'InternalError', errorMessage: 'boom' })
    expect(r.status).toBe('failed')
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('InternalError')
      expect(r.errorMessage).toContain('腾讯云内部错误')
    }
  })

  it('WAIT/RUN/未知 → running', () => {
    expect(mapJobStatus('WAIT', []).status).toBe('running')
    expect(mapJobStatus('RUN', []).status).toBe('running')
    expect(mapJobStatus('SOMETHING_NEW', []).status).toBe('running')
  })
})

describe('tencentErrorToMessage', () => {
  it('已收录错误码给出中文', () => {
    expect(tencentErrorToMessage('AuthFailure.SecretIdNotFound', 'raw')).toContain('SecretId 不存在')
    expect(tencentErrorToMessage('ResourceInsufficient', 'raw')).toContain('余额不足')
    expect(tencentErrorToMessage('RequestLimitExceeded', 'raw')).toContain('并发')
  })

  it('未收录错误码透传', () => {
    expect(tencentErrorToMessage('Some.NewCode', 'raw msg')).toBe('Some.NewCode: raw msg')
    expect(tencentErrorToMessage(undefined, '仅消息')).toBe('仅消息')
  })
})

describe('interpretProbeError（假 JobId 密钥探测）', () => {
  it('AuthFailure → 无效', () => {
    const v = interpretProbeError('AuthFailure.SignatureFailure')
    expect(v.ok).toBe(false)
  })

  it('InvalidParameter/未知业务码 → 有效', () => {
    expect(interpretProbeError('InvalidParameter').ok).toBe(true)
    expect(interpretProbeError('InvalidParameter.Value').ok).toBe(true)
  })

  it('限频/余额不足但鉴权通过 → 有效', () => {
    expect(interpretProbeError('RequestLimitExceeded').ok).toBe(true)
    expect(interpretProbeError('ResourceInsufficient').ok).toBe(true)
  })
})

describe('Hunyuan3DProvider.estimateCost', () => {
  const provider = new Hunyuan3DProvider()
  const base: GenerateRequest = {
    providerId: 'hunyuan3d',
    tier: 'rapid',
    mode: 'image-to-3d',
    format: 'GLB'
  }

  it('极速 GLB = 20（15 基础 + 非默认格式 5）', () => {
    expect(provider.estimateCost(base).total).toBe(20)
  })

  it('极速 GLB + PBR = 30', () => {
    expect(provider.estimateCost({ ...base, enablePBR: true }).total).toBe(30)
  })

  it('极速 STL = 15 + 5', () => {
    expect(provider.estimateCost({ ...base, format: 'STL' }).total).toBe(20)
  })

  it('极速 OBJ 无格式附加费', () => {
    expect(provider.estimateCost({ ...base, format: 'OBJ' }).total).toBe(15)
  })

  it('专业 Normal = 20；+PBR=30；+面数=30+10', () => {
    const pro: GenerateRequest = { ...base, tier: 'pro', format: 'STL' }
    expect(provider.estimateCost(pro).total).toBe(25) // 20 + 格式5
    expect(provider.estimateCost({ ...pro, enablePBR: true }).total).toBe(35)
    expect(provider.estimateCost({ ...pro, faceCount: 100000 }).total).toBe(35)
    expect(provider.estimateCost({ ...pro, enablePBR: true, faceCount: 100000 }).total).toBe(45)
  })

  it('专业 LowPoly（3.0）= 25 + 格式5，面数不计费', () => {
    const pro: GenerateRequest = { ...base, tier: 'pro', format: 'STL', generateType: 'LowPoly' }
    expect(provider.estimateCost(pro).total).toBe(30)
    expect(provider.estimateCost({ ...pro, faceCount: 100000 }).total).toBe(30)
  })

  it('专业白模 Geometry = 15，PBR/面数不计费', () => {
    const pro: GenerateRequest = { ...base, tier: 'pro', format: 'STL', enableWhiteModel: true }
    expect(provider.estimateCost(pro).total).toBe(20) // 15 + 格式5
    expect(provider.estimateCost({ ...pro, enablePBR: true, faceCount: 100000 }).total).toBe(20)
  })

  it('专业多视图 +10', () => {
    const pro: GenerateRequest = {
      ...base,
      tier: 'pro',
      format: 'STL',
      multiViewBase64: ['a', 'b']
    }
    expect(provider.estimateCost(pro).total).toBe(35) // 20 + 多视图10 + 格式5
  })
})
