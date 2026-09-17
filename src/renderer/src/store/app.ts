import { create } from 'zustand'
import type {
  AppInfo,
  AppPrefs,
  ProviderInfo,
  QueueState,
  Settings,
  TaskRecord
} from '@shared/types'

interface AppState {
  appInfo: AppInfo | null
  settings: Settings | null
  providers: ProviderInfo[]
  tasks: TaskRecord[]
  queue: QueueState | null
  /** 当前在 Viewer 中预览的任务 */
  selectedTaskId: string | null
  settingsOpen: boolean
  init: () => Promise<void>
  refreshSettings: () => Promise<void>
  setPrefs: (prefs: Partial<AppPrefs>) => Promise<void>
  setSettingsOpen: (open: boolean) => void
  setSelectedTask: (taskId: string | null) => void
  upsertTask: (task: TaskRecord) => void
  setQueue: (q: QueueState) => void
}

export const useAppStore = create<AppState>((set, get) => ({
  appInfo: null,
  settings: null,
  providers: [],
  tasks: [],
  queue: null,
  selectedTaskId: null,
  settingsOpen: false,

  init: async () => {
    const [appInfo, settings, providers, tasks] = await Promise.all([
      window.api.getInfo(),
      window.api.getSettings(),
      window.api.listProviders(),
      window.api.listTasks()
    ])
    set({ appInfo, settings, providers, tasks })
    window.api.onTaskUpdated((task) => get().upsertTask(task))
    window.api.onQueueChanged((q) => set({ queue: q }))
  },

  refreshSettings: async () => {
    const settings = await window.api.getSettings()
    set({ settings })
  },

  setPrefs: async (prefs) => {
    const settings = await window.api.setPrefs(prefs)
    set({ settings })
  },

  setSettingsOpen: (open) => set({ settingsOpen: open }),

  setSelectedTask: (taskId) => set({ selectedTaskId: taskId }),

  upsertTask: (task) => {
    set((state) => {
      const idx = state.tasks.findIndex((t) => t.taskId === task.taskId)
      const tasks = idx >= 0 ? state.tasks.map((t) => (t.taskId === task.taskId ? task : t)) : [task, ...state.tasks]
      return { tasks }
    })
  },

  setQueue: (q) => set({ queue: q })
}))
