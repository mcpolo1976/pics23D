import { BrowserWindow, dialog, shell } from 'electron'
import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import type {
  GenerateRequest,
  PollFile,
  TaskParams,
  TaskRecord,
  TierId
} from '@shared/types'
import { queueKey } from '@shared/types'
import { getProvider } from '../providers/registry'
import type { Provider } from '../providers/types'
import { getCredentials } from '../services/settings'
import { appendLog, ensureDir } from '../services/storage'
import { modelsDir, taskDir } from '../services/files'
import { TaskQueue } from './queue'
import { TaskHistory } from './history'
import { downloadToFile, fileNameFromUrl, maybeUnzip } from './downloader'

const POLL_INTERVAL_MS = 5000
const POLL_JITTER_MS = 1000
/** 轮询超时上限：极速 15 分钟 / 专业 30 分钟 */
const TIMEOUT_MS: Record<TierId, number> = {
  rapid: 15 * 60_000,
  pro: 30 * 60_000
}
/** 网络类错误连续 N 次判定失败（业务失败不重试） */
const MAX_NET_ERRORS = 5

/** 业务失败（云端明确返回 FAIL），不重试 */
class ProviderError extends Error {
  constructor(
    message: string,
    public readonly errorCode?: string
  ) {
    super(message)
  }
}

class CanceledError extends Error {
  constructor() {
    super('已取消')
  }
}

const TERMINAL_STATUSES = ['done', 'failed', 'canceled', 'interrupted']

export class TaskManager {
  readonly queue = new TaskQueue()
  readonly history = new TaskHistory()
  private canceled = new Set<string>()

  /** app 启动时调用：加载历史并把遗留的进行中任务标记为 interrupted */
  init(): void {
    this.history.load()
    this.queue.setChangeListener(() => this.emitQueue())
  }

  list(): TaskRecord[] {
    return this.history.all()
  }

  hasActiveTasks(): boolean {
    return this.history
      .all()
      .some((r) => ['queued', 'submitting', 'running', 'downloading'].includes(r.status))
  }

  /** 退出前调用：把进行中的任务标记为 interrupted */
  markAllInterrupted(): void {
    for (const r of this.history.all()) {
      if (['queued', 'submitting', 'running', 'downloading'].includes(r.status)) {
        r.status = 'interrupted'
        this.history.upsert(r)
      }
    }
  }

  submit(req: GenerateRequest): { taskId: string } {
    const provider = getProvider(req.providerId)
    if (!provider) throw new Error('该服务商尚未接入')
    const caps = provider.capabilities()
    if (!caps.enabled) throw new Error(`${provider.displayName} 尚未接入`)
    const tier = caps.tiers.find((t) => t.id === req.tier)
    if (!tier) throw new Error('无效的生成档位')

    // 输入校验
    if (req.mode === 'image-to-3d') {
      if (!req.imageBase64) throw new Error('请先上传图片')
      if (req.prompt?.trim()) throw new Error('图片与文字描述只能选择一种方式')
    } else {
      const prompt = req.prompt?.trim()
      if (!prompt) throw new Error('请输入描述文字')
      if (prompt.length > tier.maxPromptChars) {
        throw new Error(`描述文字最多 ${tier.maxPromptChars} 字`)
      }
    }
    if (req.multiViewBase64?.length) {
      if (!tier.supportsMultiView) throw new Error('当前档位不支持多视图输入')
      if (req.multiViewBase64.length > tier.maxMultiViewImages) {
        throw new Error(`多视图最多追加 ${tier.maxMultiViewImages} 张图片`)
      }
    }
    if (req.enableWhiteModel && tier.whiteModelFormats && !tier.whiteModelFormats.includes(req.format)) {
      throw new Error(`白模仅支持 ${tier.whiteModelFormats.join(' / ')} 格式输出`)
    }

    const params: TaskParams = {
      tier: req.tier,
      mode: req.mode,
      format: req.format,
      enablePBR: req.enablePBR ?? false,
      enableWhiteModel: req.enableWhiteModel ?? false,
      generateType: req.generateType,
      faceCount: req.faceCount,
      prompt: req.mode === 'text-to-3d' ? req.prompt?.trim() : undefined,
      hasImage: !!req.imageBase64,
      multiViewCount: req.multiViewBase64?.length ?? 0
    }

    const taskId = randomUUID()
    const record: TaskRecord = {
      taskId,
      providerId: req.providerId,
      status: 'queued',
      costEstimate: provider.estimateCost(req),
      params,
      createdAt: Date.now(),
      outputUrls: [],
      fileNames: []
    }
    this.history.upsert(record)
    this.emitTask(record)

    this.queue.configure(queueKey(req.providerId, req.tier), tier.concurrency)
    this.queue.enqueue(queueKey(req.providerId, req.tier), taskId, () =>
      this.runTask(record, req, provider)
    )
    appendLog('info', `[task] submitted ${taskId} (${req.providerId}/${req.tier}/${req.format})`)
    return { taskId }
  }

  cancel(taskId: string): void {
    const record = this.history.get(taskId)
    if (!record || TERMINAL_STATUSES.includes(record.status)) return
    this.canceled.add(taskId)
    if (record.status === 'queued') {
      this.queue.dequeueWaiting(queueKey(record.providerId, record.params.tier), taskId)
      record.status = 'canceled'
      record.finishedAt = Date.now()
      this.history.upsert(record)
      this.emitTask(record)
    }
    // submitting/running：轮询循环检测到 canceled 标记后自行退出并落状态
  }

  /** 恢复查询 interrupted 任务（云端 JobId 24h 内有效） */
  resume(taskId: string): void {
    const record = this.history.get(taskId)
    if (!record) throw new Error('任务不存在')
    if (record.status !== 'interrupted') throw new Error('仅“已中断”的任务可恢复查询')
    if (!record.providerJobId) throw new Error('该任务未提交到云端，无法恢复，请重新生成')
    const provider = getProvider(record.providerId)
    if (!provider) throw new Error('该服务商尚未接入')
    this.canceled.delete(taskId)
    const tier = record.params.tier
    this.queue.configure(queueKey(record.providerId, tier), this.concurrencyOf(provider, tier))
    record.status = 'running'
    this.history.upsert(record)
    this.emitTask(record)
    this.queue.enqueue(queueKey(record.providerId, tier), taskId, () =>
      this.resumeRun(record, provider)
    )
  }

  removeTask(taskId: string, deleteFiles: boolean): void {
    const record = this.history.get(taskId)
    if (!record) return
    if (!TERMINAL_STATUSES.includes(record.status)) {
      throw new Error('任务进行中，请先取消再删除')
    }
    if (deleteFiles) {
      const dir = taskDir(taskId)
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true })
      }
    }
    this.history.remove(taskId)
  }

  async exportTask(taskId: string): Promise<{ savedPath: string } | null> {
    const record = this.history.get(taskId)
    if (!record || record.outputUrls.length === 0) return null
    const first = record.fileNames[0]
    const src = join(taskDir(taskId), first)
    if (!existsSync(src)) return null
    const ext = extnameSafe(first)
    const result = await dialog.showSaveDialog({
      title: '导出模型',
      defaultPath: `model${ext}`
    })
    if (result.canceled || !result.filePath) return null
    copyFileSync(src, result.filePath)
    return { savedPath: result.filePath }
  }

  openTaskFolder(taskId: string): void {
    const record = this.history.get(taskId)
    if (!record) return
    const dir = taskDir(taskId)
    const target =
      record.fileNames.length > 0 && existsSync(join(dir, record.fileNames[0]))
        ? join(dir, record.fileNames[0])
        : dir
    if (existsSync(target)) {
      shell.showItemInFolder(target)
    }
  }

  /* ---------------- 内部流程 ---------------- */

  private concurrencyOf(provider: Provider, tier: TierId): number {
    return provider.capabilities().tiers.find((t) => t.id === tier)?.concurrency ?? 1
  }

  private async runTask(record: TaskRecord, req: GenerateRequest, provider: Provider): Promise<void> {
    const key = queueKey(record.providerId, record.params.tier)
    try {
      if (this.canceled.has(record.taskId)) throw new CanceledError()
      const creds = getCredentials(record.providerId)
      if (!creds) throw new Error('未配置密钥，请在设置中填写 SecretId/SecretKey')

      record.status = 'submitting'
      record.startedAt = Date.now()
      this.history.upsert(record)
      this.emitTask(record)

      const { providerJobId } = await provider.submitJob(req, creds)
      record.providerJobId = providerJobId
      record.status = 'running'
      this.history.upsert(record)
      this.emitTask(record)
      appendLog('info', `[task] ${record.taskId} running, providerJobId=${providerJobId}`)

      await this.pollLoop(record, provider, creds)
    } catch (err) {
      this.settleError(record, err)
    } finally {
      this.queue.markFinished(key, record.taskId)
    }
  }

  private async resumeRun(record: TaskRecord, provider: Provider): Promise<void> {
    const key = queueKey(record.providerId, record.params.tier)
    try {
      const creds = getCredentials(record.providerId)
      if (!creds) throw new Error('未配置密钥，无法恢复查询')
      await this.pollLoop(record, provider, creds)
    } catch (err) {
      this.settleError(record, err)
    } finally {
      this.queue.markFinished(key, record.taskId)
    }
  }

  private async pollLoop(record: TaskRecord, provider: Provider, creds: NonNullable<ReturnType<typeof getCredentials>>): Promise<void> {
    const deadline = Date.now() + TIMEOUT_MS[record.params.tier]
    let netErrors = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (this.canceled.has(record.taskId)) throw new CanceledError()
      if (Date.now() > deadline) {
        throw new Error('生成超时，云端任务可能仍在进行，请稍后到服务商平台查看')
      }
      await sleep(POLL_INTERVAL_MS + Math.floor(Math.random() * POLL_JITTER_MS))
      if (this.canceled.has(record.taskId)) throw new CanceledError()
      try {
        const result = await provider.pollJob(record.providerJobId!, creds, record.params.tier)
        netErrors = 0
        if (result.status === 'running') continue
        if (result.status === 'failed') {
          throw new ProviderError(result.errorMessage || '生成失败', result.errorCode)
        }
        // succeeded
        record.status = 'downloading'
        this.history.upsert(record)
        this.emitTask(record)
        await this.downloadOutputs(record, result.files)
        record.status = 'done'
        record.costActual = result.creditConsumed
        record.finishedAt = Date.now()
        this.history.upsert(record)
        this.emitTask(record)
        appendLog('info', `[task] ${record.taskId} done (${record.fileNames.join(', ')})`)
        return
      } catch (err) {
        if (err instanceof CanceledError) throw err
        if (err instanceof ProviderError) throw err
        netErrors++
        appendLog('warn', `[task] ${record.taskId} poll error (${netErrors}/${MAX_NET_ERRORS}): ${String(err)}`)
        if (netErrors >= MAX_NET_ERRORS) {
          throw new Error('网络异常，连续多次查询失败')
        }
      }
    }
  }

  private async downloadOutputs(record: TaskRecord, files: PollFile[]): Promise<void> {
    const dir = taskDir(record.taskId)
    ensureDir(dir)
    const fileNames: string[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      if (this.canceled.has(record.taskId)) throw new CanceledError()
      let name = fileNameFromUrl(f.url, f.type, i)
      const dest = join(dir, name)
      await downloadToFile(f.url, dest)
      // zip 组文件（如带贴图的 OBJ）：解包后以解出文件为准
      const extracted = maybeUnzip(dest, dir)
      if (extracted.length > 0) {
        rmSyncSafe(dest)
        fileNames.push(...extracted)
      } else {
        fileNames.push(name)
      }
      if (f.previewImageUrl && !record.previewUrl) {
        try {
          const previewName = 'preview.jpg'
          await downloadToFile(f.previewImageUrl, join(dir, previewName))
          record.previewUrl = `appfile://models/${record.taskId}/${previewName}`
        } catch {
          // 预览图失败不影响主流程
        }
      }
    }
    record.fileNames = fileNames
    record.outputUrls = fileNames.map(
      (n) => `appfile://models/${record.taskId}/${encodeURIComponent(n)}`
    )
  }

  private settleError(record: TaskRecord, err: unknown): void {
    if (err instanceof CanceledError || this.canceled.has(record.taskId)) {
      record.status = 'canceled'
      record.error = '已取消（云端任务不会自动取消）'
    } else {
      record.status = 'failed'
      record.error = err instanceof Error ? err.message : String(err)
    }
    record.finishedAt = Date.now()
    this.history.upsert(record)
    this.emitTask(record)
    appendLog('warn', `[task] ${record.taskId} -> ${record.status}: ${record.error ?? ''}`)
  }

  private emitTask(record: TaskRecord): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('task:updated', record)
    }
  }

  private emitQueue(): void {
    const payload = {
      running: this.queue.snapshot(),
      waitingCount: this.queue.waitingCount()
    }
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('queue:changed', payload)
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function rmSyncSafe(path: string): void {
  try {
    rmSync(path, { force: true })
  } catch {
    // 清理临时文件失败不阻塞
  }
}

function extnameSafe(name: string): string {
  const idx = name.lastIndexOf('.')
  return idx >= 0 ? name.slice(idx) : ''
}

export const taskManager = new TaskManager()
export { modelsDir }
