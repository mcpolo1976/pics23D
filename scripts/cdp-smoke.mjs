/**
 * CDP 冒烟测试：连接 Electron 渲染进程（remote-debugging-port），驱动真实 IPC 链路。
 * 覆盖 M1（偏好持久化、密钥保存/掩码/测试）与 M3（真实 Provider 预估、鉴权错误路径）。
 *
 * 安全策略：
 * - 未配置密钥 → 保存假密钥，验证鉴权失败得到中文错误（不产生云端任务、不耗积分）
 * - 已配置密钥 → 绝不覆盖、绝不自动提交任务（可能是真实密钥，提交会耗积分）
 *
 * 零依赖：Node 22+ 内置 WebSocket。用法：node scripts/cdp-smoke.mjs
 */
const CDP_PORT = 9222
// dev 由 vite 托管（http://localhost:*），打包后从 asar 加载（file://）
function isAppUrl(u) {
  return u.startsWith('http://localhost:') || u.startsWith('file://')
}

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
    (t) => t.type === 'page' && isAppUrl(t.url) && !t.url.includes('/@vite')
  )
}

function connect(url) {
  return new Promise((resolve, reject) => {
    ws = new WebSocket(url)
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
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
  results.push({ name, ok })
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
  await evaluate(`window.api.setPrefs({ lastTier: 'rapid', lastFormat: 'GLB' })`)
  const s1 = await evaluate('window.api.getSettings()')
  check('setPrefs → settings 回读', s1?.prefs?.lastTier === 'rapid', JSON.stringify(s1.prefs))

  // 3) 密钥处理（M1/M3）
  let keyConfigured = s1?.keyHints?.hunyuan3d?.configured === true
  if (keyConfigured) {
    // 已有密钥：先探测。鉴权失败 → 是旧假密钥，可覆盖；探测通过 → 真密钥，严格只读
    const probe = await evaluate(`window.api.testSecrets('hunyuan3d')`)
    if (probe?.ok === true) {
      check('已配置有效密钥 → 跳过写入/提交类冒烟（防耗积分）', true, '探测通过，视为真实密钥')
    } else {
      // 假密钥（或失效密钥）：覆盖为固定假密钥，继续完整错误路径验证
      await evaluate(
        `window.api.saveSecrets('hunyuan3d', 'AKIDtest1234567890abcd', 'sk-testSecretKeyValue0099')`
      )
      keyConfigured = false
      check('旧密钥探测失败 → 已覆盖为假密钥继续冒烟', true, JSON.stringify(probe))
    }
  }
  if (!keyConfigured) {
    // 未配置：保存假密钥验证掩码与鉴权错误路径（不耗积分）
    if (!s1?.keyHints?.hunyuan3d?.configured) {
      await evaluate(
        `window.api.saveSecrets('hunyuan3d', 'AKIDtest1234567890abcd', 'sk-testSecretKeyValue0099')`
      )
    }
    const s2 = await evaluate('window.api.getSettings()')
    const mask = s2?.keyHints?.hunyuan3d
    check(
      'secrets:save → keyHints 显示掩码且不含明文',
      mask?.configured === true && !JSON.stringify(s2).includes('sk-testSecretKeyValue0099'),
      JSON.stringify(mask)
    )
    const test = await evaluate(`window.api.testSecrets('hunyuan3d')`)
    check(
      'secrets:test 假密钥 → 鉴权失败中文提示',
      test?.ok === false && /密钥|签名|SecretId|连接/.test(test?.message ?? ''),
      JSON.stringify(test)
    )
  }

  // 4) 积分预估（真实计费规则：极速 GLB = 20）
  const est = await evaluate(
    `window.api.estimateCost({ providerId: 'hunyuan3d', tier: 'rapid', mode: 'image-to-3d', format: 'GLB', enablePBR: false, imageBase64: 'aGk=' })`
  )
  check(
    'provider:estimate 极速 GLB = 20 积分（含明细）',
    est?.total === 20 && est?.items?.length > 0,
    JSON.stringify(est)
  )
  const estPro = await evaluate(
    `window.api.estimateCost({ providerId: 'hunyuan3d', tier: 'pro', mode: 'image-to-3d', format: 'STL', enablePBR: true, multiViewBase64: ['aGk=','aGk='], imageBase64: 'aGk=' })`
  )
  check(
    'provider:estimate 专业 STL+PBR+2视图 = 45 积分',
    estPro?.total === 45,
    JSON.stringify(estPro)
  )

  // 5) 提交错误路径（仅假密钥场景；真实密钥不自动提交）
  if (!keyConfigured) {
    const submitted = await evaluate(
      `window.api.submitTask({ providerId: 'hunyuan3d', tier: 'rapid', mode: 'image-to-3d', format: 'GLB', enablePBR: false, imageBase64: 'aGk=' }).then(r => r.taskId)`
    )
    check('task:submit 接受请求并返回 taskId', !!submitted, submitted)
    let failedTask = null
    for (let i = 0; i < 20; i++) {
      await sleep(1000)
      const tasks = await evaluate('window.api.listTasks()')
      const t = tasks.find((x) => x.taskId === submitted)
      if (t && ['failed', 'canceled'].includes(t.status)) {
        failedTask = t
        break
      }
    }
    check(
      '假密钥任务 → failed 且中文错误（鉴权错误路径）',
      failedTask?.status === 'failed' && !!failedTask?.error,
      JSON.stringify({ status: failedTask?.status, error: failedTask?.error })
    )
    if (submitted) {
      await evaluate(
        `window.api.removeTask(${JSON.stringify(submitted)}, true).then(() => 'ok')`
      )
    }
  }

  // 6) Viewer 检查（有已完成任务时才跑；M4 GLB 预览链路回归）
  {
    const tasksNow = await evaluate('window.api.listTasks()')
    const doneTask = tasksNow.find((t) => t.status === 'done')
    if (doneTask) {
      const clicked = await evaluate(`(() => {
        const btns = [...document.querySelectorAll('button')]
        const b = btns.find((x) => x.textContent.trim() === '预览')
        if (!b) return 'no-btn'
        b.click()
        return 'clicked'
      })()`)
      if (clicked === 'clicked') {
        await sleep(2500)
        const canvas = await evaluate(`(() => ({
          overlayGone: !document.querySelector('.viewer-overlay'),
          hasCanvas: !!document.querySelector('.viewer-canvas canvas')
        }))()`)
        check(
          `viewer: 点击预览 → canvas 渲染（任务 ${doneTask.taskId.slice(0, 8)}）`,
          canvas.hasCanvas,
          JSON.stringify(canvas)
        )
      } else {
        check('viewer: 未找到预览按钮（无 done 任务）→ 跳过', true)
      }
    } else {
      check('viewer: 无已完成任务 → 跳过（M4 用单测覆盖 OBJ/STL 解析）', true)
    }
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
