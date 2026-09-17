/**
 * 预览 URL 选择：按支持度与信息量排序（GLB 含材质/贴图最全 → OBJ → STL）。
 * 纯函数，供 ModelViewer 与单测共用。
 */

/** 预览优先级：GLB → OBJ → STL；其余（FBX/USDZ/MP4 等）不支持预览 */
const PREVIEW_PRIORITY = ['glb', 'obj', 'stl'] as const

export function extOfUrl(url: string): string {
  try {
    const name = decodeURIComponent(url)
    const slash = name.lastIndexOf('/')
    let file = slash >= 0 ? name.slice(slash + 1) : name
    const q = file.indexOf('?') // 剥离查询串/锚点（带签名的 COS URL）
    if (q >= 0) file = file.slice(0, q)
    const hash = file.indexOf('#')
    if (hash >= 0) file = file.slice(0, hash)
    const idx = file.lastIndexOf('.')
    return idx >= 0 ? file.slice(idx + 1).toLowerCase() : ''
  } catch {
    return ''
  }
}

export interface PreviewPick {
  /** 可预览的模型 URL（appfile://） */
  url?: string
  /** 存在文件但格式不支持时，给出大写扩展名（如 "FBX"） */
  unsupportedExt?: string
}

export function pickPreviewUrl(urls: string[]): PreviewPick {
  const exts = urls.map((u) => extOfUrl(u))
  for (const ext of PREVIEW_PRIORITY) {
    const i = exts.indexOf(ext)
    if (i >= 0) return { url: urls[i] }
  }
  const any = exts.find((e) => e.length > 0)
  return any ? { unsupportedExt: any.toUpperCase() } : {}
}
