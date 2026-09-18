import type { ModelFormat, PollFile, PollResult } from '@shared/types'

/**
 * Hi3D (Sparc3D) 状态/错误码 → 本地语义/中文提示。
 * 纯函数，便于单测。
 */

/** 云端任务状态（query-task data.state） */
export type Hi3DTaskState = 'created' | 'queueing' | 'processing' | 'success' | 'failed' | string | undefined

/** 云端任务响应 data 字段 */
export interface Hi3DTaskData {
  task_id?: string
  state?: Hi3DTaskState
  id?: string
  url?: string
  cover_url?: string
}

/** 状态映射：created/queueing/processing → running；success → succeeded；failed → failed */
export function hi3dStateToPollResult(data: Hi3DTaskData): PollResult {
  switch (data.state) {
    case 'success': {
      const files: PollFile[] = []
      if (data.url) {
        files.push({
          type: urlToFormat(data.url),
          url: data.url,
          previewImageUrl: data.cover_url
        })
      }
      return { status: 'succeeded', files }
    }
    case 'failed':
      return {
        status: 'failed',
        errorCode: '50010001',
        errorMessage: hi3dErrorToMessage('50010001', 'generate failed')
      }
    case 'created':
    case 'queueing':
    case 'processing':
    default:
      // 未知状态按运行中处理，等待下一轮
      return { status: 'running' }
  }
}

/** 从结果 URL 扩展名推断格式；无法识别时按 GLB 处理（提交时已指定输出格式） */
export function urlToFormat(url: string): ModelFormat {
  const m = /\.(obj|glb|stl|fbx|usdz)(?:[?#].*)?$/i.exec(url)
  const ext = m?.[1]?.toUpperCase() as ModelFormat | undefined
  return ext ?? 'GLB'
}

/** 常见 Hi3D 错误码 → 中文提示 */
const ERROR_CODE_MESSAGES: Record<string, string> = {
  '40010000': 'Client ID 或 Client Secret 错误',
  '30010000': '积分余额不足，请到 Hi3D 平台充值',
  '10031001': '上传文件超过 20MB，请使用更小的图片',
  '10031002': '面数不合理，取值范围为 100,000 – 5,000,000',
  '10031003': '分辨率参数无效，请重试',
  '10031004': '请求类型不支持，请重试',
  '10031005': '图片格式不支持，仅支持 PNG / JPEG / WebP',
  '10031006': '模型版本无效，请重试',
  '10031007': '图片和多视图不能同时上传',
  '10031008': '图片和多视图必须上传一个',
  '10031009': '多视图最多支持 4 张图片',
  '10031010': '文件不能为空，请重新选择图片',
  '10031011': '分阶段生成需要提供几何模型，请重试',
  '10031013': '多视图位图参数错误，请重试',
  '10031014': '多视图位图参数错误，请重试',
  '10031015': '多视图位图与图片数量不匹配，请重试',
  '10031016': '白模几何模型仅支持 GLB 格式',
  '10031017': '该模型版本不支持贴纹理，请重试',
  '10000000': 'Hi3D 服务器内部错误，请稍后重试',
  '401': '访问令牌无效或已过期，请重新验证密钥',
  '50010001': '云端生成失败（超时或图片无法解析，所耗积分已退还），请重试'
}

/** 错误码 → 中文消息；未收录的原样透传「code: message」 */
export function hi3dErrorToMessage(code: string | undefined, message: string): string {
  if (code && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code]
  return code ? `${code}: ${message}` : message
}

/**
 * 计费表（0.02 USD/积分；多视图/面数/输出格式均免费）：
 * - v2.1 1536fast（极速）：几何 10 + 纹理 10 + PBR 5
 * - v3.0 2048quality（高质）：几何 90 + 纹理 10 + PBR 5
 */
export const MODEL_COSTS: Record<'rapid' | 'pro', { geometry: number; texture: number; pbr: number }> = {
  rapid: { geometry: 10, texture: 10, pbr: 5 },
  pro: { geometry: 90, texture: 10, pbr: 5 }
}

/** 多视图位图：主图（前视图）+ n 张追加图，4 位 '1'/'0'（位序：前/后/左/右） */
export function buildMultiImagesBit(extraCount: number): string {
  return '1'.repeat(1 + extraCount).padEnd(4, '0')
}
