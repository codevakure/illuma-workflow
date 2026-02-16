import type { ToolHandler } from '../../sdk/types'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0'

/** Strip HTML tags from a string */
function stripHtmlTags(html: string): string {
  let text = html
  let previous: string
  do {
    previous = text
    text = text.replace(/<[^>]*>/g, '')
    text = text.replace(/[<>]/g, '')
  } while (text !== previous)
  return text.trim()
}

/** Extract text content from a SharePoint canvas layout */
function extractTextFromCanvasLayout(canvasLayout: Record<string, unknown> | null | undefined): string {
  if (!canvasLayout) return ''
  const sections = canvasLayout.horizontalSections as Array<Record<string, unknown>> | undefined
  if (!sections) return ''

  const textParts: string[] = []

  for (const section of sections) {
    const columns = section.columns as Array<Record<string, unknown>> | undefined
    const sectionWebparts = section.webparts as Array<Record<string, unknown>> | undefined

    if (columns) {
      for (const column of columns) {
        const webparts = column.webparts as Array<Record<string, unknown>> | undefined
        if (webparts) {
          for (const webpart of webparts) {
            if (webpart.innerHtml) {
              const text = stripHtmlTags(webpart.innerHtml as string)
              if (text) textParts.push(text)
            }
          }
        }
      }
    } else if (sectionWebparts) {
      for (const webpart of sectionWebparts) {
        if (webpart.innerHtml) {
          const text = stripHtmlTags(webpart.innerHtml as string)
          if (text) textParts.push(text)
        }
      }
    }
  }

  return textParts.join('\n\n')
}

/** Remove @odata metadata keys from an object recursively */
function cleanODataMetadata<T>(obj: T): T {
  if (!obj || typeof obj !== 'object') return obj
  if (Array.isArray(obj)) return obj.map((item) => cleanODataMetadata(item)) as T

  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (key.includes('@odata')) continue
    cleaned[key] = cleanODataMetadata(value)
  }
  return cleaned as T
}

/** Read-only SharePoint fields that cannot be set/updated */
const READ_ONLY_FIELDS = new Set<string>([
  'Id', 'id', 'UniqueId', 'GUID', 'ContentTypeId', 'Created', 'Modified',
  'Author', 'Editor', 'CreatedBy', 'ModifiedBy', 'AuthorId', 'EditorId',
  '_UIVersionString', 'Attachments', 'FileRef', 'FileDirRef', 'FileLeafRef',
])

const handler: ToolHandler = {
  operations: {
    sharepoint_list_sites: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      let baseUrl: string
      if (params.groupId) {
        baseUrl = `${GRAPH_BASE}/groups/${params.groupId}/sites/root`
      } else if (params.siteId || params.siteSelector) {
        const siteId = (params.siteId as string) || (params.siteSelector as string)
        baseUrl = `${GRAPH_BASE}/sites/${siteId}`
      } else {
        baseUrl = `${GRAPH_BASE}/sites?search=*`
      }

      const url = new URL(baseUrl)
      url.searchParams.append(
        '$select',
        'id,name,displayName,webUrl,description,createdDateTime,lastModifiedDateTime,isPersonalSite,root,siteCollection'
      )

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (err as Record<string, Record<string, string>>)?.error?.message || `API error: ${response.status}`,
        }
      }
      const data = await response.json()

      // Multiple sites from search
      if (data.value && Array.isArray(data.value)) {
        return {
          success: true,
          output: {
            sites: data.value.map((site: Record<string, unknown>) => ({
              id: site.id,
              name: site.name,
              displayName: site.displayName,
              webUrl: site.webUrl,
              description: site.description,
              createdDateTime: site.createdDateTime,
              lastModifiedDateTime: site.lastModifiedDateTime,
            })),
          },
        }
      }

      // Single site response
      return {
        success: true,
        output: {
          site: {
            id: data.id,
            name: data.name,
            displayName: data.displayName,
            webUrl: data.webUrl,
            description: data.description,
            createdDateTime: data.createdDateTime,
            lastModifiedDateTime: data.lastModifiedDateTime,
            isPersonalSite: data.isPersonalSite,
            root: data.root,
            siteCollection: data.siteCollection,
          },
        },
      }
    },

    sharepoint_get_list: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const siteId = (params.siteId as string) || (params.siteSelector as string) || 'root'
      const listId = params.listId as string | undefined

      let url: string

      if (!listId) {
        // List all lists in the site
        url = `${GRAPH_BASE}/sites/${siteId}/lists`
      } else {
        const wantsItems = typeof params.includeItems === 'boolean' ? params.includeItems : true

        if (wantsItems && !params.includeColumns) {
          // Fetch items endpoint directly
          const itemsUrl = new URL(`${GRAPH_BASE}/sites/${siteId}/lists/${listId}/items`)
          itemsUrl.searchParams.set('$expand', 'fields')
          url = itemsUrl.toString()
        } else {
          // Fetch list metadata with optional expands
          const listUrl = new URL(`${GRAPH_BASE}/sites/${siteId}/lists/${listId}`)
          const expandParts: string[] = []
          if (params.includeColumns) expandParts.push('columns')
          if (wantsItems) expandParts.push('items($expand=fields)')
          if (expandParts.length > 0) listUrl.searchParams.append('$expand', expandParts.join(','))
          url = listUrl.toString()
        }
      }

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })
      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (err as Record<string, Record<string, string>>)?.error?.message || `API error: ${response.status}`,
        }
      }
      const data = await response.json()

      // Items collection response
      if (
        Array.isArray(data.value) &&
        data.value.length > 0 &&
        data.value[0] &&
        'fields' in data.value[0]
      ) {
        const items = data.value.map((i: Record<string, unknown>) => ({
          id: i.id,
          fields: i.fields as Record<string, unknown>,
        }))

        let nextPageToken: string | undefined
        if (data['@odata.nextLink']) {
          try {
            const u = new URL(data['@odata.nextLink'])
            nextPageToken = u.searchParams.get('$skiptoken') || u.searchParams.get('$skip') || undefined
          } catch {
            nextPageToken = undefined
          }
        }

        return { success: true, output: { list: { items }, nextPageToken } }
      }

      // Collection of lists (site-level)
      if (Array.isArray(data.value)) {
        const lists = data.value.map((l: Record<string, unknown>) => ({
          id: l.id,
          displayName: l.displayName ?? l.name,
          name: l.name,
          webUrl: l.webUrl,
          createdDateTime: l.createdDateTime,
          lastModifiedDateTime: l.lastModifiedDateTime,
          list: l.list,
        }))

        let nextPageToken: string | undefined
        if (data['@odata.nextLink']) {
          try {
            const u = new URL(data['@odata.nextLink'])
            nextPageToken = u.searchParams.get('$skiptoken') || u.searchParams.get('$skip') || undefined
          } catch {
            nextPageToken = undefined
          }
        }

        return { success: true, output: { lists, nextPageToken } }
      }

      // Single list response (with optional expands)
      const list: Record<string, unknown> = {
        id: data.id,
        displayName: data.displayName ?? data.name,
        name: data.name,
        webUrl: data.webUrl,
        createdDateTime: data.createdDateTime,
        lastModifiedDateTime: data.lastModifiedDateTime,
        list: data.list,
      }

      if (Array.isArray(data.columns)) {
        list.columns = data.columns.map((c: Record<string, unknown>) => ({
          id: c.id, name: c.name, displayName: c.displayName,
          description: c.description, indexed: c.indexed,
          enforcedUniqueValues: c.enforcedUniqueValues,
          hidden: c.hidden, readOnly: c.readOnly,
          required: c.required, columnGroup: c.columnGroup,
        }))
      }

      if (Array.isArray(data.items)) {
        list.items = data.items.map((i: Record<string, unknown>) => ({
          id: i.id, fields: i.fields as Record<string, unknown>,
        }))
      }

      return { success: true, output: { list } }
    },

    sharepoint_create_list: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const siteId = (params.siteSelector as string) || (params.siteId as string) || 'root'
      const listDisplayName = params.listDisplayName as string
      if (!listDisplayName) return { success: false, output: {}, error: 'Missing listDisplayName' }

      // Parse optional columns from pageContent
      let columns: unknown[] | undefined
      if (params.pageContent) {
        const raw = params.pageContent
        if (typeof raw === 'string') {
          try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) columns = parsed
            else if (parsed && Array.isArray(parsed.columns)) columns = parsed.columns
          } catch {
            // ignore invalid JSON
          }
        } else if (typeof raw === 'object') {
          if (Array.isArray(raw)) columns = raw as unknown[]
          else if (raw && Array.isArray((raw as Record<string, unknown>).columns)) {
            columns = (raw as Record<string, unknown[]>).columns
          }
        }
      }

      const payload: Record<string, unknown> = {
        displayName: listDisplayName,
        description: params.listDescription || undefined,
        list: { template: (params.listTemplate as string) || 'genericList' },
      }
      if (columns && columns.length > 0) payload.columns = columns

      const response = await fetch(`${GRAPH_BASE}/sites/${siteId}/lists`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (err as Record<string, Record<string, string>>)?.error?.message || `API error: ${response.status}`,
        }
      }
      const data = await response.json()

      return {
        success: true,
        output: {
          list: {
            id: data.id,
            displayName: data.displayName ?? data.name,
            name: data.name,
            webUrl: data.webUrl,
            createdDateTime: data.createdDateTime,
            lastModifiedDateTime: data.lastModifiedDateTime,
            list: data.list,
          },
        },
      }
    },

    sharepoint_update_list: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const siteId = (params.siteId as string) || (params.siteSelector as string) || 'root'
      const listId = params.listId as string
      const itemId = params.itemId as string
      const listItemFields = params.listItemFields as Record<string, unknown> | undefined
      if (!itemId) return { success: false, output: {}, error: 'Missing itemId' }
      if (!listId) return { success: false, output: {}, error: 'Missing listId' }
      if (!listItemFields || Object.keys(listItemFields).length === 0) {
        return { success: false, output: {}, error: 'Missing or empty listItemFields' }
      }

      // Filter out read-only fields
      const entries = Object.entries(listItemFields)
      const updatableEntries = entries.filter(([key]) => !READ_ONLY_FIELDS.has(key))

      if (updatableEntries.length === 0) {
        return {
          success: false,
          output: {},
          error: `All provided fields are read-only: ${Object.keys(listItemFields).join(', ')}`,
        }
      }

      const sanitizedFields = Object.fromEntries(updatableEntries)

      const url = `${GRAPH_BASE}/sites/${siteId}/lists/${listId}/items/${itemId}/fields`
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(sanitizedFields),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (err as Record<string, Record<string, string>>)?.error?.message || `API error: ${response.status}`,
        }
      }

      let fields: Record<string, unknown> | undefined
      if (response.status !== 204) {
        try { fields = await response.json() } catch { fields = listItemFields }
      } else {
        fields = listItemFields
      }

      return {
        success: true,
        output: {
          item: { id: itemId, fields },
        },
      }
    },

    sharepoint_add_list_items: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const siteId = (params.siteId as string) || (params.siteSelector as string) || 'root'
      const listId = params.listId as string
      const listItemFields = params.listItemFields as Record<string, unknown> | undefined
      if (!listId) return { success: false, output: {}, error: 'Missing listId' }
      if (!listItemFields || Object.keys(listItemFields).length === 0) {
        return { success: false, output: {}, error: 'Missing or empty listItemFields' }
      }

      // Unwrap { fields: {...} } wrapper if present
      const providedFields =
        typeof listItemFields === 'object' &&
        listItemFields !== null &&
        'fields' in listItemFields &&
        Object.keys(listItemFields).length === 1
          ? (listItemFields.fields as Record<string, unknown>)
          : listItemFields

      if (!providedFields || Object.keys(providedFields).length === 0) {
        return { success: false, output: {}, error: 'No fields provided for the list item' }
      }

      // Filter out read-only fields
      const entries = Object.entries(providedFields)
      const creatableEntries = entries.filter(([key]) => !READ_ONLY_FIELDS.has(key))

      if (creatableEntries.length === 0) {
        return {
          success: false,
          output: {},
          error: `All provided fields are read-only: ${Object.keys(providedFields).join(', ')}`,
        }
      }

      const sanitizedFields = Object.fromEntries(creatableEntries)

      const url = `${GRAPH_BASE}/sites/${siteId}/lists/${listId}/items`
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ fields: sanitizedFields }),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (err as Record<string, Record<string, string>>)?.error?.message || `API error: ${response.status}`,
        }
      }

      let data: Record<string, unknown> | undefined
      try { data = await response.json() } catch { data = undefined }

      return {
        success: true,
        output: {
          item: {
            id: (data?.id as string) || 'unknown',
            fields: (data?.fields as Record<string, unknown>) || listItemFields,
          },
        },
      }
    },

    sharepoint_create_page: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const siteId = (params.siteSelector as string) || (params.siteId as string) || 'root'
      const pageName = params.pageName as string
      if (!pageName) return { success: false, output: {}, error: 'Missing pageName' }

      const pageTitle = (params.pageTitle as string) || pageName
      const pageContent = params.pageContent as string | undefined

      const pageData: Record<string, unknown> = {
        '@odata.type': '#microsoft.graph.sitePage',
        name: pageName,
        title: pageTitle,
        publishingState: { level: 'draft' },
        pageLayout: 'article',
      }

      if (pageContent) {
        pageData.canvasLayout = {
          horizontalSections: [
            {
              layout: 'oneColumn',
              id: '1',
              emphasis: 'none',
              columns: [
                {
                  id: '1',
                  width: 12,
                  webparts: [
                    {
                      id: '6f9230af-2a98-4952-b205-9ede4f9ef548',
                      innerHtml: `<p>${pageContent.replace(/"/g, '&quot;').replace(/'/g, '&#39;')}</p>`,
                    },
                  ],
                },
              ],
            },
          ],
        }
      }

      const response = await fetch(`${GRAPH_BASE}/sites/${siteId}/pages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(pageData),
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (err as Record<string, Record<string, string>>)?.error?.message || `API error: ${response.status}`,
        }
      }
      const data = await response.json()

      return {
        success: true,
        output: {
          page: {
            id: data.id,
            name: data.name,
            title: data.title || data.name,
            webUrl: data.webUrl,
            pageLayout: data.pageLayout,
            createdDateTime: data.createdDateTime,
            lastModifiedDateTime: data.lastModifiedDateTime,
          },
        },
      }
    },

    sharepoint_read_page: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const siteId = (params.siteId as string) || (params.siteSelector as string) || 'root'
      const pageId = params.pageId as string | undefined
      const pageName = params.pageName as string | undefined

      // Case 1: Read specific page by ID
      if (pageId) {
        const url = new URL(`${GRAPH_BASE}/sites/${siteId}/pages/${pageId}`)
        url.searchParams.append('$select', 'id,name,title,webUrl,pageLayout,createdDateTime,lastModifiedDateTime')
        url.searchParams.append('$expand', 'canvasLayout')

        const response = await fetch(url.toString(), {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        })
        if (!response.ok) {
          const err = await response.json().catch(() => ({}))
          return {
            success: false,
            output: {},
            error: (err as Record<string, Record<string, string>>)?.error?.message || `API error: ${response.status}`,
          }
        }
        const data = await response.json()

        return {
          success: true,
          output: {
            page: {
              id: data.id,
              name: data.name,
              title: data.title || data.name,
              webUrl: data.webUrl,
              pageLayout: data.pageLayout,
              createdDateTime: data.createdDateTime,
              lastModifiedDateTime: data.lastModifiedDateTime,
            },
            content: {
              content: extractTextFromCanvasLayout(data.canvasLayout),
              canvasLayout: data.canvasLayout ?? null,
            },
          },
        }
      }

      // Case 2: Search by page name or list all pages
      const listUrl = new URL(`${GRAPH_BASE}/sites/${siteId}/pages`)
      listUrl.searchParams.append('$select', 'id,name,title,webUrl,pageLayout,createdDateTime,lastModifiedDateTime')

      if (pageName) {
        const pageNameWithAspx = pageName.endsWith('.aspx') ? pageName : `${pageName}.aspx`
        listUrl.searchParams.append('$filter', `name eq '${pageName}' or name eq '${pageNameWithAspx}'`)
        listUrl.searchParams.append('$top', '10')
      } else {
        const maxPages = Math.min((params.maxPages as number) || 10, 50)
        listUrl.searchParams.append('$top', maxPages.toString())
      }

      const listResponse = await fetch(listUrl.toString(), {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
      })
      if (!listResponse.ok) {
        const err = await listResponse.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (err as Record<string, Record<string, string>>)?.error?.message || `API error: ${listResponse.status}`,
        }
      }
      const listData = await listResponse.json()

      if (!listData.value || listData.value.length === 0) {
        const message = pageName
          ? `Page with name '${pageName}' not found. Make sure the page exists and you have access to it.`
          : 'No pages found on this SharePoint site.'
        return {
          success: true,
          output: {
            content: { content: message, canvasLayout: null },
          },
        }
      }

      // Case 2a: Search by name - return single page with content
      if (pageName) {
        const pageInfo = listData.value[0]
        const contentUrl = `${GRAPH_BASE}/sites/${siteId}/pages/${pageInfo.id}/microsoft.graph.sitePage?$expand=canvasLayout`

        let contentData: { content: string; canvasLayout: unknown } = { content: '', canvasLayout: null }
        try {
          const contentResponse = await fetch(contentUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          })
          if (contentResponse.ok) {
            const contentResult = await contentResponse.json()
            contentData = {
              content: extractTextFromCanvasLayout(contentResult.canvasLayout),
              canvasLayout: cleanODataMetadata(contentResult.canvasLayout),
            }
          }
        } catch {
          // content fetch failed, return empty content
        }

        return {
          success: true,
          output: {
            page: {
              id: pageInfo.id,
              name: pageInfo.name,
              title: pageInfo.title || pageInfo.name,
              webUrl: pageInfo.webUrl,
              pageLayout: pageInfo.pageLayout,
              createdDateTime: pageInfo.createdDateTime,
              lastModifiedDateTime: pageInfo.lastModifiedDateTime,
            },
            content: contentData,
          },
        }
      }

      // Case 2b: List all pages with content
      const pagesWithContent: Array<{ page: Record<string, unknown>; content: Record<string, unknown> }> = []

      for (const pageInfo of listData.value as Array<Record<string, unknown>>) {
        const contentUrl = `${GRAPH_BASE}/sites/${siteId}/pages/${pageInfo.id}/microsoft.graph.sitePage?$expand=canvasLayout`

        let contentData: { content: string; canvasLayout: unknown } = { content: '', canvasLayout: null }
        try {
          const contentResponse = await fetch(contentUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: 'application/json',
            },
          })
          if (contentResponse.ok) {
            const contentResult = await contentResponse.json()
            contentData = {
              content: extractTextFromCanvasLayout(contentResult.canvasLayout),
              canvasLayout: cleanODataMetadata(contentResult.canvasLayout),
            }
          }
        } catch {
          contentData = { content: 'Failed to fetch content', canvasLayout: null }
        }

        pagesWithContent.push({
          page: {
            id: pageInfo.id,
            name: pageInfo.name,
            title: pageInfo.title || pageInfo.name,
            webUrl: pageInfo.webUrl,
            pageLayout: pageInfo.pageLayout,
            createdDateTime: pageInfo.createdDateTime,
            lastModifiedDateTime: pageInfo.lastModifiedDateTime,
          },
          content: contentData,
        })
      }

      return {
        success: true,
        output: {
          pages: pagesWithContent,
          totalPages: pagesWithContent.length,
        },
      }
    },

    sharepoint_upload_file: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const siteId = (params.siteId as string) || 'root'
      const driveId = params.driveId as string | undefined
      const folderPath = (params.folderPath as string)?.trim() || ''
      const fileName = params.fileName as string
      const content = params.content as string | undefined

      if (!fileName) return { success: false, output: {}, error: 'Missing fileName' }
      if (!content) return { success: false, output: {}, error: 'Missing content to upload' }

      // Resolve the drive ID
      let effectiveDriveId = driveId
      if (!effectiveDriveId) {
        const driveResponse = await fetch(`${GRAPH_BASE}/sites/${siteId}/drive`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        })
        if (!driveResponse.ok) {
          const err = await driveResponse.json().catch(() => ({}))
          return {
            success: false,
            output: {},
            error: (err as Record<string, Record<string, string>>)?.error?.message || 'Failed to get default document library',
          }
        }
        const driveData = await driveResponse.json()
        effectiveDriveId = driveData.id
      }

      // Build upload path
      let uploadPath = ''
      if (folderPath) {
        const normalizedPath = folderPath.startsWith('/') ? folderPath : `/${folderPath}`
        const cleanPath = normalizedPath.endsWith('/') ? normalizedPath.slice(0, -1) : normalizedPath
        uploadPath = `${cleanPath}/${fileName}`
      } else {
        uploadPath = `/${fileName}`
      }

      const encodedPath = uploadPath
        .split('/')
        .map((segment) => (segment ? encodeURIComponent(segment) : ''))
        .join('/')

      const uploadUrl = `${GRAPH_BASE}/sites/${siteId}/drives/${effectiveDriveId}/root:${encodedPath}:/content`

      const response = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
        },
        body: content,
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (err as Record<string, Record<string, string>>)?.error?.message || `Failed to upload file: ${fileName}`,
        }
      }

      const uploadData = await response.json()

      return {
        success: true,
        output: {
          uploadedFiles: [
            {
              id: uploadData.id,
              name: uploadData.name,
              webUrl: uploadData.webUrl,
              size: uploadData.size,
              createdDateTime: uploadData.createdDateTime,
              lastModifiedDateTime: uploadData.lastModifiedDateTime,
            },
          ],
          fileCount: 1,
        },
      }
    },
  },
}

export default handler
