import type { ToolHandler } from '../../sdk/types'

const MAX_POLL_RETRIES = 60
const POLL_INTERVAL_MS = 5000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const handler: ToolHandler = {
  operations: {
    video_runway: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const prompt = params.prompt as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!prompt) {
        return { success: false, output: {}, error: 'Missing required parameter: prompt' }
      }

      const response = await fetch('https://api.dev.runwayml.com/v1/image_to_video', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'X-Runway-Version': '2024-11-06',
        },
        body: JSON.stringify({
          model: 'gen4_turbo',
          promptText: prompt,
          duration: params.duration || 5,
          ratio: (params.aspectRatio as string) || '16:9',
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Runway API error: ${response.status} ${errorText}` }
      }

      const createData = await response.json()
      const taskId = createData.id

      let attempts = 0
      while (attempts < MAX_POLL_RETRIES) {
        await sleep(POLL_INTERVAL_MS)

        const statusResponse = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-Runway-Version': '2024-11-06',
          },
        })

        if (!statusResponse.ok) {
          attempts++
          continue
        }

        const statusData = await statusResponse.json()

        if (statusData.status === 'SUCCEEDED') {
          const videoUrl = statusData.output?.[0] || ''
          return {
            success: true,
            output: {
              videoUrl,
              provider: 'runway',
              model: 'gen4_turbo',
              jobId: taskId,
            },
          }
        }

        if (statusData.status === 'FAILED') {
          return {
            success: false,
            output: {},
            error: statusData.failure || 'Runway video generation failed',
          }
        }

        attempts++
      }

      return { success: false, output: {}, error: 'Video generation timed out' }
    },

    video_veo: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const prompt = params.prompt as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!prompt) {
        return { success: false, output: {}, error: 'Missing required parameter: prompt' }
      }

      const model = (params.model as string) || 'veo-3'
      const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning?key=${apiKey}`

      const requestBody: Record<string, unknown> = {
        instances: [{ prompt }],
        parameters: {
          aspectRatio: (params.aspectRatio as string) || '16:9',
          durationSeconds: params.duration || 8,
        },
      }

      const response = await fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Veo API error: ${response.status} ${errorText}` }
      }

      const createData = await response.json()
      const operationName = createData.name

      if (!operationName) {
        return { success: false, output: {}, error: 'No operation name returned from Veo API' }
      }

      let attempts = 0
      while (attempts < MAX_POLL_RETRIES) {
        await sleep(POLL_INTERVAL_MS)

        const statusResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/${operationName}?key=${apiKey}`
        )

        if (!statusResponse.ok) {
          attempts++
          continue
        }

        const statusData = await statusResponse.json()

        if (statusData.done) {
          if (statusData.error) {
            return {
              success: false,
              output: {},
              error: statusData.error.message || 'Veo generation failed',
            }
          }
          const videoUrl = statusData.response?.generatedVideo?.uri || ''
          return {
            success: true,
            output: { videoUrl, provider: 'veo', model },
          }
        }

        attempts++
      }

      return { success: false, output: {}, error: 'Video generation timed out' }
    },

    video_luma: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const prompt = params.prompt as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!prompt) {
        return { success: false, output: {}, error: 'Missing required parameter: prompt' }
      }

      const requestBody: Record<string, unknown> = {
        prompt,
        model: (params.model as string) || 'ray-2',
        resolution: (params.resolution as string) || '720p',
        duration: `${params.duration || 5}s`,
      }

      if (params.aspectRatio) {
        requestBody.aspect_ratio = params.aspectRatio
      }

      const response = await fetch('https://api.lumalabs.ai/dream-machine/v1/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Luma API error: ${response.status} ${errorText}` }
      }

      const createData = await response.json()
      const generationId = createData.id

      let attempts = 0
      while (attempts < MAX_POLL_RETRIES) {
        await sleep(POLL_INTERVAL_MS)

        const statusResponse = await fetch(
          `https://api.lumalabs.ai/dream-machine/v1/generations/${generationId}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        )

        if (!statusResponse.ok) {
          attempts++
          continue
        }

        const statusData = await statusResponse.json()

        if (statusData.state === 'completed') {
          return {
            success: true,
            output: {
              videoUrl: statusData.assets?.video || '',
              provider: 'luma',
              model: (params.model as string) || 'ray-2',
              duration: statusData.assets?.duration,
              width: statusData.assets?.width,
              height: statusData.assets?.height,
            },
          }
        }

        if (statusData.state === 'failed') {
          return {
            success: false,
            output: {},
            error: statusData.failure_reason || 'Luma video generation failed',
          }
        }

        attempts++
      }

      return { success: false, output: {}, error: 'Video generation timed out' }
    },

    video_minimax: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const prompt = params.prompt as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!prompt) {
        return { success: false, output: {}, error: 'Missing required parameter: prompt' }
      }

      const endpoint = (params.endpoint as string) || 'pro'
      const requestBody: Record<string, unknown> = {
        model: (params.model as string) || 'T2V-01',
        prompt,
      }

      if (params.promptOptimizer !== undefined) {
        requestBody.prompt_optimizer = params.promptOptimizer
      }

      const url =
        endpoint === 'pro'
          ? 'https://api.minimaxi.chat/v1/video_generation'
          : 'https://api.minimaxi.chat/v1/video_generation'

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `MiniMax API error: ${response.status} ${errorText}` }
      }

      const createData = await response.json()
      const taskId = createData.task_id

      if (!taskId) {
        return { success: false, output: {}, error: 'No task ID returned from MiniMax' }
      }

      let attempts = 0
      while (attempts < MAX_POLL_RETRIES) {
        await sleep(POLL_INTERVAL_MS)

        const statusResponse = await fetch(
          `https://api.minimaxi.chat/v1/query/video_generation?task_id=${taskId}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        )

        if (!statusResponse.ok) {
          attempts++
          continue
        }

        const statusData = await statusResponse.json()

        if (statusData.status === 'Success') {
          return {
            success: true,
            output: {
              videoUrl: statusData.file_id || '',
              provider: 'minimax',
              model: (params.model as string) || 'T2V-01',
            },
          }
        }

        if (statusData.status === 'Fail') {
          return {
            success: false,
            output: {},
            error: statusData.base_resp?.status_msg || 'MiniMax video generation failed',
          }
        }

        attempts++
      }

      return { success: false, output: {}, error: 'Video generation timed out' }
    },

    video_falai: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const prompt = params.prompt as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!prompt) {
        return { success: false, output: {}, error: 'Missing required parameter: prompt' }
      }

      const model = (params.model as string) || 'veo-3.1'

      const modelEndpointMap: Record<string, string> = {
        'veo-3.1': 'fal-ai/veo3',
        'sora-2': 'fal-ai/sora',
        'kling-2.5-turbo-pro': 'fal-ai/kling-video/v2.5/turbo/text-to-video',
        'kling-2.1-pro': 'fal-ai/kling-video/v2.1/pro/text-to-video',
        'minimax-hailuo-2.3-pro': 'fal-ai/minimax-video/video-01-live/text-to-video',
        'minimax-hailuo-2.3-standard': 'fal-ai/minimax-video/video-01/text-to-video',
        'wan-2.1': 'fal-ai/wan/v2.1/text-to-video',
        'ltxv-0.9.8': 'fal-ai/ltx-video/v0.9.8/text-to-video',
      }

      const endpointId = modelEndpointMap[model] || 'fal-ai/veo3'

      const response = await fetch(`https://queue.fal.run/${endpointId}`, {
        method: 'POST',
        headers: {
          Authorization: `Key ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          duration: params.duration ? `${params.duration}s` : undefined,
          aspect_ratio: params.aspectRatio,
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Fal.ai API error: ${response.status} ${errorText}` }
      }

      const createData = await response.json()
      const requestId = createData.request_id

      if (!requestId) {
        if (createData.video?.url) {
          return {
            success: true,
            output: { videoUrl: createData.video.url, provider: 'falai', model },
          }
        }
        return { success: false, output: {}, error: 'No request ID returned from Fal.ai' }
      }

      let attempts = 0
      while (attempts < MAX_POLL_RETRIES) {
        await sleep(POLL_INTERVAL_MS)

        const statusResponse = await fetch(
          `https://queue.fal.run/${endpointId}/requests/${requestId}/status`,
          { headers: { Authorization: `Key ${apiKey}` } }
        )

        if (!statusResponse.ok) {
          attempts++
          continue
        }

        const statusData = await statusResponse.json()

        if (statusData.status === 'COMPLETED') {
          const resultResponse = await fetch(
            `https://queue.fal.run/${endpointId}/requests/${requestId}`,
            { headers: { Authorization: `Key ${apiKey}` } }
          )

          if (resultResponse.ok) {
            const resultData = await resultResponse.json()
            const videoUrl = resultData.video?.url || resultData.output?.url || ''
            return {
              success: true,
              output: { videoUrl, provider: 'falai', model },
            }
          }
        }

        if (statusData.status === 'FAILED') {
          return {
            success: false,
            output: {},
            error: statusData.error || 'Fal.ai video generation failed',
          }
        }

        attempts++
      }

      return { success: false, output: {}, error: 'Video generation timed out' }
    },
  },
}

export default handler
