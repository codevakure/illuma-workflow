import type { ToolHandler } from '../../sdk/types'

function extractTextFromDocument(document: Record<string, unknown>): string {
  let text = ''
  const body = document.body as Record<string, unknown> | undefined
  if (!body?.content) return text

  for (const element of body.content as Array<Record<string, unknown>>) {
    if (element.paragraph) {
      const para = element.paragraph as Record<string, unknown>
      for (const pe of (para.elements || []) as Array<Record<string, unknown>>) {
        const textRun = pe.textRun as Record<string, unknown> | undefined
        if (textRun?.content) text += textRun.content as string
      }
    } else if (element.table) {
      const table = element.table as Record<string, unknown>
      for (const row of (table.tableRows || []) as Array<Record<string, unknown>>) {
        for (const cell of (row.tableCells || []) as Array<Record<string, unknown>>) {
          for (const cellContent of (cell.content || []) as Array<Record<string, unknown>>) {
            if (cellContent.paragraph) {
              const para = cellContent.paragraph as Record<string, unknown>
              for (const pe of (para.elements || []) as Array<Record<string, unknown>>) {
                const textRun = pe.textRun as Record<string, unknown> | undefined
                if (textRun?.content) text += textRun.content as string
              }
            }
          }
        }
      }
    }
  }
  return text
}

const handler: ToolHandler = {
  operations: {
    google_docs_read: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const documentId = ((params.documentId as string) || (params.manualDocumentId as string))?.trim()
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!documentId) return { success: false, output: {}, error: 'Missing documentId' }

      const response = await fetch(`https://docs.googleapis.com/v1/documents/${documentId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Docs API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const content = extractTextFromDocument(data)

      return {
        success: true,
        output: {
          content,
          metadata: {
            documentId: data.documentId,
            title: data.title || 'Untitled Document',
            mimeType: 'application/vnd.google-apps.document',
            url: `https://docs.google.com/document/d/${data.documentId}/edit`,
          },
        },
      }
    },

    google_docs_write: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const documentId = ((params.documentId as string) || (params.manualDocumentId as string))?.trim()
      const content = params.content as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!documentId) return { success: false, output: {}, error: 'Missing documentId' }
      if (!content) return { success: false, output: {}, error: 'Missing content' }

      const response = await fetch(
        `https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [{ insertText: { endOfSegmentLocation: {}, text: content } }],
          }),
        }
      )

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Docs API error: ${response.status} ${err}` }
      }

      return {
        success: true,
        output: {
          updatedContent: true,
          metadata: {
            documentId,
            title: 'Updated Document',
            mimeType: 'application/vnd.google-apps.document',
            url: `https://docs.google.com/document/d/${documentId}/edit`,
          },
        },
      }
    },

    google_docs_create: async (params, ctx) => {
      const accessToken = ctx.accessToken || (params.accessToken as string)
      const title = params.title as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!title) return { success: false, output: {}, error: 'Missing title' }

      const body: Record<string, unknown> = {
        name: title,
        mimeType: 'application/vnd.google-apps.document',
      }

      const folderId = (params.folderSelector as string) || (params.folderId as string)
      if (folderId) body.parents = [folderId]

      const response = await fetch(
        'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      )

      if (!response.ok) {
        const err = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Drive API error: ${response.status} ${err}` }
      }

      const data = await response.json()
      const documentId = data.id

      if (params.content && documentId) {
        try {
          await fetch(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              requests: [{ insertText: { endOfSegmentLocation: {}, text: params.content as string } }],
            }),
          })
        } catch {
          // Document was created; content write failure is non-fatal
        }
      }

      return {
        success: true,
        output: {
          metadata: {
            documentId,
            title: data.name || 'Untitled Document',
            mimeType: 'application/vnd.google-apps.document',
            url: `https://docs.google.com/document/d/${documentId}/edit`,
          },
        },
      }
    },
  },
}

export default handler
