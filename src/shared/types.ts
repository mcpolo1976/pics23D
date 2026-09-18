/**
 * 全局共享类型：Provider / Task / IPC / Settings
 * main 与 renderer 的唯一事实源，禁止在两侧各自定义重复结构。
 */

/* ---------------- Provider ---------------- */

export type ProviderId = 'hunyuan3d' | 'hi3d' | 'meshy' | 'tripo'

/** 云端可返回的模型文件格式 */
export type ModelFormat = 'OBJ' | 'GLB' | 'STL' | 'USDZ' | 'FBX' | 'MP4'

/** 生成档位：极速版（快、便宜）/ 专业版（慢、贵、可多视图） */
export type TierId = 'rapid' | 'pro'

/** 生成模式 */
export type GenMode = 'image-to-3d' | 'text-to-3d'

/** Three.js 可直接预览的格式 */
export const PREVIEWABLE_FORMATS: readonly ModelFormat[] = ['GLB', 'OBJ', 'STL']

export interface ProviderTierCapabilities {
  id: TierId
  label: string
  /** 账号默认并发上限，本地队列据此调度 */
  concurrency: number
  /** 文生3D 提示词最大字符数 */
  maxPromptChars: number
  formats: ModelFormat[]
  /** 是否支持多视图输入（专业版） */
  supportsMultiView: boolean
  /** 除第一张主图外可追加的视图数量上限 */
  maxMultiViewImages: number
  /** 面数控制（仅专业版 Normal） */
  supportsFaceCount: boolean
  /** 生成类型选项（专业版）；缺省时 UI 使用内置默认（标准/低面数/白模） */
  generateTypes?: Array<{ id: 'Normal' | 'LowPoly' | 'Geometry'; label: string; hint: string }>
  /** 面数取值范围与推荐默认值；缺省时 UI 使用 Hunyuan 默认区间 */
  faceCountRange?: { min: number; max: number; default: number; hint: string }
  /** 白模仅允许这些输出格式（如 Hunyuan 极速版白模仅 GLB）；缺省 = 不限制 */
  whiteModelFormats?: ModelFormat[]
  /** 多视图附加积分（0 或缺省 = 不加收） */
  multiViewCredits?: number
}

export interface ProviderCapabilities {
  /** false → UI 灰显“未接入” */
  enabled: boolean
  modes: GenMode[]
  tiers: ProviderTierCapabilities[]
  /** 凭据字段说明 */
  credentialFields: Array<{ key: 'secretId' | 'secretKey'; label: string; placeholder: string }>
  /** 获取密钥的指引文案 */
  credentialHint: string
  /** UI 备注文案（如“需要代理”/“未接入”） */
  note?: string
}

export interface ProviderInfo {
  id: ProviderId
  displayName: string
  capabilities: ProviderCapabilities
}

export interface CostItem {
  label: string
  credits: number
}

export interface CostEstimate {
  total: number
  items: CostItem[]
  /** 提示文案：预估，实际以云端扣费为准 */
  disclaimer: string
}

/** 提交给生成任务的请求（renderer → main） */
export interface GenerateRequest {
  providerId: ProviderId
  tier: TierId
  mode: GenMode
  /** 文生3D 提示词 */
  prompt?: string
  /** 主图 base64（不带 data: 前缀），图生3D 必填 */
  imageBase64?: string
  /** 多视图追加图 base64 数组（专业版） */
  multiViewBase64?: string[]
  format: ModelFormat
  enablePBR?: boolean
  /** 白模（极速版 EnableGeometry，仅 GLB） */
  enableWhiteModel?: boolean
  /** 专业版生成类型 */
  generateType?: 'Normal' | 'LowPoly' | 'Geometry'
  /** 自定义面数（专业版 Normal，[3000, 1500000]） */
  faceCount?: number
}

/** 凭据（明文只存在于 main 进程内存） */
export interface ProviderCredentials {
  secretId?: string
  secretKey?: string
}

export interface CredentialTestResult {
  ok: boolean
  message: string
}

export interface PollFile {
  type: ModelFormat
  url: string
  previewImageUrl?: string
}

export type PollResult =
  | { status: 'running' }
  | { status: 'succeeded'; files: PollFile[]; creditConsumed?: number }
  | { status: 'failed'; errorCode?: string; errorMessage?: string }

/* ---------------- Task ---------------- */

export type TaskStatus =
  | 'queued' // 本地排队
  | 'submitting' // 正在提交云端
  | 'running' // 云端生成中
  | 'downloading' // 结果下载中
  | 'done'
  | 'failed'
  | 'canceled'
  | 'interrupted' // 应用退出时未完成，可恢复查询

export interface TaskParams {
  tier: TierId
  mode: GenMode
  format: ModelFormat
  enablePBR: boolean
  enableWhiteModel: boolean
  generateType?: 'Normal' | 'LowPoly' | 'Geometry'
  faceCount?: number
  prompt?: string
  /** 是否携带主图 */
  hasImage: boolean
  /** 多视图追加图数量 */
  multiViewCount: number
  /** 主图输入文件名（用于列表展示） */
  imageName?: string
}

export interface TaskRecord {
  taskId: string
  providerId: ProviderId
  status: TaskStatus
  /** 中文错误文案 */
  error?: string
  providerJobId?: string
  costEstimate?: CostEstimate
  /** 云端回填的真实扣费积分（专业版提供） */
  costActual?: number
  params: TaskParams
  createdAt: number
  startedAt?: number
  finishedAt?: number
  /** appfile:// URL，供 renderer 加载 */
  outputUrls: string[]
  /** 实际落盘文件名，与 outputUrls 一一对应 */
  fileNames: string[]
  previewUrl?: string
  inputThumbUrl?: string
}

export interface QueueState {
  /** queueKey(providerId:tier) → 正在运行的任务 id 或 null */
  running: Record<string, string | null>
  waitingCount: number
}

/* ---------------- Settings ---------------- */

export interface AppPrefs {
  /** 上次使用的服务商 */
  lastProviderId: ProviderId
  /** 上次使用的档位 */
  lastTier: TierId
  /** 默认输出格式 */
  lastFormat: ModelFormat
  /** 上次 PBR / 白模 开关 */
  lastEnablePBR: boolean
  lastEnableWhiteModel: boolean
  /** 上次自定义面数 */
  lastFaceCount?: number
}

export interface KeyHint {
  /** SecretId 掩码，如 AKID****abcd */
  secretIdMask?: string
  /** 是否已配置密钥 */
  configured: boolean
}

export interface Settings {
  version: 1
  prefs: AppPrefs
  keyHints: Partial<Record<ProviderId, KeyHint>>
}

export interface AppInfo {
  appVersion: string
  platform: string
  userDataPath: string
}

/* ---------------- IPC ---------------- */

/** task:updated 事件载荷 */
export type TaskUpdatedPayload = TaskRecord

/** queue:changed 事件载荷 */
export type QueueChangedPayload = QueueState

/** dialog:pickImage 返回 */
export interface PickedImage {
  name: string
  bytes: Uint8Array
}

/** 队列 key：providerId:tier */
export function queueKey(providerId: ProviderId, tier: TierId): string {
  return `${providerId}:${tier}`
}

/* ---------------- Renderer API（preload 暴露的 window.api） ---------------- */

export interface RendererApi {
  getInfo(): Promise<AppInfo>
  getSettings(): Promise<Settings>
  setPrefs(prefs: Partial<AppPrefs>): Promise<Settings>
  saveSecrets(providerId: ProviderId, secretId: string, secretKey: string): Promise<KeyHint>
  clearSecrets(providerId: ProviderId): Promise<void>
  testSecrets(providerId: ProviderId): Promise<CredentialTestResult>
  listProviders(): Promise<ProviderInfo[]>
  /** 生成前的积分预估（含明细） */
  estimateCost(req: GenerateRequest): Promise<CostEstimate>
  pickImage(): Promise<PickedImage | null>
  submitTask(req: GenerateRequest): Promise<{ taskId: string }>
  cancelTask(taskId: string): Promise<void>
  listTasks(): Promise<TaskRecord[]>
  resumeTask(taskId: string): Promise<void>
  removeTask(taskId: string, deleteFiles: boolean): Promise<void>
  exportTask(taskId: string): Promise<{ savedPath: string } | null>
  openFolder(taskId: string): Promise<void>
  /** 订阅任务状态变化，返回取消订阅函数 */
  onTaskUpdated(cb: (task: TaskUpdatedPayload) => void): () => void
  /** 订阅队列变化，返回取消订阅函数 */
  onQueueChanged(cb: (q: QueueChangedPayload) => void): () => void
}
