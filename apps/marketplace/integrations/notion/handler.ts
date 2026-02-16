import type { ToolHandler } from '../../sdk/types'

const NOTION_VERSION = '2022-06-28'
const BASE_URL = 'https://api.notion.com/v1'

function notionHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  }
}

function extractPageTitle(data: Record<string, unknown>): string {
  const props = data.properties as Record<string, any> | undefined
  if (props?.title?.title && Array.isArray(props.title.title) && props.title.title.length > 0) {
    return props.title.title.map((t: any) => t.plain_text || '').join('')
  }
  return 'Untitled'
}

function extractBlockContent(blocks: any[]): string {
  return blocks
    .map((block: any) => {
      if (block.type === 'paragraph') {
        return block.paragraph.rich_text.map((t: any) => t.plain_text).join('')
      }
      if (block.type === 'heading_1') {
        return `# ${block.heading_1.rich_text.map((t: any) => t.plain_text).join('')}`
      }
      if (block.type === 'heading_2') {
        return `## ${block.heading_2.rich_text.map((t: any) => t.plain_text).join('')}`
      }
      if (block.type === 'heading_3') {
        return `### ${block.heading_3.rich_text.map((t: any) => t.plain_text).join('')}`
      }
      if (block.type === 'bulleted_list_item') {
        return `• ${block.bulleted_list_item.rich_text.map((t: any) => t.plain_text).join('')}`
      }
      if (block.type === 'numbered_list_item') {
        return `1. ${block.numbered_list_item.rich_text.map((t: any) => t.plain_text).join('')}`
      }
      if (block.type === 'to_do') {
        const checked = block.to_do.checked ? '[x]' : '[ ]'
        return `${checked} ${block.to_do.rich_text.map((t: any) => t.plain_text).join('')}`
      }
      return ''
    })
    .filter(Boolean)
    .join('\n\n')
}

const handler: ToolHandler = {
  operations: {
    notion_read: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const pageId = params.pageId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }

      const pageResp = await fetch(`${BASE_URL}/pages/${pageId}`, {
        headers: notionHeaders(accessToken),
      })
      if (!pageResp.ok) {
        const err = await pageResp.text().catch(() => '')
        return { success: false, output: {}, error: `Notion API error: ${pageResp.status} ${err}` }
      }
      const pageData = await pageResp.json()
      const title = extractPageTitle(pageData)

      const blocksResp = await fetch(`${BASE_URL}/blocks/${pageId}/children?page_size=100`, {
        headers: notionHeaders(accessToken),
      })
      let content = ''
      if (blocksResp.ok) {
        const blocksData = await blocksResp.json()
        content = extractBlockContent(blocksData.results || [])
      }

      return {
        success: true,
        output: {
          content,
          title,
          url: pageData.url,
          created_time: pageData.created_time,
          last_edited_time: pageData.last_edited_time,
        },
      }
    },

    notion_read_v2: async (params, ctx) => {
      return handler.operations.notion_read(params, ctx)
    },

    notion_write: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const pageId = params.pageId as string
      const content = params.content as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }
      if (!content) return { success: false, output: {}, error: 'Missing required parameter: content' }

      const resp = await fetch(`${BASE_URL}/blocks/${pageId}/children`, {
        method: 'PATCH',
        headers: notionHeaders(accessToken),
        body: JSON.stringify({
          children: [
            {
              object: 'block',
              type: 'paragraph',
              paragraph: {
                rich_text: [{ type: 'text', text: { content } }],
              },
            },
          ],
        }),
      })

      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Notion API error: ${resp.status} ${err}` }
      }
      await resp.json()
      return { success: true, output: { appended: true } }
    },

    notion_write_v2: async (params, ctx) => {
      return handler.operations.notion_write(params, ctx)
    },

    notion_search: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const body: Record<string, unknown> = {}
      if ((params.query as string)?.trim()) body.query = (params.query as string).trim()
      const filterType = params.filterType as string | undefined
      if (filterType && filterType !== 'all' && ['page', 'database'].includes(filterType)) {
        body.filter = { value: filterType, property: 'object' }
      }
      if (params.pageSize) body.page_size = Math.min(Number(params.pageSize), 100)

      const resp = await fetch(`${BASE_URL}/search`, {
        method: 'POST',
        headers: notionHeaders(accessToken),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Notion API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          results: data.results || [],
          has_more: data.has_more || false,
          next_cursor: data.next_cursor || null,
          total_results: (data.results || []).length,
        },
      }
    },

    notion_search_v2: async (params, ctx) => {
      return handler.operations.notion_search(params, ctx)
    },

    notion_create_page: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const parentId = params.parentId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!parentId) return { success: false, output: {}, error: 'Missing required parameter: parentId' }

      const body: Record<string, any> = {
        parent: { type: 'page_id', page_id: parentId },
      }

      if (params.title) {
        body.properties = {
          title: { type: 'title', title: [{ type: 'text', text: { content: params.title } }] },
        }
      } else {
        body.properties = {}
      }

      if (params.content) {
        body.children = [
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: params.content } }],
            },
          },
        ]
      }

      const resp = await fetch(`${BASE_URL}/pages`, {
        method: 'POST',
        headers: notionHeaders(accessToken),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Notion API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      const title = extractPageTitle(data)
      return {
        success: true,
        output: {
          id: data.id,
          title,
          url: data.url,
          created_time: data.created_time,
          last_edited_time: data.last_edited_time,
        },
      }
    },

    notion_create_page_v2: async (params, ctx) => {
      return handler.operations.notion_create_page(params, ctx)
    },

    notion_update_page: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const pageId = params.pageId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }

      let properties = params.properties
      if (typeof properties === 'string') {
        try { properties = JSON.parse(properties) } catch { /* use as-is */ }
      }

      const resp = await fetch(`${BASE_URL}/pages/${pageId}`, {
        method: 'PATCH',
        headers: notionHeaders(accessToken),
        body: JSON.stringify({ properties }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Notion API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      const title = extractPageTitle(data)
      return {
        success: true,
        output: {
          id: data.id,
          title,
          url: data.url,
          last_edited_time: data.last_edited_time,
        },
      }
    },

    notion_update_page_v2: async (params, ctx) => {
      return handler.operations.notion_update_page(params, ctx)
    },

    notion_query_database: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const databaseId = params.databaseId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!databaseId) return { success: false, output: {}, error: 'Missing required parameter: databaseId' }

      const body: Record<string, unknown> = {}
      if (params.filter) {
        try { body.filter = JSON.parse(params.filter as string) } catch (e) {
          return { success: false, output: {}, error: `Invalid filter JSON: ${e}` }
        }
      }
      if (params.sorts) {
        try { body.sorts = JSON.parse(params.sorts as string) } catch (e) {
          return { success: false, output: {}, error: `Invalid sorts JSON: ${e}` }
        }
      }
      if (params.pageSize) body.page_size = Math.min(Number(params.pageSize), 100)

      const resp = await fetch(`${BASE_URL}/databases/${databaseId}/query`, {
        method: 'POST',
        headers: notionHeaders(accessToken),
        body: JSON.stringify(body),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Notion API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          results: data.results || [],
          has_more: data.has_more || false,
          next_cursor: data.next_cursor || null,
          total_results: (data.results || []).length,
        },
      }
    },

    notion_query_database_v2: async (params, ctx) => {
      return handler.operations.notion_query_database(params, ctx)
    },

    notion_read_database: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const databaseId = params.databaseId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!databaseId) return { success: false, output: {}, error: 'Missing required parameter: databaseId' }

      const resp = await fetch(`${BASE_URL}/databases/${databaseId}`, {
        headers: notionHeaders(accessToken),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Notion API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      const title = data.title?.map((t: any) => t.plain_text || '').join('') || 'Untitled Database'
      return {
        success: true,
        output: {
          id: data.id,
          title,
          url: data.url,
          created_time: data.created_time,
          last_edited_time: data.last_edited_time,
          properties: data.properties || {},
        },
      }
    },

    notion_read_database_v2: async (params, ctx) => {
      return handler.operations.notion_read_database(params, ctx)
    },

    notion_create_database: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const parentId = params.parentId as string
      const title = params.title as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!parentId) return { success: false, output: {}, error: 'Missing required parameter: parentId' }
      if (!title) return { success: false, output: {}, error: 'Missing required parameter: title' }

      let properties = params.properties as Record<string, any> | undefined
      if (typeof properties === 'string') {
        try { properties = JSON.parse(properties) } catch { /* use default */ }
      }
      if (!properties || Object.keys(properties).length === 0) {
        properties = { Name: { title: {} } }
      }

      const resp = await fetch(`${BASE_URL}/databases`, {
        method: 'POST',
        headers: notionHeaders(accessToken),
        body: JSON.stringify({
          parent: { type: 'page_id', page_id: parentId },
          title: [{ type: 'text', text: { content: title } }],
          properties,
        }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Notion API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      const dbTitle = data.title?.map((t: any) => t.plain_text || '').join('') || 'Untitled Database'
      return {
        success: true,
        output: {
          id: data.id,
          title: dbTitle,
          url: data.url,
          created_time: data.created_time,
          properties: data.properties || {},
        },
      }
    },

    notion_create_database_v2: async (params, ctx) => {
      return handler.operations.notion_create_database(params, ctx)
    },

    notion_add_database_row_v2: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const databaseId = params.databaseId as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!databaseId) return { success: false, output: {}, error: 'Missing required parameter: databaseId' }

      let properties = params.properties
      if (typeof properties === 'string') {
        try { properties = JSON.parse(properties) } catch { /* use as-is */ }
      }

      const resp = await fetch(`${BASE_URL}/pages`, {
        method: 'POST',
        headers: notionHeaders(accessToken),
        body: JSON.stringify({
          parent: { type: 'database_id', database_id: databaseId },
          properties,
        }),
      })
      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return { success: false, output: {}, error: `Notion API error: ${resp.status} ${err}` }
      }

      const data = await resp.json()
      let rowTitle = 'Untitled'
      for (const [, value] of Object.entries(data.properties || {})) {
        const prop = value as any
        if (prop.type === 'title' && prop.title?.length > 0) {
          rowTitle = prop.title.map((t: any) => t.plain_text || '').join('')
          break
        }
      }

      return {
        success: true,
        output: {
          id: data.id,
          url: data.url,
          title: rowTitle,
          created_time: data.created_time,
          last_edited_time: data.last_edited_time,
        },
      }
    },
  },
}

export default handler
