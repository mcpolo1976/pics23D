import { safeStorage } from 'electron'
import type { ProviderId, ProviderCredentials, Settings, AppPrefs, KeyHint } from '@shared/types'
import { credentialsPath, settingsPath } from './files'
import { readJson, writeJsonAtomic } from './storage'

const DEFAULT_PREFS: AppPrefs = {
  lastProviderId: 'hunyuan3d',
  lastTier: 'rapid',
  lastFormat: 'GLB',
  lastEnablePBR: false,
  lastEnableWhiteModel: false
}

export function defaultSettings(): Settings {
  return {
    version: 1,
    prefs: { ...DEFAULT_PREFS },
    keyHints: {}
  }
}

export function loadSettings(): Settings {
  const loaded = readJson<Settings>(settingsPath(), defaultSettings())
  return {
    version: 1,
    prefs: { ...DEFAULT_PREFS, ...(loaded.prefs ?? {}) },
    keyHints: loaded.keyHints ?? {}
  }
}

export function saveSettings(settings: Settings): void {
  writeJsonAtomic(settingsPath(), settings)
}

export function setPrefs(patch: Partial<AppPrefs>): Settings {
  const settings = loadSettings()
  settings.prefs = { ...settings.prefs, ...patch }
  saveSettings(settings)
  return settings
}

/** SecretId 掩码：保留前 4 后 4，中间以 **** 代替 */
export function maskSecretId(secretId: string): string {
  if (!secretId) return ''
  if (secretId.length <= 8) return `${secretId.slice(0, 2)}****`
  return `${secretId.slice(0, 4)}****${secretId.slice(-4)}`
}

interface EncryptedCredentials {
  secretId?: string
  secretKey?: string
}

function loadEncryptedCredentials(): Partial<Record<ProviderId, EncryptedCredentials>> {
  return readJson(credentialsPath(), {})
}

function saveEncryptedCredentials(all: Partial<Record<ProviderId, EncryptedCredentials>>): void {
  writeJsonAtomic(credentialsPath(), all)
}

/** safeStorage 不可用时拒绝保存（不降级明文） */
export function isSecretStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function saveSecrets(
  providerId: ProviderId,
  secretId: string,
  secretKey: string
): { hint: KeyHint } {
  if (!isSecretStorageAvailable()) {
    throw new Error('系统加密服务（DPAPI）不可用，无法安全保存密钥')
  }
  const all = loadEncryptedCredentials()
  all[providerId] = {
    secretId: safeStorage.encryptString(secretId).toString('base64'),
    secretKey: safeStorage.encryptString(secretKey).toString('base64')
  }
  saveEncryptedCredentials(all)

  const settings = loadSettings()
  settings.keyHints[providerId] = { secretIdMask: maskSecretId(secretId), configured: true }
  saveSettings(settings)
  return { hint: settings.keyHints[providerId] }
}

export function clearSecrets(providerId: ProviderId): void {
  const all = loadEncryptedCredentials()
  delete all[providerId]
  saveEncryptedCredentials(all)

  const settings = loadSettings()
  settings.keyHints[providerId] = { configured: false }
  saveSettings(settings)
}

/** 解密凭据。仅 main 进程调用，绝不传给 renderer */
export function getCredentials(providerId: ProviderId): ProviderCredentials | null {
  const entry = loadEncryptedCredentials()[providerId]
  if (!entry?.secretId || !entry?.secretKey) return null
  if (!isSecretStorageAvailable()) return null
  try {
    return {
      secretId: safeStorage.decryptString(Buffer.from(entry.secretId, 'base64')),
      secretKey: safeStorage.decryptString(Buffer.from(entry.secretKey, 'base64'))
    }
  } catch {
    // 换 Windows 用户等场景解密失败：提示重新录入
    return null
  }
}
