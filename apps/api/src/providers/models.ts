/**
 * Re-export provider definitions and helper functions for backward compatibility.
 * The legacy sim app had all of these in a single models.ts file.
 * The API splits them into definitions.ts and helpers.ts.
 */

export { PROVIDER_DEFINITIONS, EMBEDDING_MODEL_PRICING } from './definitions'

export {
  getAllModelIds,
  getProviderModels,
  getProviderDefaultModel,
  getModelPricing,
  getEmbeddingModelPricing,
  getModelCapabilities,
  getModelsWithTemperatureSupport,
  getModelsWithTempRange01,
  getModelsWithTempRange02,
  getProvidersWithToolUsageControl,
  getHostedModels,
  getComputerUseModels,
  supportsTemperature,
  getMaxTemperature,
  supportsToolUsageControl,
  supportsNativeStructuredOutputs,
  getThinkingCapability,
  getModelsWithThinking,
  getThinkingLevelsForModel,
  getModelsWithReasoningEffort,
  getReasoningEffortValuesForModel,
  getModelsWithVerbosity,
  getVerbosityValuesForModel,
  getMaxOutputTokensForModel,
  updateOllamaModels,
  updateVLLMModels,
  updateOpenRouterModels,
} from './helpers'

export type {
  ModelCapabilities,
  ModelDefinition,
  ModelPricing,
  ProviderDefinition,
} from './types'
