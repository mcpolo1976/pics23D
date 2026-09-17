import type {
  CostEstimate,
  GenerateRequest,
  PollFile,
  PollResult,
  ProviderCredentials,
  ProviderInfo,
  TierId
} from '@shared/types'
import { PROVIDER_META } from '../meta'
import type { Provider } from '../types'
import { appendLog } from '../../services/storage'
import { getAi3dClient, sdkErrorCode, withSdkError } from './client'
import { interpretProbeError, mapJobStatus } from './mappers'

/** 假 JobId：仅用于密钥探测（鉴权失败=密钥无效，参数校验=密钥有效），不产生任务 */
const PROBE_JOB_ID = 'probe-00000000-0000-0000-0000-000000000000'

/**
 * 腾讯混元生 3D Provider。
 * - 极速版: SubmitHunyuanTo3DRapidJob / QueryHunyuanTo3DRapidJob（15 积分起）
 * - 专业版: SubmitHunyuanTo3DProJob / QueryHunyuanTo3DProJob（Model 3.1；
 *   LowPoly 在 3.1 不可用，提交时回退 3.0）
 * - 白模：极速版 EnableGeometry；专业版 GenerateType='Geometry'
 * - 实扣积分：专业版 Query 返回 ResultCreditConsumed；极速版无回填（留空）
 */
export class Hunyuan3DProvider implements Provider {
  id = 'hunyuan3d' as const
  displayName = '腾讯混元生3D'

  capabilities(): ProviderInfo['capabilities'] {
    return PROVIDER_META.hunyuan3d.capabilities
  }

  estimateCost(req: GenerateRequest): CostEstimate {
    const items: CostEstimate['items'] = []
    let total = 0
    const add = (label: string, credits: number): void => {
      if (credits > 0) items.push({ label, credits })
      total += credits
    }

    if (req.tier === 'rapid') {
      add('极速版基础', 15)
      // 官方文档未明确极速版非 OBJ 格式是否加收，仍按预估展示
      if (req.format !== 'OBJ') add(`输出格式 ${req.format}`, 5)
      if (req.enablePBR) add('PBR 材质', 10)
    } else {
      const base =
        req.enableWhiteModel || req.generateType === 'Geometry'
          ? 15 // Geometry 白模
          : req.generateType === 'LowPoly'
            ? 25
            : 20 // Normal
      add(req.generateType === 'LowPoly' ? '专业版 LowPoly' : '专业版基础', base)
      if (req.multiViewBase64?.length) add(`多视图输入 ×${req.multiViewBase64.length}`, 10)
      if (req.enablePBR && !(req.enableWhiteModel || req.generateType === 'Geometry'))
        add('PBR 材质', 10)
      if (req.faceCount && req.generateType !== 'LowPoly' && !(req.enableWhiteModel || req.generateType === 'Geometry'))
        add('自定义面数', 10)
      if (req.format !== 'OBJ') add(`输出格式 ${req.format}`, 5)
    }

    return {
      total,
      items: items.length > 0 ? items : [{ label: '基础生成', credits: total }],
      disclaimer: '积分为预估，实际扣费以云端返回为准；失败任务不扣费'
    }
  }

  async validateCredentials(creds: ProviderCredentials): Promise<{ ok: boolean; message: string }> {
    let client: ReturnType<typeof getAi3dClient>
    try {
      client = getAi3dClient(creds)
    } catch {
      return { ok: false, message: '客户端初始化失败，请检查密钥格式' }
    }
    try {
      // 假 JobId：鉴权失败=密钥无效；进入参数校验=密钥有效（不产生任务、不耗积分）
      await client.QueryHunyuanTo3DRapidJob({ JobId: PROBE_JOB_ID })
      return { ok: true, message: '密钥有效' }
    } catch (err) {
      const code = sdkErrorCode(err)
      if (!code) {
        // 无错误码 = 网络/代理层失败，无法判定密钥
        const msg = err instanceof Error ? err.message : String(err)
        return { ok: false, message: `无法连接腾讯云服务：${msg.slice(0, 80)}` }
      }
      return interpretProbeError(code)
    }
  }

  async submitJob(
    req: GenerateRequest,
    creds: ProviderCredentials
  ): Promise<{ providerJobId: string }> {
    const client = getAi3dClient(creds)

    if (req.tier === 'rapid') {
      const params: Record<string, unknown> = {
        ResultFormat: req.format,
        EnablePBR: !!req.enablePBR
      }
      if (req.enableWhiteModel) {
        params['EnableGeometry'] = true // 白模（仅 GLB，TaskManager 已校验）
      }
      if (req.mode === 'image-to-3d') {
        params['ImageBase64'] = req.imageBase64
      } else {
        params['Prompt'] = req.prompt
      }
      appendLog('info', `[hunyuan3d] submit rapid format=${req.format} pbr=${!!req.enablePBR}`)
      const resp = await withSdkError(() => client.SubmitHunyuanTo3DRapidJob(params as never))
      if (!resp.JobId) throw new Error('云端未返回任务 ID，请稍后重试')
      return { providerJobId: resp.JobId }
    }

    // 专业版
    const whiteModel = !!req.enableWhiteModel || req.generateType === 'Geometry'
    const generateType = whiteModel ? 'Geometry' : (req.generateType ?? 'Normal')
    const params: Record<string, unknown> = {
      Model: generateType === 'LowPoly' ? '3.0' : '3.1', // 3.1 不支持 LowPoly
      GenerateType: generateType,
      EnablePBR: !!req.enablePBR && !whiteModel // Geometry 模式下 PBR 不生效
    }
    // 专业版 ResultFormat 仅接受 STL/USDZ/FBX，否则省略（默认返回 OBJ+GLB 组）
    if (['STL', 'USDZ', 'FBX'].includes(req.format)) {
      params['ResultFormat'] = req.format
    }
    if (generateType === 'Normal' && req.faceCount) {
      params['FaceCount'] = Math.min(1_500_000, Math.max(3_000, Math.round(req.faceCount)))
    }
    if (req.multiViewBase64?.length) {
      params['MultiViewImages'] = req.multiViewBase64.map((b64) => ({ ViewImageBase64: b64 }))
    }
    if (req.mode === 'image-to-3d') {
      params['ImageBase64'] = req.imageBase64
    } else {
      params['Prompt'] = req.prompt
    }
    appendLog(
      'info',
      `[hunyuan3d] submit pro model=${params['Model']} type=${generateType} format=${req.format}`
    )
    const resp = await withSdkError(() => client.SubmitHunyuanTo3DProJob(params as never))
    if (!resp.JobId) throw new Error('云端未返回任务 ID，请稍后重试')
    return { providerJobId: resp.JobId }
  }

  async pollJob(
    providerJobId: string,
    creds: ProviderCredentials,
    tier: TierId
  ): Promise<PollResult> {
    const client = getAi3dClient(creds)
    if (tier === 'rapid') {
      const resp = await withSdkError(() => client.QueryHunyuanTo3DRapidJob({ JobId: providerJobId }))
      return toPollResult(resp.Status, resp.ResultFile3Ds, resp.ErrorCode, resp.ErrorMessage)
    }
    const resp = await withSdkError(() => client.QueryHunyuanTo3DProJob({ JobId: providerJobId }))
    return toPollResult(
      resp.Status,
      resp.ResultFile3Ds,
      resp.ErrorCode,
      resp.ErrorMessage,
      resp.ResultCreditConsumed
    )
  }
}

type RawFile3D = { Type?: string; Url?: string; PreviewImageUrl?: string } | undefined

function toPollResult(
  status: string | undefined,
  rawFiles: RawFile3D[] | undefined,
  errorCode?: string,
  errorMessage?: string,
  creditConsumed?: number
): PollResult {
  const files: PollFile[] = (rawFiles ?? [])
    .filter((f): f is { Type: string; Url: string; PreviewImageUrl?: string } => !!f?.Url)
    .map((f) => ({
      type: (f.Type ?? 'GLB') as PollFile['type'],
      url: f.Url,
      previewImageUrl: f.PreviewImageUrl
    }))
  return mapJobStatus(status, files, {
    creditConsumed,
    errorCode,
    errorMessage
  })
}

export const hunyuan3DProvider = new Hunyuan3DProvider()
