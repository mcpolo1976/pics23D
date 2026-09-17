import type { CostEstimate } from '@shared/types'

/** 积分明细二次确认弹窗 */
function CostConfirmDialog(props: {
  estimate: CostEstimate | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element | null {
  const { estimate, busy, onConfirm, onCancel } = props
  if (!estimate) return null

  return (
    <div className="dialog-mask" onClick={onCancel}>
      <div className="dialog dialog-sm" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-title">确认生成</div>
        <div className="dialog-body">
          <div className="cost-items">
            {estimate.items.map((item) => (
              <div className="cost-item" key={item.label}>
                <span>{item.label}</span>
                <span className="cost-num">{item.credits > 0 ? `+${item.credits}` : '0'} 积分</span>
              </div>
            ))}
            <div className="cost-item cost-total">
              <span>预估合计</span>
              <span className="cost-num">{estimate.total} 积分</span>
            </div>
          </div>
          <div className="hint-box">{estimate.disclaimer}</div>
        </div>
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            {busy ? '提交中…' : '开始生成'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default CostConfirmDialog
