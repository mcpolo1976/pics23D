import { ai3d } from 'tencentcloud-sdk-nodejs-ai3d'
import type { ProviderCredentials } from '@shared/types'
import { appendLog } from '../../services/storage'
import { tencentErrorToMessage } from './mappers'

/**
 * 腾讯云 AI3D SDK 客户端单例。
 * - endpoint 固定 ai3d.tencentcloudapi.com
 * - region 传空串（该产品不区分地域）；如报地域错误改 'ap-guangzhou'
 * - 按凭据缓存实例，凭据变更时重建
 */

const Ai3dClient = ai3d.v20250513.Client
export type Ai3dClientInstance = InstanceType<typeof Ai3dClient>

const REGION = ''

const clientCache = new Map<string, Ai3dClientInstance>()

function cacheKey(creds: ProviderCredentials): string {
  return `${creds.secretId ?? ''}|${creds.secretKey ?? ''}`
}

export function getAi3dClient(creds: ProviderCredentials): Ai3dClientInstance {
  const key = cacheKey(creds)
  const existing = clientCache.get(key)
  if (existing) return existing
  const client = new Ai3dClient({
    credential: {
      secretId: creds.secretId ?? '',
      secretKey: creds.secretKey ?? ''
    },
    region: REGION,
    profile: {
      httpProfile: { endpoint: 'ai3d.tencentcloudapi.com' }
    }
  })
  clientCache.set(key, client)
  return client
}

/** SDK 抛错结构（TencentCloudSDKHttpException），鸭子类型探测 code/value.code */
export function sdkErrorInfo(err: unknown): { code: string; message: string } {
  const e = err as { code?: string; message?: string; value?: { code?: string } }
  const code = e?.code ?? e?.value?.code ?? ''
  const message = e?.message ?? String(err)
  if (code) return { code, message: tencentErrorToMessage(code, message) }
  return { code: '', message }
}

/** 提取 SDK 错误的原始 code（不做中文转换，供密钥探测等场景判定） */
export function sdkErrorCode(err: unknown): string | undefined {
  const e = err as { code?: string; value?: { code?: string } }
  return e?.code ?? e?.value?.code
}

/** 包装 SDK 调用：SDK 错误转中文 Error 抛出，调用方按普通错误处理 */
export async function withSdkError<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    const info = sdkErrorInfo(err)
    appendLog('warn', `[hunyuan3d] SDK 错误: ${info.code || '(无错误码)'}: ${info.message}`)
    throw new Error(info.message)
  }
}
