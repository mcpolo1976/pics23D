const ACCEPT_TYPES = ['jpg', 'jpeg', 'png', 'webp']
/** base64 后 ≤6MB（编码膨胀约 30%，原始字节限 4.5MB），M6 将改为自动压缩 */
const MAX_RAW_BYTES = 4.5 * 1024 * 1024

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export interface ImageCheck {
  ok: boolean
  error?: string
}

/** 基础校验：扩展名与原始大小（尺寸校验与压缩在 M6 的压缩管线中） */
export function checkImageFile(name: string, bytes: Uint8Array): ImageCheck {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (!ACCEPT_TYPES.includes(ext)) {
    return { ok: false, error: `不支持的图片格式（${ext || '未知'}），仅支持 JPG/PNG/WebP` }
  }
  if (bytes.byteLength > MAX_RAW_BYTES) {
    return { ok: false, error: `图片过大（${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB），请使用 4.5MB 以内的图片` }
  }
  return { ok: true }
}

export interface LoadedImage {
  name: string
  bytes: Uint8Array
  /** blob: URL，仅 renderer 预览用 */
  url: string
}
