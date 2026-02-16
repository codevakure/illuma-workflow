import type { ToolHandler } from '../../sdk/types'

const GRAPHQL_URL = 'https://api.fireflies.ai/graphql'

function firefliesHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  }
}

async function graphqlRequest(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<{ data?: any; errors?: any[] }> {
  const resp = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: firefliesHeaders(apiKey),
    body: JSON.stringify({ query, variables }),
  })
  return resp.json()
}

const handler: ToolHandler = {
  operations: {
    fireflies_list_transcripts: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      const variables: Record<string, unknown> = {}
      if (params.keyword) variables.keyword = params.keyword
      if (params.fromDate) variables.fromDate = params.fromDate
      if (params.toDate) variables.toDate = params.toDate
      if (params.hostEmail) variables.host_email = params.hostEmail
      if (params.participants) {
        variables.participants = (params.participants as string).split(',').map((p) => p.trim())
      }
      if (params.limit) variables.limit = Math.min(Number(params.limit), 50)
      if (params.skip) variables.skip = Number(params.skip)

      const result = await graphqlRequest(
        apiKey,
        `query Transcripts(
          $keyword: String
          $fromDate: DateTime
          $toDate: DateTime
          $host_email: String
          $participants: [String!]
          $limit: Int
          $skip: Int
        ) {
          transcripts(
            keyword: $keyword
            fromDate: $fromDate
            toDate: $toDate
            host_email: $host_email
            participants: $participants
            limit: $limit
            skip: $skip
          ) {
            id
            title
            date
            duration
            host_email
            participants
          }
        }`,
        variables
      )

      if (result.errors) {
        return {
          success: false,
          output: {},
          error: result.errors[0]?.message || 'Failed to fetch transcripts',
        }
      }

      const transcripts = result.data?.transcripts || []
      return {
        success: true,
        output: {
          transcripts: transcripts.map((t: any) => ({
            id: t.id,
            title: t.title,
            date: t.date,
            duration: t.duration,
            host_email: t.host_email,
            participants: t.participants,
          })),
          count: transcripts.length,
        },
      }
    },

    fireflies_get_transcript: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const transcriptId = params.transcriptId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!transcriptId) return { success: false, output: {}, error: 'Missing required parameter: transcriptId' }

      const result = await graphqlRequest(
        apiKey,
        `query Transcript($id: String!) {
          transcript(id: $id) {
            id
            title
            date
            dateString
            duration
            privacy
            transcript_url
            audio_url
            video_url
            meeting_link
            host_email
            organizer_email
            participants
            fireflies_users
            speakers { id name }
            meeting_attendees { displayName email phoneNumber name location }
            sentences {
              index speaker_name speaker_id text raw_text start_time end_time
              ai_filters { task pricing metric question date_and_time sentiment }
            }
            summary {
              keywords action_items outline shorthand_bullet overview
              bullet_gist gist short_summary short_overview meeting_type topics_discussed
            }
            analytics {
              sentiments { negative_pct neutral_pct positive_pct }
              categories { questions date_times metrics tasks }
              speakers {
                speaker_id name duration word_count longest_monologue
                monologues_count filler_words questions duration_pct words_per_minute
              }
            }
          }
        }`,
        { id: transcriptId }
      )

      if (result.errors) {
        return {
          success: false,
          output: {},
          error: result.errors[0]?.message || 'Failed to fetch transcript',
        }
      }

      const transcript = result.data?.transcript
      if (!transcript) {
        return { success: false, output: {}, error: 'Transcript not found' }
      }

      return { success: true, output: { transcript } }
    },

    fireflies_get_user: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      const variables = params.userId ? { id: params.userId } : {}
      const result = await graphqlRequest(
        apiKey,
        `query User($id: String) {
          user(id: $id) {
            user_id name email integrations is_admin
            minutes_consumed num_transcripts recent_transcript recent_meeting
          }
        }`,
        variables
      )

      if (result.errors) {
        return { success: false, output: {}, error: result.errors[0]?.message || 'Failed to fetch user' }
      }

      const user = result.data?.user
      if (!user) return { success: false, output: {}, error: 'User not found' }

      return { success: true, output: { user } }
    },

    fireflies_list_users: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      const result = await graphqlRequest(
        apiKey,
        `query Users {
          users {
            user_id email name num_transcripts recent_meeting
            minutes_consumed is_admin integrations
          }
        }`
      )

      if (result.errors) {
        return { success: false, output: {}, error: result.errors[0]?.message || 'Failed to fetch users' }
      }

      return { success: true, output: { users: result.data?.users || [] } }
    },

    fireflies_upload_audio: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      let url: string | undefined

      const audioFile = params.audioFile as { url?: string; path?: string } | undefined
      if (audioFile) {
        url = audioFile.url || audioFile.path
      }
      if (!url && params.audioUrl) {
        url = params.audioUrl as string
      }
      if (!url) {
        return { success: false, output: {}, error: 'Either an audio file or audio URL is required' }
      }
      if (!url.startsWith('https://')) {
        return { success: false, output: {}, error: 'Audio URL must be a valid HTTPS URL' }
      }

      const input: Record<string, unknown> = { url }
      if (params.title) input.title = params.title
      if (params.webhook) input.webhook = params.webhook
      if (params.language) input.custom_language = params.language
      if (params.clientReferenceId) input.client_reference_id = params.clientReferenceId
      if (params.attendees) {
        try {
          input.attendees = JSON.parse(params.attendees as string)
        } catch {
          return { success: false, output: {}, error: 'Invalid attendees JSON format' }
        }
      }

      const result = await graphqlRequest(
        apiKey,
        `mutation UploadAudio($input: AudioUploadInput) {
          uploadAudio(input: $input) {
            success title message
          }
        }`,
        { input }
      )

      if (result.errors) {
        return { success: false, output: {}, error: result.errors[0]?.message || 'Failed to upload audio' }
      }

      const uploadResult = result.data?.uploadAudio
      if (!uploadResult) return { success: false, output: {}, error: 'Upload failed' }

      return {
        success: uploadResult.success,
        output: {
          success: uploadResult.success,
          title: uploadResult.title,
          message: uploadResult.message,
        },
      }
    },

    fireflies_delete_transcript: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const transcriptId = params.transcriptId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!transcriptId) return { success: false, output: {}, error: 'Missing required parameter: transcriptId' }

      const result = await graphqlRequest(
        apiKey,
        `mutation DeleteTranscript($id: String!) {
          deleteTranscript(id: $id) { success }
        }`,
        { id: transcriptId }
      )

      if (result.errors) {
        return {
          success: false,
          output: {},
          error: result.errors[0]?.message || 'Failed to delete transcript',
        }
      }

      const deleted = result.data?.deleteTranscript
      return {
        success: deleted?.success ?? false,
        output: { success: deleted?.success ?? false },
      }
    },

    fireflies_add_to_live_meeting: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const meetingLink = params.meetingLink as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!meetingLink || !meetingLink.startsWith('http')) {
        return { success: false, output: {}, error: 'Meeting link must be a valid HTTP/HTTPS URL' }
      }

      const variables: Record<string, unknown> = { meetingLink }
      if (params.title) variables.title = (params.title as string).substring(0, 256)
      if (params.meetingPassword) variables.meeting_password = (params.meetingPassword as string).substring(0, 32)
      if (params.duration) {
        variables.duration = Math.min(Math.max(Number(params.duration), 15), 120)
      }
      if (params.language) variables.language = (params.language as string).substring(0, 5)

      const result = await graphqlRequest(
        apiKey,
        `mutation AddToLiveMeeting(
          $meetingLink: String!
          $title: String
          $meeting_password: String
          $duration: Int
          $language: String
        ) {
          addToLiveMeeting(
            meeting_link: $meetingLink
            title: $title
            meeting_password: $meeting_password
            duration: $duration
            language: $language
          ) { success }
        }`,
        variables
      )

      if (result.errors) {
        const error = result.errors[0]
        const errorCode = error?.extensions?.code || ''
        let errorMessage = error?.message || 'Failed to add bot to meeting'
        if (errorCode === 'too_many_requests') {
          errorMessage = 'Rate limit exceeded. This endpoint allows 3 requests per 20 minutes.'
        } else if (errorCode === 'invalid_language_code') {
          errorMessage = 'Invalid language code provided'
        } else if (errorCode === 'unsupported_platform') {
          errorMessage = 'Meeting platform is not supported'
        }
        return { success: false, output: {}, error: errorMessage }
      }

      const addResult = result.data?.addToLiveMeeting
      return {
        success: addResult?.success ?? false,
        output: { success: addResult?.success ?? false },
      }
    },

    fireflies_create_bite: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      const transcriptId = params.transcriptId as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }
      if (!transcriptId) return { success: false, output: {}, error: 'Missing required parameter: transcriptId' }
      if (params.startTime === undefined || params.endTime === undefined) {
        return { success: false, output: {}, error: 'Start time and end time are required' }
      }
      const startTime = Number(params.startTime)
      const endTime = Number(params.endTime)
      if (startTime >= endTime) {
        return { success: false, output: {}, error: 'Start time must be less than end time' }
      }

      const variables: Record<string, unknown> = { transcriptId, startTime, endTime }
      if (params.name) variables.name = (params.name as string).substring(0, 256)
      if (params.mediaType) variables.media_type = params.mediaType
      if (params.summary) variables.summary = (params.summary as string).substring(0, 500)

      const result = await graphqlRequest(
        apiKey,
        `mutation CreateBite(
          $transcriptId: ID!
          $startTime: Float!
          $endTime: Float!
          $name: String
          $media_type: String
          $summary: String
        ) {
          createBite(
            transcript_Id: $transcriptId
            start_time: $startTime
            end_time: $endTime
            name: $name
            media_type: $media_type
            summary: $summary
          ) { id name status }
        }`,
        variables
      )

      if (result.errors) {
        return { success: false, output: {}, error: result.errors[0]?.message || 'Failed to create bite' }
      }

      const bite = result.data?.createBite
      if (!bite) return { success: false, output: {}, error: 'Failed to create bite' }

      return {
        success: true,
        output: { bite: { id: bite.id, name: bite.name, status: bite.status } },
      }
    },

    fireflies_list_bites: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      const variables: Record<string, unknown> = {
        mine: params.mine !== false,
      }
      if (params.transcriptId) variables.transcript_id = params.transcriptId
      if (params.limit) variables.limit = Math.min(Number(params.limit), 50)
      if (params.skip) variables.skip = Number(params.skip)

      const result = await graphqlRequest(
        apiKey,
        `query Bites(
          $mine: Boolean
          $transcript_id: ID
          $limit: Int
          $skip: Int
        ) {
          bites(
            mine: $mine
            transcript_id: $transcript_id
            limit: $limit
            skip: $skip
          ) {
            id name transcript_id user_id start_time end_time
            status summary media_type thumbnail preview created_at
          }
        }`,
        variables
      )

      if (result.errors) {
        return { success: false, output: {}, error: result.errors[0]?.message || 'Failed to fetch bites' }
      }

      return { success: true, output: { bites: result.data?.bites || [] } }
    },

    fireflies_list_contacts: async (params, _ctx) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing API key' }

      const result = await graphqlRequest(
        apiKey,
        `query Contacts {
          contacts { email name picture last_meeting_date }
        }`
      )

      if (result.errors) {
        return { success: false, output: {}, error: result.errors[0]?.message || 'Failed to fetch contacts' }
      }

      return { success: true, output: { contacts: result.data?.contacts || [] } }
    },
  },
}

export default handler
