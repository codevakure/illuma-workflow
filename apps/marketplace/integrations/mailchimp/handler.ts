import type { ToolHandler } from '../../sdk/types'

function extractServerPrefix(apiKey: string): string {
  const parts = apiKey.split('-')
  if (parts.length < 2) {
    throw new Error('Invalid Mailchimp API key format. Expected format: key-dc (e.g., abc123-us19)')
  }
  return parts[parts.length - 1]
}

function buildMailchimpUrl(apiKey: string, path: string): string {
  const serverPrefix = extractServerPrefix(apiKey)
  return `https://${serverPrefix}.api.mailchimp.com/3.0${path}`
}

function mailchimpHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

async function handleMailchimpResponse(response: Response, operation: string): Promise<Record<string, unknown>> {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    const errorData = data as Record<string, unknown>
    const errorMessage =
      errorData.detail || errorData.title || errorData.error || errorData.message || 'Unknown error'
    return { success: false, output: {}, error: `Mailchimp ${operation} failed: ${errorMessage}` }
  }
  return {}
}

function appendPaginationParams(url: string, params: Record<string, unknown>): string {
  const queryParams = new URLSearchParams()
  if (params.count) queryParams.append('count', String(params.count))
  if (params.offset) queryParams.append('offset', String(params.offset))
  const query = queryParams.toString()
  return query ? `${url}?${query}` : url
}

function tryParseJSON(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

const handler: ToolHandler = {
  operations: {
    /** Member operations */
    mailchimp_add_member: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const emailAddress = params.emailAddress as string
      const status = params.status as string
      if (!listId || !emailAddress || !status) {
        return { success: false, output: {}, error: 'Missing required parameters: listId, emailAddress, status' }
      }

      const body: Record<string, unknown> = { email_address: emailAddress, status }
      const mergeFields = tryParseJSON(params.mergeFields)
      if (mergeFields) body.merge_fields = mergeFields
      const interests = tryParseJSON(params.interests)
      if (interests) body.interests = interests

      const response = await fetch(buildMailchimpUrl(apiKey, `/lists/${listId}/members`), {
        method: 'POST',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify(body),
      })

      const errResult = await handleMailchimpResponse(response, 'add_member')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { member: data, subscriber_hash: data.id } }
    },

    mailchimp_get_members: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      if (!listId) return { success: false, output: {}, error: 'Missing required parameter: listId' }

      const queryParams = new URLSearchParams()
      if (params.status) queryParams.append('status', params.status as string)
      if (params.count) queryParams.append('count', String(params.count))
      if (params.offset) queryParams.append('offset', String(params.offset))

      const query = queryParams.toString()
      const url = buildMailchimpUrl(apiKey, `/lists/${listId}/members`)
      const fullUrl = query ? `${url}?${query}` : url

      const response = await fetch(fullUrl, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_members')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const members = data.members || []
      return { success: true, output: { members, total_items: data.total_items || members.length, total_returned: members.length } }
    },

    mailchimp_get_member: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const subscriberEmail = params.subscriberEmail as string
      if (!listId || !subscriberEmail) {
        return { success: false, output: {}, error: 'Missing required parameters: listId, subscriberEmail' }
      }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/members/${subscriberEmail}`),
        { headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'get_member')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { member: data, subscriber_hash: data.id } }
    },

    mailchimp_update_member: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const subscriberEmail = params.subscriberEmail as string
      if (!listId || !subscriberEmail) {
        return { success: false, output: {}, error: 'Missing required parameters: listId, subscriberEmail' }
      }

      const body: Record<string, unknown> = {}
      if (params.emailAddress) body.email_address = params.emailAddress
      if (params.status) body.status = params.status
      const mergeFields = tryParseJSON(params.mergeFields)
      if (mergeFields) body.merge_fields = mergeFields
      const interests = tryParseJSON(params.interests)
      if (interests) body.interests = interests

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/members/${subscriberEmail}`),
        { method: 'PATCH', headers: mailchimpHeaders(apiKey), body: JSON.stringify(body) }
      )

      const errResult = await handleMailchimpResponse(response, 'update_member')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { member: data, subscriber_hash: data.id } }
    },

    mailchimp_delete_member: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const subscriberEmail = params.subscriberEmail as string
      if (!listId || !subscriberEmail) {
        return { success: false, output: {}, error: 'Missing required parameters: listId, subscriberEmail' }
      }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/members/${subscriberEmail}`),
        { method: 'DELETE', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'delete_member')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Member deleted successfully' } }
    },

    mailchimp_archive_member: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const subscriberEmail = params.subscriberEmail as string
      if (!listId || !subscriberEmail) {
        return { success: false, output: {}, error: 'Missing required parameters: listId, subscriberEmail' }
      }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/members/${subscriberEmail}/actions/delete-permanent`),
        { method: 'DELETE', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'archive_member')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Member archived permanently' } }
    },

    mailchimp_unarchive_member: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const subscriberEmail = params.subscriberEmail as string
      const emailAddress = params.emailAddress as string
      const status = params.status as string
      if (!listId || !subscriberEmail || !emailAddress || !status) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/members/${subscriberEmail}`),
        {
          method: 'PUT',
          headers: mailchimpHeaders(apiKey),
          body: JSON.stringify({ email_address: emailAddress, status }),
        }
      )

      const errResult = await handleMailchimpResponse(response, 'unarchive_member')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { member: data, subscriber_hash: data.id } }
    },

    mailchimp_add_or_update_member: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const subscriberEmail = params.subscriberEmail as string
      const emailAddress = params.emailAddress as string
      const statusIfNew = params.statusIfNew as string
      if (!listId || !subscriberEmail || !emailAddress || !statusIfNew) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, unknown> = { email_address: emailAddress, status_if_new: statusIfNew }
      const mergeFields = tryParseJSON(params.mergeFields)
      if (mergeFields) body.merge_fields = mergeFields
      const interests = tryParseJSON(params.interests)
      if (interests) body.interests = interests

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/members/${subscriberEmail}`),
        { method: 'PUT', headers: mailchimpHeaders(apiKey), body: JSON.stringify(body) }
      )

      const errResult = await handleMailchimpResponse(response, 'add_or_update_member')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { member: data, subscriber_hash: data.id } }
    },

    /** Member tag operations */
    mailchimp_add_member_tags: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const subscriberEmail = params.subscriberEmail as string
      const tags = params.tags as string
      if (!listId || !subscriberEmail || !tags) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const parsedTags = tryParseJSON(tags) || []

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/members/${subscriberEmail}/tags`),
        { method: 'POST', headers: mailchimpHeaders(apiKey), body: JSON.stringify({ tags: parsedTags }) }
      )

      const errResult = await handleMailchimpResponse(response, 'add_member_tags')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Tags added successfully' } }
    },

    mailchimp_remove_member_tags: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const subscriberEmail = params.subscriberEmail as string
      const tags = params.tags as string
      if (!listId || !subscriberEmail || !tags) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const parsedTags = tryParseJSON(tags) || []

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/members/${subscriberEmail}/tags`),
        { method: 'POST', headers: mailchimpHeaders(apiKey), body: JSON.stringify({ tags: parsedTags }) }
      )

      const errResult = await handleMailchimpResponse(response, 'remove_member_tags')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Tags removed successfully' } }
    },

    mailchimp_get_member_tags: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const subscriberEmail = params.subscriberEmail as string
      if (!listId || !subscriberEmail) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/members/${subscriberEmail}/tags`),
        { headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'get_member_tags')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const tags = data.tags || []
      return { success: true, output: { tags, total_items: data.total_items || tags.length, total_returned: tags.length } }
    },

    /** Audience operations */
    mailchimp_get_audiences: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = appendPaginationParams(buildMailchimpUrl(apiKey, '/lists'), params)
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_audiences')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const lists = data.lists || []
      return { success: true, output: { lists, total_items: data.total_items || lists.length, total_returned: lists.length } }
    },

    mailchimp_get_audience: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      if (!listId) return { success: false, output: {}, error: 'Missing required parameter: listId' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/lists/${listId}`), { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_audience')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { list: data, list_id: data.id } }
    },

    mailchimp_create_audience: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const audienceName = params.audienceName as string
      const permissionReminder = params.permissionReminder as string
      if (!audienceName || !permissionReminder) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const body: Record<string, unknown> = {
        name: audienceName,
        permission_reminder: permissionReminder,
        email_type_option: params.emailTypeOption === 'true',
      }

      const contact = tryParseJSON(params.contact)
      if (contact) body.contact = contact
      const campaignDefaults = tryParseJSON(params.campaignDefaults)
      if (campaignDefaults) body.campaign_defaults = campaignDefaults

      const response = await fetch(buildMailchimpUrl(apiKey, '/lists'), {
        method: 'POST',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify(body),
      })

      const errResult = await handleMailchimpResponse(response, 'create_audience')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { list: data, list_id: data.id } }
    },

    mailchimp_update_audience: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      if (!listId) return { success: false, output: {}, error: 'Missing required parameter: listId' }

      const body: Record<string, unknown> = {}
      if (params.audienceName) body.name = params.audienceName
      if (params.permissionReminder) body.permission_reminder = params.permissionReminder
      if (params.emailTypeOption !== undefined) body.email_type_option = params.emailTypeOption === 'true'
      const campaignDefaults = tryParseJSON(params.campaignDefaults)
      if (campaignDefaults) body.campaign_defaults = campaignDefaults

      const response = await fetch(buildMailchimpUrl(apiKey, `/lists/${listId}`), {
        method: 'PATCH',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify(body),
      })

      const errResult = await handleMailchimpResponse(response, 'update_audience')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { list: data, list_id: data.id } }
    },

    mailchimp_delete_audience: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      if (!listId) return { success: false, output: {}, error: 'Missing required parameter: listId' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/lists/${listId}`), {
        method: 'DELETE',
        headers: mailchimpHeaders(apiKey),
      })

      const errResult = await handleMailchimpResponse(response, 'delete_audience')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Audience deleted successfully' } }
    },

    /** Campaign operations */
    mailchimp_get_campaigns: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const queryParams = new URLSearchParams()
      if (params.campaignType) queryParams.append('type', params.campaignType as string)
      if (params.status) queryParams.append('status', params.status as string)
      if (params.count) queryParams.append('count', String(params.count))
      if (params.offset) queryParams.append('offset', String(params.offset))

      const query = queryParams.toString()
      const url = buildMailchimpUrl(apiKey, '/campaigns')
      const fullUrl = query ? `${url}?${query}` : url

      const response = await fetch(fullUrl, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_campaigns')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const campaigns = data.campaigns || []
      return { success: true, output: { campaigns, total_items: data.total_items || campaigns.length, total_returned: campaigns.length } }
    },

    mailchimp_get_campaign: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignId = params.campaignId as string
      if (!campaignId) return { success: false, output: {}, error: 'Missing required parameter: campaignId' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/campaigns/${campaignId}`), { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_campaign')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { campaign: data, campaign_id: data.id } }
    },

    mailchimp_create_campaign: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignType = params.campaignType as string
      if (!campaignType) return { success: false, output: {}, error: 'Missing required parameter: campaignType' }

      const body: Record<string, unknown> = { type: campaignType }
      const settings = tryParseJSON(params.campaignSettings)
      if (settings) body.settings = settings
      const recipients = tryParseJSON(params.recipients)
      if (recipients) body.recipients = recipients

      const response = await fetch(buildMailchimpUrl(apiKey, '/campaigns'), {
        method: 'POST',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify(body),
      })

      const errResult = await handleMailchimpResponse(response, 'create_campaign')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { campaign: data, campaign_id: data.id } }
    },

    mailchimp_update_campaign: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignId = params.campaignId as string
      if (!campaignId) return { success: false, output: {}, error: 'Missing required parameter: campaignId' }

      const body: Record<string, unknown> = {}
      const settings = tryParseJSON(params.campaignSettings)
      if (settings) body.settings = settings
      const recipients = tryParseJSON(params.recipients)
      if (recipients) body.recipients = recipients

      const response = await fetch(buildMailchimpUrl(apiKey, `/campaigns/${campaignId}`), {
        method: 'PATCH',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify(body),
      })

      const errResult = await handleMailchimpResponse(response, 'update_campaign')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { campaign: data, campaign_id: data.id } }
    },

    mailchimp_delete_campaign: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignId = params.campaignId as string
      if (!campaignId) return { success: false, output: {}, error: 'Missing required parameter: campaignId' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/campaigns/${campaignId}`), {
        method: 'DELETE',
        headers: mailchimpHeaders(apiKey),
      })

      const errResult = await handleMailchimpResponse(response, 'delete_campaign')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Campaign deleted successfully' } }
    },

    mailchimp_send_campaign: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignId = params.campaignId as string
      if (!campaignId) return { success: false, output: {}, error: 'Missing required parameter: campaignId' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/campaigns/${campaignId}/actions/send`),
        { method: 'POST', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'send_campaign')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Campaign sent successfully' } }
    },

    mailchimp_schedule_campaign: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignId = params.campaignId as string
      const scheduleTime = params.scheduleTime as string
      if (!campaignId || !scheduleTime) {
        return { success: false, output: {}, error: 'Missing required parameters: campaignId, scheduleTime' }
      }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/campaigns/${campaignId}/actions/schedule`),
        {
          method: 'POST',
          headers: mailchimpHeaders(apiKey),
          body: JSON.stringify({ schedule_time: scheduleTime }),
        }
      )

      const errResult = await handleMailchimpResponse(response, 'schedule_campaign')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Campaign scheduled successfully' } }
    },

    mailchimp_unschedule_campaign: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignId = params.campaignId as string
      if (!campaignId) return { success: false, output: {}, error: 'Missing required parameter: campaignId' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/campaigns/${campaignId}/actions/unschedule`),
        { method: 'POST', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'unschedule_campaign')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Campaign unscheduled successfully' } }
    },

    mailchimp_replicate_campaign: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignId = params.campaignId as string
      if (!campaignId) return { success: false, output: {}, error: 'Missing required parameter: campaignId' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/campaigns/${campaignId}/actions/replicate`),
        { method: 'POST', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'replicate_campaign')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { campaign: data, campaign_id: data.id } }
    },

    /** Campaign content operations */
    mailchimp_get_campaign_content: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignId = params.campaignId as string
      if (!campaignId) return { success: false, output: {}, error: 'Missing required parameter: campaignId' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/campaigns/${campaignId}/content`),
        { headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'get_campaign_content')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { content: data } }
    },

    mailchimp_set_campaign_content: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignId = params.campaignId as string
      if (!campaignId) return { success: false, output: {}, error: 'Missing required parameter: campaignId' }

      const body: Record<string, unknown> = {}
      if (params.html) body.html = params.html
      if (params.plainText) body.plain_text = params.plainText
      if (params.templateId) body.template = { id: params.templateId }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/campaigns/${campaignId}/content`),
        { method: 'PUT', headers: mailchimpHeaders(apiKey), body: JSON.stringify(body) }
      )

      const errResult = await handleMailchimpResponse(response, 'set_campaign_content')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { content: data } }
    },

    /** Campaign report operations */
    mailchimp_get_campaign_reports: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = appendPaginationParams(buildMailchimpUrl(apiKey, '/reports'), params)
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_campaign_reports')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const reports = data.reports || []
      return { success: true, output: { reports, total_items: data.total_items || reports.length, total_returned: reports.length } }
    },

    mailchimp_get_campaign_report: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const campaignId = params.campaignId as string
      if (!campaignId) return { success: false, output: {}, error: 'Missing required parameter: campaignId' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/reports/${campaignId}`),
        { headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'get_campaign_report')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { report: data, campaign_id: data.campaign_id } }
    },

    /** Automation operations */
    mailchimp_get_automations: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = appendPaginationParams(buildMailchimpUrl(apiKey, '/automations'), params)
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_automations')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const automations = data.automations || []
      return { success: true, output: { automations, total_items: data.total_items || automations.length, total_returned: automations.length } }
    },

    mailchimp_get_automation: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const workflowId = params.workflowId as string
      if (!workflowId) return { success: false, output: {}, error: 'Missing required parameter: workflowId' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/automations/${workflowId}`),
        { headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'get_automation')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { automation: data, workflow_id: data.id } }
    },

    mailchimp_start_automation: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const workflowId = params.workflowId as string
      if (!workflowId) return { success: false, output: {}, error: 'Missing required parameter: workflowId' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/automations/${workflowId}/actions/start-all-emails`),
        { method: 'POST', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'start_automation')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Automation started successfully' } }
    },

    mailchimp_pause_automation: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const workflowId = params.workflowId as string
      if (!workflowId) return { success: false, output: {}, error: 'Missing required parameter: workflowId' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/automations/${workflowId}/actions/pause-all-emails`),
        { method: 'POST', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'pause_automation')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Automation paused successfully' } }
    },

    mailchimp_add_subscriber_to_automation: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const workflowId = params.workflowId as string
      const workflowEmailId = params.workflowEmailId as string
      const emailAddress = params.emailAddress as string
      if (!workflowId || !workflowEmailId || !emailAddress) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/automations/${workflowId}/emails/${workflowEmailId}/queue`),
        {
          method: 'POST',
          headers: mailchimpHeaders(apiKey),
          body: JSON.stringify({ email_address: emailAddress }),
        }
      )

      const errResult = await handleMailchimpResponse(response, 'add_subscriber_to_automation')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { subscriber: data } }
    },

    /** Segment operations */
    mailchimp_get_segments: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      if (!listId) return { success: false, output: {}, error: 'Missing required parameter: listId' }

      const url = appendPaginationParams(buildMailchimpUrl(apiKey, `/lists/${listId}/segments`), params)
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_segments')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const segments = data.segments || []
      return { success: true, output: { segments, total_items: data.total_items || segments.length, total_returned: segments.length } }
    },

    mailchimp_get_segment: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const segmentId = params.segmentId as string
      if (!listId || !segmentId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/segments/${segmentId}`),
        { headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'get_segment')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { segment: data, segment_id: data.id } }
    },

    mailchimp_create_segment: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const segmentName = params.segmentName as string
      if (!listId || !segmentName) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = { name: segmentName }
      const segmentOptions = tryParseJSON(params.segmentOptions)
      if (segmentOptions) body.options = segmentOptions

      const response = await fetch(buildMailchimpUrl(apiKey, `/lists/${listId}/segments`), {
        method: 'POST',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify(body),
      })

      const errResult = await handleMailchimpResponse(response, 'create_segment')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { segment: data, segment_id: data.id } }
    },

    mailchimp_update_segment: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const segmentId = params.segmentId as string
      if (!listId || !segmentId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = {}
      if (params.segmentName) body.name = params.segmentName
      const segmentOptions = tryParseJSON(params.segmentOptions)
      if (segmentOptions) body.options = segmentOptions

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/segments/${segmentId}`),
        { method: 'PATCH', headers: mailchimpHeaders(apiKey), body: JSON.stringify(body) }
      )

      const errResult = await handleMailchimpResponse(response, 'update_segment')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { segment: data, segment_id: data.id } }
    },

    mailchimp_delete_segment: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const segmentId = params.segmentId as string
      if (!listId || !segmentId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/segments/${segmentId}`),
        { method: 'DELETE', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'delete_segment')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Segment deleted successfully' } }
    },

    mailchimp_get_segment_members: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const segmentId = params.segmentId as string
      if (!listId || !segmentId) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = appendPaginationParams(
        buildMailchimpUrl(apiKey, `/lists/${listId}/segments/${segmentId}/members`),
        params
      )
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_segment_members')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const members = data.members || []
      return { success: true, output: { members, total_items: data.total_items || members.length, total_returned: members.length } }
    },

    mailchimp_add_segment_member: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const segmentId = params.segmentId as string
      const emailAddress = params.emailAddress as string
      if (!listId || !segmentId || !emailAddress) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/segments/${segmentId}/members`),
        {
          method: 'POST',
          headers: mailchimpHeaders(apiKey),
          body: JSON.stringify({ email_address: emailAddress }),
        }
      )

      const errResult = await handleMailchimpResponse(response, 'add_segment_member')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { member: data } }
    },

    mailchimp_remove_segment_member: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const segmentId = params.segmentId as string
      const subscriberEmail = params.subscriberEmail as string
      if (!listId || !segmentId || !subscriberEmail) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/segments/${segmentId}/members/${subscriberEmail}`),
        { method: 'DELETE', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'remove_segment_member')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Member removed from segment successfully' } }
    },

    /** Template operations */
    mailchimp_get_templates: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = appendPaginationParams(buildMailchimpUrl(apiKey, '/templates'), params)
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_templates')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const templates = data.templates || []
      return { success: true, output: { templates, total_items: data.total_items || templates.length, total_returned: templates.length } }
    },

    mailchimp_get_template: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const templateId = params.templateId as string
      if (!templateId) return { success: false, output: {}, error: 'Missing required parameter: templateId' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/templates/${templateId}`), { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_template')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { template: data, template_id: data.id } }
    },

    mailchimp_create_template: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const templateName = params.templateName as string
      const templateHtml = params.templateHtml as string
      if (!templateName || !templateHtml) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(buildMailchimpUrl(apiKey, '/templates'), {
        method: 'POST',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify({ name: templateName, html: templateHtml }),
      })

      const errResult = await handleMailchimpResponse(response, 'create_template')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { template: data, template_id: data.id } }
    },

    mailchimp_update_template: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const templateId = params.templateId as string
      if (!templateId) return { success: false, output: {}, error: 'Missing required parameter: templateId' }

      const body: Record<string, unknown> = {}
      if (params.templateName) body.name = params.templateName
      if (params.templateHtml) body.html = params.templateHtml

      const response = await fetch(buildMailchimpUrl(apiKey, `/templates/${templateId}`), {
        method: 'PATCH',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify(body),
      })

      const errResult = await handleMailchimpResponse(response, 'update_template')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { template: data, template_id: data.id } }
    },

    mailchimp_delete_template: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const templateId = params.templateId as string
      if (!templateId) return { success: false, output: {}, error: 'Missing required parameter: templateId' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/templates/${templateId}`), {
        method: 'DELETE',
        headers: mailchimpHeaders(apiKey),
      })

      const errResult = await handleMailchimpResponse(response, 'delete_template')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Template deleted successfully' } }
    },

    /** Interest category operations */
    mailchimp_get_interest_categories: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      if (!listId) return { success: false, output: {}, error: 'Missing required parameter: listId' }

      const url = appendPaginationParams(buildMailchimpUrl(apiKey, `/lists/${listId}/interest-categories`), params)
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_interest_categories')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const categories = data.categories || []
      return { success: true, output: { categories, total_items: data.total_items || categories.length, total_returned: categories.length } }
    },

    mailchimp_get_interest_category: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const interestCategoryId = params.interestCategoryId as string
      if (!listId || !interestCategoryId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/interest-categories/${interestCategoryId}`),
        { headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'get_interest_category')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { category: data, interest_category_id: data.id } }
    },

    mailchimp_create_interest_category: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const interestCategoryTitle = params.interestCategoryTitle as string
      const interestCategoryType = params.interestCategoryType as string
      if (!listId || !interestCategoryTitle || !interestCategoryType) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const response = await fetch(buildMailchimpUrl(apiKey, `/lists/${listId}/interest-categories`), {
        method: 'POST',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify({ title: interestCategoryTitle, type: interestCategoryType }),
      })

      const errResult = await handleMailchimpResponse(response, 'create_interest_category')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { category: data, interest_category_id: data.id } }
    },

    mailchimp_update_interest_category: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const interestCategoryId = params.interestCategoryId as string
      if (!listId || !interestCategoryId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = {}
      if (params.interestCategoryTitle) body.title = params.interestCategoryTitle
      if (params.interestCategoryType) body.type = params.interestCategoryType

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/interest-categories/${interestCategoryId}`),
        { method: 'PATCH', headers: mailchimpHeaders(apiKey), body: JSON.stringify(body) }
      )

      const errResult = await handleMailchimpResponse(response, 'update_interest_category')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { category: data, interest_category_id: data.id } }
    },

    mailchimp_delete_interest_category: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const interestCategoryId = params.interestCategoryId as string
      if (!listId || !interestCategoryId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/interest-categories/${interestCategoryId}`),
        { method: 'DELETE', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'delete_interest_category')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Interest category deleted successfully' } }
    },

    /** Interest operations */
    mailchimp_get_interests: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const interestCategoryId = params.interestCategoryId as string
      if (!listId || !interestCategoryId) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = appendPaginationParams(
        buildMailchimpUrl(apiKey, `/lists/${listId}/interest-categories/${interestCategoryId}/interests`),
        params
      )
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_interests')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const interests = data.interests || []
      return { success: true, output: { interests, total_items: data.total_items || interests.length, total_returned: interests.length } }
    },

    mailchimp_get_interest: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const interestCategoryId = params.interestCategoryId as string
      const interestId = params.interestId as string
      if (!listId || !interestCategoryId || !interestId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/interest-categories/${interestCategoryId}/interests/${interestId}`),
        { headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'get_interest')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { interest: data, interest_id: data.id } }
    },

    mailchimp_create_interest: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const interestCategoryId = params.interestCategoryId as string
      const interestName = params.interestName as string
      if (!listId || !interestCategoryId || !interestName) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/interest-categories/${interestCategoryId}/interests`),
        {
          method: 'POST',
          headers: mailchimpHeaders(apiKey),
          body: JSON.stringify({ name: interestName }),
        }
      )

      const errResult = await handleMailchimpResponse(response, 'create_interest')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { interest: data, interest_id: data.id } }
    },

    mailchimp_update_interest: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const interestCategoryId = params.interestCategoryId as string
      const interestId = params.interestId as string
      if (!listId || !interestCategoryId || !interestId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = {}
      if (params.interestName) body.name = params.interestName

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/interest-categories/${interestCategoryId}/interests/${interestId}`),
        { method: 'PATCH', headers: mailchimpHeaders(apiKey), body: JSON.stringify(body) }
      )

      const errResult = await handleMailchimpResponse(response, 'update_interest')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { interest: data, interest_id: data.id } }
    },

    mailchimp_delete_interest: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const interestCategoryId = params.interestCategoryId as string
      const interestId = params.interestId as string
      if (!listId || !interestCategoryId || !interestId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/interest-categories/${interestCategoryId}/interests/${interestId}`),
        { method: 'DELETE', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'delete_interest')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Interest deleted successfully' } }
    },

    /** Merge field operations */
    mailchimp_get_merge_fields: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      if (!listId) return { success: false, output: {}, error: 'Missing required parameter: listId' }

      const url = appendPaginationParams(buildMailchimpUrl(apiKey, `/lists/${listId}/merge-fields`), params)
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_merge_fields')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const mergeFields = data.merge_fields || []
      return { success: true, output: { merge_fields: mergeFields, total_items: data.total_items || mergeFields.length, total_returned: mergeFields.length } }
    },

    mailchimp_get_merge_field: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const mergeId = params.mergeId as string
      if (!listId || !mergeId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/merge-fields/${mergeId}`),
        { headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'get_merge_field')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { mergeField: data, merge_id: data.merge_id } }
    },

    mailchimp_create_merge_field: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const mergeName = params.mergeName as string
      const mergeType = params.mergeType as string
      if (!listId || !mergeName || !mergeType) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/lists/${listId}/merge-fields`), {
        method: 'POST',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify({ name: mergeName, type: mergeType }),
      })

      const errResult = await handleMailchimpResponse(response, 'create_merge_field')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { mergeField: data, merge_id: data.merge_id } }
    },

    mailchimp_update_merge_field: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const mergeId = params.mergeId as string
      if (!listId || !mergeId) return { success: false, output: {}, error: 'Missing required parameters' }

      const body: Record<string, unknown> = {}
      if (params.mergeName) body.name = params.mergeName
      if (params.mergeType) body.type = params.mergeType

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/merge-fields/${mergeId}`),
        { method: 'PATCH', headers: mailchimpHeaders(apiKey), body: JSON.stringify(body) }
      )

      const errResult = await handleMailchimpResponse(response, 'update_merge_field')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { mergeField: data, merge_id: data.merge_id } }
    },

    mailchimp_delete_merge_field: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const listId = params.listId as string
      const mergeId = params.mergeId as string
      if (!listId || !mergeId) return { success: false, output: {}, error: 'Missing required parameters' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/lists/${listId}/merge-fields/${mergeId}`),
        { method: 'DELETE', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'delete_merge_field')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Merge field deleted successfully' } }
    },

    /** Batch operation operations */
    mailchimp_get_batch_operations: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = appendPaginationParams(buildMailchimpUrl(apiKey, '/batches'), params)
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_batch_operations')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const batches = data.batches || []
      return { success: true, output: { batches, total_items: data.total_items || batches.length, total_returned: batches.length } }
    },

    mailchimp_get_batch_operation: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const batchId = params.batchId as string
      if (!batchId) return { success: false, output: {}, error: 'Missing required parameter: batchId' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/batches/${batchId}`), { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_batch_operation')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { batch: data, batch_id: data.id } }
    },

    mailchimp_create_batch_operation: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const operations = params.operations as string
      if (!operations) return { success: false, output: {}, error: 'Missing required parameter: operations' }

      const parsedOperations = tryParseJSON(operations) || []

      const response = await fetch(buildMailchimpUrl(apiKey, '/batches'), {
        method: 'POST',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify({ operations: parsedOperations }),
      })

      const errResult = await handleMailchimpResponse(response, 'create_batch_operation')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { batch: data, batch_id: data.id } }
    },

    mailchimp_delete_batch_operation: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const batchId = params.batchId as string
      if (!batchId) return { success: false, output: {}, error: 'Missing required parameter: batchId' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/batches/${batchId}`), {
        method: 'DELETE',
        headers: mailchimpHeaders(apiKey),
      })

      const errResult = await handleMailchimpResponse(response, 'delete_batch_operation')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Batch operation deleted successfully' } }
    },

    /** Landing page operations */
    mailchimp_get_landing_pages: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = appendPaginationParams(buildMailchimpUrl(apiKey, '/landing-pages'), params)
      const response = await fetch(url, { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_landing_pages')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      const landingPages = data.landing_pages || []
      return { success: true, output: { landing_pages: landingPages, total_items: data.total_items || landingPages.length, total_returned: landingPages.length } }
    },

    mailchimp_get_landing_page: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const pageId = params.pageId as string
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/landing-pages/${pageId}`), { headers: mailchimpHeaders(apiKey) })

      const errResult = await handleMailchimpResponse(response, 'get_landing_page')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { landingPage: data, page_id: data.id } }
    },

    mailchimp_create_landing_page: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const landingPageType = params.landingPageType as string
      if (!landingPageType) return { success: false, output: {}, error: 'Missing required parameter: landingPageType' }

      const body: Record<string, unknown> = { type: landingPageType }
      if (params.landingPageTitle) body.title = params.landingPageTitle

      const response = await fetch(buildMailchimpUrl(apiKey, '/landing-pages'), {
        method: 'POST',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify(body),
      })

      const errResult = await handleMailchimpResponse(response, 'create_landing_page')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { landingPage: data, page_id: data.id } }
    },

    mailchimp_update_landing_page: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const pageId = params.pageId as string
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }

      const body: Record<string, unknown> = {}
      if (params.landingPageTitle) body.title = params.landingPageTitle
      if (params.landingPageName) body.name = params.landingPageName

      const response = await fetch(buildMailchimpUrl(apiKey, `/landing-pages/${pageId}`), {
        method: 'PATCH',
        headers: mailchimpHeaders(apiKey),
        body: JSON.stringify(body),
      })

      const errResult = await handleMailchimpResponse(response, 'update_landing_page')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      const data = await response.json()
      return { success: true, output: { landingPage: data, page_id: data.id } }
    },

    mailchimp_delete_landing_page: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const pageId = params.pageId as string
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }

      const response = await fetch(buildMailchimpUrl(apiKey, `/landing-pages/${pageId}`), {
        method: 'DELETE',
        headers: mailchimpHeaders(apiKey),
      })

      const errResult = await handleMailchimpResponse(response, 'delete_landing_page')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Landing page deleted successfully' } }
    },

    mailchimp_publish_landing_page: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const pageId = params.pageId as string
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/landing-pages/${pageId}/actions/publish`),
        { method: 'POST', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'publish_landing_page')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Landing page published successfully' } }
    },

    mailchimp_unpublish_landing_page: async (params, ctx) => {
      const apiKey = (ctx.apiKey || params.apiKey) as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const pageId = params.pageId as string
      if (!pageId) return { success: false, output: {}, error: 'Missing required parameter: pageId' }

      const response = await fetch(
        buildMailchimpUrl(apiKey, `/landing-pages/${pageId}/actions/unpublish`),
        { method: 'POST', headers: mailchimpHeaders(apiKey) }
      )

      const errResult = await handleMailchimpResponse(response, 'unpublish_landing_page')
      if (errResult.error) return errResult as { success: false; output: Record<string, unknown>; error: string }

      return { success: true, output: { message: 'Landing page unpublished successfully' } }
    },
  },
}

export default handler
