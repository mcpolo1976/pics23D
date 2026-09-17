import type { ProviderId, ProviderInfo } from '@shared/types'

/**
 * 服务商静态元数据（capabilities 是 UI 渲染的唯一依据）。
 * enabled=false 的服务商在 UI 灰显“未接入”。
 */
export const PROVIDER_META: Record<ProviderId, ProviderInfo> = {
  hunyuan3d: {
    id: 'hunyuan3d',
    displayName: '腾讯混元生3D',
    capabilities: {
      enabled: true,
      modes: ['image-to-3d', 'text-to-3d'],
      tiers: [
        {
          id: 'rapid',
          label: '极速版',
          concurrency: 1,
          maxPromptChars: 200,
          formats: ['OBJ', 'GLB', 'STL', 'USDZ', 'FBX', 'MP4'],
          supportsMultiView: false,
          maxMultiViewImages: 0,
          supportsFaceCount: false
        },
        {
          id: 'pro',
          label: '专业版',
          concurrency: 3,
          maxPromptChars: 1024,
          formats: ['STL', 'USDZ', 'FBX'],
          supportsMultiView: true,
          maxMultiViewImages: 3,
          supportsFaceCount: true
        }
      ],
      credentialFields: [
        { key: 'secretId', label: 'SecretId', placeholder: 'AKIDxxxxxxxxxxxxxxxx' },
        { key: 'secretKey', label: 'SecretKey', placeholder: 'xxxxxxxxxxxxxxxx' }
      ],
      credentialHint:
        '腾讯云控制台 → 访问管理 → API 密钥管理 中创建密钥，并在控制台开通“腾讯混元生3D”服务（新用户可领 100 免费积分）。'
    }
  },
  hi3d: {
    id: 'hi3d',
    displayName: 'Hi3D (Sparc3D)',
    capabilities: {
      enabled: false,
      modes: [],
      tiers: [],
      credentialFields: [],
      credentialHint: '待接入（已确认国内可直连，支持支付宝）。',
      note: '未接入'
    }
  },
  meshy: {
    id: 'meshy',
    displayName: 'Meshy',
    capabilities: {
      enabled: false,
      modes: [],
      tiers: [],
      credentialFields: [],
      credentialHint: '待接入（当前网络需代理访问）。',
      note: '未接入'
    }
  },
  tripo: {
    id: 'tripo',
    displayName: 'Tripo',
    capabilities: {
      enabled: false,
      modes: [],
      tiers: [],
      credentialFields: [],
      credentialHint: '待接入（当前网络需代理访问）。',
      note: '未接入'
    }
  }
}
