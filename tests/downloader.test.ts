import { describe, expect, it, vi } from 'vitest'

// downloader → storage → files 依赖 electron app，mock 掉路径模块
vi.mock('../src/main/services/files', () => ({
  logDir: () => '/tmp/img3d-test-logs'
}))

import AdmZip from 'adm-zip'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileNameFromUrl, maybeUnzip } from '../src/main/task/downloader'

describe('maybeUnzip', () => {
  it('zip 组文件解包并返回条目名', () => {
    const dir = mkdtempSync(join(tmpdir(), 'img3d-mz-'))
    const zipPath = join(dir, 'group.zip')
    const zip = new AdmZip()
    zip.addFile('model.obj', Buffer.from('v 0 0 0\n'))
    zip.addFile('model.mtl', Buffer.from('newmtl m\n'))
    zip.writeZip(zipPath)

    const outDir = join(dir, 'out')
    const entries = maybeUnzip(zipPath, outDir)
    expect(entries.sort()).toEqual(['model.mtl', 'model.obj'])
    expect(existsSync(join(outDir, 'model.obj'))).toBe(true)
  })

  it('非 zip 文件返回空数组且不动原文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'img3d-mz-'))
    const p = join(dir, 'a.glb')
    writeFileSync(p, Buffer.from('glTF binary, not a zip'))
    expect(maybeUnzip(p, join(dir, 'out'))).toEqual([])
    expect(existsSync(p)).toBe(true)
  })

  it('文件不存在返回空数组', () => {
    expect(maybeUnzip(join(tmpdir(), 'no-such-file.zip'), tmpdir())).toEqual([])
  })
})

describe('fileNameFromUrl', () => {
  it('保留已知扩展名', () => {
    expect(fileNameFromUrl('https://cos.x.com/abc/model.glb?sign=1', 'GLB', 0)).toBe('model.glb')
  })

  it('解码 URL 编码文件名', () => {
    expect(fileNameFromUrl('https://cos.x.com/%E6%A8%A1%E5%9E%8B.obj', 'OBJ', 0)).toBe('模型.obj')
  })

  it('未知/缺失扩展名按 type 兜底', () => {
    expect(fileNameFromUrl('https://cos.x.com/abc', 'GLB', 2)).toBe('glb-3.glb')
    expect(fileNameFromUrl('not a url', 'STL', 0)).toBe('stl-1.stl')
  })

  it('解码后含路径分隔符的名称拒绝并兜底（防穿越）', () => {
    expect(fileNameFromUrl('https://cos.x.com/a%2Fb%2Fevil.glb', 'GLB', 0)).toBe('glb-1.glb')
  })
})
