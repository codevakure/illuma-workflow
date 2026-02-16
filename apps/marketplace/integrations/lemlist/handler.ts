import type { ToolHandler } from '../../sdk/types'

function lemlistHeaders(apiKey: string): Record<string, string> {
  const credentials = Buffer.from(`:${apiKey}`).toString('base64')
  return {
    Authorization: `Basic ${credentials}`,
    'Content-Type': 'application/json',
  }
}

const handler: ToolHandler = {
  operations: {
    lemlist_get_activities: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const url = new URL('https://api.lemlist.com/api/activities')
      url.searchParams.append('version', 'v2')

      if (params.type) url.searchParams.append('type', params.type as string)
      if (params.campaignId) url.searchParams.append('campaignId', params.campaignId as string)
      if (params.leadId) url.searchParams.append('leadId', params.leadId as string)
      if (params.isFirst !== undefined) url.searchParams.append('isFirst', String(params.isFirst))
      if (params.limit !== undefined) url.searchParams.append('limit', String(params.limit))
      if (params.offset !== undefined) url.searchParams.append('offset', String(params.offset))

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: lemlistHeaders(apiKey),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Lemlist API error: ${response.status} - ${errorText}` }
      }

      const data = await response.json()
      const activities = Array.isArray(data) ? data : []

      return {
        success: true,
        output: {
          activities: activities.map((activity: Record<string, unknown>) => ({
            _id: (activity._id as string) ?? '',
            type: (activity.type as string) ?? '',
            leadId: (activity.leadId as string) ?? '',
            campaignId: (activity.campaignId as string) ?? '',
            sequenceId: (activity.sequenceId as string) ?? null,
            stepId: (activity.stepId as string) ?? null,
            createdAt: (activity.createdAt as string) ?? '',
          })),
          count: activities.length,
        },
      }
    },

    lemlist_get_lead: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }

      const leadIdentifier = params.leadIdentifier as string
      if (!leadIdentifier) {
        return { success: false, output: {}, error: 'Missing required parameter: leadIdentifier' }
      }

      const isEmail = leadIdentifier.includes('@')
      const url = isEmail
        ? `https://api.lemlist.com/api/leads/${encodeURIComponent(leadIdentifier)}`
        : `https://api.lemlist.com/api/leads?id=${encodeURIComponent(leadIdentifier)}`

      const response = await fetch(url, {
        method: 'GET',
        headers: lemlistHeaders(apiKey),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Lemlist API error: ${response.status} - ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          _id: data._id ?? '',
          email: data.email ?? '',
          firstName: data.firstName ?? null,
          lastName: data.lastName ?? null,
          companyName: data.companyName ?? null,
          jobTitle: data.jobTitle ?? null,
          companyDomain: data.companyDomain ?? null,
          isPaused: data.isPaused ?? false,
          campaignId: data.campaignId ?? null,
          contactId: data.contactId ?? null,
          emailStatus: data.emailStatus ?? null,
        },
      }
    },

    lemlist_send_email: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) {
        return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      }
      if (!params.sendUserId || !params.sendUserEmail || !params.sendUserMailboxId || !params.contactId || !params.leadId || !params.subject || !params.message) {
        return { success: false, output: {}, error: 'Missing required parameters for sending email' }
      }

      const response = await fetch('https://api.lemlist.com/api/inbox/email', {
        method: 'POST',
        headers: lemlistHeaders(apiKey),
        body: JSON.stringify({
          sendUserId: (params.sendUserId as string).trim(),
          sendUserEmail: (params.sendUserEmail as string).trim(),
          sendUserMailboxId: (params.sendUserMailboxId as string).trim(),
          contactId: (params.contactId as string).trim(),
          leadId: (params.leadId as string).trim(),
          subject: (params.subject as string).trim(),
          message: params.message,
          cc: params.cc ?? [],
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, output: {}, error: `Lemlist API error: ${response.status} - ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          ok: data.ok ?? true,
        },
      }
    },
  },
}

export default handler
