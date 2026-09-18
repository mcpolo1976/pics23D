import type { GenerateRequest, ProviderCredentials, TierId } from '@shared/types'
import { buildMultiImagesBit, hi3dErrorToMessage } from './mappers'

/**
 * Hi3D (Sparc3D) 开放 API 客户端（api.hitem3d.ai）。
 * Electron 39 主进程 = Node 22，全局 fetch / FormData / Blob 可直接使用。
 * 本文件不 import electron，保持可被 vitest 直接加载。
 */

export const HI3D_BASE_URL = 'https://api.hitem3d.ai'

/** 档位 → 模型版本与分辨率（tier 映射的唯一事实源） */
export const HI3D_MODEL_SPECS: Record<TierId, { model: string; resolution: string }> = {
  rapid: { model: 'hitem3dv2.1', resolution: '1536fast' },
  pro: { model: 'hi3dv3.0', resolution: '2048quality' }
}

/** 输出格式 → submit-task format 参数（1=obj 2=glb 3=stl 4=fbx 5=usdz） */
const FORMAT_CODES: Partial<Record<GenerateRequest['format'], string>> = {
  OBJ: '1',
  GLB: '2',
  STL: '3',
  FBX: '4',
  USDZ: '5'
}

/** API 错误：code 为 Hi3D 业务错误码（字符串化），如 '40010000' / '401' / '30010000' */
export class Hi3DApiError extends Error {
  code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'Hi3DApiError'
    this.code = code
  }
}

interface Hi3DResponse<T = Record<string, unknown>> {
  code?: number | string
  message?: string
  msg?: string
  data?: T
}

/* ---------------- Token ---------------- */

const tokenCache = new Map<string, string>()

function credsKey(creds: ProviderCredentials): string {
  return `${creds.secretId ?? ''}|${creds.secretKey ?? ''}`
}

/** 获取 accessToken（Basic 认证）；网络/凭据错误抛 Error / Hi3DApiError */
export async function fetchToken(creds: ProviderCredentials): Promise<string> {
  const basic = Buffer.from(`${creds.secretId ?? ''}:${creds.secretKey ?? ''}`).toString('base64')
  let resp: Response
  try {
    resp = await fetch(`${HI3D_BASE_URL}/open-api/v1/auth/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/json' },
      body: '{}'
    })
  } catch (err) {
    throw new Error(`无法连接 Hi3D 服务：${(err as Error).message.slice(0, 120)}`)
  }
  const body = (await resp.json().catch(() => null)) as Hi3DResponse<{ accessToken?: string }> | null
  const code = body?.code != null ? String(body.code) : String(resp.status)
  if (code === '200' && body?.data?.accessToken) return body.data.accessToken
  throw new Hi3DApiError(hi3dErrorToMessage(code, body?.msg ?? body?.message ?? ''), code)
}

/** 带 token 的请求执行器：token 缓存 + 401 时刷新重试一次 */
async function withToken<T>(creds: ProviderCredentials, fn: (token: string) => Promise<T>): Promise<T> {
  const key = credsKey(creds)
  let token = tokenCache.get(key)
  if (!token) {
    token = await fetchToken(creds)
    tokenCache.set(key, token)
  }
  try {
    return await fn(token)
  } catch (err) {
    if (err instanceof Hi3DApiError && err.code === '401') {
      tokenCache.delete(key)
      const fresh = await fetchToken(creds)
      tokenCache.set(key, fresh)
      return await fn(fresh)
    }
    throw err
  }
}

/** 仅获取（并缓存）token，用于密钥探测 */
export async function ensureToken(creds: ProviderCredentials): Promise<string> {
  const key = credsKey(creds)
  const cached = tokenCache.get(key)
  if (cached) return cached
  const token = await fetchToken(creds)
  tokenCache.set(key, token)
  return token
}

export function dropToken(creds: ProviderCredentials): void {
  tokenCache.delete(credsKey(creds))
}

/* ---------------- 通用请求 ---------------- */

/** Bearer 请求 → 解析 JSON；业务错误（code !== 200）抛 Hi3DApiError（401 触发刷新重试） */
async function apiRequest<T = Record<string, unknown>>(
  creds: ProviderCredentials,
  path: string,
  init?: (token: string) => RequestInit
): Promise<T> {
  return withToken(creds, async (token) => {
    const { headers, ...rest } = init?.(token) ?? {}
    let resp: Response
    try {
      resp = await fetch(`${HI3D_BASE_URL}${path}`, {
        ...rest,
        headers: { ...headers, Authorization: `Bearer ${token}` }
      })
    } catch (err) {
      throw new Error(`无法连接 Hi3D 服务：${(err as Error).message.slice(0, 120)}`)
    }
    const body = (await resp.json().catch(() => null)) as Hi3DResponse<T> | null
    const code = body?.code != null ? String(body.code) : String(resp.status)
    if (code !== '200' || !body) {
      throw new Hi3DApiError(hi3dErrorToMessage(code, body?.msg ?? body?.message ?? ''), code)
    }
    return body.data as T
  })
}

/** 查询任务状态 */
export function queryTask(creds: ProviderCredentials, taskId: string): Promise<Record<string, unknown>> {
  return apiRequest(creds, `/open-api/v1/query-task?task_id=${encodeURIComponent(taskId)}`)
}

/* ---------------- 提交任务 ---------------- */

function blobFromBase64(b64: string, mime = 'image/jpeg'): Blob {
  return new Blob([Buffer.from(b64, 'base64')], { type: mime })
}

/**
 * 构造 submit-task 的 multipart 表单。
 * - 白模（request_type=1）：仅几何，无 pbr/纹理
 * - 单图 → images；多视图 → multi_images + multi_images_bit（主图为前视图）
 * - face 仅在显式提供时发送（100000–5000000）
 */
export function buildSubmitForm(req: GenerateRequest): FormData {
  const form = new FormData()
  const whiteModel = !!req.enableWhiteModel || req.generateType === 'Geometry'
  const spec = HI3D_MODEL_SPECS[req.tier]

  form.append('request_type', whiteModel ? '1' : '3')
  form.append('model', spec.model)
  form.append('resolution', spec.resolution)

  if (req.mode === 'image-to-3d') {
    const extra = req.multiViewBase64 ?? []
    if (extra.length > 0) {
      form.append('multi_images_bit', buildMultiImagesBit(extra.length))
      const all = [req.imageBase64 ?? '', ...extra]
      all.forEach((b64, i) => {
        form.append('multi_images', blobFromBase64(b64), `view${i}.jpg`)
      })
    } else {
      form.append('images', blobFromBase64(req.imageBase64 ?? ''), 'input.jpg')
    }
  }

  if (!whiteModel) {
    form.append('pbr', req.enablePBR ? '1' : '0')
  }
  if (req.faceCount) {
    form.append('face', String(Math.min(5_000_000, Math.max(100_000, Math.round(req.faceCount)))))
  }
  form.append('format', FORMAT_CODES[req.format] ?? '2')
  return form
}

/** 提交生成任务，返回 task_id */
export async function submitTask(
  req: GenerateRequest,
  creds: ProviderCredentials
): Promise<string> {
  const data = await apiRequest<{ task_id?: string }>(creds, '/open-api/v1/submit-task', () => ({
    method: 'POST',
    body: buildSubmitForm(req)
  }))
  if (!data?.task_id) throw new Error('云端未返回任务 ID，请稍后重试')
  return data.task_id
}
