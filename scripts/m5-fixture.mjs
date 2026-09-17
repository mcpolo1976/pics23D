/**
 * M5 fixture 注入：应用停止期间向 tasks.json 写入一条 interrupted 任务，
 * 供 cdp-smoke-m5.mjs 验证"启动加载 → 恢复查询 → 取消"链路。
 * 用法：node scripts/m5-fixture.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// userData 由 package.json 的 name 决定（%APPDATA%\img-to-3d），dev 与打包版共用；
// electron-builder 的 productName 只影响安装包/窗口名。优先取已有 tasks.json 的目录，可用 argv[2] 强制指定。
const roaming = join(homedir(), 'AppData', 'Roaming')
const candidates = [
  process.argv[2],
  join(roaming, '图片生成3D模型'),
  join(roaming, 'img-to-3d')
].filter(Boolean)
const userData =
  candidates.find((d) => existsSync(join(d, 'tasks.json'))) ??
  candidates.find((d) => existsSync(d)) ??
  candidates[0]
const tasksFile = join(userData, 'tasks.json')

if (!existsSync(userData)) {
  console.error(
    `userData 不存在: ${userData}（应用是否从未运行过？可显式指定: node scripts/m5-fixture.mjs <userDataDir>）`
  )
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
