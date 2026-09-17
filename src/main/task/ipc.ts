import { ipcMain } from 'electron'
import type { GenerateRequest } from '@shared/types'
import { taskManager } from './TaskManager'

/** 任务相关 IPC 通道注册 */
export function registerTaskIpc(): void {
  ipcMain.handle('task:submit', (_e, req: GenerateRequest) => taskManager.submit(req))

  ipcMain.handle('task:cancel', (_e, taskId: string) => taskManager.cancel(taskId))

  ipcMain.handle('task:list', () => taskManager.list())

  ipcMain.handle('task:resume', (_e, taskId: string) => taskManager.resume(taskId))

  ipcMain.handle('task:remove', (_e, taskId: string, deleteFiles: boolean) =>
    taskManager.removeTask(taskId, deleteFiles)
  )

  ipcMain.handle('task:export', (_e, taskId: string) => taskManager.exportTask(taskId))

  ipcMain.handle('task:openFolder', (_e, taskId: string) => taskManager.openTaskFolder(taskId))
}
