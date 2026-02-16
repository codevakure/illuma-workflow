import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    tts_openai: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const text = params.text as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!text) {
        return { success: false, output: {}, error: 'Missing required parameter: text' }
      }

      const model = (params.model as string) || 'tts-1'
      const voice = (params.voice as string) || 'alloy'

      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: text,
          voice,
          response_format: (params.responseFormat as string) || 'mp3',
          speed: params.speed ? Number(params.speed) : 1.0,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `OpenAI TTS error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const arrayBuffer = await response.arrayBuffer()
      const audio = Buffer.from(arrayBuffer).toString('base64')
      const contentType = response.headers.get('content-type') || 'audio/mpeg'

      return {
        success: true,
        output: {
          audio,
          contentType,
          characterCount: text.length,
          format: (params.responseFormat as string) || 'mp3',
          provider: 'openai',
        },
      }
    },

    tts_elevenlabs: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const text = params.text as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!text) {
        return { success: false, output: {}, error: 'Missing required parameter: text' }
      }

      const voiceId = (params.voiceId as string) || '21m00Tcm4TlvDq8ikWAM'
      const modelId = (params.modelId as string) || 'eleven_turbo_v2_5'

      const body: Record<string, unknown> = {
        text,
        model_id: modelId,
      }

      if (params.stability !== undefined || params.similarityBoost !== undefined) {
        body.voice_settings = {
          stability: params.stability ?? 0.5,
          similarity_boost: params.similarityBoost ?? 0.8,
          style: params.style,
          use_speaker_boost: params.useSpeakerBoost ?? true,
        }
      }

      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
        method: 'POST',
        headers: {
          Accept: 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': apiKey,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `ElevenLabs TTS error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const arrayBuffer = await response.arrayBuffer()
      const audio = Buffer.from(arrayBuffer).toString('base64')

      return {
        success: true,
        output: {
          audio,
          contentType: 'audio/mpeg',
          characterCount: text.length,
          format: 'mp3',
          provider: 'elevenlabs',
        },
      }
    },

    tts_deepgram: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const text = params.text as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!text) {
        return { success: false, output: {}, error: 'Missing required parameter: text' }
      }

      const model = (params.model as string) || (params.voice as string) || 'aura-asteria-en'
      const encoding = (params.encoding as string) || 'mp3'

      const queryParams = new URLSearchParams({ model, encoding })
      if (params.sampleRate) queryParams.set('sample_rate', String(params.sampleRate))
      if (params.bitRate) queryParams.set('bit_rate', String(params.bitRate))
      if (params.container) queryParams.set('container', params.container as string)

      const response = await fetch(
        `https://api.deepgram.com/v1/speak?${queryParams.toString()}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Token ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `Deepgram TTS error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const arrayBuffer = await response.arrayBuffer()
      const audio = Buffer.from(arrayBuffer).toString('base64')
      const contentType = response.headers.get('content-type') || 'audio/mpeg'

      return {
        success: true,
        output: {
          audio,
          contentType,
          characterCount: text.length,
          format: encoding,
          provider: 'deepgram',
        },
      }
    },

    tts_google: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const text = params.text as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!text) {
        return { success: false, output: {}, error: 'Missing required parameter: text' }
      }

      const languageCode = (params.languageCode as string) || 'en-US'
      const audioEncoding = (params.audioEncoding as string) || 'MP3'

      const body: Record<string, unknown> = {
        input: { text },
        voice: {
          languageCode,
          name: params.voiceId || undefined,
          ssmlGender: params.gender || undefined,
        },
        audioConfig: {
          audioEncoding,
          speakingRate: params.speakingRate ?? 1.0,
          pitch: params.pitch ?? 0.0,
          volumeGainDb: params.volumeGainDb,
          sampleRateHertz: params.sampleRateHertz,
          effectsProfileId: params.effectsProfileId,
        },
      }

      const response = await fetch(
        `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `Google TTS error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          audio: data.audioContent || '',
          contentType: audioEncoding === 'MP3' ? 'audio/mpeg' : `audio/${audioEncoding.toLowerCase()}`,
          characterCount: text.length,
          format: audioEncoding.toLowerCase(),
          provider: 'google',
        },
      }
    },

    tts_azure: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const text = params.text as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!text) {
        return { success: false, output: {}, error: 'Missing required parameter: text' }
      }

      const region = (params.region as string) || 'eastus'
      const voiceId = (params.voiceId as string) || 'en-US-JennyNeural'
      const outputFormat = (params.outputFormat as string) || 'audio-24khz-96kbitrate-mono-mp3'

      let prosodyAttrs = ''
      if (params.rate) prosodyAttrs += ` rate="${params.rate}"`
      if (params.pitch) prosodyAttrs += ` pitch="${params.pitch}"`

      let voiceContent = text
      if (prosodyAttrs) {
        voiceContent = `<prosody${prosodyAttrs}>${text}</prosody>`
      }
      if (params.style) {
        const degree = params.styleDegree ? ` styledegree="${params.styleDegree}"` : ''
        voiceContent = `<mstts:express-as style="${params.style}"${degree}>${voiceContent}</mstts:express-as>`
      }

      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${voiceId}">${voiceContent}</voice></speak>`

      const response = await fetch(
        `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
        {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': apiKey,
            'Content-Type': 'application/ssml+xml',
            'X-Microsoft-OutputFormat': outputFormat,
          },
          body: ssml,
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        return {
          success: false,
          output: {},
          error: `Azure TTS error: ${response.status} ${errorText}`,
        }
      }

      const arrayBuffer = await response.arrayBuffer()
      const audio = Buffer.from(arrayBuffer).toString('base64')

      return {
        success: true,
        output: {
          audio,
          contentType: outputFormat.includes('mp3') ? 'audio/mpeg' : 'audio/wav',
          characterCount: text.length,
          format: outputFormat.includes('mp3') ? 'mp3' : 'wav',
          provider: 'azure',
        },
      }
    },

    tts_cartesia: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const text = params.text as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!text) {
        return { success: false, output: {}, error: 'Missing required parameter: text' }
      }

      const modelId = (params.modelId as string) || 'sonic-3'
      const outputFormat = (params.outputFormat as Record<string, unknown>) || {
        container: 'mp3',
        encoding: 'pcm_f32le',
        sample_rate: 44100,
      }

      const body: Record<string, unknown> = {
        model_id: modelId,
        transcript: text,
        language: (params.language as string) || 'en',
        output_format: outputFormat,
      }

      if (params.voice) {
        body.voice = { mode: 'id', id: params.voice }
      }
      if (params.speed !== undefined) {
        body.speed = params.speed
      }
      if (params.emotion) {
        body.emotion = params.emotion
      }

      const response = await fetch('https://api.cartesia.ai/tts/bytes', {
        method: 'POST',
        headers: {
          'X-API-Key': apiKey,
          'Cartesia-Version': '2024-06-10',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `Cartesia TTS error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const arrayBuffer = await response.arrayBuffer()
      const audio = Buffer.from(arrayBuffer).toString('base64')

      return {
        success: true,
        output: {
          audio,
          contentType: 'audio/mpeg',
          characterCount: text.length,
          format: 'mp3',
          provider: 'cartesia',
        },
      }
    },

    tts_playht: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const text = params.text as string
      const userId = params.userId as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!text) {
        return { success: false, output: {}, error: 'Missing required parameter: text' }
      }
      if (!userId) {
        return { success: false, output: {}, error: 'Missing required parameter: userId' }
      }

      const body: Record<string, unknown> = {
        text,
        voice: params.voice,
        quality: (params.quality as string) || 'standard',
        output_format: (params.outputFormat as string) || 'mp3',
        speed: params.speed ?? 1.0,
      }

      if (params.temperature !== undefined) body.temperature = params.temperature
      if (params.voiceGuidance !== undefined) body.voice_guidance = params.voiceGuidance
      if (params.textGuidance !== undefined) body.text_guidance = params.textGuidance
      if (params.sampleRate !== undefined) body.sample_rate = params.sampleRate

      const response = await fetch('https://api.play.ht/api/v2/tts/stream', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-USER-ID': userId,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: `PlayHT TTS error: ${response.status} ${JSON.stringify(errorData)}`,
        }
      }

      const arrayBuffer = await response.arrayBuffer()
      const audio = Buffer.from(arrayBuffer).toString('base64')

      return {
        success: true,
        output: {
          audio,
          contentType: 'audio/mpeg',
          characterCount: text.length,
          format: (params.outputFormat as string) || 'mp3',
          provider: 'playht',
        },
      }
    },
  },
}

export default handler
