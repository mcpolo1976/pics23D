import { useAppStore } from '../store/app'

function StatusBar(): React.JSX.Element {
  const queue = useAppStore((s) => s.queue)
  const appInfo = useAppStore((s) => s.appInfo)
  const tasks = useAppStore((s) => s.tasks)

  const runningCount = queue
    ? Object.values(queue.running).filter((v): v is string => !!v).length
    : 0
  const waiting = queue?.waitingCount ?? 0

  return (
    <footer className="statusbar">
      <span>
        {runningCount > 0 || waiting > 0
          ? `队列：${runningCount} 运行中 · ${waiting} 等待`
          : '队列为空'}
      </span>
      <span className="statusbar-right">
        任务 {tasks.length} · {appInfo ? `v${appInfo.appVersion}` : ''}
      </span>
    </footer>
  )
}

export default StatusBar
