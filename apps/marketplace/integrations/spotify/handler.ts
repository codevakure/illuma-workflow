import type { ToolHandler } from '../../sdk/types'

const SPOTIFY_API = 'https://api.spotify.com/v1'

function spotifyHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

async function spotifyFetch(
  url: string,
  accessToken: string,
  options?: { method?: string; body?: unknown }
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  const response = await fetch(url, {
    method: options?.method || 'GET',
    headers: spotifyHeaders(accessToken),
    body: options?.body ? JSON.stringify(options.body) : undefined,
  })

  if (response.status === 204) {
    return { ok: true, status: 204, data: null }
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    return { ok: false, status: response.status, data: errorData as Record<string, unknown> }
  }

  const data = await response.json()
  return { ok: true, status: response.status, data: data as Record<string, unknown> }
}

function mapTrack(track: Record<string, unknown>): Record<string, unknown> {
  const artists = track.artists as Array<Record<string, unknown>> | undefined
  const album = track.album as Record<string, unknown> | undefined
  const albumImages = album?.images as Array<Record<string, unknown>> | undefined
  const externalUrls = track.external_urls as Record<string, string> | undefined
  return {
    id: track.id,
    name: track.name,
    artists: artists?.map((a) => ({ id: a.id, name: a.name })) || [],
    album: {
      id: album?.id || '',
      name: album?.name || '',
      image_url: albumImages?.[0]?.url || null,
    },
    duration_ms: track.duration_ms,
    explicit: track.explicit,
    popularity: track.popularity,
    preview_url: track.preview_url,
    external_url: externalUrls?.spotify || '',
    uri: track.uri,
  }
}

const handler: ToolHandler = {
  operations: {
    spotify_search: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }
      const query = params.query as string
      if (!query) {
        return { success: false, output: {}, error: 'Missing required parameter: query' }
      }

      const type = (params.type as string) || 'track'
      const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50)
      const offset = Number(params.offset) || 0
      let url = `${SPOTIFY_API}/search?q=${encodeURIComponent(query)}&type=${encodeURIComponent(type)}&limit=${limit}&offset=${offset}`
      if (params.market) url += `&market=${params.market}`

      const { ok, data } = await spotifyFetch(url, accessToken)
      if (!ok || !data) {
        return { success: false, output: {}, error: `Spotify API error: ${JSON.stringify(data)}` }
      }

      const tracksData = data.tracks as Record<string, unknown> | undefined
      const artistsData = data.artists as Record<string, unknown> | undefined
      const albumsData = data.albums as Record<string, unknown> | undefined
      const playlistsData = data.playlists as Record<string, unknown> | undefined

      const tracks = ((tracksData?.items || []) as Array<Record<string, unknown>>).map((t) => {
        const a = t.artists as Array<Record<string, unknown>> | undefined
        const al = t.album as Record<string, unknown> | undefined
        const eu = t.external_urls as Record<string, string> | undefined
        return {
          id: t.id, name: t.name,
          artists: a?.map((x) => (x as Record<string, unknown>).name) || [],
          album: al?.name || '',
          duration_ms: t.duration_ms, popularity: t.popularity,
          preview_url: t.preview_url, external_url: eu?.spotify || '',
        }
      })

      const artists = ((artistsData?.items || []) as Array<Record<string, unknown>>).map((a) => {
        const f = a.followers as Record<string, unknown> | undefined
        const imgs = a.images as Array<Record<string, unknown>> | undefined
        const eu = a.external_urls as Record<string, string> | undefined
        return {
          id: a.id, name: a.name, genres: a.genres || [],
          popularity: a.popularity, followers: (f?.total as number) || 0,
          image_url: imgs?.[0]?.url || null, external_url: eu?.spotify || '',
        }
      })

      const albums = ((albumsData?.items || []) as Array<Record<string, unknown>>).map((al) => {
        const a = al.artists as Array<Record<string, unknown>> | undefined
        const imgs = al.images as Array<Record<string, unknown>> | undefined
        const eu = al.external_urls as Record<string, string> | undefined
        return {
          id: al.id, name: al.name,
          artists: a?.map((x) => (x as Record<string, unknown>).name) || [],
          total_tracks: al.total_tracks, release_date: al.release_date,
          image_url: imgs?.[0]?.url || null, external_url: eu?.spotify || '',
        }
      })

      const playlists = ((playlistsData?.items || []) as Array<Record<string, unknown>>).map((p) => {
        const owner = p.owner as Record<string, unknown> | undefined
        const imgs = p.images as Array<Record<string, unknown>> | undefined
        const trks = p.tracks as Record<string, unknown> | undefined
        const eu = p.external_urls as Record<string, string> | undefined
        return {
          id: p.id, name: p.name, description: p.description,
          owner: owner?.display_name || '',
          total_tracks: (trks?.total as number) || 0,
          image_url: imgs?.[0]?.url || null, external_url: eu?.spotify || '',
        }
      })

      return { success: true, output: { tracks, artists, albums, playlists } }
    },

    spotify_get_track: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }
      const trackId = params.trackId as string
      if (!trackId) return { success: false, output: {}, error: 'Missing trackId' }

      let url = `${SPOTIFY_API}/tracks/${trackId}`
      if (params.market) url += `?market=${params.market}`

      const { ok, data } = await spotifyFetch(url, accessToken)
      if (!ok || !data) return { success: false, output: {}, error: `Spotify API error` }

      return { success: true, output: mapTrack(data) }
    },

    spotify_get_currently_playing: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      let url = `${SPOTIFY_API}/me/player/currently-playing`
      if (params.market) url += `?market=${params.market}`

      const { ok, status, data } = await spotifyFetch(url, accessToken)
      if (status === 204 || !data) {
        return { success: true, output: { is_playing: false, progress_ms: null, track: null } }
      }
      if (!ok) return { success: false, output: {}, error: 'Spotify API error' }

      const item = data.item as Record<string, unknown> | undefined
      return {
        success: true,
        output: {
          is_playing: data.is_playing || false,
          progress_ms: data.progress_ms || null,
          track: item ? mapTrack(item) : null,
        },
      }
    },

    spotify_get_user_playlists: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      const limit = Math.min(Math.max(Number(params.limit) || 20, 1), 50)
      const offset = Number(params.offset) || 0
      const url = `${SPOTIFY_API}/me/playlists?limit=${limit}&offset=${offset}`

      const { ok, data } = await spotifyFetch(url, accessToken)
      if (!ok || !data) return { success: false, output: {}, error: 'Spotify API error' }

      const items = (data.items || []) as Array<Record<string, unknown>>
      const playlists = items.map((p) => {
        const owner = p.owner as Record<string, unknown> | undefined
        const imgs = p.images as Array<Record<string, unknown>> | undefined
        const trks = p.tracks as Record<string, unknown> | undefined
        const eu = p.external_urls as Record<string, string> | undefined
        return {
          id: p.id, name: p.name, description: p.description,
          public: p.public, collaborative: p.collaborative,
          owner: owner?.display_name || '',
          total_tracks: (trks?.total as number) || 0,
          image_url: imgs?.[0]?.url || null, external_url: eu?.spotify || '',
        }
      })

      return {
        success: true,
        output: { playlists, total: data.total || playlists.length, next: data.next || null },
      }
    },

    spotify_create_playlist: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }
      const name = params.name as string
      if (!name) return { success: false, output: {}, error: 'Missing name' }

      const { ok, data } = await spotifyFetch(`${SPOTIFY_API}/me/playlists`, accessToken, {
        method: 'POST',
        body: {
          name,
          description: (params.description as string) || '',
          public: params.public !== false,
          collaborative: params.collaborative === true,
        },
      })

      if (!ok || !data) return { success: false, output: {}, error: 'Spotify API error' }

      const eu = data.external_urls as Record<string, string> | undefined
      return {
        success: true,
        output: {
          id: data.id, name: data.name, description: data.description,
          public: data.public, collaborative: data.collaborative,
          snapshot_id: data.snapshot_id, external_url: eu?.spotify || '',
        },
      }
    },

    spotify_play: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      let url = `${SPOTIFY_API}/me/player/play`
      if (params.device_id) url += `?device_id=${params.device_id}`

      const body: Record<string, unknown> = {}
      if (params.context_uri) body.context_uri = params.context_uri
      if (params.uris) body.uris = (params.uris as string).split(',').map((u: string) => u.trim())
      if (params.offset !== undefined) body.offset = { position: params.offset }
      if (params.position_ms !== undefined) body.position_ms = params.position_ms

      const { ok } = await spotifyFetch(url, accessToken, {
        method: 'PUT',
        body: Object.keys(body).length > 0 ? body : undefined,
      })

      return { success: ok, output: { success: ok } }
    },

    spotify_pause: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      let url = `${SPOTIFY_API}/me/player/pause`
      if (params.device_id) url += `?device_id=${params.device_id}`

      const { ok } = await spotifyFetch(url, accessToken, { method: 'PUT' })
      return { success: ok, output: { success: ok } }
    },

    spotify_skip_next: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      let url = `${SPOTIFY_API}/me/player/next`
      if (params.device_id) url += `?device_id=${params.device_id}`

      const { ok } = await spotifyFetch(url, accessToken, { method: 'POST' })
      return { success: ok, output: { success: ok } }
    },

    spotify_skip_previous: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      let url = `${SPOTIFY_API}/me/player/previous`
      if (params.device_id) url += `?device_id=${params.device_id}`

      const { ok } = await spotifyFetch(url, accessToken, { method: 'POST' })
      return { success: ok, output: { success: ok } }
    },

    spotify_get_playback_state: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      let url = `${SPOTIFY_API}/me/player`
      if (params.market) url += `?market=${params.market}`

      const { ok, status, data } = await spotifyFetch(url, accessToken)
      if (status === 204 || !data) {
        return {
          success: true,
          output: {
            is_playing: false, device: null, progress_ms: null,
            currently_playing_type: '', shuffle_state: false, repeat_state: 'off', track: null,
          },
        }
      }
      if (!ok) return { success: false, output: {}, error: 'Spotify API error' }

      const device = data.device as Record<string, unknown> | undefined
      const item = data.item as Record<string, unknown> | undefined
      return {
        success: true,
        output: {
          is_playing: data.is_playing,
          device: device ? {
            id: device.id, name: device.name, type: device.type,
            volume_percent: device.volume_percent,
          } : null,
          progress_ms: data.progress_ms,
          currently_playing_type: data.currently_playing_type,
          shuffle_state: data.shuffle_state,
          repeat_state: data.repeat_state,
          track: item ? mapTrack(item) : null,
        },
      }
    },

    spotify_get_devices: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      const { ok, data } = await spotifyFetch(`${SPOTIFY_API}/me/player/devices`, accessToken)
      if (!ok || !data) return { success: false, output: {}, error: 'Spotify API error' }

      return { success: true, output: { devices: data.devices || [] } }
    },

    spotify_add_to_queue: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }
      const uri = params.uri as string
      if (!uri) return { success: false, output: {}, error: 'Missing uri' }

      let url = `${SPOTIFY_API}/me/player/queue?uri=${encodeURIComponent(uri)}`
      if (params.device_id) url += `&device_id=${params.device_id}`

      const { ok } = await spotifyFetch(url, accessToken, { method: 'POST' })
      return { success: ok, output: { success: ok } }
    },

    spotify_get_current_user: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      const { ok, data } = await spotifyFetch(`${SPOTIFY_API}/me`, accessToken)
      if (!ok || !data) return { success: false, output: {}, error: 'Spotify API error' }

      const f = data.followers as Record<string, unknown> | undefined
      const imgs = data.images as Array<Record<string, unknown>> | undefined
      const eu = data.external_urls as Record<string, string> | undefined
      return {
        success: true,
        output: {
          id: data.id, display_name: data.display_name,
          email: data.email || null, country: data.country || null,
          product: data.product || null, followers: (f?.total as number) || 0,
          image_url: imgs?.[0]?.url || null, external_url: eu?.spotify || '',
        },
      }
    },

    spotify_set_volume: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      let url = `${SPOTIFY_API}/me/player/volume?volume_percent=${params.volume_percent}`
      if (params.device_id) url += `&device_id=${params.device_id}`

      const { ok } = await spotifyFetch(url, accessToken, { method: 'PUT' })
      return { success: ok, output: { success: ok } }
    },

    spotify_seek: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      let url = `${SPOTIFY_API}/me/player/seek?position_ms=${params.position_ms}`
      if (params.device_id) url += `&device_id=${params.device_id}`

      const { ok } = await spotifyFetch(url, accessToken, { method: 'PUT' })
      return { success: ok, output: { success: ok } }
    },

    spotify_set_repeat: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      let url = `${SPOTIFY_API}/me/player/repeat?state=${params.state}`
      if (params.device_id) url += `&device_id=${params.device_id}`

      const { ok } = await spotifyFetch(url, accessToken, { method: 'PUT' })
      return { success: ok, output: { success: ok } }
    },

    spotify_set_shuffle: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing accessToken' }

      let url = `${SPOTIFY_API}/me/player/shuffle?state=${params.state}`
      if (params.device_id) url += `&device_id=${params.device_id}`

      const { ok } = await spotifyFetch(url, accessToken, { method: 'PUT' })
      return { success: ok, output: { success: ok } }
    },
  },
}

export default handler
