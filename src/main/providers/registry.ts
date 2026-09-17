import type { ProviderId, ProviderInfo } from '@shared/types'
import { PROVIDER_META } from './meta'
import type { Provider } from './types'
import { mockProvider } from './mock/MockProvider'

/**
 * 服务商实现注册表。新增服务商：实现 Provider 接口后在此数组加一行即可。
 */
const IMPLEMENTATIONS: Provider[] = [mockProvider]

export function listProviderInfos(): ProviderInfo[] {
  return Object.values(PROVIDER_META)
}

export function getProvider(id: ProviderId): Provider | undefined {
  return IMPLEMENTATIONS.find((p) => p.id === id)
}
