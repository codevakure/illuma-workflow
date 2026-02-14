import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { type AuthContext } from '@/middleware/auth'
import { getDedicatedHandler } from '@/routes/tool-proxy/handler-registry'
import { handleGenericProxy } from '@/routes/tool-proxy/generic-handler'

// Import handler registration modules to ensure they register on load
import '@/routes/tool-proxy/handlers/register'

const logger = createLogger('ToolRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * POST /api/tools/thinking
 * Simple thinking/reasoning tool that acknowledges thoughts.
 */
app.post('/thinking', async (c) => {
  try {
    const body = await c.req.json()
    const { thought } = body

    if (!thought || typeof thought !== 'string') {
      return c.json({ success: false, error: 'A thought parameter is required' }, 400)
    }

    return c.json({
      success: true,
      output: {
        thought,
        status: 'acknowledged',
      },
    })
  } catch (error) {
    logger.error('Error in thinking tool', { error })
    return c.json({ success: false, error: 'Failed to process thought' }, 500)
  }
})

/**
 * POST /api/tools/search
 * Search tool - proxies to Exa or other search providers.
 */
app.post('/search', async (c) => {
  try {
    const body = await c.req.json()
    const { query, numResults = 5, type = 'neural' } = body

    if (!query) {
      return c.json({ success: false, error: 'Query is required' }, 400)
    }

    const exaApiKey = process.env.EXA_API_KEY
    if (exaApiKey) {
      const response = await fetch('https://api.exa.ai/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': exaApiKey,
        },
        body: JSON.stringify({
          query,
          numResults,
          type,
          contents: { text: { maxCharacters: 3000 } },
        }),
      })

      if (response.ok) {
        const data = await response.json()
        return c.json({
          success: true,
          output: {
            results: data.results || [],
            query,
            totalResults: data.results?.length || 0,
            source: 'exa',
          },
        })
      }
    }

    return c.json({
      success: true,
      output: {
        results: [],
        query,
        totalResults: 0,
        source: 'none',
        message: 'No search provider configured. Set EXA_API_KEY for web search.',
      },
    })
  } catch (error) {
    logger.error('Error in search tool', { error })
    return c.json({ success: false, error: 'Search failed' }, 500)
  }
})

/**
 * POST /api/tools/image
 * Image generation/proxy tool.
 */
app.post('/image', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}))

    const imageUrl = c.req.query('url')
    if (imageUrl) {
      const response = await fetch(imageUrl)
      if (response.ok) {
        const buffer = await response.arrayBuffer()
        return new Response(buffer, {
          headers: {
            'Content-Type': response.headers.get('Content-Type') || 'image/png',
            'Cache-Control': 'public, max-age=3600',
          },
        })
      }
      return c.json({ error: 'Failed to fetch image' }, 502)
    }

    return c.json({ success: false, error: 'Image URL parameter required' }, 400)
  } catch (error) {
    logger.error('Error in image tool', { error })
    return c.json({ success: false, error: 'Image processing failed' }, 500)
  }
})

/**
 * GET /api/tools/image
 * Image proxy for fetching images by URL query param.
 */
app.get('/image', async (c) => {
  const imageUrl = c.req.query('url')
  if (!imageUrl) {
    return c.json({ error: 'URL parameter required' }, 400)
  }

  try {
    const response = await fetch(imageUrl)
    if (response.ok) {
      const buffer = await response.arrayBuffer()
      return new Response(buffer, {
        headers: {
          'Content-Type': response.headers.get('Content-Type') || 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
    return c.json({ error: 'Failed to fetch image' }, 502)
  } catch (error) {
    return c.json({ error: 'Image fetch failed' }, 500)
  }
})

/**
 * Catch-all for /api/tools/:service/:action
 * Dispatches to dedicated handlers or generic proxy instead of returning 501.
 */
app.all('/:service/:action', async (c) => {
  const service = c.req.param('service')
  const action = c.req.param('action')
  const method = c.req.method

  if (method !== 'POST') {
    return c.json(
      { success: false, error: `Method ${method} not supported for tool routes` },
      405
    )
  }

  try {
    const body = await c.req.json()

    // Check for a dedicated handler
    const dedicatedHandler = getDedicatedHandler(service, action)
    if (dedicatedHandler) {
      logger.info(`Tool proxy: ${service}/${action} -> dedicated handler`)
      const result = await dedicatedHandler(body, c)
      return c.json(result, result.success === false ? 400 : 200)
    }

    // Fall through to generic proxy
    logger.info(`Tool proxy: ${service}/${action} -> generic handler`)
    const result = await handleGenericProxy(service, action, body, c)
    return c.json(result, result.success === false ? 400 : 200)
  } catch (error) {
    logger.error(`Error in tool proxy ${service}/${action}:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return c.json({ success: false, error: errorMessage }, 500)
  }
})

/**
 * Catch-all for /api/tools/:service (single-level paths)
 */
app.all('/:service', async (c) => {
  const service = c.req.param('service')
  const method = c.req.method

  // Skip if already handled by explicit routes
  if (['thinking', 'search', 'image', 'custom'].includes(service)) {
    return c.notFound()
  }

  if (method !== 'POST') {
    return c.json(
      { success: false, error: `Method ${method} not supported for tool routes` },
      405
    )
  }

  try {
    const body = await c.req.json()

    const dedicatedHandler = getDedicatedHandler(service)
    if (dedicatedHandler) {
      logger.info(`Tool proxy: ${service} -> dedicated handler`)
      const result = await dedicatedHandler(body, c)
      return c.json(result, result.success === false ? 400 : 200)
    }

    const result = await handleGenericProxy(service, undefined, body, c)
    return c.json(result, result.success === false ? 400 : 200)
  } catch (error) {
    logger.error(`Error in tool proxy ${service}:`, error)
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred'
    return c.json({ success: false, error: errorMessage }, 500)
  }
})

export { app as toolRoutes }
