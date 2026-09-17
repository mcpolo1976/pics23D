import { app, shell, BrowserWindow, protocol, net, dialog } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { taskManager } from './task/TaskManager'
import { appendLog, ensureDir } from './services/storage'
import { modelsDir } from './services/files'
import icon from '../../resources/icon.png?asset'

// 是否处于退出流程（用于关闭拦截判断）
let quitting = false

// appfile:// → userData/models/ 映射，renderer 由此加载模型与预览图（CSP 全程禁外网）
// corsEnabled: 自定义 scheme 默认不在 Chromium 的 CORS-fetch scheme 白名单内，
// 页面从 http(s)/file 源 fetch appfile:// 会被直接拒绝，必须开启
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'appfile',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])

function registerAppFileProtocol(): void {
  ensureDir(modelsDir())
  const root = modelsDir()
  protocol.handle('appfile', async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host !== 'models') {
        return withCors(new Response('not found', { status: 404 }))
      }
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
      const abs = join(root, rel)
      if (!abs.startsWith(root)) {
        return withCors(new Response('forbidden', { status: 403 }))
      }
      const resp = await net.fetch(pathToFileURL(abs).toString())
      // standard scheme 对页面而言是跨源请求，GLTFLoader/fetch 需要 CORS 头
      return withCors(resp)
    } catch (err) {
      appendLog('warn', `[appfile] ${request.url.slice(0, 120)}: ${String(err)}`)
      return withCors(new Response('bad request', { status: 400 }))
    }
  })
}

/** 给协议响应补 CORS 头（net.fetch 的拒绝/错误响应也统一处理） */
function withCors(resp: Response): Response {
  const headers = new Headers(resp.headers)
  headers.set('Access-Control-Allow-Origin', '*')
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers })
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    autoHideMenuBar: true,
    title: '图片生成3D模型',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // 有进行中任务时拦截关闭
  mainWindow.on('close', (e) => {
    if (!taskManager.hasActiveTasks()) return
    if (quitting) return
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['取消退出', '退出'],
      defaultId: 1,
      cancelId: 0,
      message: '任务仍在进行中',
      detail: '退出不会取消云端任务，重启应用后 24 小时内可恢复查询。仍要退出吗？'
    })
    if (choice === 0) {
      e.preventDefault()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return mainWindow
}

// 单实例锁：二次启动时聚焦已有窗口，避免多实例并发读写 tasks.json/credentials.json
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.imgto3d.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerAppFileProtocol()
  taskManager.init()
  registerIpcHandlers()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  quitting = true
  taskManager.markAllInterrupted()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
