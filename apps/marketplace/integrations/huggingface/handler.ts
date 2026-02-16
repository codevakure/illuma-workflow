import type { ToolHandler } from '../../sdk/types'

interface HuggingFaceMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

const ENDPOINT_MAP: Record<string, string> = {
  novita: '/v3/openai/chat/completions',
  cerebras: '/v1/chat/completions',
  cohere: '/v1/chat/completions',
  fal: '/v1/chat/completions',
  fireworks: '/v1/chat/completions',
  hyperbolic: '/v1/chat/completions',
  'hf-inference': '/v1/chat/completions',
  nebius: '/v1/chat/completions',
  nscale: '/v1/chat/completions',
  replicate: '/v1/chat/completions',
  sambanova: '/v1/chat/completions',
  together: '/v1/chat/completions',
}

const handler: ToolHandler = {
  operations: {
    huggingface_chat: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const content = params.content as string
      const model = params.model as string
      const provider = params.provider as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!content) {
        return { success: false, output: {}, error: 'Missing required parameter: content' }
      }
      if (!model) {
        return { success: false, output: {}, error: 'Missing required parameter: model' }
      }
      if (!provider) {
        return { success: false, output: {}, error: 'Missing required parameter: provider' }
      }

      const messages: HuggingFaceMessage[] = []

      if (params.systemPrompt) {
        messages.push({ role: 'system', content: params.systemPrompt as string })
      }

      messages.push({ role: 'user', content })

      const body: Record<string, unknown> = {
        model,
        messages,
        stream: false,
      }

      if (params.temperature !== undefined) {
        body.temperature = Number(params.temperature)
      }
      if (params.maxTokens !== undefined) {
        body.max_tokens = Number(params.maxTokens)
      }

      const endpoint = ENDPOINT_MAP[provider] || '/v1/chat/completions'
      const url = `https://router.huggingface.co/${provider}${endpoint}`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `Hugging Face API error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          content: data.choices?.[0]?.message?.content || '',
          model: data.model || 'unknown',
          usage: data.usage
            ? {
                prompt_tokens: data.usage.prompt_tokens || 0,
                completion_tokens: data.usage.completion_tokens || 0,
                total_tokens: data.usage.total_tokens || 0,
              }
            : {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0,
              },
        },
      }
    },
  },
}

export default handler
