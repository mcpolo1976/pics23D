/**
 * M5 冒烟：interrupted → 恢复查询 → 生成中 → 取消 → 已取消 → 删除清理。
 * 前置：先运行 m5-fixture.mjs 写入 fixture 任务，应用已带 CDP 9222 启动且为唯一实例。
 * 恢复/取消走 IPC 直调（确定性）；UI 层断言"恢复查询"按钮存在且 fixture 为唯一中断项。
 * 用法：node scripts/cdp-smoke-m5.mjs
 */
const CDP_PORT = 9222
const FIXTURE_ID = 'smoke-m5-interrupted-0000-000000000000'

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
  return targets.find((t) => t.type === 'page' && t.url.startsWith('http://localhost:'))
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

async function fixtureStatus() {
  const tasks = await evaluate('window.api.listTasks()')
  return tasks.find((t) => t.taskId === FIXTURE_ID)?.status
}

async function waitFor(pred, { tries = 40, interval = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    await sleep(interval)
    const v = await pred()
    if (v) return v
  }
  return null
}

async function main() {
  const target = await findAppTarget()
  if (!target) throw new Error('未找到应用页面 target')
  await connect(target.webSocketDebuggerUrl)

  // 1) 应用启动后 fixture 以 interrupted 状态出现在列表（等 init 完成，快轮询抗窗口操作竞态）
  const st1 = await waitFor(async () => {
    const s = await fixtureStatus()
    return s === 'interrupted' ? s : null
  }, { tries: 30 })
  check('启动加载: fixture 显示为"已中断"', st1 === 'interrupted', st1 ?? '(未出现)')

  // 2) UI 存在"恢复查询"按钮（fixture 是唯一中断任务，不点击避免与窗口操作竞态）
  const ui = await evaluate(`(() => {
    const btns = [...document.querySelectorAll('.task-item button')]
    const resume = btns.filter((b) => b.textContent.trim() === '恢复查询')
    const chips = [...document.querySelectorAll('.task-item .chip')].map((c) => c.textContent.trim())
    return { resumeCount: resume.length, interruptedChips: chips.filter((c) => c === '已中断').length }
  })()`)
  check(
    'UI: 中断任务带"恢复查询"按钮',
    ui.resumeCount >= 1 && ui.interruptedChips >= 1,
    JSON.stringify(ui)
  )

  // 3) IPC 恢复查询 → running（立即执行，避免窗口侧抢先操作）
  const resumed = await evaluate(
    `window.api.resumeTask(${JSON.stringify(FIXTURE_ID)}).then(() => 'ok').catch(e => 'err:' + e.message)`
  )
  const st3 = await waitFor(async () => {
    const s = await fixtureStatus()
    return s === 'running' ? 'running' : null
  }, { tries: 40 })
  check(
    '恢复查询: IPC 成功且状态 → 生成中',
    resumed === 'ok' && st3 === 'running',
    `${resumed} / ${st3 ?? '(未观测到 running，可能被窗口操作提前推进)'}`
  )

  // 4) 取消 → canceled（pollLoop 唤醒时检查 canceled 标记，≤10s 落定）
  await evaluate(`window.api.cancelTask(${JSON.stringify(FIXTURE_ID)})`)
  const st4 = await waitFor(async () => {
    const s = await fixtureStatus()
    return s === 'canceled' ? 'canceled' : null
  }, { tries: 60 })
  check('取消: 状态 → 已取消', st4 === 'canceled', st4 ?? '(超时)')

  // 5) 删除清理 fixture
  const removed = await evaluate(
    `window.api.removeTask(${JSON.stringify(FIXTURE_ID)}, true).then(() => 'ok').catch(e => 'err:' + e.message)`
  )
  const gone = (await fixtureStatus()) === undefined
  check('删除: fixture 从历史移除', removed === 'ok' && gone, removed)

  const failed = results.filter((r) => !r.ok)
  console.log(`\n==== M5 冒烟: ${results.length - failed.length}/${results.length} 通过 ====`)
  process.exit(failed.length > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('M5 冒烟失败:', err.message)
  process.exit(2)
})
