import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    google_maps_geocode: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const address = params.address as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!address) return { success: false, output: {}, error: 'Missing address' }

      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
      url.searchParams.set('address', address.trim())
      url.searchParams.set('key', apiKey.trim())
      if (params.language) url.searchParams.set('language', (params.language as string).trim())
      if (params.region) url.searchParams.set('region', (params.region as string).trim())

      const response = await fetch(url.toString())
      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      if (data.status !== 'OK') return { success: false, output: {}, error: `Geocoding failed: ${data.status}` }

      const result = data.results[0]
      const location = result.geometry.location
      return {
        success: true,
        output: {
          formattedAddress: result.formatted_address,
          lat: location.lat,
          lng: location.lng,
          location: { lat: location.lat, lng: location.lng },
          placeId: result.place_id,
          addressComponents: (result.address_components || []).map((c: Record<string, unknown>) => ({
            longName: c.long_name, shortName: c.short_name, types: c.types,
          })),
          locationType: result.geometry.location_type,
        },
      }
    },

    google_maps_reverse_geocode: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!params.lat || !params.lng) return { success: false, output: {}, error: 'Missing lat/lng' }

      const url = new URL('https://maps.googleapis.com/maps/api/geocode/json')
      url.searchParams.set('latlng', `${params.lat},${params.lng}`)
      url.searchParams.set('key', apiKey.trim())
      if (params.language) url.searchParams.set('language', (params.language as string).trim())

      const response = await fetch(url.toString())
      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      if (data.status !== 'OK') return { success: false, output: {}, error: `Reverse geocoding failed: ${data.status}` }

      const results = data.results.map((r: Record<string, unknown>) => ({
        formattedAddress: r.formatted_address,
        placeId: r.place_id,
        types: r.types,
        addressComponents: ((r.address_components || []) as Array<Record<string, unknown>>).map((c) => ({
          longName: c.long_name, shortName: c.short_name, types: c.types,
        })),
      }))

      return { success: true, output: { results } }
    },

    google_maps_directions: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!params.origin || !params.destination) return { success: false, output: {}, error: 'Missing origin/destination' }

      const url = new URL('https://maps.googleapis.com/maps/api/directions/json')
      url.searchParams.set('origin', (params.origin as string).trim())
      url.searchParams.set('destination', (params.destination as string).trim())
      url.searchParams.set('key', apiKey.trim())
      if (params.mode) url.searchParams.set('mode', params.mode as string)
      if (params.avoid) url.searchParams.set('avoid', params.avoid as string)
      if (params.waypoints && Array.isArray(params.waypoints) && (params.waypoints as string[]).length > 0) {
        url.searchParams.set('waypoints', (params.waypoints as string[]).join('|'))
      }
      if (params.units) url.searchParams.set('units', params.units as string)
      if (params.language) url.searchParams.set('language', (params.language as string).trim())

      const response = await fetch(url.toString())
      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      if (data.status !== 'OK') return { success: false, output: {}, error: `Directions failed: ${data.status}` }

      const routes = data.routes.map((route: Record<string, unknown>) => {
        const legs = ((route.legs || []) as Array<Record<string, unknown>>).map((leg) => ({
          startAddress: leg.start_address,
          endAddress: leg.end_address,
          startLocation: leg.start_location,
          endLocation: leg.end_location,
          distanceText: (leg.distance as Record<string, unknown>)?.text ?? '',
          distanceMeters: (leg.distance as Record<string, unknown>)?.value ?? 0,
          durationText: (leg.duration as Record<string, unknown>)?.text ?? '',
          durationSeconds: (leg.duration as Record<string, unknown>)?.value ?? 0,
          steps: ((leg.steps || []) as Array<Record<string, unknown>>).map((step) => ({
            instruction: ((step.html_instructions as string) || '').replace(/<[^>]*>/g, ''),
            distanceText: (step.distance as Record<string, unknown>)?.text ?? '',
            distanceMeters: (step.distance as Record<string, unknown>)?.value ?? 0,
            durationText: (step.duration as Record<string, unknown>)?.text ?? '',
            durationSeconds: (step.duration as Record<string, unknown>)?.value ?? 0,
            startLocation: step.start_location,
            endLocation: step.end_location,
            travelMode: step.travel_mode,
            maneuver: step.maneuver ?? null,
          })),
        }))
        return {
          summary: route.summary,
          legs,
          overviewPolyline: (route.overview_polyline as Record<string, unknown>)?.points ?? '',
          warnings: route.warnings ?? [],
          waypointOrder: route.waypoint_order ?? [],
        }
      })

      const primaryLeg = routes[0]?.legs[0]
      return {
        success: true,
        output: {
          routes,
          distanceText: primaryLeg?.distanceText ?? '',
          distanceMeters: primaryLeg?.distanceMeters ?? 0,
          durationText: primaryLeg?.durationText ?? '',
          durationSeconds: primaryLeg?.durationSeconds ?? 0,
          startAddress: primaryLeg?.startAddress ?? '',
          endAddress: primaryLeg?.endAddress ?? '',
          steps: primaryLeg?.steps ?? [],
          polyline: routes[0]?.overviewPolyline ?? '',
        },
      }
    },

    google_maps_places_search: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!params.query) return { success: false, output: {}, error: 'Missing query' }

      const url = new URL('https://maps.googleapis.com/maps/api/place/textsearch/json')
      url.searchParams.set('query', (params.query as string).trim())
      url.searchParams.set('key', apiKey.trim())
      if (params.location) {
        const loc = params.location as Record<string, unknown>
        url.searchParams.set('location', `${loc.lat},${loc.lng}`)
      }
      if (params.radius) url.searchParams.set('radius', String(params.radius))
      if (params.type) url.searchParams.set('type', params.type as string)
      if (params.language) url.searchParams.set('language', (params.language as string).trim())
      if (params.region) url.searchParams.set('region', (params.region as string).trim())

      const response = await fetch(url.toString())
      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
        return { success: false, output: {}, error: `Places search failed: ${data.status}` }
      }

      const places = (data.results || []).map((p: Record<string, unknown>) => ({
        placeId: p.place_id,
        name: p.name,
        formattedAddress: p.formatted_address,
        lat: (p.geometry as Record<string, unknown>)?.location ? ((p.geometry as Record<string, unknown>).location as Record<string, unknown>).lat : null,
        lng: (p.geometry as Record<string, unknown>)?.location ? ((p.geometry as Record<string, unknown>).location as Record<string, unknown>).lng : null,
        types: p.types ?? [],
        rating: p.rating ?? null,
        userRatingsTotal: p.user_ratings_total ?? null,
        priceLevel: p.price_level ?? null,
        openNow: (p.opening_hours as Record<string, unknown>)?.open_now ?? null,
        photoReference: ((p.photos as Array<Record<string, unknown>>) || [])[0]?.photo_reference ?? null,
        businessStatus: p.business_status ?? null,
      }))

      return { success: true, output: { places, nextPageToken: data.next_page_token ?? null } }
    },

    google_maps_place_details: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      const placeId = params.placeId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!placeId) return { success: false, output: {}, error: 'Missing placeId' }

      const url = new URL('https://maps.googleapis.com/maps/api/place/details/json')
      url.searchParams.set('place_id', placeId.trim())
      url.searchParams.set('key', apiKey.trim())
      const fields = (params.fields as string) || 'place_id,name,formatted_address,geometry,types,rating,user_ratings_total,price_level,website,formatted_phone_number,international_phone_number,opening_hours,reviews,photos,url,utc_offset,vicinity,business_status'
      url.searchParams.set('fields', fields)
      if (params.language) url.searchParams.set('language', (params.language as string).trim())

      const response = await fetch(url.toString())
      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      if (data.status !== 'OK') return { success: false, output: {}, error: `Place details failed: ${data.status}` }

      const place = data.result
      return {
        success: true,
        output: {
          placeId: place.place_id,
          name: place.name ?? null,
          formattedAddress: place.formatted_address ?? null,
          lat: place.geometry?.location?.lat ?? null,
          lng: place.geometry?.location?.lng ?? null,
          types: place.types ?? [],
          rating: place.rating ?? null,
          userRatingsTotal: place.user_ratings_total ?? null,
          priceLevel: place.price_level ?? null,
          website: place.website ?? null,
          phoneNumber: place.formatted_phone_number ?? null,
          internationalPhoneNumber: place.international_phone_number ?? null,
          openNow: place.opening_hours?.open_now ?? null,
          weekdayText: place.opening_hours?.weekday_text ?? [],
          reviews: (place.reviews || []).map((r: Record<string, unknown>) => ({
            authorName: r.author_name, authorUrl: r.author_url ?? null,
            profilePhotoUrl: r.profile_photo_url ?? null, rating: r.rating,
            text: r.text, time: r.time, relativeTimeDescription: r.relative_time_description,
          })),
          photos: (place.photos || []).map((p: Record<string, unknown>) => ({
            photoReference: p.photo_reference, height: p.height, width: p.width,
            htmlAttributions: p.html_attributions ?? [],
          })),
          url: place.url ?? null,
          utcOffset: place.utc_offset ?? null,
          vicinity: place.vicinity ?? null,
          businessStatus: place.business_status ?? null,
        },
      }
    },

    google_maps_distance_matrix: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!params.origin || !params.destinations) return { success: false, output: {}, error: 'Missing origin/destinations' }

      const url = new URL('https://maps.googleapis.com/maps/api/distancematrix/json')
      url.searchParams.set('origins', (params.origin as string).trim())
      url.searchParams.set('destinations', (params.destinations as string[]).join('|'))
      url.searchParams.set('key', apiKey.trim())
      if (params.mode) url.searchParams.set('mode', params.mode as string)
      if (params.avoid) url.searchParams.set('avoid', params.avoid as string)
      if (params.units) url.searchParams.set('units', params.units as string)
      if (params.language) url.searchParams.set('language', (params.language as string).trim())

      const response = await fetch(url.toString())
      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      if (data.status !== 'OK') return { success: false, output: {}, error: `Distance matrix failed: ${data.status}` }

      const rows = data.rows.map((row: Record<string, unknown>) => ({
        elements: ((row.elements || []) as Array<Record<string, unknown>>).map((el) => ({
          distanceText: (el.distance as Record<string, unknown>)?.text ?? 'N/A',
          distanceMeters: (el.distance as Record<string, unknown>)?.value ?? 0,
          durationText: (el.duration as Record<string, unknown>)?.text ?? 'N/A',
          durationSeconds: (el.duration as Record<string, unknown>)?.value ?? 0,
          durationInTrafficText: (el.duration_in_traffic as Record<string, unknown>)?.text ?? null,
          durationInTrafficSeconds: (el.duration_in_traffic as Record<string, unknown>)?.value ?? null,
          status: el.status,
        })),
      }))

      return {
        success: true,
        output: {
          originAddresses: data.origin_addresses ?? [],
          destinationAddresses: data.destination_addresses ?? [],
          rows,
        },
      }
    },

    google_maps_elevation: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!params.locations) return { success: false, output: {}, error: 'Missing locations' }

      const locations = Array.isArray(params.locations)
        ? (params.locations as Array<Record<string, unknown>>).map((l) => `${l.lat},${l.lng}`).join('|')
        : params.locations as string

      const url = new URL('https://maps.googleapis.com/maps/api/elevation/json')
      url.searchParams.set('locations', locations)
      url.searchParams.set('key', apiKey.trim())

      const response = await fetch(url.toString())
      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      if (data.status !== 'OK') return { success: false, output: {}, error: `Elevation failed: ${data.status}` }

      return {
        success: true,
        output: {
          results: data.results.map((r: Record<string, unknown>) => ({
            elevation: r.elevation,
            location: r.location,
            resolution: r.resolution,
          })),
        },
      }
    },

    google_maps_timezone: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing apiKey' }
      if (!params.lat || !params.lng) return { success: false, output: {}, error: 'Missing lat/lng' }

      const timestamp = (params.timestamp as number) || Math.floor(Date.now() / 1000)
      const url = new URL('https://maps.googleapis.com/maps/api/timezone/json')
      url.searchParams.set('location', `${params.lat},${params.lng}`)
      url.searchParams.set('timestamp', String(timestamp))
      url.searchParams.set('key', apiKey.trim())

      const response = await fetch(url.toString())
      if (!response.ok) return { success: false, output: {}, error: `API error: ${response.status}` }
      const data = await response.json()
      if (data.status !== 'OK') return { success: false, output: {}, error: `Timezone failed: ${data.status}` }

      return {
        success: true,
        output: {
          dstOffset: data.dstOffset,
          rawOffset: data.rawOffset,
          timeZoneId: data.timeZoneId,
          timeZoneName: data.timeZoneName,
        },
      }
    },
  },
}

export default handler
