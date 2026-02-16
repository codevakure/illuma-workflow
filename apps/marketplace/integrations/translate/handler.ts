import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    llm_chat: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const context = params.context as string
      if (!context) {
        return { success: false, output: {}, error: 'Missing required parameter: context (text to translate)' }
      }

      const targetLanguage = (params.targetLanguage as string) || 'English'
      const model = (params.model as string) || 'gpt-4o-mini'

      const defaultSystemPrompt =
        `You are a professional translator. Translate the following text to ${targetLanguage}. ` +
        'Only return the translated text, nothing else.'
      const systemPrompt = (params.systemPrompt as string) || defaultSystemPrompt

      // Determine provider based on model name
      let url: string
      let headers: Record<string, string>
      let body: Record<string, unknown>

      if (model.startsWith('claude')) {
        url = 'https://api.anthropic.com/v1/messages'
        headers = {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        }
        body = {
          model,
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: 'user', content: context }],
        }
      } else {
        // Default to OpenAI-compatible API
        url = 'https://api.openai.com/v1/chat/completions'
        headers = {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        }
        body = {
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: context },
          ],
        }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `LLM API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      let content: string
      if (model.startsWith('claude')) {
        content = data.content?.[0]?.text || ''
      } else {
        content = data.choices?.[0]?.message?.content || ''
      }

      return {
        success: true,
        output: { content },
      }
    },
  },
}

export default handler
