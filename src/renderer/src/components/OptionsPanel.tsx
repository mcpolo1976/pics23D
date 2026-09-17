import { useCallback, useEffect, useState } from 'react'
import type { CostEstimate, GenMode, ModelFormat, TierId } from '@shared/types'
import { useAppStore } from '../store/app'
import { checkImageFile, compressImage, bytesToBase64, type LoadedImage } from '../lib/image'
import { FORMAT_LABEL, MODE_LABEL } from '../lib/format'
import CostConfirmDialog from './CostConfirmDialog'

/** 专业版生成类型选项（白模 = Geometry） */
const PRO_GENERATE_TYPES: Array<{ id: 'Normal' | 'LowPoly' | 'Geometry'; label: string; hint: string }> = [
  { id: 'Normal', label: '标准', hint: '标准生成，可控制面数与 PBR' },
  { id: 'LowPoly', label: '低面数', hint: '优化布线，适合游戏资产' },
  { id: 'Geometry', label: '白模', hint: '无贴图几何体' }
]

const FACE_COUNT_MIN = 3000
const FACE_COUNT_MAX = 1_500_000
const FACE_COUNT_DEFAULT = 500_000

function fmtMB(n: number): string {
  return `${(n / 1024 / 1024).toFixed(2)}MB`
}

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
  const [multiView, setMultiView] = useState<LoadedImage[]>([])
  const [generateType, setGenerateType] = useState<'Normal' | 'LowPoly' | 'Geometry'>('Normal')
  const [faceCount, setFaceCount] = useState<number>(FACE_COUNT_DEFAULT)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [estimate, setEstimate] = useState<CostEstimate | null>(null)
  const [openConfirm, setOpenConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [compressing, setCompressing] = useState(false)

  const tierCaps = caps?.tiers.find((t) => t.id === tier)
  const tierList = caps?.tiers ?? []
  const isPro = tier === 'pro'
  const proWhiteModel = isPro && generateType === 'Geometry'

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
      enableWhiteModel: isPro ? proWhiteModel : enableWhiteModel
    }
    if (mode === 'image-to-3d') {
      if (!image) return null
      req.imageBase64 = bytesToBase64(image.bytes)
      // 多视图（仅专业版）
      if (isPro && multiView.length > 0) {
        req.multiViewBase64 = multiView.map((m) => bytesToBase64(m.bytes))
      }
    } else {
      if (!prompt.trim()) return null
      req.prompt = prompt.trim()
    }
    if (isPro) {
      req.generateType = generateType
      if (generateType === 'Normal' && faceCount !== FACE_COUNT_DEFAULT) {
        req.faceCount = faceCount
      }
    }
    return req
  }, [
    provider,
    tier,
    mode,
    format,
    enablePBR,
    enableWhiteModel,
    isPro,
    proWhiteModel,
    image,
    multiView,
    prompt,
    generateType,
    faceCount
  ])

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

  /** 统一入口：校验 → 压缩 → 交给使用者 */
  const ingestFile = useCallback(
    async (name: string, bytes: Uint8Array): Promise<LoadedImage | null> => {
      const check = checkImageFile(name, bytes)
      if (!check.ok) {
        setError(check.error ?? '图片不可用')
        return null
      }
      setCompressing(true)
      setError(null)
      try {
        const c = await compressImage(bytes)
        const url = URL.createObjectURL(new Blob([c.bytes.buffer as ArrayBuffer], { type: 'image/jpeg' }))
        return {
          name,
          bytes: c.bytes,
          url,
          compressed: {
            originalBytes: c.originalBytes,
            compressedBytes: c.compressedBytes,
            width: c.width,
            height: c.height,
            scaled: c.scaled
          }
        }
      } catch (err) {
        setError(`图片处理失败：${(err as Error).message}`)
        return null
      } finally {
        setCompressing(false)
      }
    },
    []
  )

  const acceptImage = useCallback(
    (name: string, bytes: Uint8Array): void => {
      void ingestFile(name, bytes).then((img) => {
        if (img) setImage(img)
      })
    },
    [ingestFile]
  )

  const acceptMultiView = useCallback(
    (index: number, name: string, bytes: Uint8Array): void => {
      void ingestFile(name, bytes).then((img) => {
        if (!img) return
        setMultiView((prev) => {
          const next = [...prev]
          if (index < next.length) next[index] = img
          else next.push(img)
          return next
        })
      })
    },
    [ingestFile]
  )

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

  const onPickMultiView = useCallback(
    async (index: number): Promise<void> => {
      const picked = await window.api.pickImage()
      if (picked) acceptMultiView(index, picked.name, picked.bytes)
    },
    [acceptMultiView]
  )

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
        <>
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
                <div className="upload-tip">
                  {image.compressed.scaled
                    ? `${image.compressed.width}×${image.compressed.height} · ${fmtMB(image.compressed.originalBytes)} → ${fmtMB(image.compressed.compressedBytes)}`
                    : `已压缩 ${fmtMB(image.compressed.originalBytes)} → ${fmtMB(image.compressed.compressedBytes)}`}
                </div>
              </>
            ) : (
              <>
                <div className="upload-icon">🖼</div>
                <div className="upload-main">将图片拖到此处，或点击选择</div>
                <div className="upload-tip">支持 JPG / PNG / WebP，大图自动压缩</div>
              </>
            )}
            {compressing && <div className="upload-tip">压缩处理中…</div>}
          </div>

          {/* 多视图追加（专业版）：提升几何一致性 */}
          {isPro && tierCaps?.supportsMultiView && (
            <div className="mv-section">
              <div className="field-label">
                多视图（可选，最多 {tierCaps.maxMultiViewImages} 张，+10 积分）
              </div>
              <div className="mv-slots">
                {Array.from({ length: tierCaps.maxMultiViewImages }).map((_, i) => {
                  const slot = multiView[i]
                  return (
                    <div
                      key={i}
                      className="mv-slot"
                      onClick={() => void onPickMultiView(i)}
                      title="点击选择该视角图片（建议：前/侧/后）"
                    >
                      {slot ? (
                        <>
                          <img src={slot.url} alt={`视图 ${i + 1}`} />
                          <button
                            className="mv-remove"
                            onClick={(e) => {
                              e.stopPropagation()
                              setMultiView((prev) => prev.filter((_, j) => j !== i))
                            }}
                          >
                            ×
                          </button>
                        </>
                      ) : (
                        <span className="mv-add">＋ 视图 {i + 1}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
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

      {/* 专业版生成类型（白模 = Geometry） */}
      {isPro && (
        <>
          <div className="field-label">生成类型</div>
          <div className="mode-tabs gentype-tabs">
            {PRO_GENERATE_TYPES.map((g) => (
              <button
                key={g.id}
                className={generateType === g.id ? 'tab active' : 'tab'}
                title={g.hint}
                onClick={() => setGenerateType(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
          {generateType === 'Normal' && tierCaps?.supportsFaceCount && (
            <label className="field">
              <span className="field-label">目标面数（+10 积分）</span>
              <input
                className="face-input"
                type="number"
                min={FACE_COUNT_MIN}
                max={FACE_COUNT_MAX}
                step={1000}
                value={faceCount}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) setFaceCount(Math.min(FACE_COUNT_MAX, Math.max(FACE_COUNT_MIN, Math.round(v))))
                }}
              />
              <span className="upload-tip">{FACE_COUNT_MIN.toLocaleString()} – {FACE_COUNT_MAX.toLocaleString()}，留空/默认 500,000 不计费</span>
            </label>
          )}
          {proWhiteModel && <div className="hint-box">白模模式：PBR 与面数控制不生效</div>}
        </>
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
