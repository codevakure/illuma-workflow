import type { ToolHandler } from '../../sdk/types'

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0/me/drive'

interface DriveItem {
  id: string
  name: string
  file?: { mimeType: string }
  folder?: { childCount: number }
  webUrl: string
  createdDateTime: string
  lastModifiedDateTime: string
  size?: number
  '@microsoft.graph.downloadUrl'?: string
  parentReference?: { id: string; driveId: string; path: string }
}

const handler: ToolHandler = {
  operations: {
    onedrive_list: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const folderId = (params.manualFolderId as string) || (params.folderSelector as string)
      const encodedFolderId = folderId ? encodeURIComponent(folderId) : ''
      const baseUrl = encodedFolderId
        ? `${GRAPH_BASE}/items/${encodedFolderId}/children`
        : `${GRAPH_BASE}/root/children`

      const url = new URL(baseUrl)
      url.searchParams.append(
        '$select',
        'id,name,file,folder,webUrl,size,createdDateTime,lastModifiedDateTime,parentReference'
      )

      if (params.query) {
        url.searchParams.append('$filter', `startswith(name,'${params.query}')`)
      }
      if (params.pageSize) {
        url.searchParams.append('$top', String(params.pageSize))
      }

      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
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
          files: (data.value as DriveItem[]).map((item) => ({
            id: item.id,
            name: item.name,
            mimeType: item.file?.mimeType || (item.folder ? 'application/folder' : 'unknown'),
            webViewLink: item.webUrl,
            webContentLink: item['@microsoft.graph.downloadUrl'],
            size: item.size?.toString() || '0',
            createdTime: item.createdDateTime,
            modifiedTime: item.lastModifiedDateTime,
            parents: item.parentReference ? [item.parentReference.id] : [],
          })),
          nextPageToken: data['@odata.nextLink'] || null,
        },
      }
    },

    onedrive_create_folder: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const folderName = params.folderName as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!folderName) return { success: false, output: {}, error: 'Missing folderName' }

      const parentFolderId = (params.manualFolderId as string) || (params.folderSelector as string)
      const url = parentFolderId
        ? `${GRAPH_BASE}/items/${encodeURIComponent(parentFolderId)}/children`
        : `${GRAPH_BASE}/root/children`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: folderName,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'rename',
        }),
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
          file: {
            id: data.id,
            name: data.name,
            mimeType: 'application/vnd.microsoft.graph.folder',
            webViewLink: data.webUrl,
            size: data.size,
            createdTime: data.createdDateTime,
            modifiedTime: data.lastModifiedDateTime,
            parentReference: data.parentReference,
          },
        },
      }
    },

    onedrive_delete: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const fileId = (params.fileId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fileId) return { success: false, output: {}, error: 'Missing fileId' }

      const response = await fetch(
        `${GRAPH_BASE}/items/${encodeURIComponent(fileId)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )

      if (response.status === 204) {
        return { success: true, output: { fileId, deleted: true } }
      }

      const err = await response.json().catch(() => ({}))
      return {
        success: false,
        output: {},
        error: (err as Record<string, Record<string, string>>)?.error?.message || `API error: ${response.status}`,
      }
    },

    onedrive_download: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const fileId = (params.fileId as string)?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fileId) return { success: false, output: {}, error: 'Missing fileId' }

      // Download the file content directly from Graph API
      const downloadResponse = await fetch(
        `${GRAPH_BASE}/items/${fileId}/content`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
        }
      )

      if (!downloadResponse.ok) {
        const errorData = await downloadResponse.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, Record<string, string>>)?.error?.message || 'Failed to download file',
        }
      }

      const arrayBuffer = await downloadResponse.arrayBuffer()
      const contentDisposition = downloadResponse.headers.get('content-disposition') || ''
      const nameMatch = contentDisposition.match(/filename="?([^";\s]+)"?/)
      const name = nameMatch?.[1] || (params.fileName as string) || 'download'
      const contentType = downloadResponse.headers.get('content-type') || 'application/octet-stream'

      // Convert to base64 for transport
      const bytes = new Uint8Array(arrayBuffer)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      const base64Content = btoa(binary)

      return {
        success: true,
        output: {
          content: base64Content,
          name,
          mimeType: contentType,
          size: arrayBuffer.byteLength,
        },
      }
    },

    onedrive_upload: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const content = params.content as string
      if (!content) return { success: false, output: {}, error: 'Missing content to upload' }

      let fileName = (params.fileName as string) || 'untitled'
      if (!fileName.endsWith('.txt')) {
        fileName = `${fileName.replace(/\.[^.]*$/, '')}.txt`
      }

      const parentFolderId = (params.manualFolderId as string) || (params.folderSelector as string)
      const url = parentFolderId && parentFolderId.trim() !== ''
        ? `${GRAPH_BASE}/items/${encodeURIComponent(parentFolderId)}:/${fileName}:/content`
        : `${GRAPH_BASE}/root:/${fileName}:/content`

      const response = await fetch(url, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'text/plain',
        },
        body: content,
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
          file: {
            id: data.id,
            name: data.name,
            mimeType: data.file?.mimeType || (params.mimeType as string) || 'text/plain',
            webViewLink: data.webUrl,
            webContentLink: data['@microsoft.graph.downloadUrl'],
            size: data.size,
            createdTime: data.createdDateTime,
            modifiedTime: data.lastModifiedDateTime,
            parentReference: data.parentReference,
          },
        },
      }
    },
  },
}

export default handler
