import type { ToolHandler } from '../../sdk/types'

interface VolumeItem {
  id: string
  volumeInfo: {
    title?: string
    subtitle?: string
    authors?: string[]
    publisher?: string
    publishedDate?: string
    description?: string
    pageCount?: number
    categories?: string[]
    averageRating?: number
    ratingsCount?: number
    language?: string
    previewLink?: string
    infoLink?: string
    imageLinks?: { thumbnail?: string; smallThumbnail?: string }
    industryIdentifiers?: Array<{ type: string; identifier: string }>
  }
}

function extractVolumeInfo(item: VolumeItem) {
  const info = item.volumeInfo
  const identifiers = info.industryIdentifiers ?? []

  return {
    id: item.id,
    title: info.title ?? '',
    subtitle: info.subtitle ?? null,
    authors: info.authors ?? [],
    publisher: info.publisher ?? null,
    publishedDate: info.publishedDate ?? null,
    description: info.description ?? null,
    pageCount: info.pageCount ?? null,
    categories: info.categories ?? [],
    averageRating: info.averageRating ?? null,
    ratingsCount: info.ratingsCount ?? null,
    language: info.language ?? null,
    previewLink: info.previewLink ?? null,
    infoLink: info.infoLink ?? null,
    thumbnailUrl: info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null,
    isbn10: identifiers.find((id) => id.type === 'ISBN_10')?.identifier ?? null,
    isbn13: identifiers.find((id) => id.type === 'ISBN_13')?.identifier ?? null,
  }
}

const handler: ToolHandler = {
  operations: {
    google_books_volume_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const query = params.query as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const url = new URL('https://www.googleapis.com/books/v1/volumes')
      url.searchParams.set('q', query.trim())
      url.searchParams.set('key', apiKey.trim())

      if (params.filter) url.searchParams.set('filter', params.filter as string)
      if (params.printType) url.searchParams.set('printType', params.printType as string)
      if (params.orderBy) url.searchParams.set('orderBy', params.orderBy as string)
      if (params.startIndex !== undefined) url.searchParams.set('startIndex', String(params.startIndex))
      if (params.maxResults !== undefined) url.searchParams.set('maxResults', String(params.maxResults))
      if (params.langRestrict) url.searchParams.set('langRestrict', params.langRestrict as string)

      const response = await fetch(url.toString(), {
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Books API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()
      const items: VolumeItem[] = data.items ?? []

      return {
        success: true,
        output: {
          totalItems: data.totalItems ?? 0,
          volumes: items.map(extractVolumeInfo),
        },
      }
    },

    google_books_volume_details: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const volumeId = params.volumeId as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!volumeId) {
        return { success: false, output: {}, error: 'Missing required parameter: volumeId' }
      }

      const url = new URL(`https://www.googleapis.com/books/v1/volumes/${volumeId.trim()}`)
      url.searchParams.set('key', apiKey.trim())
      if (params.projection) url.searchParams.set('projection', params.projection as string)

      const response = await fetch(url.toString(), {
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Google Books API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()
      if (!data.volumeInfo) {
        return { success: false, output: {}, error: 'Volume not found' }
      }

      return {
        success: true,
        output: extractVolumeInfo(data),
      }
    },
  },
}

export default handler
