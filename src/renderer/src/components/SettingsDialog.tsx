import { useEffect, useState } from 'react'
import { useAppStore } from '../store/app'

/**
 * 设置弹窗：凭据录入（safeStorage 加密存储）、连通性测试、清除。
 */
function SettingsDialog(): React.JSX.Element | null {
  const open = useAppStore((s) => s.settingsOpen)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)
  const providers = useAppStore((s) => s.providers)
  const settings = useAppStore((s) => s.settings)
  const refreshSettings = useAppStore((s) => s.refreshSettings)

  const enabled = providers.filter((p) => p.capabilities.enabled)
  const [providerId, setProviderId] = useState('')
  const [secretId, setSecretId] = useState('')
  const [secretKey, setSecretKey] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open && !providerId && enabled.length > 0) {
      setProviderId(enabled[0].id)
    }
  }, [open, providerId, enabled])

  useEffect(() => {
    setSecretId('')
    setSecretKey('')
    setMessage(null)
  }, [providerId])

  if (!open) return null

  const provider = providers.find((p) => p.id === providerId)
  const hint = settings?.keyHints[providerId as keyof typeof settings.keyHints]
  const masked = hint?.secretIdMask

  const onSave = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      await window.api.saveSecrets(providerId as never, secretId, secretKey)
      await refreshSettings()
      setMessage({ ok: true, text: '密钥已加密保存' })
      setSecretId('')
      setSecretKey('')
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message })
    } finally {
      setBusy(false)
    }
  }

  const onTest = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    try {
      const result = await window.api.testSecrets(providerId as never)
      setMessage({ ok: result.ok, text: result.message })
    } finally {
      setBusy(false)
    }
  }

  const onClear = async (): Promise<void> => {
    setBusy(true)
    try {
      await window.api.clearSecrets(providerId as never)
      await refreshSettings()
      setMessage({ ok: true, text: '已清除该服务商的密钥' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-mask" onClick={() => setSettingsOpen(false)}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">设置</div>
        <div className="dialog-body">
          <label className="field">
            <span className="field-label">服务商</span>
            <select value={providerId} onChange={(e) => setProviderId(e.target.value)}>
              {enabled.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>

          {provider && (
            <div className="hint-box">{provider.capabilities.credentialHint}</div>
          )}

          {hint?.configured && (
            <div className="configured-row">
              已配置：<code>{masked ?? '密钥已保存'}</code>
            </div>
          )}

          {provider?.capabilities.credentialFields.map((f) => (
            <label className="field" key={f.key}>
              <span className="field-label">{f.label}</span>
              <input
                type="password"
                autoComplete="off"
                placeholder={f.placeholder}
                value={f.key === 'secretId' ? secretId : secretKey}
                onChange={(e) =>
                  f.key === 'secretId' ? setSecretId(e.target.value) : setSecretKey(e.target.value)
                }
              />
            </label>
          ))}

          {message && (
            <div className={message.ok ? 'msg msg-ok' : 'msg msg-err'}>{message.text}</div>
          )}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-ghost" onClick={() => void onClear()} disabled={busy}>
            清除
          </button>
          <button className="btn btn-ghost" onClick={() => void onTest()} disabled={busy}>
            测试连通性
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void onSave()}
            disabled={busy || !secretId.trim() || !secretKey.trim()}
          >
            保存
          </button>
          <button className="btn" onClick={() => setSettingsOpen(false)}>
            关闭
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsDialog
