import { ipcMain, dialog, BrowserWindow, app } from 'electron'
import { readFileSync } from 'fs'
import type { AppInfo, GenerateRequest, PickedImage, ProviderId, Settings } from '@shared/types'
import {
  clearSecrets,
  getCredentials,
  isSecretStorageAvailable,
  loadSettings,
  saveSecrets,
  setPrefs
} from './services/settings'
import { appendLog } from './services/storage'
import { getProvider, listProviderInfos } from './providers/registry'
import { registerTaskIpc } from './task/ipc'

/**
 * 全部 ipcMain.handle 注册入口（薄层，业务在各 service/provider/task 模块内）。
 */
export function registerIpcHandlers(): void {
  /* -------- app -------- */
  ipcMain.handle('app:getInfo', (): AppInfo => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    userDataPath: app.getPath('userData')
  }))

  /* -------- settings / secrets -------- */
  ipcMain.handle('settings:getAll', (): Settings => loadSettings())

  ipcMain.handle('settings:setPrefs', (_e, prefs: Partial<Settings['prefs']>): Settings =>
    setPrefs(prefs)
  )

  ipcMain.handle(
    'secrets:save',
    (_e, providerId: ProviderId, secretId: string, secretKey: string) => {
      if (!secretId.trim() || !secretKey.trim()) {
        throw new Error('SecretId 与 SecretKey 均不能为空')
      }
      const hint = saveSecrets(providerId, secretId.trim(), secretKey.trim())
      appendLog('info', `[secrets] saved for ${providerId}`)
      return hint
    }
  )

  ipcMain.handle('secrets:clear', (_e, providerId: ProviderId) => {
    clearSecrets(providerId)
    appendLog('info', `[secrets] cleared for ${providerId}`)
  })

  ipcMain.handle('secrets:test', async (_e, providerId: ProviderId) => {
    if (!isSecretStorageAvailable()) {
      return { ok: false, message: '系统加密服务不可用' }
    }
    const provider = getProvider(providerId)
    if (!provider) {
      return { ok: false, message: '该服务商尚未接入' }
    }
    const creds = getCredentials(providerId)
    if (!creds) {
      return { ok: false, message: '尚未配置密钥，请先填写并保存' }
    }
    try {
      return await provider.validateCredentials(creds)
    } catch (err) {
      appendLog('warn', `[secrets] test failed: ${String(err)}`)
      return { ok: false, message: `连接失败：${(err as Error).message}` }
    }
  })

  /* -------- providers -------- */
  ipcMain.handle('providers:list', () => listProviderInfos())

  ipcMain.handle('provider:estimate', (_e, req: GenerateRequest) => {
    const provider = getProvider(req.providerId)
    if (!provider) throw new Error('该服务商尚未接入')
    return provider.estimateCost(req)
  })

  /* -------- dialog / files -------- */
  ipcMain.handle('dialog:pickImage', async (): Promise<PickedImage | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '选择图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const filePath = result.filePaths[0]
    const bytes = readFileSync(filePath)
    return { name: filePath.split(/[\\/]/).pop() ?? 'image', bytes: new Uint8Array(bytes) }
  })

  /* -------- task（TaskManager 接入后生效） -------- */
  registerTaskIpc()
}
