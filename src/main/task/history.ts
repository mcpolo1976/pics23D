import type { TaskRecord, TaskStatus } from '@shared/types'
import { tasksPath } from '../services/files'
import { readJson, writeJsonAtomic } from '../services/storage'

const MAX_TASKS = 200

/** 启动时需要被标记为 interrupted 的“进行中”状态 */
const ACTIVE_STATUSES: TaskStatus[] = ['queued', 'submitting', 'running', 'downloading']

/**
 * 任务历史持久化（tasks.json，滚动保留最近 200 条）。
 * 应用启动时把上次遗留的进行中任务标记为 interrupted（云端任务未取消，24h 内可恢复查询）。
 */
export class TaskHistory {
  private records: TaskRecord[] = []

  load(): TaskRecord[] {
    const loaded = readJson<TaskRecord[]>(tasksPath(), [])
    this.records = loaded.map((r) =>
      ACTIVE_STATUSES.includes(r.status) ? { ...r, status: 'interrupted' as const } : r
    )
    this.persist()
    return this.records
  }

  all(): TaskRecord[] {
    return [...this.records]
  }

  get(taskId: string): TaskRecord | undefined {
    return this.records.find((r) => r.taskId === taskId)
  }

  upsert(record: TaskRecord): void {
    const idx = this.records.findIndex((r) => r.taskId === record.taskId)
    if (idx >= 0) {
      this.records[idx] = record
    } else {
      this.records.unshift(record)
      if (this.records.length > MAX_TASKS) {
        this.records.length = MAX_TASKS
      }
    }
    this.persist()
  }

  remove(taskId: string): void {
    this.records = this.records.filter((r) => r.taskId !== taskId)
    this.persist()
  }

  private persist(): void {
    writeJsonAtomic(tasksPath(), this.records)
  }
}
