import type { PollFile, PollResult } from '@shared/types'

/**
 * 腾讯混元生 3D 状态/错误码 → 本地语义/中文提示。
 * 纯函数，便于单测。
 */

export type CloudJobStatus = 'WAIT' | 'RUN' | 'FAIL' | 'DONE' | string | undefined

/** 云端任务状态映射（Status: WAIT/RUN/FAIL/DONE） */
export function mapJobStatus(
  status: CloudJobStatus,
  files: PollFile[],
  opts?: { creditConsumed?: number; errorCode?: string; errorMessage?: string }
): PollResult {
  switch (status) {
    case 'DONE':
      return { status: 'succeeded', files, creditConsumed: opts?.creditConsumed }
    case 'FAIL':
      return {
        status: 'failed',
        errorCode: opts?.errorCode,
        errorMessage: opts?.errorMessage
          ? tencentErrorToMessage(opts.errorCode, opts.errorMessage)
          : undefined
      }
    case 'WAIT':
    case 'RUN':
    default:
      // 未知状态按运行中处理，等待下一轮
      return { status: 'running' }
  }
}

/** 常见腾讯云错误码 → 中文提示 */
const ERROR_CODE_MESSAGES: Record<string, string> = {
  'AuthFailure.SecretIdNotFound': 'SecretId 不存在，请检查密钥 ID 是否正确',
  'AuthFailure.SignatureFailure': '签名错误，请检查 SecretKey 是否正确',
  'AuthFailure.SignatureExpire': '签名已过期，请检查本机系统时间是否准确',
  'AuthFailure.TokenFailure': '令牌无效，请使用长期密钥而非临时令牌',
  'AuthFailure.MFAFailure': '该密钥需要 MFA 二次验证，请使用 API 密钥',
  'AuthFailure.UnauthorizedOperation': '该密钥没有混元生 3D 的访问权限，请到 CAM 授权',
  'RequestLimitExceeded': '请求频率或并发超限（极速版并发 1、专业版并发 3 为账号级上限）',
  'ResourceInsufficient': '积分余额不足，请到腾讯云混元生 3D 控制台充值',
  'InvalidParameter': '参数无效，请检查输入图片或描述文字',
  'InvalidParameterValue': '参数取值无效，请检查输入图片或描述文字',
  'LimitExceeded': '超出限制，请检查图片大小/分辨率要求',
  'FailedOperation.JobCanceled': '云端任务已取消',
  'FailedOperation.GenerateFailed': '云端生成失败（失败任务不扣费）',
  'InternalError': '腾讯云内部错误，请稍后重试'
}

/** 错误码 → 中文消息；未收录的原样透传「code: message」 */
export function tencentErrorToMessage(code: string | undefined, message: string): string {
  if (code && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code]
  return code ? `${code}: ${message}` : message
}

/**
 * 用假 JobId 探测密钥有效性（不消耗积分）：
 * 鉴权失败（AuthFailure.*）= 密钥无效；进入参数校验（InvalidParameter 等）= 密钥有效。
 */
export function interpretProbeError(code: string | undefined): { ok: boolean; message: string } {
  if (!code) return { ok: true, message: '密钥有效' }
  if (code.startsWith('AuthFailure.')) {
    return { ok: false, message: tencentErrorToMessage(code, '') }
  }
  if (code === 'RequestLimitExceeded' || code === 'ResourceInsufficient') {
    // 这两类说明鉴权已通过，只是频率/余额问题
    return { ok: true, message: `密钥有效（${tencentErrorToMessage(code, '')}）` }
  }
  return { ok: true, message: '密钥有效' }
}
