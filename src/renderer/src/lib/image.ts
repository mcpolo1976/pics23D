import { TARGET_RAW_BYTES } from './imagePlan'

const ACCEPT_TYPES = ['jpg', 'jpeg', 'png', 'webp']

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

/** 入口校验：扩展名与宽松大小上限（尺寸/体积压缩由 compressImage 完成） */
export function checkImageFile(name: string, bytes: Uint8Array): ImageCheck {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (!ACCEPT_TYPES.includes(ext)) {
    return { ok: false, error: `不支持的图片格式（${ext || '未知'}），仅支持 JPG/PNG/WebP` }
  }
  if (bytes.byteLength > 30 * 1024 * 1024) {
    return { ok: false, error: `图片过大（${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB），请使用 30MB 以内的图片` }
  }
  return { ok: true }
}

export interface LoadedImage {
  name: string
  /** 压缩后的字节（提交用） */
  bytes: Uint8Array
  /** blob: URL，仅 renderer 预览用 */
  url: string
  /** 压缩信息（展示"原图 → 压缩后"） */
  compressed: {
    originalBytes: number
    compressedBytes: number
    width: number
    height: number
    /** 是否发生了降采样 */
    scaled: boolean
  }
}

export interface CompressResult {
  base64: string
  bytes: Uint8Array
  width: number
  height: number
  originalBytes: number
  compressedBytes: number
  scaled: boolean
}

/**
 * 图片压缩管线：createImageBitmap（按 EXIF 方向解码）→ 原尺寸 JPEG 重编码；
 * 仍超限则沿 4096→2048→1024 阶梯等比降采样，直到 ≤ TARGET_RAW_BYTES。
 * 任一档位失败（编码异常）自动降级到下一档。
 */
export async function compressImage(raw: Uint8Array): Promise<CompressResult> {
  const { computeResizePlan, scaledSize } = await import('./imagePlan')
  const bitmap = await createImageBitmap(new Blob([raw.buffer as ArrayBuffer]), {
    imageOrientation: 'from-image'
  })
  const plan = computeResizePlan(bitmap.width, bitmap.height)
  // 候选：原尺寸 + 降采样档位
  const candidates: Array<{ edge: number | null }> = [
    { edge: null },
    ...plan.steps.map((e) => ({ edge: e }))
  ]
  let lastError: unknown = null
  for (const c of candidates) {
    const size = c.edge
      ? scaledSize(bitmap.width, bitmap.height, c.edge)
      : { width: bitmap.width, height: bitmap.height }
    try {
      const canvas = new OffscreenCanvas(size.width, size.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('OffscreenCanvas 2d 上下文不可用')
      ctx.drawImage(bitmap, 0, 0, size.width, size.height)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: plan.quality })
      const out = new Uint8Array(await blob.arrayBuffer())
      if (out.byteLength > TARGET_RAW_BYTES) {
        lastError = new Error(`JPEG 编码后仍超限（${(out.byteLength / 1024 / 1024).toFixed(1)}MB）`)
        continue // 下一档
      }
      bitmap.close()
      return {
        base64: bytesToBase64(out),
        bytes: out,
        width: size.width,
        height: size.height,
        originalBytes: raw.byteLength,
        compressedBytes: out.byteLength,
        scaled: c.edge != null
      }
    } catch (err) {
      lastError = err
    }
  }
  bitmap.close()
  throw lastError instanceof Error ? lastError : new Error('图片压缩失败')
}
