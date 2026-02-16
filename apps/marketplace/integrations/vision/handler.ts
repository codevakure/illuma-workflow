import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    vision_tool: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const imageUrl = params.imageUrl as string | undefined
      const imageFile = params.imageFile as Record<string, unknown> | undefined
      const model = (params.model as string) || 'gpt-4o'
      const prompt = (params.prompt as string) || 'Describe this image in detail.'

      if (!imageUrl && !imageFile) {
        return { success: false, output: {}, error: 'Either imageUrl or imageFile is required' }
      }

      // Resolve image content for the vision request
      let imageContent: unknown[]

      if (imageUrl) {
        imageContent = [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: imageUrl } },
        ]
      } else if (imageFile && ctx.downloadFile) {
        const buffer = await ctx.downloadFile(imageFile)
        const base64 = buffer.toString('base64')
        const mimeType = (imageFile as Record<string, string>).mimeType || 'image/png'
        imageContent = [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
        ]
      } else {
        return { success: false, output: {}, error: 'Cannot process image file without download helper' }
      }

      // Determine provider based on model
      if (model.startsWith('claude')) {
        return analyzeWithAnthropic(apiKey, model, prompt, imageUrl, imageFile, ctx)
      }

      // Default to OpenAI-compatible API
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: imageContent }],
          max_tokens: 4096,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Vision API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()
      const content = data.choices?.[0]?.message?.content || ''
      const usage = data.usage || {}

      return {
        success: true,
        output: {
          content,
          model: data.model || model,
          tokens: usage.total_tokens || 0,
          usage: {
            input_tokens: usage.prompt_tokens || 0,
            output_tokens: usage.completion_tokens || 0,
            total_tokens: usage.total_tokens || 0,
          },
        },
      }
    },
  },
}

async function analyzeWithAnthropic(
  apiKey: string,
  model: string,
  prompt: string,
  imageUrl?: string,
  imageFile?: Record<string, unknown>,
  ctx?: { downloadFile?: (fileRef: unknown) => Promise<Buffer> }
) {
  let imageSource: Record<string, unknown>

  if (imageUrl) {
    imageSource = { type: 'url', url: imageUrl }
  } else if (imageFile && ctx?.downloadFile) {
    const buffer = await ctx.downloadFile(imageFile)
    const base64 = buffer.toString('base64')
    const mimeType = (imageFile as Record<string, string>).mimeType || 'image/png'
    imageSource = { type: 'base64', media_type: mimeType, data: base64 }
  } else {
    return { success: false, output: {}, error: 'Cannot process image for Anthropic' }
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: imageSource },
            { type: 'text', text: prompt },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    return { success: false, output: {}, error: `Anthropic Vision API error: ${response.status} ${errorText}` }
  }

  const data = await response.json()
  const content = data.content?.[0]?.text || ''
  const usage = data.usage || {}

  return {
    success: true,
    output: {
      content,
      model: data.model || model,
      tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      usage: {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
      },
    },
  }
}

export default handler
