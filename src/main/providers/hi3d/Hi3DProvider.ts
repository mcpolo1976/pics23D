import type {
  CostEstimate,
  GenerateRequest,
  PollResult,
  ProviderCredentials,
  ProviderInfo,
  TierId
} from '@shared/types'
import { PROVIDER_META } from '../meta'
import type { Provider } from '../types'
import { appendLog } from '../../services/storage'
import { Hi3DApiError, fetchToken, queryTask, submitTask } from './client'
import { MODEL_COSTS, hi3dErrorToMessage, hi3dStateToPollResult } from './mappers'

/**
 * Hi3D (Sparc3D) Provider —— api.hitem3d.ai 开放 API。
 * - 极速版: hitem3dv2.1 @ 1536fast（几何 10 + 纹理 10 + PBR 5）
 * - 高质版: hi3dv3.0 @ 2048quality（几何 90 + 纹理 10 + PBR 5）
 * - 白模：request_type=1（仅几何，输出格式不限）
 * - 多视图（前/后/左/右，最多 4 张）与面数控制不额外计费；失败退还积分
 * - 鉴权：client_id/secret → Basic 换 Bearer token（token 缓存，401 自动刷新）
 */
export class Hi3DProvider implements Provider {
  id = 'hi3d' as const
  displayName = 'Hi3D (Sparc3D)'

  capabilities(): ProviderInfo['capabilities'] {
    return PROVIDER_META.hi3d.capabilities
  }

  estimateCost(req: GenerateRequest): CostEstimate {
    const costs = MODEL_COSTS[req.tier]
    const whiteModel = !!req.enableWhiteModel || req.generateType === 'Geometry'
    const items: CostEstimate['items'] = []
    let total = 0
    const add = (label: string, credits: number): void => {
      if (credits > 0) items.push({ label, credits })
      total += credits
    }

    if (whiteModel) {
      // 仅几何：无纹理/PBR
      add(req.tier === 'rapid' ? '几何生成（v2.1 极速）' : '几何生成（v3.0 高质）', costs.geometry)
    } else {
      add(req.tier === 'rapid' ? '几何生成（v2.1 极速）' : '几何生成（v3.0 高质）', costs.geometry)
      add('纹理生成', costs.texture)
      if (req.enablePBR) add('PBR 材质', costs.pbr)
    }
    // 多视图 / 面数 / 输出格式均免费，不出明细行

    return {
      total,
      items: items.length > 0 ? items : [{ label: '基础生成', credits: total }],
      disclaimer: '积分为预估，实际扣费以云端返回为准；失败任务退还积分'
    }
  }

  async validateCredentials(creds: ProviderCredentials): Promise<{ ok: boolean; message: string }> {
    try {
      // 换 token 不消耗积分；凭据错误 → 40010000
      await fetchToken(creds)
      return { ok: true, message: '密钥有效' }
    } catch (err) {
      if (err instanceof Hi3DApiError) {
        if (err.code === '40010000') return { ok: false, message: 'Client ID 或 Client Secret 错误' }
        return { ok: false, message: err.message }
      }
      return { ok: false, message: (err as Error).message }
    }
  }

  async submitJob(
    req: GenerateRequest,
    creds: ProviderCredentials
  ): Promise<{ providerJobId: string }> {
    const whiteModel = !!req.enableWhiteModel || req.generateType === 'Geometry'
    appendLog(
      'info',
      `[hi3d] submit tier=${req.tier} white=${whiteModel} pbr=${!!req.enablePBR} format=${req.format} multiview=${req.multiViewBase64?.length ?? 0}`
    )
    const taskId = await submitTask(req, creds)
    return { providerJobId: taskId }
  }

  async pollJob(
    providerJobId: string,
    creds: ProviderCredentials,
    tier: TierId
  ): Promise<PollResult> {
    void tier
    try {
      const data = await queryTask(creds, providerJobId)
      return hi3dStateToPollResult(data)
    } catch (err) {
      // 生成失败是终态（云端已退还积分），不能走网络重试
      if (err instanceof Hi3DApiError && err.code === '50010001') {
        return { status: 'failed', errorCode: err.code, errorMessage: hi3dErrorToMessage(err.code, 'generate failed') }
      }
      throw err
    }
  }
}

export const hi3DProvider = new Hi3DProvider()
