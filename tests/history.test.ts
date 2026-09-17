import { describe, expect, it, beforeEach, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { join } from 'path'
import { tmpdir } from 'os'

const state = vi.hoisted(() => ({ path: '' }))
// history → files 依赖 electron app，mock 掉 tasks.json 路径（每个用例独立文件）
vi.mock('../src/main/services/files', () => ({
  tasksPath: () => state.path
}))

import type { TaskRecord, TaskStatus } from '@shared/types'
import { TaskHistory } from '../src/main/task/history'

function makeRecord(taskId: string, status: TaskStatus, createdAt: number): TaskRecord {
  return {
    taskId,
    providerId: 'hunyuan3d',
    status,
    params: { tier: 'rapid', mode: 'image-to-3d', format: 'GLB', enablePBR: false, enableWhiteModel: false, hasImage: true, multiViewCount: 0 },
    createdAt,
    outputUrls: [],
    fileNames: []
  }
}

beforeEach(() => {
  state.path = join(tmpdir(), `img3d-hist-${randomUUID()}.json`)
})

describe('TaskHistory', () => {
  it('load() 把进行中状态标记为 interrupted（启动恢复语义）', () => {
    const h = new TaskHistory()
    h.upsert(makeRecord('a', 'running', 1))
    h.upsert(makeRecord('b', 'done', 2))
    h.upsert(makeRecord('c', 'queued', 3))

    // 模拟重启：新实例从磁盘加载
    const h2 = new TaskHistory()
    const loaded = h2.load()
    const a = loaded.find((r) => r.taskId === 'a')
    const b = loaded.find((r) => r.taskId === 'b')
    const c = loaded.find((r) => r.taskId === 'c')
    expect(a?.status).toBe('interrupted')
    expect(b?.status).toBe('done')
    expect(c?.status).toBe('interrupted')
  })

  it('upsert 新纪录插到最前，超过 200 条淘汰最旧', () => {
    const h = new TaskHistory()
    for (let i = 0; i < 205; i++) {
      h.upsert(makeRecord(`t-${i}`, 'done', i))
    }
    const all = h.all()
    expect(all.length).toBe(200)
    expect(all[0].taskId).toBe('t-204') // 最新在前
    expect(all[199].taskId).toBe('t-5') // t-0..t-4 被淘汰
  })

  it('upsert 已存在任务原地更新不产生重复', () => {
    const h = new TaskHistory()
    h.upsert(makeRecord('x', 'running', 1))
    h.upsert(makeRecord('y', 'done', 2))
    const updated = { ...makeRecord('x', 'done', 1), outputUrls: ['appfile://models/x/m.glb'] }
    h.upsert(updated)
    const all = h.all()
    expect(all.length).toBe(2)
    expect(all.find((r) => r.taskId === 'x')?.outputUrls).toEqual(['appfile://models/x/m.glb'])
  })

  it('remove 删除指定任务并持久化', () => {
    const h = new TaskHistory()
    h.upsert(makeRecord('a', 'done', 1))
    h.upsert(makeRecord('b', 'done', 2))
    h.remove('a')
    expect(h.get('a')).toBeUndefined()

    const h2 = new TaskHistory()
    h2.load()
    expect(h2.get('a')).toBeUndefined()
    expect(h2.get('b')).toBeDefined()
  })
})
