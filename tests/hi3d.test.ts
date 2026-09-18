import { describe, expect, it } from 'vitest'
import {
  MODEL_COSTS,
  buildMultiImagesBit,
  hi3dErrorToMessage,
  hi3dStateToPollResult,
  urlToFormat
} from '../src/main/providers/hi3d/mappers'
import { HI3D_MODEL_SPECS, buildSubmitForm } from '../src/main/providers/hi3d/client'
import { Hi3DProvider } from '../src/main/providers/hi3d/Hi3DProvider'
import type { GenerateRequest } from '../src/shared/types'

describe('hi3dStateToPollResult', () => {
  it('created/queueing/processing/未知 → running', () => {
    expect(hi3dStateToPollResult({ state: 'created' }).status).toBe('running')
    expect(hi3dStateToPollResult({ state: 'queueing' }).status).toBe('running')
    expect(hi3dStateToPollResult({ state: 'processing' }).status).toBe('running')
    expect(hi3dStateToPollResult({ state: 'SOMETHING_NEW' }).status).toBe('running')
    expect(hi3dStateToPollResult({}).status).toBe('running')
  })

  it('success → succeeded（url 扩展名推断格式，cover_url 作预览）', () => {
    const r = hi3dStateToPollResult({
      state: 'success',
      url: 'https://cdn.example.com/0.glb',
      cover_url: 'https://cdn.example.com/0.webp'
    })
    expect(r.status).toBe('succeeded')
    if (r.status === 'succeeded') {
      expect(r.files).toEqual([
        { type: 'GLB', url: 'https://cdn.example.com/0.glb', previewImageUrl: 'https://cdn.example.com/0.webp' }
      ])
    }
  })

  it('success 无 url → succeeded 空文件列表', () => {
    const r = hi3dStateToPollResult({ state: 'success' })
    expect(r.status).toBe('succeeded')
    if (r.status === 'succeeded') expect(r.files).toEqual([])
  })

  it('failed → failed（含积分已退还提示）', () => {
    const r = hi3dStateToPollResult({ state: 'failed' })
    expect(r.status).toBe('failed')
    if (r.status === 'failed') {
      expect(r.errorCode).toBe('50010001')
      expect(r.errorMessage).toContain('积分已退还')
    }
  })
})

describe('urlToFormat', () => {
  it('按扩展名映射，大小写/查询串均兼容', () => {
    expect(urlToFormat('https://a.com/x/0.glb')).toBe('GLB')
    expect(urlToFormat('https://a.com/x/0.OBJ')).toBe('OBJ')
    expect(urlToFormat('https://a.com/0.stl?sig=abc')).toBe('STL')
    expect(urlToFormat('https://a.com/0.FBX#frag')).toBe('FBX')
    expect(urlToFormat('https://a.com/0.USDZ')).toBe('USDZ')
  })

  it('无法识别 → 默认 GLB（提交时已指定输出格式）', () => {
    expect(urlToFormat('https://a.com/noextension')).toBe('GLB')
    expect(urlToFormat('https://a.com/0.zip')).toBe('GLB')
  })
})

describe('hi3dErrorToMessage', () => {
  it('已收录错误码给出中文', () => {
    expect(hi3dErrorToMessage('40010000', 'client credentials are invalid')).toContain('Client ID')
    expect(hi3dErrorToMessage('30010000', 'balance is not enough')).toContain('余额不足')
    expect(hi3dErrorToMessage('10031005', 'raw')).toContain('PNG')
    expect(hi3dErrorToMessage('50010001', 'generate failed')).toContain('退还')
  })

  it('未收录错误码透传', () => {
    expect(hi3dErrorToMessage('99999999', 'raw msg')).toBe('99999999: raw msg')
    expect(hi3dErrorToMessage(undefined, '仅消息')).toBe('仅消息')
  })
})

describe('buildMultiImagesBit', () => {
  it('主图 + n 张追加图 → 前 n+1 位为 1', () => {
    expect(buildMultiImagesBit(0)).toBe('1000')
    expect(buildMultiImagesBit(1)).toBe('1100')
    expect(buildMultiImagesBit(2)).toBe('1110')
    expect(buildMultiImagesBit(3)).toBe('1111')
  })
})

describe('buildSubmitForm', () => {
  const base: GenerateRequest = {
    providerId: 'hi3d',
    tier: 'rapid',
    mode: 'image-to-3d',
    imageBase64: 'aGk=', // "hi"
    format: 'GLB'
  }

  it('极速档映射 hitem3dv2.1 / 1536fast；高质档映射 hi3dv3.0 / 2048quality', () => {
    expect(HI3D_MODEL_SPECS.rapid).toEqual({ model: 'hitem3dv2.1', resolution: '1536fast' })
    expect(HI3D_MODEL_SPECS.pro).toEqual({ model: 'hi3dv3.0', resolution: '2048quality' })
    const rapid = buildSubmitForm(base)
    expect(rapid.get('model')).toBe('hitem3dv2.1')
    expect(rapid.get('resolution')).toBe('1536fast')
    const pro = buildSubmitForm({ ...base, tier: 'pro' })
    expect(pro.get('model')).toBe('hi3dv3.0')
    expect(pro.get('resolution')).toBe('2048quality')
  })

  it('标准生成 request_type=3 + pbr 开关 + format 代码', () => {
    const form = buildSubmitForm({ ...base, enablePBR: true })
    expect(form.get('request_type')).toBe('3')
    expect(form.get('pbr')).toBe('1')
    expect(form.get('format')).toBe('2') // GLB
    expect(form.get('images')).toBeTruthy()
    expect(form.get('multi_images')).toBeNull()
    expect(buildSubmitForm(base).get('pbr')).toBe('0')
  })

  it('白模 request_type=1，不带 pbr，格式不受限', () => {
    const form = buildSubmitForm({ ...base, enableWhiteModel: true, format: 'STL' })
    expect(form.get('request_type')).toBe('1')
    expect(form.get('pbr')).toBeNull()
    expect(form.get('format')).toBe('3') // STL
  })

  it('多视图走 multi_images + multi_images_bit，主图在前', () => {
    const form = buildSubmitForm({ ...base, multiViewBase64: ['YQ==', 'Yg=='] })
    const files = form.getAll('multi_images') as File[]
    expect(files).toHaveLength(3)
    expect(files[0].name).toBe('view0.jpg')
    expect(form.get('multi_images_bit')).toBe('1110')
    expect(form.get('images')).toBeNull()
  })

  it('faceCount 发送并夹取到 [100000, 5000000]', () => {
    expect(buildSubmitForm({ ...base, faceCount: 50 }).get('face')).toBe('100000')
    expect(buildSubmitForm({ ...base, faceCount: 9_000_000 }).get('face')).toBe('5000000')
    expect(buildSubmitForm({ ...base, faceCount: 2_000_000 }).get('face')).toBe('2000000')
    expect(buildSubmitForm(base).get('face')).toBeNull()
  })
})

describe('Hi3DProvider.estimateCost', () => {
  const provider = new Hi3DProvider()
  const base: GenerateRequest = {
    providerId: 'hi3d',
    tier: 'rapid',
    mode: 'image-to-3d',
    format: 'GLB'
  }

  it('极速标准 = 20（几何10 + 纹理10）；+PBR = 25', () => {
    expect(provider.estimateCost(base).total).toBe(20)
    expect(provider.estimateCost({ ...base, enablePBR: true }).total).toBe(25)
  })

  it('极速白模 = 10（仅几何）', () => {
    expect(provider.estimateCost({ ...base, enableWhiteModel: true }).total).toBe(10)
    expect(MODEL_COSTS.rapid.geometry).toBe(10)
  })

  it('高质标准 = 100；+PBR = 105；白模 = 90', () => {
    const pro: GenerateRequest = { ...base, tier: 'pro' }
    expect(provider.estimateCost(pro).total).toBe(100)
    expect(provider.estimateCost({ ...pro, enablePBR: true }).total).toBe(105)
    expect(provider.estimateCost({ ...pro, enableWhiteModel: true }).total).toBe(90)
  })

  it('多视图 / 面数 / 输出格式均免费', () => {
    const pro: GenerateRequest = {
      ...base,
      tier: 'pro',
      multiViewBase64: ['a', 'b', 'c'],
      faceCount: 5_000_000,
      format: 'USDZ'
    }
    expect(provider.estimateCost(pro).total).toBe(100)
  })
})
