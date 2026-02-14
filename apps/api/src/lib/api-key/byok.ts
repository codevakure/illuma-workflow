import { createLogger } from '@sim/logger'

const logger = createLogger('BYOKKeys')

const PROVIDER_ENV_KEYS: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY', 'OPENAI_API_KEY_1', 'OPENAI_API_KEY_2', 'OPENAI_API_KEY_3'],
  anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY_1', 'ANTHROPIC_API_KEY_2', 'ANTHROPIC_API_KEY_3'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY_1', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3'],
  deepseek: ['DEEPSEEK_API_KEY'],
  xai: ['XAI_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
  groq: ['GROQ_API_KEY'],
  mistral: ['MISTRAL_API_KEY'],
  'azure-openai': ['AZURE_OPENAI_API_KEY'],
  'azure-anthropic': ['AZURE_ANTHROPIC_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
}

function getServerApiKey(provider: string): string | undefined {
  const envKeys = PROVIDER_ENV_KEYS[provider]
  if (!envKeys) return undefined
  for (const key of envKeys) {
    const value = process.env[key]
    if (value) return value
  }
  return undefined
}

export async function getApiKeyWithBYOK(
  provider: string,
  model: string,
  workspaceId: string | undefined | null,
  userProvidedKey?: string
): Promise<{ apiKey: string; isBYOK: boolean }> {
  if (provider === 'ollama') {
    return { apiKey: 'empty', isBYOK: false }
  }
  if (provider === 'vllm') {
    return { apiKey: userProvidedKey || 'empty', isBYOK: false }
  }
  if (provider === 'bedrock' || model.startsWith('bedrock/')) {
    return { apiKey: 'bedrock-uses-own-credentials', isBYOK: false }
  }

  const serverKey = getServerApiKey(provider)
  if (serverKey) {
    return { apiKey: serverKey, isBYOK: false }
  }

  if (userProvidedKey) {
    return { apiKey: userProvidedKey, isBYOK: false }
  }

  throw new Error(
    `No API key available for ${provider} ${model}. Set the appropriate env var (e.g., ${provider.toUpperCase().replace('-', '_')}_API_KEY).`
  )
}
