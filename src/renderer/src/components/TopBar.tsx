import { useAppStore } from '../store/app'

function TopBar(): React.JSX.Element {
  const providers = useAppStore((s) => s.providers)
  const settings = useAppStore((s) => s.settings)
  const setPrefs = useAppStore((s) => s.setPrefs)
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen)

  const enabledProviders = providers.filter((p) => p.capabilities.enabled)
  const current = enabledProviders.find((p) => p.id === settings?.prefs.lastProviderId) ?? enabledProviders[0]

  return (
    <header className="topbar">
      <div className="topbar-title">图片生成3D模型</div>
      <div className="topbar-provider">
        <span className="topbar-label">服务商</span>
        <select
          value={current?.id ?? ''}
          onChange={(e) => void setPrefs({ lastProviderId: e.target.value as never })}
        >
          {enabledProviders.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
          {providers
            .filter((p) => !p.capabilities.enabled)
            .map((p) => (
              <option key={p.id} value={p.id} disabled>
                {p.displayName}（{p.capabilities.note ?? '未接入'}）
              </option>
            ))}
        </select>
      </div>
      <button className="btn btn-ghost" onClick={() => setSettingsOpen(true)}>
        ⚙ 设置
      </button>
    </header>
  )
}

export default TopBar
