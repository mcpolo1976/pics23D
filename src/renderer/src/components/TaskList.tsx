import { useAppStore } from '../store/app'
import { STATUS_CLASS, STATUS_LABEL, formatDateTime, taskDuration } from '../lib/format'

function TaskList(): React.JSX.Element {
  const tasks = useAppStore((s) => s.tasks)
  const selectedTaskId = useAppStore((s) => s.selectedTaskId)
  const setSelectedTask = useAppStore((s) => s.setSelectedTask)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const settingsOpen = useAppStore((s) => s.settingsOpen)
  void setSettingsOpen
  void settingsOpen

  const sorted = [...tasks].sort((a, b) => b.createdAt - a.createdAt)

  const onRemove = async (taskId: string): Promise<void> => {
    await window.api.removeTask(taskId, true)
    if (selectedTaskId === taskId) setSelectedTask(null)
  }

  const onResume = async (taskId: string): Promise<void> => {
    try {
      await window.api.resumeTask(taskId)
    } catch (err) {
      alert((err as Error).message)
    }
  }

  const onExport = async (taskId: string): Promise<void> => {
    const result = await window.api.exportTask(taskId)
    if (result) void result.savedPath
  }

  return (
    <aside className="tasklist">
      <div className="tasklist-header">任务历史（{sorted.length}）</div>
      {sorted.length === 0 && <div className="tasklist-empty">还没有任务，从右侧开始创建</div>}
      <div className="tasklist-scroll">
        {sorted.map((task) => {
          const selected = task.taskId === selectedTaskId
          const terminal = ['done', 'failed', 'canceled', 'interrupted'].includes(task.status)
          return (
            <div
              key={task.taskId}
              className={selected ? 'task-item selected' : 'task-item'}
              onClick={() => setSelectedTask(task.taskId)}
            >
              <div className="task-thumb">
                {task.previewUrl ? (
                  <img src={task.previewUrl} alt="" />
                ) : (
                  <span className="task-thumb-empty">3D</span>
                )}
              </div>
              <div className="task-info">
                <div className="task-line">
                  <span className={`chip ${STATUS_CLASS[task.status]}`}>{STATUS_LABEL[task.status]}</span>
                  <span className="task-tier">{task.params.tier === 'rapid' ? '极速' : '专业'}</span>
                  <span className="task-format">{task.params.format}</span>
                </div>
                <div className="task-meta">
                  {task.costEstimate ? `${task.costEstimate.total} 积分` : ''}
                  {task.costActual != null ? ` · 实扣 ${task.costActual}` : ''}
                  {task.status === 'running' || task.status === 'downloading'
                    ? ` · ${taskDuration(task)}`
                    : ''}
                </div>
                <div className="task-meta dim">{formatDateTime(task.createdAt)}</div>
                {task.error && <div className="task-error">{task.error}</div>}
                <div className="task-actions">
                  {task.status === 'done' && (
                    <>
                      <button
                        className="btn btn-sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedTask(task.taskId)
                        }}
                      >
                        预览
                      </button>
                      <button
                        className="btn btn-sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          void onExport(task.taskId)
                        }}
                      >
                        导出
                      </button>
                    </>
                  )}
                  {task.status === 'interrupted' && (
                    <button
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onResume(task.taskId)
                      }}
                    >
                      恢复查询
                    </button>
                  )}
                  <button
                    className="btn btn-sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      window.api.openFolder(task.taskId)
                    }}
                  >
                    文件夹
                  </button>
                  {['queued', 'submitting', 'running'].includes(task.status) && (
                    <button
                      className="btn btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        window.api.cancelTask(task.taskId)
                      }}
                    >
                      取消
                    </button>
                  )}
                  {terminal && (
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        void onRemove(task.taskId)
                      }}
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </aside>
  )
}

export default TaskList
