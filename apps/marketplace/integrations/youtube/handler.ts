import type { ToolHandler } from '../../sdk/types'

const YT_API = 'https://www.googleapis.com/youtube/v3'

const handler: ToolHandler = {
  operations: {
    youtube_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const query = params.query as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      let url = `${YT_API}/search?part=snippet&type=video&key=${apiKey}&q=${encodeURIComponent(query)}`
      url += `&maxResults=${Number(params.maxResults || 5)}`
      if (params.pageToken) url += `&pageToken=${encodeURIComponent(params.pageToken as string)}`
      if (params.channelId) url += `&channelId=${encodeURIComponent(params.channelId as string)}`
      if (params.publishedAfter) url += `&publishedAfter=${encodeURIComponent(params.publishedAfter as string)}`
      if (params.publishedBefore) url += `&publishedBefore=${encodeURIComponent(params.publishedBefore as string)}`
      if (params.videoDuration) url += `&videoDuration=${params.videoDuration}`
      if (params.order) url += `&order=${params.order}`
      if (params.videoCategoryId) url += `&videoCategoryId=${params.videoCategoryId}`
      if (params.videoDefinition) url += `&videoDefinition=${params.videoDefinition}`
      if (params.videoCaption) url += `&videoCaption=${params.videoCaption}`
      if (params.eventType) url += `&eventType=${params.eventType}`
      if (params.regionCode) url += `&regionCode=${params.regionCode}`
      if (params.relevanceLanguage) url += `&relevanceLanguage=${params.relevanceLanguage}`
      if (params.safeSearch) url += `&safeSearch=${params.safeSearch}`

      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: `YouTube API error: ${response.status} ${JSON.stringify(errorData)}` }
      }

      const data = await response.json()
      if (data.error) {
        return { success: false, output: { items: [], totalResults: 0, nextPageToken: null }, error: data.error.message }
      }

      const items = (data.items || []).map((item: Record<string, unknown>) => {
        const id = item.id as Record<string, unknown> | undefined
        const snippet = item.snippet as Record<string, unknown> | undefined
        const thumbs = snippet?.thumbnails as Record<string, Record<string, unknown>> | undefined
        return {
          videoId: id?.videoId ?? '',
          title: snippet?.title ?? '',
          description: snippet?.description ?? '',
          thumbnail: thumbs?.default?.url || thumbs?.medium?.url || thumbs?.high?.url || '',
          channelId: snippet?.channelId ?? '',
          channelTitle: snippet?.channelTitle ?? '',
          publishedAt: snippet?.publishedAt ?? '',
          liveBroadcastContent: snippet?.liveBroadcastContent ?? 'none',
        }
      })

      const pageInfo = data.pageInfo as Record<string, unknown> | undefined
      return {
        success: true,
        output: { items, totalResults: (pageInfo?.totalResults as number) || 0, nextPageToken: data.nextPageToken ?? null },
      }
    },

    youtube_video_details: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const videoId = params.videoId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!videoId) return { success: false, output: {}, error: 'Missing videoId' }

      const url = `${YT_API}/videos?part=snippet,statistics,contentDetails,status,liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${apiKey}`
      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) return { success: false, output: {}, error: `YouTube API error: ${response.status}` }

      const data = await response.json()
      if (!data.items || data.items.length === 0) {
        return { success: false, output: {}, error: 'Video not found' }
      }

      const item = data.items[0]
      const snippet = item.snippet || {}
      const stats = item.statistics || {}
      const content = item.contentDetails || {}
      const live = item.liveStreamingDetails
      const thumbs = snippet.thumbnails || {}

      return {
        success: true,
        output: {
          videoId: item.id ?? '', title: snippet.title ?? '', description: snippet.description ?? '',
          channelId: snippet.channelId ?? '', channelTitle: snippet.channelTitle ?? '',
          publishedAt: snippet.publishedAt ?? '', duration: content.duration ?? '',
          viewCount: Number(stats.viewCount || 0), likeCount: Number(stats.likeCount || 0),
          commentCount: Number(stats.commentCount || 0), favoriteCount: Number(stats.favoriteCount || 0),
          thumbnail: thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || '',
          tags: snippet.tags ?? [], categoryId: snippet.categoryId ?? null,
          definition: content.definition ?? null, caption: content.caption ?? null,
          licensedContent: content.licensedContent ?? null,
          privacyStatus: item.status?.privacyStatus ?? null,
          liveBroadcastContent: snippet.liveBroadcastContent ?? null,
          defaultLanguage: snippet.defaultLanguage ?? null,
          defaultAudioLanguage: snippet.defaultAudioLanguage ?? null,
          isLiveContent: live !== undefined,
          scheduledStartTime: live?.scheduledStartTime ?? null,
          actualStartTime: live?.actualStartTime ?? null,
          actualEndTime: live?.actualEndTime ?? null,
          concurrentViewers: live?.concurrentViewers ? Number(live.concurrentViewers) : null,
          activeLiveChatId: live?.activeLiveChatId ?? null,
        },
      }
    },

    youtube_channel_info: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }

      let url = `${YT_API}/channels?part=snippet,statistics,contentDetails,brandingSettings&key=${apiKey}`
      if (params.channelId) url += `&id=${encodeURIComponent(params.channelId as string)}`
      else if (params.username) url += `&forUsername=${encodeURIComponent(params.username as string)}`
      else return { success: false, output: {}, error: 'Provide channelId or username' }

      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) return { success: false, output: {}, error: `YouTube API error: ${response.status}` }

      const data = await response.json()
      if (!data.items || data.items.length === 0) {
        return { success: false, output: {}, error: 'Channel not found' }
      }

      const item = data.items[0]
      const snippet = item.snippet || {}
      const stats = item.statistics || {}
      const thumbs = snippet.thumbnails || {}

      return {
        success: true,
        output: {
          channelId: item.id ?? '', title: snippet.title ?? '', description: snippet.description ?? '',
          subscriberCount: Number(stats.subscriberCount || 0),
          videoCount: Number(stats.videoCount || 0), viewCount: Number(stats.viewCount || 0),
          publishedAt: snippet.publishedAt ?? '',
          thumbnail: thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || '',
          customUrl: snippet.customUrl ?? null, country: snippet.country ?? null,
          uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
          bannerImageUrl: item.brandingSettings?.image?.bannerExternalUrl ?? null,
          hiddenSubscriberCount: stats.hiddenSubscriberCount ?? false,
        },
      }
    },

    youtube_comments: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const videoId = params.videoId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!videoId) return { success: false, output: {}, error: 'Missing videoId' }

      let url = `${YT_API}/commentThreads?part=snippet,replies&videoId=${encodeURIComponent(videoId)}&key=${apiKey}`
      url += `&maxResults=${Number(params.maxResults || 20)}`
      url += `&order=${(params.order as string) || 'relevance'}`
      if (params.pageToken) url += `&pageToken=${encodeURIComponent(params.pageToken as string)}`

      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) return { success: false, output: {}, error: `YouTube API error: ${response.status}` }

      const data = await response.json()
      if (data.error) {
        return { success: false, output: { items: [], totalResults: 0, nextPageToken: null }, error: data.error.message }
      }

      const items = (data.items || []).map((item: Record<string, unknown>) => {
        const snippetOuter = item.snippet as Record<string, unknown> | undefined
        const topComment = snippetOuter?.topLevelComment as Record<string, unknown> | undefined
        const s = (topComment?.snippet || {}) as Record<string, unknown>
        return {
          commentId: (topComment?.id as string) ?? (item.id as string) ?? '',
          authorDisplayName: s.authorDisplayName ?? '',
          authorChannelUrl: s.authorChannelUrl ?? '',
          authorProfileImageUrl: s.authorProfileImageUrl ?? '',
          textDisplay: s.textDisplay ?? '',
          textOriginal: s.textOriginal ?? '',
          likeCount: Number(s.likeCount || 0),
          publishedAt: s.publishedAt ?? '',
          updatedAt: s.updatedAt ?? '',
          replyCount: Number(snippetOuter?.totalReplyCount || 0),
        }
      })

      return {
        success: true,
        output: { items, totalResults: data.pageInfo?.totalResults || items.length, nextPageToken: data.nextPageToken ?? null },
      }
    },

    youtube_trending: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }

      let url = `${YT_API}/videos?part=snippet,statistics,contentDetails&chart=mostPopular&key=${apiKey}`
      url += `&maxResults=${Number(params.maxResults || 10)}`
      url += `&regionCode=${(params.regionCode as string) || 'US'}`
      if (params.videoCategoryId) url += `&videoCategoryId=${params.videoCategoryId}`
      if (params.pageToken) url += `&pageToken=${encodeURIComponent(params.pageToken as string)}`

      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) return { success: false, output: {}, error: `YouTube API error: ${response.status}` }

      const data = await response.json()
      const items = (data.items || []).map((item: Record<string, unknown>) => {
        const snippet = (item.snippet || {}) as Record<string, unknown>
        const stats = (item.statistics || {}) as Record<string, unknown>
        const content = (item.contentDetails || {}) as Record<string, unknown>
        const thumbs = (snippet.thumbnails || {}) as Record<string, Record<string, unknown>>
        return {
          videoId: item.id ?? '', title: snippet.title ?? '', description: snippet.description ?? '',
          thumbnail: thumbs.high?.url || thumbs.medium?.url || thumbs.default?.url || '',
          channelId: snippet.channelId ?? '', channelTitle: snippet.channelTitle ?? '',
          publishedAt: snippet.publishedAt ?? '',
          viewCount: Number(stats.viewCount || 0), likeCount: Number(stats.likeCount || 0),
          commentCount: Number(stats.commentCount || 0), duration: content.duration ?? '',
        }
      })

      return {
        success: true,
        output: { items, totalResults: data.pageInfo?.totalResults || items.length, nextPageToken: data.nextPageToken ?? null },
      }
    },

    youtube_playlist_items: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const playlistId = params.playlistId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!playlistId) return { success: false, output: {}, error: 'Missing playlistId' }

      let url = `${YT_API}/playlistItems?part=snippet&playlistId=${encodeURIComponent(playlistId)}&key=${apiKey}`
      url += `&maxResults=${Number(params.maxResults || 25)}`
      if (params.pageToken) url += `&pageToken=${encodeURIComponent(params.pageToken as string)}`

      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) return { success: false, output: {}, error: `YouTube API error: ${response.status}` }

      const data = await response.json()
      const items = (data.items || []).map((item: Record<string, unknown>) => {
        const snippet = (item.snippet || {}) as Record<string, unknown>
        const resourceId = (snippet.resourceId || {}) as Record<string, unknown>
        const thumbs = (snippet.thumbnails || {}) as Record<string, Record<string, unknown>>
        return {
          videoId: resourceId.videoId ?? '',
          title: snippet.title ?? '', description: snippet.description ?? '',
          thumbnail: thumbs.default?.url || thumbs.medium?.url || '',
          publishedAt: snippet.publishedAt ?? '',
          channelTitle: snippet.channelTitle ?? '',
          position: snippet.position ?? 0,
          videoOwnerChannelId: snippet.videoOwnerChannelId ?? null,
          videoOwnerChannelTitle: snippet.videoOwnerChannelTitle ?? null,
        }
      })

      return {
        success: true,
        output: { items, totalResults: data.pageInfo?.totalResults || items.length, nextPageToken: data.nextPageToken ?? null },
      }
    },

    youtube_channel_videos: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const channelId = params.channelId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!channelId) return { success: false, output: {}, error: 'Missing channelId' }

      let url = `${YT_API}/search?part=snippet&type=video&channelId=${encodeURIComponent(channelId)}&key=${apiKey}`
      url += `&maxResults=${Number(params.maxResults || 10)}`
      url += `&order=${(params.order as string) || 'date'}`
      if (params.pageToken) url += `&pageToken=${encodeURIComponent(params.pageToken as string)}`

      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) return { success: false, output: {}, error: `YouTube API error: ${response.status}` }

      const data = await response.json()
      const items = (data.items || []).map((item: Record<string, unknown>) => {
        const id = (item.id || {}) as Record<string, unknown>
        const snippet = (item.snippet || {}) as Record<string, unknown>
        const thumbs = (snippet.thumbnails || {}) as Record<string, Record<string, unknown>>
        return {
          videoId: id.videoId ?? '', title: snippet.title ?? '', description: snippet.description ?? '',
          thumbnail: thumbs.default?.url || thumbs.medium?.url || '',
          publishedAt: snippet.publishedAt ?? '', channelTitle: snippet.channelTitle ?? '',
        }
      })

      return {
        success: true,
        output: { items, totalResults: data.pageInfo?.totalResults || items.length, nextPageToken: data.nextPageToken ?? null },
      }
    },

    youtube_channel_playlists: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const channelId = params.channelId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!channelId) return { success: false, output: {}, error: 'Missing channelId' }

      let url = `${YT_API}/playlists?part=snippet,contentDetails&channelId=${encodeURIComponent(channelId)}&key=${apiKey}`
      url += `&maxResults=${Number(params.maxResults || 25)}`
      if (params.pageToken) url += `&pageToken=${encodeURIComponent(params.pageToken as string)}`

      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) return { success: false, output: {}, error: `YouTube API error: ${response.status}` }

      const data = await response.json()
      const items = (data.items || []).map((item: Record<string, unknown>) => {
        const snippet = (item.snippet || {}) as Record<string, unknown>
        const content = (item.contentDetails || {}) as Record<string, unknown>
        const thumbs = (snippet.thumbnails || {}) as Record<string, Record<string, unknown>>
        return {
          playlistId: item.id ?? '', title: snippet.title ?? '', description: snippet.description ?? '',
          thumbnail: thumbs.default?.url || thumbs.medium?.url || '',
          itemCount: content.itemCount ?? 0,
          publishedAt: snippet.publishedAt ?? '', channelTitle: snippet.channelTitle ?? '',
        }
      })

      return {
        success: true,
        output: { items, totalResults: data.pageInfo?.totalResults || items.length, nextPageToken: data.nextPageToken ?? null },
      }
    },

    youtube_video_categories: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }

      let url = `${YT_API}/videoCategories?part=snippet&key=${apiKey}`
      url += `&regionCode=${(params.regionCode as string) || 'US'}`
      if (params.hl) url += `&hl=${params.hl}`

      const response = await fetch(url, { headers: { 'Content-Type': 'application/json' } })
      if (!response.ok) return { success: false, output: {}, error: `YouTube API error: ${response.status}` }

      const data = await response.json()
      const items = (data.items || []).map((item: Record<string, unknown>) => {
        const snippet = (item.snippet || {}) as Record<string, unknown>
        return {
          categoryId: item.id ?? '', title: snippet.title ?? '', assignable: snippet.assignable ?? false,
        }
      })

      return { success: true, output: { items, totalResults: items.length } }
    },
  },
}

export default handler
