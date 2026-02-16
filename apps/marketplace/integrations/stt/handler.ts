import type { ToolHandler } from '../../sdk/types'

async function getAudioBuffer(
  params: Record<string, unknown>,
  ctx: { downloadFile?: (fileRef: unknown) => Promise<Buffer> }
): Promise<{ buffer: Buffer; fileName: string; mimeType: string } | null> {
  if (params.audioFile && ctx.downloadFile) {
    const file = Array.isArray(params.audioFile) ? params.audioFile[0] : params.audioFile
    const buffer = await ctx.downloadFile(file)
    const name = (file as Record<string, unknown>)?.name as string || 'audio.mp3'
    const mime = (file as Record<string, unknown>)?.type as string || 'audio/mpeg'
    return { buffer, fileName: name, mimeType: mime }
  }

  if (params.audioFileReference && ctx.downloadFile) {
    const file = Array.isArray(params.audioFileReference)
      ? params.audioFileReference[0]
      : params.audioFileReference
    const buffer = await ctx.downloadFile(file)
    const name = (file as Record<string, unknown>)?.name as string || 'audio.mp3'
    const mime = (file as Record<string, unknown>)?.type as string || 'audio/mpeg'
    return { buffer, fileName: name, mimeType: mime }
  }

  if (params.audioUrl) {
    const response = await fetch(params.audioUrl as string)
    if (!response.ok) {
      return null
    }
    const arrayBuffer = await response.arrayBuffer()
    const fileName = (params.audioUrl as string).split('/').pop() || 'audio.mp3'
    const mimeType = response.headers.get('content-type') || 'audio/mpeg'
    return { buffer: Buffer.from(arrayBuffer), fileName, mimeType }
  }

  return null
}

const handler: ToolHandler = {
  operations: {
    stt_whisper: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const audio = await getAudioBuffer(params, ctx)
      if (!audio) {
        return { success: false, output: {}, error: 'No audio source provided. Provide audioFile, audioFileReference, or audioUrl.' }
      }

      const model = (params.model as string) || 'whisper-1'
      const isTranslation = params.translateToEnglish === true

      const formData = new FormData()
      const blob = new Blob([new Uint8Array(audio.buffer)], { type: audio.mimeType })
      formData.append('file', blob, audio.fileName)
      formData.append('model', model)

      if (params.language && params.language !== 'auto') {
        formData.append('language', params.language as string)
      }
      if (params.prompt) {
        formData.append('prompt', params.prompt as string)
      }
      if (params.temperature !== undefined) {
        formData.append('temperature', String(params.temperature))
      }

      const needsTimestamps = params.timestamps && params.timestamps !== 'none'
      if (needsTimestamps) {
        formData.append('response_format', 'verbose_json')
        if (params.timestamps === 'word') {
          formData.append('timestamp_granularities[]', 'word')
        } else {
          formData.append('timestamp_granularities[]', 'segment')
        }
      }

      const endpoint = isTranslation
        ? 'https://api.openai.com/v1/audio/translations'
        : 'https://api.openai.com/v1/audio/transcriptions'

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `Whisper API error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          transcript: data.text || '',
          segments: data.segments || data.words || [],
          language: data.language,
          duration: data.duration,
        },
      }
    },

    stt_whisper_v2: async (params, ctx) => {
      return handler.operations.stt_whisper(params, ctx)
    },

    stt_deepgram: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const audio = await getAudioBuffer(params, ctx)
      if (!audio) {
        return { success: false, output: {}, error: 'No audio source provided.' }
      }

      const model = (params.model as string) || 'nova-3'
      const queryParams = new URLSearchParams({ model })

      if (params.language && params.language !== 'auto') {
        queryParams.set('language', params.language as string)
      } else {
        queryParams.set('detect_language', 'true')
      }
      if (params.diarization) {
        queryParams.set('diarize', 'true')
      }
      queryParams.set('punctuate', 'true')
      queryParams.set('paragraphs', 'true')

      const response = await fetch(
        `https://api.deepgram.com/v1/listen?${queryParams.toString()}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': audio.mimeType,
          },
          body: audio.buffer,
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `Deepgram API error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()
      const channel = data.results?.channels?.[0]
      const alternative = channel?.alternatives?.[0]

      return {
        success: true,
        output: {
          transcript: alternative?.transcript || '',
          segments: alternative?.paragraphs?.paragraphs || [],
          language: channel?.detected_language || data.results?.channels?.[0]?.detected_language,
          duration: data.metadata?.duration,
          confidence: alternative?.confidence,
        },
      }
    },

    stt_deepgram_v2: async (params, ctx) => {
      return handler.operations.stt_deepgram(params, ctx)
    },

    stt_elevenlabs: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const audio = await getAudioBuffer(params, ctx)
      if (!audio) {
        return { success: false, output: {}, error: 'No audio source provided.' }
      }

      const model = (params.model as string) || 'scribe_v1'

      const formData = new FormData()
      const blob = new Blob([new Uint8Array(audio.buffer)], { type: audio.mimeType })
      formData.append('file', blob, audio.fileName)
      formData.append('model_id', model)

      if (params.language && params.language !== 'auto') {
        formData.append('language_code', params.language as string)
      }

      const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: { 'xi-api-key': apiKey },
        body: formData,
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `ElevenLabs STT error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          transcript: data.text || '',
          segments: data.words || [],
          language: data.language_code,
          confidence: data.language_probability,
        },
      }
    },

    stt_elevenlabs_v2: async (params, ctx) => {
      return handler.operations.stt_elevenlabs(params, ctx)
    },

    stt_assemblyai: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const audio = await getAudioBuffer(params, ctx)
      let audioUrl = params.audioUrl as string | undefined

      if (audio && !audioUrl) {
        const uploadResponse = await fetch('https://api.assemblyai.com/v2/upload', {
          method: 'POST',
          headers: {
            authorization: apiKey,
            'Content-Type': 'application/octet-stream',
          },
          body: audio.buffer,
        })

        if (!uploadResponse.ok) {
          return { success: false, output: {}, error: 'Failed to upload audio to AssemblyAI' }
        }

        const uploadData = await uploadResponse.json()
        audioUrl = uploadData.upload_url
      }

      if (!audioUrl) {
        return { success: false, output: {}, error: 'No audio source provided.' }
      }

      const transcriptBody: Record<string, unknown> = {
        audio_url: audioUrl,
      }

      if (params.language && params.language !== 'auto') {
        transcriptBody.language_code = params.language
      } else {
        transcriptBody.language_detection = true
      }
      if (params.diarization) transcriptBody.speaker_labels = true
      if (params.sentiment) transcriptBody.sentiment_analysis = true
      if (params.entityDetection) transcriptBody.entity_detection = true
      if (params.summarization) {
        transcriptBody.summarization = true
        transcriptBody.summary_type = 'bullets'
      }

      const response = await fetch('https://api.assemblyai.com/v2/transcript', {
        method: 'POST',
        headers: {
          authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(transcriptBody),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `AssemblyAI API error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const createData = await response.json()
      const transcriptId = createData.id

      let attempts = 0
      while (attempts < 120) {
        await new Promise((resolve) => setTimeout(resolve, 3000))

        const pollResponse = await fetch(`https://api.assemblyai.com/v2/transcript/${transcriptId}`, {
          headers: { authorization: apiKey },
        })

        if (!pollResponse.ok) {
          attempts++
          continue
        }

        const pollData = await pollResponse.json()

        if (pollData.status === 'completed') {
          return {
            success: true,
            output: {
              transcript: pollData.text || '',
              segments: pollData.utterances || [],
              language: pollData.language_code,
              duration: pollData.audio_duration,
              confidence: pollData.confidence,
              sentiment: pollData.sentiment_analysis_results || [],
              entities: pollData.entities || [],
              summary: pollData.summary,
            },
          }
        }

        if (pollData.status === 'error') {
          return { success: false, output: {}, error: pollData.error || 'AssemblyAI transcription failed' }
        }

        attempts++
      }

      return { success: false, output: {}, error: 'Transcription timed out' }
    },

    stt_assemblyai_v2: async (params, ctx) => {
      return handler.operations.stt_assemblyai(params, ctx)
    },

    stt_gemini: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const audio = await getAudioBuffer(params, ctx)
      if (!audio) {
        return { success: false, output: {}, error: 'No audio source provided.' }
      }

      const model = (params.model as string) || 'gemini-2.5-flash'
      const base64Audio = audio.buffer.toString('base64')

      const languageInstruction =
        params.language && params.language !== 'auto'
          ? ` The audio is in ${params.language}.`
          : ''

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: `Transcribe this audio accurately.${languageInstruction} Return only the transcription text.`,
                  },
                  {
                    inline_data: {
                      mime_type: audio.mimeType,
                      data: base64Audio,
                    },
                  },
                ],
              },
            ],
          }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `Gemini API error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()
      const transcript = data.candidates?.[0]?.content?.parts?.[0]?.text || ''

      return {
        success: true,
        output: {
          transcript,
          language: (params.language as string) || 'auto',
        },
      }
    },

    stt_gemini_v2: async (params, ctx) => {
      return handler.operations.stt_gemini(params, ctx)
    },
  },
}

export default handler
