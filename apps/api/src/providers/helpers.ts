import type { ModelCapabilities, ModelPricing, ProviderId, ProviderDefinition } from './types'
import { PROVIDER_DEFINITIONS, EMBEDDING_MODEL_PRICING } from './definitions'

export function getProviderModels(providerId: string): string[] {
  return PROVIDER_DEFINITIONS[providerId]?.models.map((m) => m.id) || []
}

export function getProviderDefaultModel(providerId: string): string {
  return PROVIDER_DEFINITIONS[providerId]?.defaultModel || ''
}

export function getModelPricing(modelId: string): ModelPricing | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model) {
      return model.pricing
    }
  }
  return null
}

export function getEmbeddingModelPricing(modelId: string): ModelPricing | null {
  return EMBEDDING_MODEL_PRICING[modelId] || null
}

export function getModelCapabilities(modelId: string): ModelCapabilities | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model) {
      const capabilities: ModelCapabilities = { ...provider.capabilities, ...model.capabilities }
      return capabilities
    }
  }

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    if (provider.modelPatternStrings) {
      for (const patternStr of provider.modelPatternStrings) {
        const pattern = new RegExp(patternStr)
        if (pattern.test(modelId.toLowerCase())) {
          return provider.capabilities || null
        }
      }
    }
  }

  return null
}

export function getModelsWithTemperatureSupport(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.temperature) {
        models.push(model.id)
      }
    }
  }
  return models
}

export function getModelsWithTempRange01(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.temperature?.max === 1) {
        models.push(model.id)
      }
    }
  }
  return models
}

export function getModelsWithTempRange02(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.temperature?.max === 2) {
        models.push(model.id)
      }
    }
  }
  return models
}

export function getProvidersWithToolUsageControl(): string[] {
  const providers: string[] = []
  for (const [providerId, provider] of Object.entries(PROVIDER_DEFINITIONS)) {
    if (provider.capabilities?.toolUsageControl) {
      providers.push(providerId)
    }
  }
  return providers
}

export function getHostedModels(): string[] {
  return [
    ...getProviderModels('openai'),
    ...getProviderModels('anthropic'),
    ...getProviderModels('google'),
  ]
}

export function getComputerUseModels(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.computerUse) {
        models.push(model.id)
      }
    }
  }
  return models
}

export function supportsTemperature(modelId: string): boolean {
  const capabilities = getModelCapabilities(modelId)
  return !!capabilities?.temperature
}

export function getMaxTemperature(modelId: string): number | undefined {
  const capabilities = getModelCapabilities(modelId)
  return capabilities?.temperature?.max
}

export function supportsToolUsageControl(providerId: string): boolean {
  return getProvidersWithToolUsageControl().includes(providerId)
}

export function supportsNativeStructuredOutputs(modelId: string): boolean {
  const normalizedModelId = modelId.toLowerCase()

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.nativeStructuredOutputs) {
        const baseModelId = model.id.toLowerCase()
        if (normalizedModelId === baseModelId || normalizedModelId.startsWith(`${baseModelId}-`)) {
          return true
        }
      }
    }
  }
  return false
}

export function getThinkingCapability(
  modelId: string
): { levels: string[]; default?: string } | null {
  const normalizedModelId = modelId.toLowerCase()

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.thinking) {
        const baseModelId = model.id.toLowerCase()
        if (normalizedModelId === baseModelId || normalizedModelId.startsWith(`${baseModelId}-`)) {
          return model.capabilities.thinking
        }
      }
    }
  }
  return null
}

export function getModelsWithThinking(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.thinking) {
        models.push(model.id)
      }
    }
  }
  return models
}

export function getThinkingLevelsForModel(modelId: string): string[] | null {
  const capability = getThinkingCapability(modelId)
  return capability?.levels ?? null
}

export function getModelsWithReasoningEffort(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.reasoningEffort) {
        models.push(model.id)
      }
    }
  }
  return models
}

export function getReasoningEffortValuesForModel(modelId: string): string[] | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model?.capabilities.reasoningEffort) {
      return model.capabilities.reasoningEffort.values
    }
  }
  return null
}

export function getModelsWithVerbosity(): string[] {
  const models: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      if (model.capabilities.verbosity) {
        models.push(model.id)
      }
    }
  }
  return models
}

export function getVerbosityValuesForModel(modelId: string): string[] | null {
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    const model = provider.models.find((m) => m.id.toLowerCase() === modelId.toLowerCase())
    if (model?.capabilities.verbosity) {
      return model.capabilities.verbosity.values
    }
  }
  return null
}

export function getMaxOutputTokensForModel(modelId: string, streaming = false): number {
  const normalizedModelId = modelId.toLowerCase()
  const STANDARD_MAX_OUTPUT_TOKENS = 4096

  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      const baseModelId = model.id.toLowerCase()
      if (normalizedModelId === baseModelId || normalizedModelId.startsWith(`${baseModelId}-`)) {
        const outputTokens = model.capabilities.maxOutputTokens
        if (outputTokens) {
          return streaming ? outputTokens.max : outputTokens.default
        }
        return STANDARD_MAX_OUTPUT_TOKENS
      }
    }
  }

  return STANDARD_MAX_OUTPUT_TOKENS
}

export function getAllModelIds(): string[] {
  const modelIds: string[] = []
  for (const provider of Object.values(PROVIDER_DEFINITIONS)) {
    for (const model of provider.models) {
      modelIds.push(model.id)
    }
  }
  return modelIds
}

export function updateOllamaModels(models: string[]): void {
  PROVIDER_DEFINITIONS.ollama.models = models.map((modelId) => ({
    id: modelId,
    pricing: {
      input: 0,
      output: 0,
      updatedAt: new Date().toISOString().split('T')[0],
    },
    capabilities: {},
  }))
}

export function updateVLLMModels(models: string[]): void {
  PROVIDER_DEFINITIONS.vllm.models = models.map((modelId) => ({
    id: modelId,
    pricing: {
      input: 0,
      output: 0,
      updatedAt: new Date().toISOString().split('T')[0],
    },
    capabilities: {},
  }))
}

export function updateOpenRouterModels(models: string[]): void {
  PROVIDER_DEFINITIONS.openrouter.models = models.map((modelId) => ({
    id: modelId,
    pricing: {
      input: 0,
      output: 0,
      updatedAt: new Date().toISOString().split('T')[0],
    },
    capabilities: {},
  }))
}
