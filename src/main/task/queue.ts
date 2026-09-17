import { appendLog } from '../services/storage'

/**
 * 按 (providerId:tier) 分 key 的并发队列。
 * concurrency 来自服务商 capabilities（极速 1 / 专业 3 = 账号级默认并发）。
 */
export interface QueueSlot {
  key: string
  concurrency: number
  waiting: string[]
  running: Map<string, () => Promise<void>>
}

export class TaskQueue {
  private slots = new Map<string, QueueSlot>()
  private onChange: (() => void) | null = null

  setChangeListener(cb: () => void): void {
    this.onChange = cb
  }

  /** 注册/更新某 key 的并发上限（取服务商 capabilities） */
  configure(key: string, concurrency: number): void {
    const existing = this.slots.get(key)
    if (existing) {
      existing.concurrency = concurrency
    } else {
      this.slots.set(key, { key, concurrency, waiting: [], running: new Map() })
    }
  }

  enqueue(key: string, taskId: string, runner: () => Promise<void>): void {
    this.configure(key, this.concurrencyOf(key))
    const slot = this.slots.get(key)!
    slot.waiting.push(taskId)
    this.runners.set(taskId, runner)
    appendLog('info', `[queue] enqueue ${taskId} -> ${key} (waiting=${slot.waiting.length})`)
    this.schedule(key)
    this.onChange?.()
  }

  /** 从等待队列移除（取消排队中的任务）；返回是否移除成功 */
  dequeueWaiting(key: string, taskId: string): boolean {
    const slot = this.slots.get(key)
    if (!slot) return false
    const idx = slot.waiting.indexOf(taskId)
    if (idx === -1) return false
    slot.waiting.splice(idx, 1)
    this.runners.delete(taskId)
    this.onChange?.()
    return true
  }

  /** 标记运行中任务结束（用于状态同步，如失败/取消） */
  markFinished(key: string, taskId: string): void {
    const slot = this.slots.get(key)
    if (slot) {
      slot.running.delete(taskId)
      this.schedule(key)
      this.onChange?.()
    }
  }

  isWaiting(key: string, taskId: string): boolean {
    return this.slots.get(key)?.waiting.includes(taskId) ?? false
  }

  isRunning(key: string, taskId: string): boolean {
    return this.slots.get(key)?.running.has(taskId) ?? false
  }

  waitingCount(): number {
    let n = 0
    for (const slot of this.slots.values()) n += slot.waiting.length
    return n
  }

  /** 当前运行状态快照（key → taskId | null），供状态栏展示 */
  snapshot(): Record<string, string | null> {
    const out: Record<string, string | null> = {}
    for (const [key, slot] of this.slots) {
      out[key] = slot.running.keys().next().value ?? null
    }
    return out
  }

  private concurrencyOf(key: string): number {
    return this.slots.get(key)?.concurrency ?? 1
  }

  private runners = new Map<string, () => Promise<void>>()

  private schedule(key: string): void {
    const slot = this.slots.get(key)
    if (!slot) return
    while (slot.running.size < slot.concurrency && slot.waiting.length > 0) {
      const taskId = slot.waiting.shift()!
      const runner = this.runners.get(taskId)
      this.runners.delete(taskId)
      if (!runner) continue
      slot.running.set(taskId, runner)
      // 不 await：启动即轮转，错误由 runner 自行落到任务状态
      void runner()
        .finally(() => {
          slot.running.delete(taskId)
          this.schedule(key)
          this.onChange?.()
        })
        .catch(() => {
          // runner 内部已将错误写入任务状态；此处仅避免未处理的 Promise 拒绝
        })
    }
  }
}
