import { describe, expect, it } from 'vitest'
import { extOfUrl, pickPreviewUrl } from '../src/renderer/src/lib/preview'

describe('extOfUrl', () => {
  it('解析普通与 URL 编码的扩展名', () => {
    expect(extOfUrl('appfile://models/t1/model.glb')).toBe('glb')
    expect(extOfUrl('https://cos.example.com/a/b/模型.OBJ?sign=x')).toBe('obj')
    expect(extOfUrl('appfile://models/t1/%E6%A8%A1%E5%9E%8B.stl')).toBe('stl')
  })

  it('无扩展名返回空串', () => {
    expect(extOfUrl('appfile://models/t1/noext')).toBe('')
    expect(extOfUrl('appfile://models/t1/')).toBe('')
  })
})

describe('pickPreviewUrl', () => {
  it('优先级 GLB > OBJ > STL', () => {
    const urls = ['a.stl', 'b.obj', 'c.glb']
    expect(pickPreviewUrl(urls).url).toBe('c.glb')
    expect(pickPreviewUrl(['a.stl', 'b.obj']).url).toBe('b.obj')
    expect(pickPreviewUrl(['a.stl']).url).toBe('a.stl')
  })

  it('编码文件名不影响识别', () => {
    expect(pickPreviewUrl(['appfile://models/t1/%E6%A8%A1%E5%9E%8B.glb']).url).toBe(
      'appfile://models/t1/%E6%A8%A1%E5%9E%8B.glb'
    )
  })

  it('全部不支持时报出大写扩展名', () => {
    const r = pickPreviewUrl(['x.mp4', 'y.usdz'])
    expect(r.url).toBeUndefined()
    expect(r.unsupportedExt).toBe('MP4')
  })

  it('空列表返回空对象', () => {
    expect(pickPreviewUrl([])).toEqual({})
  })
})
