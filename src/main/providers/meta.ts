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
          supportsFaceCount: false,
          whiteModelFormats: ['GLB']
        },
        {
          id: 'pro',
          label: '专业版',
          concurrency: 3,
          maxPromptChars: 1024,
          formats: ['STL', 'USDZ', 'FBX'],
          supportsMultiView: true,
          maxMultiViewImages: 3,
          supportsFaceCount: true,
          generateTypes: [
            { id: 'Normal', label: '标准', hint: '标准生成，可控制面数与 PBR' },
            { id: 'LowPoly', label: '低面数', hint: '优化布线，适合游戏资产' },
            { id: 'Geometry', label: '白模', hint: '白模模式：PBR 与面数控制不生效' }
          ],
          faceCountRange: {
            min: 3000,
            max: 1_500_000,
            default: 500_000,
            hint: '3,000 – 1,500,000，默认 500,000 不计费；自定义面数 +10 积分'
          },
          multiViewCredits: 10
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
      enabled: true,
      modes: ['image-to-3d'],
      tiers: [
        {
          id: 'rapid',
          label: '极速版 (v2.1)',
          concurrency: 1,
          maxPromptChars: 200,
          formats: ['OBJ', 'GLB', 'STL', 'FBX', 'USDZ'],
          supportsMultiView: true,
          maxMultiViewImages: 3,
          supportsFaceCount: false,
          multiViewCredits: 0
        },
        {
          id: 'pro',
          label: '高质版 (v3.0)',
          concurrency: 1,
          maxPromptChars: 200,
          formats: ['OBJ', 'GLB', 'STL', 'FBX', 'USDZ'],
          supportsMultiView: true,
          maxMultiViewImages: 3,
          supportsFaceCount: true,
          generateTypes: [
            { id: 'Normal', label: '标准', hint: '一次性生成几何 + 纹理，可控制面数' },
            { id: 'Geometry', label: '白模', hint: '仅生成几何体（无贴图），适合 3D 打印' }
          ],
          faceCountRange: {
            min: 100_000,
            max: 5_000_000,
            default: 2_000_000,
            hint: '100,000 – 5,000,000，默认 2,000,000，面数控制免费'
          }
        }
      ],
      credentialFields: [
        { key: 'secretId', label: 'Client ID', placeholder: '在 Hi3D 开放平台创建应用获取' },
        { key: 'secretKey', label: 'Client Secret', placeholder: '应用对应的 Secret' }
      ],
      credentialHint:
        'Hi3D 开发者平台（hi3d.ai）→ 控制台 → 开放 API → 创建应用，获取 Client ID 与 Client Secret；支持支付宝充值，注册赠送免费积分。'
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
