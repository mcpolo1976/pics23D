/**
 * 压缩决策纯函数（无 DOM 依赖，可单测）。
 * 策略：优先保留分辨率——先原尺寸 JPEG 重编码；超限再沿 4096→2048→1024 阶梯降采样。
 */

/** 云端限制：base64 ≤6MB（编码膨胀 ~33%），原始字节上限 4.5MB */
export const TARGET_RAW_BYTES = 4.5 * 1024 * 1024
/** 输入图片的宽松上限（超过直接拒绝，不尝试压缩） */
export const MAX_INPUT_BYTES = 30 * 1024 * 1024

/** 降采样长边阶梯（仅取小于当前长边的档位） */
export const RESIZE_LADDER = [4096, 2048, 1024] as const
/** JPEG 编码质量（全档位统一） */
export const JPEG_QUALITY = 0.92

export interface ResizePlan {
  /** 依次尝试的降采样目标长边（空 = 原尺寸直出） */
  steps: number[]
  quality: number
}

/**
 * 根据原始宽高决定降采样阶梯。
 * 长边 ≤4096 → 不降采样（只做 JPEG 重编码）；否则按阶梯取所有 < 长边的档位，从高到低尝试。
 */
export function computeResizePlan(width: number, height: number): ResizePlan {
  const maxSide = Math.max(width, height)
  if (maxSide <= RESIZE_LADDER[0]) {
    return { steps: [], quality: JPEG_QUALITY }
  }
  return { steps: RESIZE_LADDER.filter((e) => e < maxSide), quality: JPEG_QUALITY }
}

/** 降采样后的目标宽高（等比，长边 = targetEdge） */
export function scaledSize(width: number, height: number, targetEdge: number): { width: number; height: number } {
  const maxSide = Math.max(width, height)
  if (maxSide <= targetEdge || maxSide === 0) return { width, height }
  const ratio = targetEdge / maxSide
  return { width: Math.max(1, Math.round(width * ratio)), height: Math.max(1, Math.round(height * ratio)) }
}
