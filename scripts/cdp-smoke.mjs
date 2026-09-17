/**
 * CDP 冒烟测试：连接 Electron 渲染进程（remote-debugging-port），驱动真实 IPC 链路。
 * 覆盖 M1（偏好持久化、密钥保存/掩码/测试）与 M2（mock 任务 queued→running→done）。
 * 零依赖：Node 22+ 内置 WebSocket。用法：node scripts/cdp-smoke.mjs
 */
const CDP_PORT = 9222
const APP_URL_PREFIX = 'http://localhost:'

let idSeq = 0
let ws
const pending = new Map()

function send(method, params = {}) {
  const id = ++idSeq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id)
        reject(new Error(`CDP ${method} 超时`))
      }
    }, 30000)
  })
}

async function evaluate(expression) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (r.exceptionDetails) {
    const d = r.exceptionDetails
    throw new Error(`页面异常: ${d.exception?.description || d.text}`)
  }
  return r.result.value
}

async function findAppTarget() {
  const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
  const targets = await res.json()
  return targets.find(
    (t) => t.type === 'page' && t.url.startsWith(APP_URL_PREFIX) && !t.url.includes('/@vite')
  )
}

function connect(url) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url)
    ws.onopen = resolve
    ws.onerror = (e) => reject(new Error('WebSocket 连接失败'))
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id)
        pending.delete(msg.id)
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result)
      }
    }
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main() {
  const target = await findAppTarget()
  if (!target) throw new Error('未找到应用页面 target，确认应用已启动且带 --remote-debugging-port=9222')
  console.log(`已连接 target: ${target.url}`)
  await connect(target.webSocketDebuggerUrl)

  // 1) 应用信息与 providers
  const info = await evaluate('window.api.getInfo()')
  check('app:getInfo', info && info.appVersion && info.platform, JSON.stringify(info))
  const providers = await evaluate('window.api.listProviders()')
  const hy = providers.find((p) => p.id === 'hunyuan3d')
  check(
    'providers:list 含 hunyuan3d（启用）+ 3 个未接入',
    hy?.capabilities?.enabled === true && providers.length === 4,
    providers.map((p) => `${p.id}:${p.capabilities.enabled ? '启用' : '未接入'}`).join(', ')
  )

  // 2) 偏好持久化（M1）
  await evaluate(`window.api.setPrefs({ lastTier: 'pro', lastFormat: 'GLB' })`)
  const s1 = await evaluate('window.api.getSettings()')
  check('setPrefs → settings 回读', s1?.prefs?.lastTier === 'pro', JSON.stringify(s1.prefs))

  // 3) 密钥保存 → 掩码回显（M1，safeStorage DPAPI）
  await evaluate(
    `window.api.saveSecrets('hunyuan3d', 'AKIDtest1234567890abcd', 'sk-testSecretKeyValue0099')`
  )
  const s2 = await evaluate('window.api.getSettings()')
  const mask = s2?.keyHints?.hunyuan3d
  check(
    'secrets:save → keyHints 显示掩码且不含明文',
    mask?.configured === true && !JSON.stringify(s2).includes('sk-testSecretKeyValue0099'),
    JSON.stringify(mask)
  )

  // 4) 连通性测试（mock provider 跳过真实校验，验证 IPC 全链路）
  const test = await evaluate(`window.api.testSecrets('hunyuan3d')`)
  check('secrets:test 返回结果', test && typeof test.ok === 'boolean', JSON.stringify(test))

  // 5) 积分预估（mock 零积分）
  const est = await evaluate(
    `window.api.estimateCost({ providerId: 'hunyuan3d', tier: 'rapid', mode: 'image-to-3d', format: 'GLB', enablePBR: false, imageBase64: 'aGk=' })`
  )
  check('provider:estimate mock 零积分', est?.total === 0, JSON.stringify(est))

  // 6) mock 任务全链路（M2）：queued→submitting→running→downloading→done
  const submitted = await evaluate(
    `window.api.submitTask({ providerId: 'hunyuan3d', tier: 'rapid', mode: 'image-to-3d', format: 'GLB', enablePBR: false, imageBase64: 'aGk=' })`
  )
  const taskId = submitted?.taskId
  check('task:submit 返回 taskId', !!taskId, taskId)

  let final = null
  const seen = new Set()
  for (let i = 0; i < 40; i++) {
    await sleep(1000)
    const tasks = await evaluate('window.api.listTasks()')
    const t = tasks.find((x) => x.taskId === taskId)
    if (t) {
      seen.add(t.status)
      if (['done', 'failed', 'canceled', 'interrupted'].includes(t.status)) {
        final = t
        break
      }
    }
  }
  check('mock 任务到达 done', final?.status === 'done', `状态流转: ${[...seen].join('→')}`)
  check(
    '任务包含 cube.glb 且文件落盘（fileNames）',
    (final?.fileNames ?? []).some((n) => n.endsWith('.glb')),
    JSON.stringify(final?.fileNames)
  )
  check('实扣积分为 0', final?.costActual === 0, String(final?.costActual))
  check(
    'outputUrls 使用 appfile:// 协议',
    (final?.outputUrls ?? []).every((u) => u.startsWith('appfile://models/')),
    final?.outputUrls?.[0]
  )

  // 7) appfile:// 协议实际可取到 GLB（Viewer 加载路径）
  if (final?.outputUrls?.length) {
    const bytes = await evaluate(
      `fetch(${JSON.stringify(final.outputUrls[0])}).then(r => r.arrayBuffer()).then(b => b.byteLength)`
    )
    check('appfile:// fetch 模型文件 > 500 字节', bytes > 500, `${bytes} bytes`)
  }

  // 8) Viewer 实际渲染（点击任务列表的“预览”，GLTFLoader 走 appfile:// 加载）
  if (final?.status === 'done') {
    const clicked = await evaluate(`(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === '预览')
      if (btns.length === 0) return false
      btns[0].click()
      return true
    })()`)
    check('任务列表存在“预览”按钮', clicked === true)
    await sleep(2500)
    const viewer = await evaluate(`(() => {
      const overlay = document.querySelector('.viewer-overlay')
      const canvas = document.querySelector('.viewer-canvas canvas')
      return {
        overlayGone: !overlay,
        hasCanvas: !!canvas,
        canvasW: canvas?.width ?? 0,
        overlayText: overlay?.textContent?.trim() ?? ''
      }
    })()`)
    check(
      'Viewer 渲染模型（overlay 消失 + canvas 存在）',
      viewer.overlayGone && viewer.hasCanvas && viewer.canvasW > 0,
      JSON.stringify(viewer)
    )
    // 线框切换不崩
    await evaluate(`(() => {
      const cb = [...document.querySelectorAll('.viewer-toolbar input[type=checkbox]')][0]
      if (cb) cb.click()
      return true
    })()`)
    await sleep(400)
    const stillOk = await evaluate(`!!document.querySelector('.viewer-canvas canvas')`)
    check('线框切换后 Viewer 正常', stillOk)
  }

  // 9) 任务删除（M5 路径）
  if (taskId) {
    const rm = await evaluate(
      `window.api.removeTask(${JSON.stringify(taskId)}, true).then(() => 'ok')`
    )
    check('task:remove 删除任务', rm === 'ok')
  }

  // 汇总
  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== 冒烟结果: ${results.length - failed.length}/${results.length} 通过 ====`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('冒烟测试失败:', err.message)
  process.exit(2)
})
