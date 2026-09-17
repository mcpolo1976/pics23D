import { useCallback, useEffect, useState } from 'react'
import type { CostEstimate, GenMode, ModelFormat, TierId } from '@shared/types'
import { useAppStore } from '../store/app'
import { checkImageFile, bytesToBase64, type LoadedImage } from '../lib/image'
import { FORMAT_LABEL, MODE_LABEL } from '../lib/format'
import CostConfirmDialog from './CostConfirmDialog'

function OptionsPanel(): React.JSX.Element {
  const providers = useAppStore((s) => s.providers)
  const settings = useAppStore((s) => s.settings)
  const setPrefs = useAppStore((s) => s.setPrefs)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  const enabledProviders = providers.filter((p) => p.capabilities.enabled)
  const provider =
    enabledProviders.find((p) => p.id === settings?.prefs.lastProviderId) ?? enabledProviders[0]
  const caps = provider?.capabilities

  const [mode, setMode] = useState<GenMode>('image-to-3d')
  const [tier, setTier] = useState<TierId>('rapid')
  const [format, setFormat] = useState<ModelFormat>('GLB')
  const [enablePBR, setEnablePBR] = useState(false)
  const [enableWhiteModel, setEnableWhiteModel] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [image, setImage] = useState<LoadedImage | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<CostEstimate | null>(null)
  const [openConfirm, setOpenConfirm] = useState(false)
  const [busy, setBusy] = useState(false)

  const tierCaps = caps?.tiers.find((t) => t.id === tier)
  const tierList = caps?.tiers ?? []

  // 服务商/档位变化时修正选中的档位与格式
  useEffect(() => {
    if (caps && !caps.tiers.some((t) => t.id === tier) && caps.tiers.length > 0) {
      setTier(caps.tiers[0].id)
      setFormat(caps.tiers[0].formats[0])
    } else if (tierCaps && !tierCaps.formats.includes(format)) {
      setFormat(tierCaps.formats[0])
    }
  }, [caps, tier, tierCaps, format])

  const buildRequest = useCallback((): Record<string, unknown> | null => {
    if (!provider) return null
    const req: Record<string, unknown> = {
      providerId: provider.id,
      tier,
      mode,
      format,
      enablePBR,
      enableWhiteModel
    }
    if (mode === 'image-to-3d') {
      if (!image) return null
      req.imageBase64 = bytesToBase64(image.bytes)
    } else {
      if (!prompt.trim()) return null
      req.prompt = prompt.trim()
    }
    return req
  }, [provider, tier, mode, format, enablePBR, enableWhiteModel, image, prompt])

  // 选项变化时刷新积分预估
  useEffect(() => {
    const req = buildRequest()
    if (!req) {
      setEstimate(null)
      return
    }
    let active = true
    window.api
      .estimateCost(req as never)
      .then((est) => {
        if (active) setEstimate(est)
      })
      .catch(() => {
        if (active) setEstimate(null)
      })
    return () => {
      active = false
    }
  }, [buildRequest])

  const acceptImage = useCallback((name: string, bytes: Uint8Array): void => {
    const check = checkImageFile(name, bytes)
    if (!check.ok) {
      setError(check.error ?? '图片不可用')
      return
    }
    setError(null)
    setImage({ name, bytes, url: URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer])) })
  }, [])

  const onDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault()
      setDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (!file) return
      void file.arrayBuffer().then((buf) => acceptImage(file.name, new Uint8Array(buf)))
    },
    [acceptImage]
  )

  const onPick = useCallback(async (): Promise<void> => {
    const picked = await window.api.pickImage()
    if (picked) acceptImage(picked.name, picked.bytes)
  }, [acceptImage])

  const onStart = (): void => {
    setError(null)
    if (!settings?.keyHints[provider?.id ?? '']?.configured) {
      setSettingsOpen(true)
      return
    }
    if (!buildRequest()) return
    setBusy(true)
    void window.api
      .estimateCost(buildRequest() as never)
      .then((est) => {
        setEstimate(est)
        setOpenConfirm(true)
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setBusy(false))
  }

  const onConfirm = async (): Promise<void> => {
    const req = buildRequest()
    if (!req) return
    setBusy(true)
    try {
      await window.api.submitTask(req as never)
      setOpenConfirm(false)
    } catch (err) {
      setError((err as Error).message)
      setOpenConfirm(false)
    } finally {
      setBusy(false)
    }
  }

  if (!caps) {
    return <aside className="options">加载中…</aside>
  }

  return (
    <aside className="options">
      <div className="mode-tabs">
        {caps.modes.map((m) => (
          <button
            key={m}
            className={mode === m ? 'tab active' : 'tab'}
            onClick={() => setMode(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>

      {mode === 'image-to-3d' ? (
        <div
          className={dragOver ? 'upload drop' : 'upload'}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => void onPick()}
        >
          {image ? (
            <>
              <img className="upload-preview" src={image.url} alt="输入图" />
              <div className="upload-name">{image.name}</div>
              <div className="upload-tip">点击或拖拽替换</div>
            </>
          ) : (
            <>
              <div className="upload-icon">🖼</div>
              <div className="upload-main">将图片拖到此处，或点击选择</div>
              <div className="upload-tip">支持 JPG / PNG / WebP，单边 128–5000px</div>
            </>
          )}
        </div>
      ) : (
        <div className="prompt-box">
          <textarea
            placeholder={`描述想要生成的 3D 内容（最多 ${tierCaps?.maxPromptChars ?? 200} 字）`}
            value={prompt}
            maxLength={tierCaps?.maxPromptChars ?? 200}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
          />
        </div>
      )}

      {tierList.length > 1 && (
        <div className="mode-tabs tier-tabs">
          {tierList.map((t) => (
            <button
              key={t.id}
              className={tier === t.id ? 'tab active' : 'tab'}
              onClick={() => {
                setTier(t.id)
                setPrefs({ lastTier: t.id })
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <label className="field">
        <span className="field-label">输出格式</span>
        <select
          value={format}
          onChange={(e) => {
            setFormat(e.target.value as ModelFormat)
            setPrefs({ lastFormat: e.target.value as ModelFormat })
          }}
        >
          {(tierCaps?.formats ?? []).map((f) => (
            <option key={f} value={f}>
              {FORMAT_LABEL[f]}
            </option>
          ))}
        </select>
      </label>

      <label className="check">
        <input
          type="checkbox"
          checked={enablePBR}
          onChange={(e) => {
            setEnablePBR(e.target.checked)
            setPrefs({ lastEnablePBR: e.target.checked })
          }}
        />
        PBR 材质（更真实的金属/粗糙度反应）
      </label>

      {tier === 'rapid' && (
        <label className="check">
          <input
            type="checkbox"
            checked={enableWhiteModel}
            onChange={(e) => {
              setEnableWhiteModel(e.target.checked)
              if (e.target.checked) setFormat('GLB')
              setPrefs({ lastEnableWhiteModel: e.target.checked })
            }}
          />
          白模（无贴图几何体，仅 GLB）
        </label>
      )}
      {enableWhiteModel && (
        <div className="hint-box">白模模式已强制使用 GLB 格式输出</div>
      )}

      {error && <div className="msg msg-err">{error}</div>}

      <div className="estimate-row">
        <span>预估</span>
        <span className="cost-num">{estimate ? `${estimate.total} 积分` : '—'}</span>
      </div>

      <button className="btn btn-primary btn-block" onClick={onStart} disabled={busy}>
        开始生成
      </button>
      {!settings?.keyHints[provider.id]?.configured && (
        <div className="upload-tip center">
          尚未配置密钥，点击“开始生成”打开设置
        </div>
      )}

      {openConfirm && (
        <CostConfirmDialog
          estimate={estimate}
          busy={busy}
          onConfirm={() => void onConfirm()}
          onCancel={() => setOpenConfirm(false)}
        />
      )}
    </aside>
  )
}

export default OptionsPanel
