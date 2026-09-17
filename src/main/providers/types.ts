import type {
  GenerateRequest,
  ProviderCredentials,
  ProviderInfo,
  PollResult,
  CostEstimate,
  TierId
} from '@shared/types'

/**
 * Provider 接口：新增服务商 = 实现此接口 + 在 registry.ts 注册一行。
 * 下载属于通用逻辑（task/downloader.ts），不在此接口内——实现只产出文件 URL。
 */
export interface Provider {
  id: ProviderInfo['id']
  displayName: string
  capabilities(): ProviderInfo['capabilities']
  /** 生成前的积分预估（UI 展示明细） */
  estimateCost(req: GenerateRequest): CostEstimate
  /** 校验凭据（不消耗积分） */
  validateCredentials(creds: ProviderCredentials): Promise<{ ok: boolean; message: string }>
  /** 提交生成任务，返回云端任务 ID */
  submitJob(req: GenerateRequest, creds: ProviderCredentials): Promise<{ providerJobId: string }>
  /** 轮询任务状态（tier 用于区分同一服务商的不同档位 API） */
  pollJob(
    providerJobId: string,
    creds: ProviderCredentials,
    tier: TierId
  ): Promise<PollResult>
}
