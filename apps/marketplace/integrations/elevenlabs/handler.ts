import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    elevenlabs_tts: async (params) => {
      const apiKey = params.apiKey as string
      const text = params.text as string
      const voiceId = params.voiceId as string

      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!text) {
        return { success: false, output: {}, error: 'Missing required parameter: text' }
      }
      if (!voiceId) {
        return { success: false, output: {}, error: 'Missing required parameter: voiceId' }
      }

      const modelId = (params.modelId as string) || 'eleven_monolingual_v1'
      const stability = params.stability as number | undefined
      const similarity = params.similarity as number | undefined

      const body: Record<string, unknown> = {
        text,
        model_id: modelId,
      }

      if (stability !== undefined || similarity !== undefined) {
        body.voice_settings = {
          stability: stability ?? 0.5,
          similarity_boost: similarity ?? 0.75,
        }
      }

      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': apiKey,
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        const errorMessage =
          (errorData as Record<string, unknown>).detail ||
          (errorData as Record<string, unknown>).message ||
          `ElevenLabs API error: ${response.status}`
        return { success: false, output: { audioUrl: '' }, error: String(errorMessage) }
      }

      const audioBuffer = await response.arrayBuffer()
      const base64Audio = Buffer.from(audioBuffer).toString('base64')
      const audioUrl = `data:audio/mpeg;base64,${base64Audio}`

      return {
        success: true,
        output: {
          audioUrl,
        },
      }
    },
  },
}

export default handler
