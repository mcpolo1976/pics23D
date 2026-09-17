import type { GenMode, ModelFormat, TaskStatus, TaskRecord } from '@shared/types'

export const STATUS_LABEL: Record<TaskStatus, string> = {
  queued: '排队中',
  submitting: '提交中',
  running: '生成中',
  downloading: '下载中',
  done: '已完成',
  failed: '失败',
  canceled: '已取消',
  interrupted: '已中断'
}

export const STATUS_CLASS: Record<TaskStatus, string> = {
  queued: 'st-wait',
  submitting: 'st-wait',
  running: 'st-run',
  downloading: 'st-run',
  done: 'st-ok',
  failed: 'st-err',
  canceled: 'st-dim',
  interrupted: 'st-warn'
}

export const MODE_LABEL: Record<GenMode, string> = {
  'image-to-3d': '图生3D',
  'text-to-3d': '文生3D'
}

export const FORMAT_LABEL: Record<ModelFormat, string> = {
  OBJ: 'OBJ（通用交换）',
  GLB: 'GLB（含贴图，推荐）',
  STL: 'STL（3D 打印）',
  USDZ: 'USDZ（AR 展示）',
  FBX: 'FBX（影视/动画）',
  MP4: 'MP4（展示视频）'
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return '<1 秒'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function taskDuration(task: TaskRecord): string {
  if (!task.startedAt) return ''
  const end = task.finishedAt ?? Date.now()
  return formatDuration(end - task.startedAt)
}

/** 任务产出文件是否可在 Viewer 预览 */
export function isPreviewable(task: TaskRecord): boolean {
  return (
    task.status === 'done' &&
    task.outputUrls.some((u) => /\.(glb|obj|stl)$/i.test(decodeURIComponent(u)))
  )
}
