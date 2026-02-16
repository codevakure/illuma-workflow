import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    openai_embeddings: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const input = params.input as string | string[]
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!input) {
        return { success: false, output: {}, error: 'Missing required parameter: input' }
      }

      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          input,
          model: (params.model as string) || 'text-embedding-3-small',
          encoding_format: (params.encodingFormat as string) || 'float',
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `OpenAI API error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          embeddings: data.data.map((item: Record<string, unknown>) => item.embedding),
          model: data.model,
          usage: {
            prompt_tokens: data.usage.prompt_tokens,
            total_tokens: data.usage.total_tokens,
          },
        },
      }
    },

    openai_image: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const prompt = params.prompt as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!prompt) {
        return { success: false, output: {}, error: 'Missing required parameter: prompt' }
      }

      const model = (params.model as string) || 'dall-e-3'
      const body: Record<string, unknown> = {
        model,
        prompt,
        size: (params.size as string) || '1024x1024',
        n: params.n ? Number(params.n) : 1,
      }

      if (model === 'dall-e-3') {
        if (params.quality) body.quality = params.quality
        if (params.style) body.style = params.style
      } else if (model === 'gpt-image-1') {
        if (params.background) body.background = params.background
      }

      const response = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `OpenAI API error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()

      let imageUrl: string | null = null
      let base64Image: string | null = null

      if (data.data?.[0]?.url) {
        imageUrl = data.data[0].url
      } else if (data.data?.[0]?.b64_json) {
        base64Image = data.data[0].b64_json
      } else {
        return { success: false, output: {}, error: 'No image data found in response' }
      }

      if (imageUrl && !base64Image) {
        try {
          const imageResponse = await fetch(imageUrl)
          if (imageResponse.ok) {
            const arrayBuffer = await imageResponse.arrayBuffer()
            base64Image = Buffer.from(arrayBuffer).toString('base64')
          }
        } catch {
          // If fetching fails, return URL only
        }
      }

      return {
        success: true,
        output: {
          content: imageUrl || 'direct-image',
          image: base64Image || '',
          metadata: {
            model,
          },
        },
      }
    },
  },
}

export default handler
