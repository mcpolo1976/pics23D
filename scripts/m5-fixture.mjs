/**
 * M5 fixture 注入：应用停止期间向 tasks.json 写入一条 interrupted 任务，
 * 供 cdp-smoke-m5.mjs 验证"启动加载 → 恢复查询 → 取消"链路。
 * 用法：node scripts/m5-fixture.mjs
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const userData = join(homedir(), 'AppData', 'Roaming', 'img-to-3d')
const tasksFile = join(userData, 'tasks.json')

if (!existsSync(userData)) {
  console.error(`userData 不存在: ${userData}（应用是否从未运行过？）`)
  process.exit(1)
}

const records = existsSync(tasksFile) ? JSON.parse(readFileSync(tasksFile, 'utf-8')) : []
const existing = new Set(records.map((r) => r.taskId))

const fixtureId = 'smoke-m5-interrupted-0000-000000000000'
const fixture = {
  taskId: fixtureId,
  providerId: 'hunyuan3d',
  status: 'interrupted',
  providerJobId: 'probe-00000000-0000-0000-0000-000000000000',
  params: {
    tier: 'rapid',
    mode: 'image-to-3d',
    format: 'GLB',
    enablePBR: false,
    enableWhiteModel: false,
    hasImage: true,
    multiViewCount: 0
  },
  createdAt: Date.now(),
  outputUrls: [],
  fileNames: []
}
// 幂等 upsert：存在则重置为 interrupted（清掉上次运行残留的终态）
const idx = records.findIndex((r) => r.taskId === fixtureId)
if (idx >= 0) {
  records[idx] = fixture
  console.log(`fixture 已重置: ${fixtureId}`)
} else {
  records.unshift(fixture)
  console.log(`fixture 已写入: ${fixtureId}`)
}
writeFileSync(tasksFile, JSON.stringify(records, null, 2), 'utf-8')
