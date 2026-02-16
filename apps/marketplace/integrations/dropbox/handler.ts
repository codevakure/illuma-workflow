import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    dropbox_download: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const path = params.path as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      const dropboxApiArg = JSON.stringify({ path })
        .replace(/[\u007f-\uffff]/g, (c) => '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4))

      const response = await fetch('https://content.dropboxapi.com/2/files/download', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': dropboxApiArg,
        },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: errorText || 'Failed to download file' }
      }

      const apiResultHeader =
        response.headers.get('dropbox-api-result') || response.headers.get('Dropbox-API-Result')
      const metadata = apiResultHeader ? JSON.parse(apiResultHeader) : undefined
      const contentType = response.headers.get('content-type') || 'application/octet-stream'
      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)
      const resolvedName = metadata?.name || path.split('/').pop() || 'download'

      let temporaryLink: string | undefined
      try {
        const linkResponse = await fetch('https://api.dropboxapi.com/2/files/get_temporary_link', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ path }),
        })
        if (linkResponse.ok) {
          const linkData = await linkResponse.json()
          temporaryLink = linkData.link
        }
      } catch {
        temporaryLink = undefined
      }

      return {
        success: true,
        output: {
          file: {
            name: resolvedName,
            mimeType: contentType,
            data: buffer.toString('base64'),
            size: buffer.length,
          },
          content: buffer.toString('base64'),
          metadata,
          temporaryLink,
        },
      }
    },

    dropbox_upload: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const path = params.path as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      let fileBuffer: Buffer | undefined
      let finalPath = path

      if (params.file && ctx.downloadFile) {
        fileBuffer = await ctx.downloadFile(params.file)
        const fileObj = params.file as Record<string, unknown>
        if (finalPath.endsWith('/') && fileObj.name) {
          finalPath = `${finalPath}${fileObj.name}`
        }
      } else if (params.fileContent) {
        fileBuffer = Buffer.from(params.fileContent as string, 'base64')
        if (finalPath.endsWith('/') && params.fileName) {
          finalPath = `${finalPath}${params.fileName}`
        }
      }

      if (!fileBuffer) {
        return { success: false, output: {}, error: 'File is required' }
      }

      const dropboxApiArg = {
        path: finalPath,
        mode: (params.mode as string) || 'add',
        autorename: params.autorename ?? true,
        mute: params.mute ?? false,
      }

      const response = await fetch('https://content.dropboxapi.com/2/files/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/octet-stream',
          'Dropbox-API-Arg': JSON.stringify(dropboxApiArg),
        },
        body: new Uint8Array(fileBuffer),
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: {},
          error: data.error_summary || data.error?.message || 'Failed to upload file',
        }
      }

      return { success: true, output: { file: data } }
    },

    dropbox_search: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const query = params.query as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!query) return { success: false, output: {}, error: 'Missing required parameter: query' }

      const body: Record<string, unknown> = { query }
      const options: Record<string, unknown> = {}

      if (params.path) options.path = params.path
      if (params.fileExtensions) {
        const extensions = (params.fileExtensions as string)
          .split(',')
          .map((ext) => ext.trim())
          .filter((ext) => ext.length > 0)
        if (extensions.length > 0) options.file_extensions = extensions
      }
      if (params.maxResults) options.max_results = params.maxResults
      if (Object.keys(options).length > 0) body.options = options

      const response = await fetch('https://api.dropboxapi.com/2/files/search_v2', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: {},
          error: data.error_summary || data.error?.message || 'Failed to search files',
        }
      }

      return {
        success: true,
        output: {
          matches: data.matches || [],
          hasMore: data.has_more || false,
          cursor: data.cursor,
        },
      }
    },

    dropbox_copy: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const fromPath = params.fromPath as string
      const toPath = params.toPath as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fromPath) return { success: false, output: {}, error: 'Missing required parameter: fromPath' }
      if (!toPath) return { success: false, output: {}, error: 'Missing required parameter: toPath' }

      const response = await fetch('https://api.dropboxapi.com/2/files/copy_v2', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from_path: fromPath,
          to_path: toPath,
          autorename: params.autorename ?? false,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: {},
          error: data.error_summary || data.error?.message || 'Failed to copy file/folder',
        }
      }

      return { success: true, output: { metadata: data.metadata } }
    },

    dropbox_move: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const fromPath = params.fromPath as string
      const toPath = params.toPath as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!fromPath) return { success: false, output: {}, error: 'Missing required parameter: fromPath' }
      if (!toPath) return { success: false, output: {}, error: 'Missing required parameter: toPath' }

      const response = await fetch('https://api.dropboxapi.com/2/files/move_v2', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from_path: fromPath,
          to_path: toPath,
          autorename: params.autorename ?? false,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: {},
          error: data.error_summary || data.error?.message || 'Failed to move file/folder',
        }
      }

      return { success: true, output: { metadata: data.metadata } }
    },

    dropbox_delete: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const path = params.path as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      const response = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: {},
          error: data.error_summary || data.error?.message || 'Failed to delete file/folder',
        }
      }

      return { success: true, output: { metadata: data.metadata, deleted: true } }
    },

    dropbox_create_folder: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const path = params.path as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      const response = await fetch('https://api.dropboxapi.com/2/files/create_folder_v2', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path, autorename: params.autorename ?? false }),
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: {},
          error: data.error_summary || data.error?.message || 'Failed to create folder',
        }
      }

      return { success: true, output: { folder: data.metadata } }
    },

    dropbox_create_shared_link: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const path = params.path as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      const body: Record<string, unknown> = { path }
      const settings: Record<string, unknown> = {}

      if (params.requestedVisibility) {
        settings.requested_visibility = { '.tag': params.requestedVisibility }
      }
      if (params.linkPassword) settings.link_password = params.linkPassword
      if (params.expires) settings.expires = params.expires
      if (Object.keys(settings).length > 0) body.settings = settings

      const response = await fetch(
        'https://api.dropboxapi.com/2/sharing/create_shared_link_with_settings',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      )

      const data = await response.json()

      if (!response.ok) {
        if (data.error_summary?.includes('shared_link_already_exists')) {
          return {
            success: false,
            output: {},
            error:
              'A shared link already exists for this path. Use list_shared_links to get the existing link.',
          }
        }
        return {
          success: false,
          output: {},
          error: data.error_summary || data.error?.message || 'Failed to create shared link',
        }
      }

      return { success: true, output: { sharedLink: data } }
    },

    dropbox_get_metadata: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const path = params.path as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!path) return { success: false, output: {}, error: 'Missing required parameter: path' }

      const response = await fetch('https://api.dropboxapi.com/2/files/get_metadata', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path,
          include_media_info: params.includeMediaInfo ?? false,
          include_deleted: params.includeDeleted ?? false,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: {},
          error: data.error_summary || data.error?.message || 'Failed to get metadata',
        }
      }

      return { success: true, output: { metadata: data } }
    },

    dropbox_list_folder: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const path = params.path as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          path: path === '/' ? '' : (path ?? ''),
          recursive: params.recursive ?? false,
          include_deleted: params.includeDeleted ?? false,
          include_media_info: params.includeMediaInfo ?? false,
          limit: params.limit,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        return {
          success: false,
          output: {},
          error: data.error_summary || data.error?.message || 'Failed to list folder',
        }
      }

      return {
        success: true,
        output: {
          entries: data.entries,
          cursor: data.cursor,
          hasMore: data.has_more,
        },
      }
    },
  },
}

export default handler
