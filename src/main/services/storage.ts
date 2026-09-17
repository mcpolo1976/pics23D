import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { logDir } from './files'

/**
 * JSON 原子写：先写 *.tmp 再 rename（NTFS 同卷原子），避免写一半崩溃损坏数据。
 * Windows 上 rename 可能被杀毒/索引器短暂占用而瞬时 EPERM，做小退避重试。
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  const tmp = join(dir, `.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`)
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, filePath)
      return
    } catch (err) {
      if (attempt >= 3) {
        try {
          rmSync(tmp, { force: true }) // 清理残留 tmp，避免目录堆积
        } catch {
          // 清理失败忽略
        }
        throw err
      }
      const waitMs = 40 * (attempt + 1)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, waitMs)
    }
  }
}

export function readJson<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as T
  } catch {
    // 损坏文件按缺失处理，返回默认值
    return fallback
  }
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

/** 简单分级日志（脱敏由调用方保证），追加到 userData/logs/main.log */
export function appendLog(level: 'info' | 'warn' | 'error', message: string): void {
  try {
    ensureDir(logDir())
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`
    if (level === 'error') console.error(message)
    else if (level === 'warn') console.warn(message)
    else console.log(message)
    appendFileSync(join(logDir(), 'main.log'), line, 'utf-8')
  } catch {
    // 日志失败不影响主流程
  }
}
