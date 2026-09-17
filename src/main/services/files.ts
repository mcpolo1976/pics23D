import { app } from 'electron'
import { join } from 'path'

/** userData 根目录：生产环境 %APPDATA%\图片生成3D模型\（dev 环境不同，密钥“丢失”是正常现象） */
export function userDataRoot(): string {
  return app.getPath('userData')
}

export const SETTINGS_FILE = 'settings.json'
export const CREDENTIALS_FILE = 'credentials.json'
export const TASKS_FILE = 'tasks.json'
export const LOG_FILE = 'main.log'

export function settingsPath(): string {
  return join(userDataRoot(), SETTINGS_FILE)
}

export function credentialsPath(): string {
  return join(userDataRoot(), CREDENTIALS_FILE)
}

export function tasksPath(): string {
  return join(userDataRoot(), TASKS_FILE)
}

export function logsPath(): string {
  return join(userDataRoot(), 'logs')
}

export function logFilePath(): string {
  return join(logsPath(), LOG_FILE)
}

/** 模型根目录 models/ */
export function modelsDir(): string {
  return join(userDataRoot(), 'models')
}

/** 单个任务的产物目录 models/<taskId>/ */
export function taskDir(taskId: string): string {
  return join(modelsDir(), taskId)
}

export function logDir(): string {
  return logsPath()
}
