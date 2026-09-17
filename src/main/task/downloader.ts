import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import AdmZip from 'adm-zip'
import { basename, extname } from 'path'
import { fileURLToPath } from 'url'
import { appendLog } from '../services/storage'

const FORMAT_EXT: Record<string, string> = {
  OBJ: '.obj',
  GLB: '.glb',
  STL: '.stl',
  USDZ: '.usdz',
  FBX: '.fbx',
  MP4: '.mp4'
}

export function extForFormat(type: string): string {
  return FORMAT_EXT[type] ?? '.bin'
}

/**
 * 下载云端结果文件到本地。
 * 支持 http(s):// 与 file://（MockProvider 用 file:// 指向内置测试资源）。
 */
export async function downloadToFile(
  url: string,
  destPath: string,
  signal?: AbortSignal
): Promise<void> {
  if (url.startsWith('file://')) {
    // new URL().pathname 会得到 "/C:/dev/..."，必须用 fileURLToPath 还原盘符路径
    copyFileSync(fileURLToPath(url), destPath)
    return
  }
  const res = await fetch(url, { signal })
  if (!res.ok) {
    throw new Error(`下载失败：HTTP ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(destPath, buf)
  appendLog('info', `[downloader] ${basename(destPath)} (${buf.length} bytes) <- ${url.slice(0, 120)}`)
}

/**
 * 结果文件可能是 zip 包（组文件格式，如带贴图的 OBJ）。
 * 检测 zip 魔数 PK\x03\x04，解包到 destDir 并返回解出的文件名列表。
 */
export function maybeUnzip(filePath: string, destDir: string): string[] {
  if (!existsSync(filePath)) return []
  const head = readFileSync(filePath).subarray(0, 2)
  if (!(head[0] === 0x50 && head[1] === 0x4b)) return []
  const zip = new AdmZip(filePath)
  mkdirSync(destDir, { recursive: true })
  zip.extractAllTo(destDir, true)
  return zip.getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName)
}

/** 从 URL 推断原始文件名（无扩展名时按 type 补） */
export function fileNameFromUrl(url: string, type: string, index: number): string {
  let name = ''
  try {
    const u = new URL(url)
    name = basename(u.pathname)
  } catch {
    name = ''
  }
  const ext = extname(name).toLowerCase()
  const known = Object.values(FORMAT_EXT)
  if (!name || !known.includes(ext)) {
    name = `${type.toLowerCase()}-${index + 1}${extForFormat(type)}`
  }
  return name
}
