import { contextBridge, ipcRenderer } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { RendererApi } from '@shared/types'

const api: RendererApi = {
  getInfo: () => ipcRenderer.invoke('app:getInfo'),
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  setPrefs: (prefs) => ipcRenderer.invoke('settings:setPrefs', prefs),
  saveSecrets: (providerId, secretId, secretKey) =>
    ipcRenderer.invoke('secrets:save', providerId, secretId, secretKey),
  clearSecrets: (providerId) => ipcRenderer.invoke('secrets:clear', providerId),
  testSecrets: (providerId) => ipcRenderer.invoke('secrets:test', providerId),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  estimateCost: (req) => ipcRenderer.invoke('provider:estimate', req),
  pickImage: () => ipcRenderer.invoke('dialog:pickImage'),
  submitTask: (req) => ipcRenderer.invoke('task:submit', req),
  cancelTask: (taskId) => ipcRenderer.invoke('task:cancel', taskId),
  listTasks: () => ipcRenderer.invoke('task:list'),
  resumeTask: (taskId) => ipcRenderer.invoke('task:resume', taskId),
  removeTask: (taskId, deleteFiles) => ipcRenderer.invoke('task:remove', taskId, deleteFiles),
  exportTask: (taskId) => ipcRenderer.invoke('task:export', taskId),
  openFolder: (taskId) => ipcRenderer.invoke('task:openFolder', taskId),
  onTaskUpdated: (cb) => {
    const listener = (_e: IpcRendererEvent, task: Parameters<typeof cb>[0]): void =>
      cb(task)
    ipcRenderer.on('task:updated', listener)
    return () => ipcRenderer.removeListener('task:updated', listener)
  },
  onQueueChanged: (cb) => {
    const listener = (_e: IpcRendererEvent, q: Parameters<typeof cb>[0]): void => cb(q)
    ipcRenderer.on('queue:changed', listener)
    return () => ipcRenderer.removeListener('queue:changed', listener)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.api = api
}
