/**
 * Server-side stub for useProvidersStore.
 * The API does not need a live Zustand store for provider models.
 * Block definitions call getState() at definition time for model lists;
 * on the server these resolve to empty arrays which is acceptable
 * because the executor resolves models from the database / provider config.
 */
import type { OpenRouterModelInfo, ProviderName, ProviderState } from './types'

const emptyProvider: ProviderState = { models: [], isLoading: false }

export const useProvidersStore = {
  getState: () => ({
    providers: {
      base: emptyProvider,
      ollama: emptyProvider,
      vllm: emptyProvider,
      openrouter: emptyProvider,
    } as Record<ProviderName, ProviderState>,
    openRouterModelInfo: {} as Record<string, OpenRouterModelInfo>,
    setProviderModels: (_provider: ProviderName, _models: string[]) => {},
    setProviderLoading: (_provider: ProviderName, _isLoading: boolean) => {},
    setOpenRouterModelInfo: (_modelInfo: Record<string, OpenRouterModelInfo>) => {},
    getProvider: (_provider: ProviderName): ProviderState => emptyProvider,
    getOpenRouterModelInfo: (_modelId: string): OpenRouterModelInfo | undefined => undefined,
  }),
}
