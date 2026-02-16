import type { ToolHandler } from '../../sdk/types'

const TWILIO_API_BASE = 'https://api.twilio.com/2010-04-01/Accounts'

function twilioAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`
}

const handler: ToolHandler = {
  operations: {
    twilio_voice_make_call: async (params) => {
      const accountSid = params.accountSid as string
      const authToken = params.authToken as string
      const to = params.to as string
      const from = params.from as string
      if (!accountSid || !authToken || !to || !from) {
        return {
          success: false,
          output: {},
          error: 'Missing required parameters: accountSid, authToken, to, from',
        }
      }

      const formBody = new URLSearchParams()
      formBody.append('To', to)
      formBody.append('From', from)

      if (params.url) formBody.append('Url', params.url as string)
      if (params.twiml) formBody.append('Twiml', params.twiml as string)
      if (params.statusCallback) formBody.append('StatusCallback', params.statusCallback as string)
      if (params.statusCallbackMethod) formBody.append('StatusCallbackMethod', params.statusCallbackMethod as string)
      if (params.method) formBody.append('Method', params.method as string)
      if (params.timeout) formBody.append('Timeout', String(params.timeout))
      if (params.record !== undefined) formBody.append('Record', String(params.record))
      if (params.machineDetection) formBody.append('MachineDetection', params.machineDetection as string)

      const response = await fetch(`${TWILIO_API_BASE}/${accountSid}/Calls.json`, {
        method: 'POST',
        headers: {
          Authorization: twilioAuthHeader(accountSid, authToken),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formBody.toString(),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Twilio API error: ${response.status}`,
        }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          sid: data.sid,
          status: data.status,
          to: data.to,
          from: data.from,
          direction: data.direction,
          dateCreated: data.date_created,
          uri: data.uri,
        },
      }
    },

    twilio_voice_list_calls: async (params) => {
      const accountSid = params.accountSid as string
      const authToken = params.authToken as string
      if (!accountSid || !authToken) {
        return {
          success: false,
          output: {},
          error: 'Missing required parameters: accountSid, authToken',
        }
      }

      const queryParams = new URLSearchParams()
      if (params.to) queryParams.append('To', params.to as string)
      if (params.from) queryParams.append('From', params.from as string)
      if (params.status) queryParams.append('Status', params.status as string)
      if (params.startTime) queryParams.append('StartTime', params.startTime as string)
      if (params.endTime) queryParams.append('EndTime', params.endTime as string)
      if (params.pageSize) queryParams.append('PageSize', String(params.pageSize))

      const query = queryParams.toString()
      const url = query
        ? `${TWILIO_API_BASE}/${accountSid}/Calls.json?${query}`
        : `${TWILIO_API_BASE}/${accountSid}/Calls.json`

      const response = await fetch(url, {
        headers: { Authorization: twilioAuthHeader(accountSid, authToken) },
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Twilio API error: ${response.status}`,
        }
      }

      const data = await response.json()
      const calls = (data.calls || []).map((call: Record<string, unknown>) => ({
        sid: call.sid,
        status: call.status,
        to: call.to,
        from: call.from,
        direction: call.direction,
        duration: call.duration,
        startTime: call.start_time,
        endTime: call.end_time,
        dateCreated: call.date_created,
        price: call.price,
        priceUnit: call.price_unit,
      }))

      return {
        success: true,
        output: {
          calls,
          page: data.page,
          pageSize: data.page_size,
          totalCount: calls.length,
        },
      }
    },

    twilio_voice_get_recording: async (params) => {
      const accountSid = params.accountSid as string
      const authToken = params.authToken as string
      const callSid = params.callSid as string
      if (!accountSid || !authToken || !callSid) {
        return {
          success: false,
          output: {},
          error: 'Missing required parameters: accountSid, authToken, callSid',
        }
      }

      const response = await fetch(
        `${TWILIO_API_BASE}/${accountSid}/Calls/${callSid}/Recordings.json`,
        { headers: { Authorization: twilioAuthHeader(accountSid, authToken) } }
      )

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return {
          success: false,
          output: {},
          error: (errorData as Record<string, string>).message || `Twilio API error: ${response.status}`,
        }
      }

      const data = await response.json()
      const recordings = data.recordings || []

      if (recordings.length === 0) {
        return { success: true, output: { message: 'No recordings found for this call', recordings: [] } }
      }

      const enrichedRecordings = await Promise.all(
        recordings.map(async (recording: Record<string, unknown>) => {
          const recordingSid = recording.sid as string
          const result: Record<string, unknown> = {
            sid: recordingSid,
            callSid: recording.call_sid,
            duration: recording.duration,
            dateCreated: recording.date_created,
            status: recording.status,
            channels: recording.channels,
            source: recording.source,
            mediaUrl: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.mp3`,
          }

          try {
            const transcriptionResponse = await fetch(
              `${TWILIO_API_BASE}/${accountSid}/Recordings/${recordingSid}/Transcriptions.json`,
              { headers: { Authorization: twilioAuthHeader(accountSid, authToken) } }
            )

            if (transcriptionResponse.ok) {
              const transcriptionData = await transcriptionResponse.json()
              const transcriptions = transcriptionData.transcriptions || []
              if (transcriptions.length > 0) {
                result.transcription = {
                  sid: transcriptions[0].sid,
                  status: transcriptions[0].status,
                  transcriptionText: transcriptions[0].transcription_text,
                  duration: transcriptions[0].duration,
                }
              }
            }
          } catch {
            // transcription not available
          }

          return result
        })
      )

      return {
        success: true,
        output: {
          recordings: enrichedRecordings,
          totalCount: enrichedRecordings.length,
        },
      }
    },
  },
}

export default handler
