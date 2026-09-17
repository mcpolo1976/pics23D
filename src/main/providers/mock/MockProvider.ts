import { join } from 'path'
import type {
  CostEstimate,
  GenerateRequest,
  PollResult,
  ProviderCredentials,
  ProviderInfo
} from '@shared/types'
import { PROVIDER_META } from '../meta'
import type { Provider } from '../types'
import { is } from '@electron-toolkit/utils'
import { appendLog } from '../../services/storage'

/**
 * MockProvider：本地假流水线，不消耗任何积分。
 * 提交后约 6 秒返回 resources/test/cube.glb，用于在接入真实 API 前验证
 * 队列、状态机、下载与 Viewer 全链路。
 * M3 接入真实腾讯服务后从 registry 移除。
 */
class MockProvider implements Provider {
  id = 'hunyuan3d' as const
  displayName = '腾讯混元生3D（本地模拟）'

  private counter = 0
  private startedAt = new Map<string, number>()

  capabilities(): ProviderInfo['capabilities'] {
    return PROVIDER_META.hunyuan3d.capabilities
  }

  estimateCost(_req: GenerateRequest): CostEstimate {
    return {
      total: 0,
      items: [{ label: '本地模拟任务', credits: 0 }],
      disclaimer: '当前为本地模拟模式，不消耗积分'
    }
  }

  async validateCredentials(_creds: ProviderCredentials): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: '本地模拟模式：跳过密钥校验' }
  }

  async submitJob(_req: GenerateRequest, _creds: ProviderCredentials): Promise<{ providerJobId: string }> {
    const id = `mock-${Date.now()}-${++this.counter}`
    this.startedAt.set(id, Date.now())
    appendLog('info', `[mock] submitJob -> ${id}`)
    return { providerJobId: id }
  }

  async pollJob(providerJobId: string, _creds: ProviderCredentials): Promise<PollResult> {
    // 与真实云端一致：查询幂等（DONE 保持 DONE）。
    // 未知 jobId（如重启后恢复查询）从首次查询起算 6 秒完成；
    // 已删除 startedAt 的旧实现会让重试轮询永远拿到 started=now，卡在 running。
    let started = this.startedAt.get(providerJobId)
    if (started === undefined) {
      started = Date.now()
      this.startedAt.set(providerJobId, started)
    }
    if (Date.now() - started < 6000) {
      return { status: 'running' }
    }
    const glbPath = this.testGlbPath()
    appendLog('info', `[mock] job done -> ${glbPath}`)
    return {
      status: 'succeeded',
      files: [{ type: 'GLB', url: `file:///${glbPath.replace(/\\/g, '/')}` }],
      creditConsumed: 0
    }
  }

  /** 测试用 GLB：dev 为项目 resources/test/，生产为 process.resourcesPath/test/ */
  private testGlbPath(): string {
    const fileName = 'cube.glb'
    return is.dev && process.env['ELECTRON_RENDERER_URL']
      ? join(__dirname, '../../resources/test', fileName) // out/main -> 项目根
      : join(process.resourcesPath, 'test', fileName)
  }
}

export const mockProvider = new MockProvider()
