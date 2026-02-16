import type { ToolHandler } from '../../sdk/types'

const SLIDES_API_BASE = 'https://slides.googleapis.com/v1/presentations'
const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files'
const PT_TO_EMU = 12700

function generateObjectId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

async function batchUpdate(
  accessToken: string,
  presentationId: string,
  requests: Record<string, unknown>[]
): Promise<Record<string, unknown>> {
  const response = await fetch(`${SLIDES_API_BASE}/${presentationId}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  })
  const data = await response.json()
  if (!response.ok) {
    throw new Error(data.error?.message ?? 'Batch update failed')
  }
  return data
}

const handler: ToolHandler = {
  operations: {
    google_slides_create: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const title = params.title as string
      if (!accessToken || !title) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, title' }
      }

      const body: Record<string, unknown> = {
        name: title,
        mimeType: 'application/vnd.google-apps.presentation',
      }
      const folderId = (params.folderSelector as string) || (params.folderId as string)
      if (folderId) body.parents = [folderId]

      const response = await fetch(`${DRIVE_API_BASE}?supportsAllDrives=true`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to create presentation' }
      }

      const presentationId = data.id
      const metadata = {
        presentationId,
        title: data.name || 'Untitled Presentation',
        mimeType: 'application/vnd.google-apps.presentation',
        url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
      }

      if (params.content && presentationId) {
        try {
          const presResponse = await fetch(`${SLIDES_API_BASE}/${presentationId}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` },
          })
          const presData = await presResponse.json()
          const slide = presData.slides?.[0]
          if (slide) {
            const textBoxId = generateObjectId('textbox')
            await batchUpdate(accessToken, presentationId, [
              {
                createShape: {
                  objectId: textBoxId,
                  shapeType: 'TEXT_BOX',
                  elementProperties: {
                    pageObjectId: slide.objectId,
                    size: { width: { magnitude: 400, unit: 'PT' }, height: { magnitude: 100, unit: 'PT' } },
                    transform: { scaleX: 1, scaleY: 1, translateX: 50, translateY: 100, unit: 'PT' },
                  },
                },
              },
              { insertText: { objectId: textBoxId, text: params.content as string, insertionIndex: 0 } },
            ])
          }
        } catch {
          /* content add failed but presentation was created */
        }
      }

      return { success: true, output: { metadata } }
    },

    google_slides_read: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      if (!accessToken || !presentationId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId' }
      }

      const response = await fetch(`${SLIDES_API_BASE}/${presentationId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to read presentation' }
      }

      return {
        success: true,
        output: {
          slides: data.slides ?? [],
          metadata: {
            presentationId: data.presentationId,
            title: data.title || 'Untitled Presentation',
            pageSize: data.pageSize,
            mimeType: 'application/vnd.google-apps.presentation',
            url: `https://docs.google.com/presentation/d/${data.presentationId}/edit`,
          },
        },
      }
    },

    google_slides_write: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      const content = params.content as string
      if (!accessToken || !presentationId || !content) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, content' }
      }

      const metadata = {
        presentationId,
        title: 'Presentation',
        mimeType: 'application/vnd.google-apps.presentation',
        url: `https://docs.google.com/presentation/d/${presentationId}/edit`,
      }

      const presResponse = await fetch(`${SLIDES_API_BASE}/${presentationId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
      const presData = await presResponse.json()
      if (!presResponse.ok) {
        return { success: false, output: { updatedContent: false, metadata }, error: presData.error?.message ?? 'Failed to read presentation' }
      }
      metadata.title = presData.title || 'Updated Presentation'

      const slideIndex = typeof params.slideIndex === 'string' ? Number.parseInt(params.slideIndex, 10) : ((params.slideIndex as number) ?? 0)
      if (Number.isNaN(slideIndex) || slideIndex < 0) {
        return { success: false, output: { updatedContent: false, metadata }, error: 'Slide index must be a non-negative number' }
      }

      const slide = presData.slides?.[slideIndex]
      if (!slide) {
        return { success: false, output: { updatedContent: false, metadata }, error: `Slide at index ${slideIndex} not found` }
      }

      const textBoxId = generateObjectId('textbox')
      try {
        await batchUpdate(accessToken, presentationId, [
          {
            createShape: {
              objectId: textBoxId,
              shapeType: 'TEXT_BOX',
              elementProperties: {
                pageObjectId: slide.objectId,
                size: { width: { magnitude: 400, unit: 'PT' }, height: { magnitude: 100, unit: 'PT' } },
                transform: { scaleX: 1, scaleY: 1, translateX: 50, translateY: 100, unit: 'PT' },
              },
            },
          },
          { insertText: { objectId: textBoxId, text: content, insertionIndex: 0 } },
        ])
      } catch (error) {
        return { success: false, output: { updatedContent: false, metadata }, error: error instanceof Error ? error.message : 'Failed to update presentation' }
      }

      return { success: true, output: { updatedContent: true, metadata } }
    },

    google_slides_add_slide: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      if (!accessToken || !presentationId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId' }
      }

      const slideObjectId = generateObjectId('slide')
      const layout = ((params.layout as string) || 'BLANK').toUpperCase()
      const createSlideRequest: Record<string, unknown> = {
        objectId: slideObjectId,
        slideLayoutReference: { predefinedLayout: layout },
      }
      if (params.insertionIndex !== undefined && (params.insertionIndex as number) >= 0) {
        createSlideRequest.insertionIndex = params.insertionIndex
      }
      if (params.placeholderIdMappings) {
        try {
          const mappings = JSON.parse(params.placeholderIdMappings as string)
          if (Array.isArray(mappings) && mappings.length > 0) {
            createSlideRequest.placeholderIdMappings = mappings
          }
        } catch { /* ignore invalid JSON */ }
      }

      try {
        const data = await batchUpdate(accessToken, presentationId, [{ createSlide: createSlideRequest }])
        const slideId = (data.replies as Record<string, unknown>[])?.[0]?.createSlide
          ? ((data.replies as Record<string, unknown>[])[0].createSlide as Record<string, unknown>).objectId as string
          : ''
        return {
          success: true,
          output: {
            slideId,
            metadata: { presentationId, layout, insertionIndex: params.insertionIndex, url: `https://docs.google.com/presentation/d/${presentationId}/edit` },
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to add slide' }
      }
    },

    google_slides_add_image: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      const pageObjectId = ((params.pageObjectId as string) || '').trim()
      const imageUrl = ((params.imageUrl as string) || '').trim()
      if (!accessToken || !presentationId || !pageObjectId || !imageUrl) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, pageObjectId, imageUrl' }
      }

      const imageObjectId = generateObjectId('image')
      const widthEmu = ((params.width as number) || 300) * PT_TO_EMU
      const heightEmu = ((params.height as number) || 200) * PT_TO_EMU
      const translateX = ((params.positionX as number) || 100) * PT_TO_EMU
      const translateY = ((params.positionY as number) || 100) * PT_TO_EMU

      try {
        const data = await batchUpdate(accessToken, presentationId, [{
          createImage: {
            objectId: imageObjectId,
            url: imageUrl,
            elementProperties: {
              pageObjectId,
              size: { width: { magnitude: widthEmu, unit: 'EMU' }, height: { magnitude: heightEmu, unit: 'EMU' } },
              transform: { scaleX: 1, scaleY: 1, translateX, translateY, unit: 'EMU' },
            },
          },
        }])
        const imageId = (data.replies as Record<string, unknown>[])?.[0]?.createImage
          ? ((data.replies as Record<string, unknown>[])[0].createImage as Record<string, unknown>).objectId as string
          : ''
        return {
          success: true,
          output: {
            imageId,
            metadata: { presentationId, pageObjectId, imageUrl, url: `https://docs.google.com/presentation/d/${presentationId}/edit` },
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to add image' }
      }
    },

    google_slides_get_page: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      const pageObjectId = ((params.pageObjectId as string) || '').trim()
      if (!accessToken || !presentationId || !pageObjectId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, pageObjectId' }
      }

      const response = await fetch(`${SLIDES_API_BASE}/${presentationId}/pages/${pageObjectId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to get page' }
      }

      return {
        success: true,
        output: {
          objectId: data.objectId,
          pageType: data.pageType ?? 'SLIDE',
          pageElements: data.pageElements ?? [],
          slideProperties: data.slideProperties
            ? {
                layoutObjectId: data.slideProperties.layoutObjectId ?? null,
                masterObjectId: data.slideProperties.masterObjectId ?? null,
                notesPage: data.slideProperties.notesPage ?? null,
              }
            : null,
          metadata: { presentationId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` },
        },
      }
    },

    google_slides_get_thumbnail: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      const pageObjectId = ((params.pageObjectId as string) || '').trim()
      if (!accessToken || !presentationId || !pageObjectId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, pageObjectId' }
      }

      const size = ((params.thumbnailSize as string) || 'MEDIUM').toUpperCase()
      const mimeType = ((params.mimeType as string) || 'PNG').toUpperCase()
      let url = `${SLIDES_API_BASE}/${presentationId}/pages/${pageObjectId}/thumbnail?thumbnailProperties.thumbnailSize=${size}`
      if (mimeType !== 'PNG') url += `&thumbnailProperties.mimeType=${mimeType}`

      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to get thumbnail' }
      }

      return {
        success: true,
        output: {
          contentUrl: data.contentUrl,
          width: data.width,
          height: data.height,
          metadata: { presentationId, pageObjectId, thumbnailSize: size, mimeType },
        },
      }
    },

    google_slides_replace_all_text: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      const findText = params.findText as string
      if (!accessToken || !presentationId || !findText || params.replaceText === undefined) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, findText, replaceText' }
      }

      const replaceRequest: Record<string, unknown> = {
        containsText: { text: findText, matchCase: params.matchCase !== false },
        replaceText: params.replaceText as string,
      }
      if (params.pageObjectIds) {
        replaceRequest.pageObjectIds = (params.pageObjectIds as string).split(',').map((id) => id.trim()).filter((id) => id.length > 0)
      }

      try {
        const data = await batchUpdate(accessToken, presentationId, [{ replaceAllText: replaceRequest }])
        const occurrencesChanged = (data.replies as Record<string, unknown>[])?.[0]?.replaceAllText
          ? ((data.replies as Record<string, unknown>[])[0].replaceAllText as Record<string, unknown>).occurrencesChanged as number ?? 0
          : 0
        return {
          success: true,
          output: {
            occurrencesChanged,
            metadata: { presentationId, findText, replaceText: params.replaceText, url: `https://docs.google.com/presentation/d/${presentationId}/edit` },
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to replace text' }
      }
    },

    google_slides_delete_object: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      const objectId = ((params.objectId as string) || '').trim()
      if (!accessToken || !presentationId || !objectId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, objectId' }
      }

      try {
        await batchUpdate(accessToken, presentationId, [{ deleteObject: { objectId } }])
        return {
          success: true,
          output: { deleted: true, objectId, metadata: { presentationId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` } },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to delete object' }
      }
    },

    google_slides_duplicate_object: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      const objectId = ((params.objectId as string) || '').trim()
      if (!accessToken || !presentationId || !objectId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, objectId' }
      }

      const duplicateRequest: Record<string, unknown> = { objectId }
      if (params.objectIds) {
        try {
          const mapping = JSON.parse(params.objectIds as string)
          if (typeof mapping === 'object' && !Array.isArray(mapping)) {
            duplicateRequest.objectIds = mapping
          }
        } catch { /* ignore invalid JSON */ }
      }

      try {
        const data = await batchUpdate(accessToken, presentationId, [{ duplicateObject: duplicateRequest }])
        const duplicatedObjectId = (data.replies as Record<string, unknown>[])?.[0]?.duplicateObject
          ? ((data.replies as Record<string, unknown>[])[0].duplicateObject as Record<string, unknown>).objectId as string ?? ''
          : ''
        return {
          success: true,
          output: {
            duplicatedObjectId,
            metadata: { presentationId, sourceObjectId: objectId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` },
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to duplicate object' }
      }
    },

    google_slides_update_slides_position: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      if (!accessToken || !presentationId || !params.slideObjectIds || params.insertionIndex === undefined) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, slideObjectIds, insertionIndex' }
      }

      const slideObjectIds = (params.slideObjectIds as string).split(',').map((id) => id.trim()).filter((id) => id.length > 0)
      if (slideObjectIds.length === 0) {
        return { success: false, output: {}, error: 'At least one slide object ID is required' }
      }

      try {
        await batchUpdate(accessToken, presentationId, [{
          updateSlidesPosition: { slideObjectIds, insertionIndex: params.insertionIndex },
        }])
        return {
          success: true,
          output: {
            moved: true,
            slideObjectIds,
            insertionIndex: params.insertionIndex,
            metadata: { presentationId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` },
          },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to update slides position' }
      }
    },

    google_slides_create_table: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      const pageObjectId = ((params.pageObjectId as string) || '').trim()
      const rows = params.rows as number
      const columns = params.columns as number
      if (!accessToken || !presentationId || !pageObjectId || !rows || !columns) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, pageObjectId, rows, columns' }
      }

      const tableObjectId = generateObjectId('table')
      const widthEmu = ((params.width as number) || 400) * PT_TO_EMU
      const heightEmu = ((params.height as number) || 200) * PT_TO_EMU
      const translateX = ((params.positionX as number) || 100) * PT_TO_EMU
      const translateY = ((params.positionY as number) || 100) * PT_TO_EMU

      try {
        const data = await batchUpdate(accessToken, presentationId, [{
          createTable: {
            objectId: tableObjectId,
            rows,
            columns,
            elementProperties: {
              pageObjectId,
              size: { width: { magnitude: widthEmu, unit: 'EMU' }, height: { magnitude: heightEmu, unit: 'EMU' } },
              transform: { scaleX: 1, scaleY: 1, translateX, translateY, unit: 'EMU' },
            },
          },
        }])
        const tableId = (data.replies as Record<string, unknown>[])?.[0]?.createTable
          ? ((data.replies as Record<string, unknown>[])[0].createTable as Record<string, unknown>).objectId as string
          : ''
        return {
          success: true,
          output: { tableId, rows, columns, metadata: { presentationId, pageObjectId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` } },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to create table' }
      }
    },

    google_slides_create_shape: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      const pageObjectId = ((params.pageObjectId as string) || '').trim()
      const shapeType = ((params.shapeType as string) || 'RECTANGLE').toUpperCase()
      if (!accessToken || !presentationId || !pageObjectId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, pageObjectId' }
      }

      const shapeObjectId = generateObjectId('shape')
      const widthEmu = ((params.width as number) || 200) * PT_TO_EMU
      const heightEmu = ((params.height as number) || 100) * PT_TO_EMU
      const translateX = ((params.positionX as number) || 100) * PT_TO_EMU
      const translateY = ((params.positionY as number) || 100) * PT_TO_EMU

      try {
        const data = await batchUpdate(accessToken, presentationId, [{
          createShape: {
            objectId: shapeObjectId,
            shapeType,
            elementProperties: {
              pageObjectId,
              size: { width: { magnitude: widthEmu, unit: 'EMU' }, height: { magnitude: heightEmu, unit: 'EMU' } },
              transform: { scaleX: 1, scaleY: 1, translateX, translateY, unit: 'EMU' },
            },
          },
        }])
        const shapeId = (data.replies as Record<string, unknown>[])?.[0]?.createShape
          ? ((data.replies as Record<string, unknown>[])[0].createShape as Record<string, unknown>).objectId as string
          : ''
        return {
          success: true,
          output: { shapeId, shapeType, metadata: { presentationId, pageObjectId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` } },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to create shape' }
      }
    },

    google_slides_insert_text: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const presentationId = ((params.presentationId as string) || '').trim()
      const objectId = ((params.objectId as string) || '').trim()
      const text = params.text as string
      if (!accessToken || !presentationId || !objectId || text === undefined || text === null) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, presentationId, objectId, text' }
      }

      try {
        await batchUpdate(accessToken, presentationId, [{
          insertText: { objectId, text, insertionIndex: (params.insertionIndex as number) ?? 0 },
        }])
        return {
          success: true,
          output: { inserted: true, objectId, text, metadata: { presentationId, url: `https://docs.google.com/presentation/d/${presentationId}/edit` } },
        }
      } catch (error) {
        return { success: false, output: {}, error: error instanceof Error ? error.message : 'Failed to insert text' }
      }
    },
  },
}

export default handler
