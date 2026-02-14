import crypto from 'crypto'
import { db, account, webhook, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { and, eq, isNull, or } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { safeCompare } from '@/lib/core/security/encryption'
import {
  type SecureFetchResponse,
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { sanitizeUrlForLog } from '@/lib/core/utils/logging'
import type { DbOrTx } from '@/lib/db/types'
import { getProviderIdFromServiceId } from '@/lib/oauth/utils'
import {
  getCredentialsForCredentialSet,
  refreshAccessTokenIfNeeded,
} from '@/lib/auth/oauth-utils'

const logger = createLogger('WebhookUtils')

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Represents a single consolidated Airtable record change */
export interface AirtableChange {
  tableId: string
  recordId: string
  changeType: 'created' | 'updated'
  changedFields: Record<string, unknown>
  previousFields?: Record<string, unknown>
}

/** Result of syncing webhooks for a credential set */
export interface CredentialSetWebhookSyncResult {
  webhooks: Array<{
    id: string
    credentialId: string
    isNew: boolean
  }>
  created: number
  updated: number
  deleted: number
  failed: Array<{
    credentialId: string
    error: string
  }>
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLACK_FILE_HOSTS = new Set(['files.slack.com', 'files-pri.slack.com'])
const SLACK_MAX_FILE_SIZE = 50 * 1024 * 1024 // 50 MB
const SLACK_MAX_FILES = 10

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Fetches a URL with DNS pinning to prevent DNS rebinding attacks.
 * @param url - The URL to fetch
 * @param accessToken - Authorization token (empty string for pre-signed URLs)
 * @param requestId - Request ID for logging
 * @returns The fetch Response or null if validation fails
 */
async function fetchWithDNSPinning(
  url: string,
  accessToken: string,
  requestId: string
): Promise<SecureFetchResponse | null> {
  try {
    const urlValidation = await validateUrlWithDNS(url, 'contentUrl')
    if (!urlValidation.isValid) {
      logger.warn(`[${requestId}] Invalid content URL: ${urlValidation.error}`, {
        url,
      })
      return null
    }

    const headers: Record<string, string> = {}

    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`
    }

    const response = await secureFetchWithPinnedIP(url, urlValidation.resolvedIP!, {
      headers,
    })

    return response
  } catch (error) {
    logger.error(`[${requestId}] Error fetching URL with DNS pinning`, {
      error: error instanceof Error ? error.message : String(error),
      url: sanitizeUrlForLog(url),
    })
    return null
  }
}

/**
 * Downloads file attachments from Slack using the bot token.
 *
 * Security:
 * - Validates each url_private against allowlisted Slack file hosts
 * - Uses validateUrlWithDNS + secureFetchWithPinnedIP to prevent SSRF
 * - Enforces per-file size limit and max file count
 */
async function downloadSlackFiles(
  rawFiles: unknown[],
  botToken: string
): Promise<Array<{ name: string; data: string; mimeType: string; size: number }>> {
  const filesToProcess = rawFiles.slice(0, SLACK_MAX_FILES) as Array<Record<string, unknown>>
  const downloaded: Array<{ name: string; data: string; mimeType: string; size: number }> = []

  for (const file of filesToProcess) {
    const urlPrivate = file.url_private as string | undefined
    if (!urlPrivate) {
      continue
    }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(urlPrivate)
    } catch {
      logger.warn('Slack file has invalid url_private, skipping', { fileId: file.id })
      continue
    }

    if (!SLACK_FILE_HOSTS.has(parsedUrl.hostname)) {
      logger.warn('Slack file url_private points to unexpected host, skipping', {
        fileId: file.id,
        hostname: sanitizeUrlForLog(urlPrivate),
      })
      continue
    }

    const reportedSize = Number(file.size) || 0
    if (reportedSize > SLACK_MAX_FILE_SIZE) {
      logger.warn('Slack file exceeds size limit, skipping', {
        fileId: file.id,
        size: reportedSize,
        limit: SLACK_MAX_FILE_SIZE,
      })
      continue
    }

    try {
      const urlValidation = await validateUrlWithDNS(urlPrivate, 'url_private')
      if (!urlValidation.isValid) {
        logger.warn('Slack file url_private failed DNS validation, skipping', {
          fileId: file.id,
          error: urlValidation.error,
        })
        continue
      }

      const response = await secureFetchWithPinnedIP(urlPrivate, urlValidation.resolvedIP!, {
        headers: { Authorization: `Bearer ${botToken}` },
      })

      if (!response.ok) {
        logger.warn('Failed to download Slack file, skipping', {
          fileId: file.id,
          status: response.status,
        })
        continue
      }

      const arrayBuffer = await response.arrayBuffer()
      const buffer = Buffer.from(arrayBuffer)

      if (buffer.length > SLACK_MAX_FILE_SIZE) {
        logger.warn('Downloaded Slack file exceeds size limit, skipping', {
          fileId: file.id,
          actualSize: buffer.length,
          limit: SLACK_MAX_FILE_SIZE,
        })
        continue
      }

      downloaded.push({
        name: (file.name as string) || 'download',
        data: buffer.toString('base64'),
        mimeType: (file.mimetype as string) || 'application/octet-stream',
        size: buffer.length,
      })
    } catch (error) {
      logger.error('Error downloading Slack file, skipping', {
        fileId: file.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return downloaded
}

/**
 * Format Microsoft Teams Graph change notification.
 * Extracts chatId/messageId from the Graph notification resource, fetches
 * the full message via Graph API, and downloads any SharePoint/OneDrive
 * attachments using secure fetch.
 */
async function formatTeamsGraphNotification(
  body: Record<string, unknown>,
  foundWebhook: Record<string, unknown>,
  _foundWorkflow: Record<string, unknown>,
  _request: Request
): Promise<Record<string, unknown> | null> {
  const value = body.value as Array<Record<string, unknown>> | undefined
  const notification = value?.[0]
  if (!notification) {
    logger.warn('Received empty Teams notification body')
    return null
  }

  const changeType = (notification.changeType as string) || 'created'
  const resource = (notification.resource as string) || ''
  const subscriptionId = (notification.subscriptionId as string) || ''

  let chatId: string | null = null
  let messageId: string | null = null

  // Try standard path format
  const fullMatch = resource.match(/chats\/([^/]+)\/messages\/([^/]+)/)
  if (fullMatch) {
    chatId = fullMatch[1]
    messageId = fullMatch[2]
  }

  // Try quoted path format
  if (!chatId || !messageId) {
    const quotedMatch = resource.match(/chats\('([^']+)'\)\/messages\('([^']+)'\)/)
    if (quotedMatch) {
      chatId = quotedMatch[1]
      messageId = quotedMatch[2]
    }
  }

  // Try collection match with resourceData id
  if (!chatId || !messageId) {
    const collectionMatch = resource.match(/chats\/([^/]+)\/messages$/)
    const rdId = (value?.[0] as Record<string, unknown>)?.resourceData as
      | Record<string, unknown>
      | undefined
    if (collectionMatch && rdId?.id) {
      chatId = collectionMatch[1]
      messageId = rdId.id as string
    }
  }

  // Try @odata.id fallback
  if (!chatId || !messageId) {
    const resourceData = (value?.[0] as Record<string, unknown>)?.resourceData as
      | Record<string, unknown>
      | undefined
    const odataId = resourceData?.['@odata.id'] as string | undefined
    if (odataId) {
      const odataMatch = String(odataId).match(/chats\('([^']+)'\)\/messages\('([^']+)'\)/)
      if (odataMatch) {
        chatId = odataMatch[1]
        messageId = odataMatch[2]
      }
    }
  }

  if (!chatId || !messageId) {
    logger.warn('Could not resolve chatId/messageId from Teams notification', {
      resource,
      hasResourceDataId: Boolean(
        ((value?.[0] as Record<string, unknown>)?.resourceData as Record<string, unknown>)?.id
      ),
      valueLength: Array.isArray(value) ? value.length : 0,
      keys: Object.keys(body || {}),
    })
    return {
      from: null,
      message: { raw: body },
      activity: body,
      conversation: null,
    }
  }

  const resolvedChatId = chatId
  const resolvedMessageId = messageId
  const providerConfig = (foundWebhook?.providerConfig as Record<string, unknown>) || {}
  const credentialId = providerConfig.credentialId as string | undefined
  const includeAttachments = providerConfig.includeAttachments !== false

  let message: Record<string, unknown> | null = null
  const rawAttachments: Array<{ name: string; data: Buffer; contentType: string; size: number }> =
    []
  let accessToken: string | null = null

  if (!credentialId) {
    logger.error('Missing credentialId for Teams chat subscription', {
      chatId: resolvedChatId,
      messageId: resolvedMessageId,
      webhookId: (foundWebhook as Record<string, unknown>)?.id,
      blockId: (foundWebhook as Record<string, unknown>)?.blockId,
      providerConfig,
    })
  } else {
    try {
      const rows = await db
        .select()
        .from(account)
        .where(eq(account.id, credentialId))
        .limit(1)
      if (rows.length === 0) {
        logger.error('Teams credential not found', {
          credentialId,
          chatId: resolvedChatId,
        })
      } else {
        const effectiveUserId = rows[0].userId
        accessToken = await refreshAccessTokenIfNeeded(
          credentialId,
          effectiveUserId,
          'teams-graph-notification'
        )
      }

      if (accessToken) {
        const msgUrl = `https://graph.microsoft.com/v1.0/chats/${encodeURIComponent(resolvedChatId)}/messages/${encodeURIComponent(resolvedMessageId)}`
        const res = await fetch(msgUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        })
        if (res.ok) {
          message = (await res.json()) as Record<string, unknown>

          const msgAttachments = message?.attachments as
            | Array<Record<string, unknown>>
            | undefined
          if (includeAttachments && msgAttachments && msgAttachments.length > 0) {
            for (const att of msgAttachments) {
              try {
                const contentUrl =
                  typeof att?.contentUrl === 'string' ? (att.contentUrl as string) : undefined
                const contentTypeHint =
                  typeof att?.contentType === 'string' ? (att.contentType as string) : undefined
                let attachmentName = (att?.name as string) || 'teams-attachment'

                if (!contentUrl) continue

                let buffer: Buffer | null = null
                let mimeType = 'application/octet-stream'

                if (
                  contentUrl.includes('sharepoint.com') ||
                  contentUrl.includes('onedrive')
                ) {
                  try {
                    const directRes = await fetchWithDNSPinning(
                      contentUrl,
                      accessToken,
                      'teams-attachment'
                    )

                    if (directRes?.ok) {
                      const arrayBuffer = await directRes.arrayBuffer()
                      buffer = Buffer.from(arrayBuffer)
                      mimeType =
                        directRes.headers.get('content-type') ||
                        contentTypeHint ||
                        'application/octet-stream'
                    } else if (directRes) {
                      const encodedUrl = Buffer.from(contentUrl)
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')

                      const graphUrl = `https://graph.microsoft.com/v1.0/shares/u!${encodedUrl}/driveItem/content`
                      const graphRes = await fetch(graphUrl, {
                        headers: { Authorization: `Bearer ${accessToken}` },
                        redirect: 'follow',
                      })

                      if (graphRes.ok) {
                        const arrayBuffer = await graphRes.arrayBuffer()
                        buffer = Buffer.from(arrayBuffer)
                        mimeType =
                          graphRes.headers.get('content-type') ||
                          contentTypeHint ||
                          'application/octet-stream'
                      } else {
                        continue
                      }
                    }
                  } catch {
                    continue
                  }
                } else if (
                  contentUrl.includes('1drv.ms') ||
                  contentUrl.includes('onedrive.live.com') ||
                  contentUrl.includes('onedrive.com') ||
                  contentUrl.includes('my.microsoftpersonalcontent.com')
                ) {
                  try {
                    let shareToken: string | null = null

                    if (contentUrl.includes('1drv.ms')) {
                      const urlParts = contentUrl.split('/').pop()
                      if (urlParts) shareToken = urlParts
                    } else if (contentUrl.includes('resid=')) {
                      const urlParams = new URL(contentUrl).searchParams
                      const resId = urlParams.get('resid')
                      if (resId) shareToken = resId
                    }

                    if (!shareToken) {
                      const base64Url = Buffer.from(contentUrl, 'utf-8')
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')
                      shareToken = `u!${base64Url}`
                    } else if (!shareToken.startsWith('u!')) {
                      const base64Url = Buffer.from(shareToken, 'utf-8')
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=+$/, '')
                      shareToken = `u!${base64Url}`
                    }

                    const metadataUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem`
                    const metadataRes = await fetch(metadataUrl, {
                      headers: {
                        Authorization: `Bearer ${accessToken}`,
                        Accept: 'application/json',
                      },
                    })

                    if (!metadataRes.ok) {
                      const directUrl = `https://graph.microsoft.com/v1.0/shares/${shareToken}/driveItem/content`
                      const directRes = await fetch(directUrl, {
                        headers: { Authorization: `Bearer ${accessToken}` },
                        redirect: 'follow',
                      })

                      if (directRes.ok) {
                        const arrayBuffer = await directRes.arrayBuffer()
                        buffer = Buffer.from(arrayBuffer)
                        mimeType =
                          directRes.headers.get('content-type') ||
                          contentTypeHint ||
                          'application/octet-stream'
                      } else {
                        continue
                      }
                    } else {
                      const metadata = (await metadataRes.json()) as Record<string, unknown>
                      const downloadUrl = metadata['@microsoft.graph.downloadUrl'] as
                        | string
                        | undefined

                      if (downloadUrl) {
                        const downloadRes = await fetchWithDNSPinning(
                          downloadUrl,
                          '',
                          'teams-onedrive-download'
                        )

                        if (downloadRes?.ok) {
                          const arrayBuffer = await downloadRes.arrayBuffer()
                          buffer = Buffer.from(arrayBuffer)
                          const fileMeta = metadata.file as
                            | Record<string, unknown>
                            | undefined
                          mimeType =
                            downloadRes.headers.get('content-type') ||
                            (fileMeta?.mimeType as string) ||
                            contentTypeHint ||
                            'application/octet-stream'

                          if (
                            metadata.name &&
                            (metadata.name as string) !== attachmentName
                          ) {
                            attachmentName = metadata.name as string
                          }
                        } else {
                          continue
                        }
                      } else {
                        continue
                      }
                    }
                  } catch {
                    continue
                  }
                } else {
                  try {
                    const ares = await fetchWithDNSPinning(
                      contentUrl,
                      accessToken,
                      'teams-attachment-generic'
                    )
                    if (ares?.ok) {
                      const arrayBuffer = await ares.arrayBuffer()
                      buffer = Buffer.from(arrayBuffer)
                      mimeType =
                        ares.headers.get('content-type') ||
                        contentTypeHint ||
                        'application/octet-stream'
                    }
                  } catch {
                    continue
                  }
                }

                if (!buffer) continue

                const size = buffer.length

                rawAttachments.push({
                  name: attachmentName,
                  data: buffer,
                  contentType: mimeType,
                  size,
                })
              } catch {
                // Skip attachment on unexpected error
              }
            }
          }
        }
      }
    } catch (error) {
      logger.error('Failed to fetch Teams message', {
        error,
        chatId: resolvedChatId,
        messageId: resolvedMessageId,
      })
    }
  }

  if (!message) {
    logger.warn('No message data available for Teams notification', {
      chatId: resolvedChatId,
      messageId: resolvedMessageId,
      hasCredential: !!credentialId,
    })
    return {
      message_id: resolvedMessageId,
      chat_id: resolvedChatId,
      from_name: '',
      text: '',
      created_at: '',
      attachments: [],
    }
  }

  const body_ = message.body as Record<string, unknown> | undefined
  const messageText = (body_?.content as string) || ''
  const from = (message.from as Record<string, unknown>)?.user as
    | Record<string, unknown>
    | undefined
  const createdAt = (message.createdDateTime as string) || ''

  return {
    message_id: resolvedMessageId,
    chat_id: resolvedChatId,
    from_name: (from?.displayName as string) || '',
    text: messageText,
    created_at: createdAt,
    attachments: rawAttachments,
  }
}

// ---------------------------------------------------------------------------
// formatWebhookInput
// ---------------------------------------------------------------------------

/**
 * Formats webhook input based on the provider type.
 * Normalizes each provider's raw payload into a consistent shape
 * consumable by the workflow execution engine.
 */
export async function formatWebhookInput(
  foundWebhook: Record<string, unknown>,
  foundWorkflow: Record<string, unknown>,
  body: Record<string, unknown>,
  request: Request
): Promise<unknown> {
  if (foundWebhook.provider === 'whatsapp') {
    const entry = body?.entry as Array<Record<string, unknown>> | undefined
    const data = (entry?.[0]?.changes as Array<Record<string, unknown>>)?.[0]?.value as
      | Record<string, unknown>
      | undefined
    const messages = (data?.messages as Array<Record<string, unknown>>) || []

    if (messages.length > 0) {
      const message = messages[0]
      const metadata = data?.metadata as Record<string, unknown> | undefined
      const textObj = message.text as Record<string, unknown> | undefined
      return {
        messageId: message.id,
        from: message.from,
        phoneNumberId: metadata?.phone_number_id,
        text: textObj?.body,
        timestamp: message.timestamp,
        raw: JSON.stringify(message),
      }
    }
    return null
  }

  if (foundWebhook.provider === 'telegram') {
    const rawMessage =
      (body?.message as Record<string, unknown>) ||
      (body?.edited_message as Record<string, unknown>) ||
      (body?.channel_post as Record<string, unknown>) ||
      (body?.edited_channel_post as Record<string, unknown>)

    const updateType = body.message
      ? 'message'
      : body.edited_message
        ? 'edited_message'
        : body.channel_post
          ? 'channel_post'
          : body.edited_channel_post
            ? 'edited_channel_post'
            : 'unknown'

    if (rawMessage) {
      const messageType = rawMessage.photo
        ? 'photo'
        : rawMessage.document
          ? 'document'
          : rawMessage.audio
            ? 'audio'
            : rawMessage.video
              ? 'video'
              : rawMessage.voice
                ? 'voice'
                : rawMessage.sticker
                  ? 'sticker'
                  : rawMessage.location
                    ? 'location'
                    : rawMessage.contact
                      ? 'contact'
                      : rawMessage.poll
                        ? 'poll'
                        : 'text'

      const fromObj = rawMessage.from as Record<string, unknown> | undefined

      return {
        message: {
          id: rawMessage.message_id,
          text: rawMessage.text,
          date: rawMessage.date,
          messageType,
          raw: rawMessage,
        },
        sender: fromObj
          ? {
              id: fromObj.id,
              username: fromObj.username,
              firstName: fromObj.first_name,
              lastName: fromObj.last_name,
              languageCode: fromObj.language_code,
              isBot: fromObj.is_bot,
            }
          : null,
        updateId: body.update_id,
        updateType,
      }
    }

    logger.warn('Unknown Telegram update type', {
      updateId: body.update_id,
      bodyKeys: Object.keys(body || {}),
    })

    return {
      updateId: body.update_id,
      updateType,
    }
  }

  if (foundWebhook.provider === 'twilio_voice') {
    return {
      callSid: body.CallSid,
      accountSid: body.AccountSid,
      from: body.From,
      to: body.To,
      callStatus: body.CallStatus,
      direction: body.Direction,
      apiVersion: body.ApiVersion,
      callerName: body.CallerName,
      forwardedFrom: body.ForwardedFrom,
      digits: body.Digits,
      speechResult: body.SpeechResult,
      recordingUrl: body.RecordingUrl,
      recordingSid: body.RecordingSid,
      called: body.Called,
      caller: body.Caller,
      toCity: body.ToCity,
      toState: body.ToState,
      toZip: body.ToZip,
      toCountry: body.ToCountry,
      fromCity: body.FromCity,
      fromState: body.FromState,
      fromZip: body.FromZip,
      fromCountry: body.FromCountry,
      calledCity: body.CalledCity,
      calledState: body.CalledState,
      calledZip: body.CalledZip,
      calledCountry: body.CalledCountry,
      callerCity: body.CallerCity,
      callerState: body.CallerState,
      callerZip: body.CallerZip,
      callerCountry: body.CallerCountry,
      callToken: body.CallToken,
      raw: JSON.stringify(body),
    }
  }

  if (foundWebhook.provider === 'gmail') {
    if (body && typeof body === 'object' && 'email' in body) {
      return {
        email: body.email,
        timestamp: body.timestamp,
      }
    }
    return body
  }

  if (foundWebhook.provider === 'outlook') {
    if (body && typeof body === 'object' && 'email' in body) {
      return {
        email: body.email,
        timestamp: body.timestamp,
      }
    }
    return body
  }

  if (foundWebhook.provider === 'rss') {
    if (body && typeof body === 'object' && 'item' in body) {
      return {
        title: body.title,
        link: body.link,
        pubDate: body.pubDate,
        item: body.item,
        feed: body.feed,
        timestamp: body.timestamp,
      }
    }
    return body
  }

  if (foundWebhook.provider === 'imap') {
    if (body && typeof body === 'object' && 'email' in body) {
      return {
        messageId: body.messageId,
        subject: body.subject,
        from: body.from,
        to: body.to,
        cc: body.cc,
        date: body.date,
        bodyText: body.bodyText,
        bodyHtml: body.bodyHtml,
        mailbox: body.mailbox,
        hasAttachments: body.hasAttachments,
        attachments: body.attachments,
        email: body.email,
        timestamp: body.timestamp,
      }
    }
    return body
  }

  if (foundWebhook.provider === 'hubspot') {
    const events = Array.isArray(body) ? body : [body]
    const event = events[0]

    if (!event) {
      logger.warn('HubSpot webhook received with empty payload')
      return null
    }

    logger.info('Formatting HubSpot webhook input', {
      subscriptionType: event.subscriptionType,
      objectId: event.objectId,
      portalId: event.portalId,
    })

    return {
      payload: body,
      provider: 'hubspot',
      providerConfig: foundWebhook.providerConfig,
    }
  }

  if (foundWebhook.provider === 'microsoft-teams') {
    const bodyValue = body?.value
    if (bodyValue && Array.isArray(bodyValue) && bodyValue.length > 0) {
      return await formatTeamsGraphNotification(
        body,
        foundWebhook,
        foundWorkflow,
        request
      )
    }

    const messageText = (body?.text as string) || ''
    const messageId = (body?.id as string) || ''
    const timestamp = (body?.timestamp as string) || (body?.localTimestamp as string) || ''
    const from = (body?.from as Record<string, unknown>) || {}
    const conversation = (body?.conversation as Record<string, unknown>) || {}

    const messageObj = {
      raw: {
        attachments: body?.attachments || [],
        channelData: body?.channelData || {},
        conversation: body?.conversation || {},
        text: messageText,
        messageType: body?.type || 'message',
        channelId: body?.channelId || '',
        timestamp,
      },
    }

    const fromObj = {
      id: (from.id as string) || '',
      name: (from.name as string) || '',
      aadObjectId: (from.aadObjectId as string) || '',
    }

    const conversationObj = {
      id: (conversation.id as string) || '',
      name: (conversation.name as string) || '',
      isGroup: (conversation.isGroup as boolean) || false,
      tenantId: (conversation.tenantId as string) || '',
      aadObjectId: (conversation.aadObjectId as string) || '',
      conversationType: (conversation.conversationType as string) || '',
    }

    const activityObj = body || {}

    return {
      from: fromObj,
      message: messageObj,
      activity: activityObj,
      conversation: conversationObj,
    }
  }

  if (foundWebhook.provider === 'slack') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}
    const botToken = providerConfig.botToken as string | undefined
    const includeFiles = Boolean(providerConfig.includeFiles)

    const rawEvent = body?.event as Record<string, unknown> | undefined

    if (!rawEvent) {
      logger.warn('Unknown Slack event type', {
        type: body?.type,
        hasEvent: false,
        bodyKeys: Object.keys(body || {}),
      })
    }

    const rawFiles: unknown[] = (rawEvent?.files as unknown[]) ?? []
    const hasFiles = rawFiles.length > 0

    let files: Array<{ name: string; data: string; mimeType: string; size: number }> = []
    if (hasFiles && includeFiles && botToken) {
      files = await downloadSlackFiles(rawFiles, botToken)
    } else if (hasFiles && includeFiles && !botToken) {
      logger.warn(
        'Slack message has files and includeFiles is enabled, but no bot token provided'
      )
    }

    return {
      event: {
        event_type: (rawEvent?.type as string) || (body?.type as string) || 'unknown',
        channel: (rawEvent?.channel as string) || '',
        channel_name: '',
        user: (rawEvent?.user as string) || '',
        user_name: '',
        text: (rawEvent?.text as string) || '',
        timestamp: (rawEvent?.ts as string) || (rawEvent?.event_ts as string) || '',
        thread_ts: (rawEvent?.thread_ts as string) || '',
        team_id: (body?.team_id as string) || (rawEvent?.team as string) || '',
        event_id: (body?.event_id as string) || '',
        hasFiles,
        files,
      },
    }
  }

  if (foundWebhook.provider === 'webflow') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId === 'webflow_form_submission') {
      return {
        siteId: body?.siteId || '',
        formId: body?.formId || '',
        name: body?.name || '',
        id: body?.id || '',
        submittedAt: body?.submittedAt || '',
        data: body?.data || {},
        schema: body?.schema || {},
        formElementId: body?.formElementId || '',
      }
    }

    const { _cid, _id, ...itemFields } = body || {}
    return {
      siteId: body?.siteId || '',
      collectionId: _cid || body?.collectionId || '',
      payload: {
        id: _id || '',
        cmsLocaleId: (itemFields as Record<string, unknown>)?.cmsLocaleId || '',
        lastPublished:
          (itemFields as Record<string, unknown>)?.lastPublished ||
          (itemFields as Record<string, unknown>)?.['last-published'] ||
          '',
        lastUpdated:
          (itemFields as Record<string, unknown>)?.lastUpdated ||
          (itemFields as Record<string, unknown>)?.['last-updated'] ||
          '',
        createdOn:
          (itemFields as Record<string, unknown>)?.createdOn ||
          (itemFields as Record<string, unknown>)?.['created-on'] ||
          '',
        isArchived:
          (itemFields as Record<string, unknown>)?.isArchived ||
          (itemFields as Record<string, unknown>)?._archived ||
          false,
        isDraft:
          (itemFields as Record<string, unknown>)?.isDraft ||
          (itemFields as Record<string, unknown>)?._draft ||
          false,
        fieldData: itemFields,
      },
    }
  }

  if (foundWebhook.provider === 'generic') {
    return body
  }

  if (foundWebhook.provider === 'google_forms') {
    const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}

    const normalizeAnswers = (src: unknown): Record<string, unknown> => {
      if (!src || typeof src !== 'object') return {}
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
        if (Array.isArray(v)) {
          out[k] = v.length === 1 ? v[0] : v
        } else {
          out[k] = v
        }
      }
      return out
    }

    const responseId = (body?.responseId as string) || (body?.id as string) || ''
    const createTime =
      (body?.createTime as string) || (body?.timestamp as string) || new Date().toISOString()
    const lastSubmittedTime = (body?.lastSubmittedTime as string) || createTime
    const formId = (body?.formId as string) || (providerConfig.formId as string) || ''
    const includeRaw = providerConfig.includeRawPayload !== false

    return {
      responseId,
      createTime,
      lastSubmittedTime,
      formId,
      answers: normalizeAnswers(body?.answers),
      ...(includeRaw ? { raw: body?.raw ?? body } : {}),
    }
  }

  if (foundWebhook.provider === 'github') {
    const eventType = request.headers.get('x-github-event') || 'unknown'
    const ref = body?.ref as string | undefined
    const branch = ref?.replace('refs/heads/', '') || ''

    return {
      ...body,
      event_type: eventType,
      action: body?.action || '',
      branch,
    }
  }

  if (foundWebhook.provider === 'typeform') {
    const formResponse = (body?.form_response as Record<string, unknown>) || {}
    const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}
    const includeDefinition = providerConfig.includeDefinition === true

    return {
      event_id: body?.event_id || '',
      event_type: body?.event_type || 'form_response',
      form_id: formResponse.form_id || '',
      token: formResponse.token || '',
      submitted_at: formResponse.submitted_at || '',
      landed_at: formResponse.landed_at || '',
      calculated: formResponse.calculated || {},
      variables: formResponse.variables || [],
      hidden: formResponse.hidden || {},
      answers: formResponse.answers || [],
      ...(includeDefinition ? { definition: formResponse.definition || {} } : {}),
      ending: formResponse.ending || {},
      raw: body,
    }
  }

  if (foundWebhook.provider === 'linear') {
    return {
      action: body.action || '',
      type: body.type || '',
      webhookId: body.webhookId || '',
      webhookTimestamp: body.webhookTimestamp || 0,
      organizationId: body.organizationId || '',
      createdAt: body.createdAt || '',
      actor: body.actor || null,
      data: body.data || null,
      updatedFrom: body.updatedFrom || null,
    }
  }

  if (foundWebhook.provider === 'jira') {
    const { extractIssueData, extractCommentData, extractWorklogData } = await import(
      '@/triggers/jira/utils'
    )

    const providerConfig = (foundWebhook.providerConfig as Record<string, unknown>) || {}
    const triggerId = providerConfig.triggerId as string | undefined

    if (triggerId === 'jira_issue_commented') {
      return extractCommentData(body)
    }
    if (triggerId === 'jira_worklog_created') {
      return extractWorklogData(body)
    }
    return extractIssueData(body)
  }

  if (foundWebhook.provider === 'stripe') {
    return body
  }

  if (foundWebhook.provider === 'calendly') {
    return {
      event: body.event,
      created_at: body.created_at,
      created_by: body.created_by,
      payload: body.payload,
    }
  }

  if (foundWebhook.provider === 'circleback') {
    return {
      id: body.id,
      name: body.name,
      createdAt: body.createdAt,
      duration: body.duration,
      url: body.url,
      recordingUrl: body.recordingUrl,
      tags: body.tags || [],
      icalUid: body.icalUid,
      attendees: body.attendees || [],
      notes: body.notes || '',
      actionItems: body.actionItems || [],
      transcript: body.transcript || [],
      insights: body.insights || {},
      meeting: body,
    }
  }

  if (foundWebhook.provider === 'grain') {
    return {
      type: body.type,
      user_id: body.user_id,
      data: body.data || {},
    }
  }

  if (foundWebhook.provider === 'fireflies') {
    return {
      meetingId: body.meetingId || '',
      eventType: body.eventType || 'Transcription completed',
      clientReferenceId: body.clientReferenceId || '',
    }
  }

  // Default: return body as-is
  return body
}

// ---------------------------------------------------------------------------
// fetchAndProcessAirtablePayloads
// ---------------------------------------------------------------------------

/**
 * Processes Airtable webhook payloads with cursor-based polling.
 *
 * 1. Retrieves a valid access token via refreshAccessTokenIfNeeded.
 * 2. Polls Airtable's /payloads endpoint using cursor-based pagination.
 * 3. Consolidates created/updated records into a de-duplicated change map.
 * 4. Persists the latest cursor to the DB after each batch.
 * 5. Returns the processed input for downstream workflow execution.
 *
 * Max 10 API calls per invocation to prevent runaway loops.
 */
export async function fetchAndProcessAirtablePayloads(
  webhookData: Record<string, unknown>,
  workflowData: Record<string, unknown>,
  requestId: string
): Promise<unknown> {
  let currentCursor: number | null = null
  let mightHaveMore = true
  let payloadsFetched = 0
  let apiCallCount = 0
  const consolidatedChangesMap = new Map<string, AirtableChange>()
  const allPayloads: Array<Record<string, unknown>> = []
  const localProviderConfig = {
    ...((webhookData.providerConfig as Record<string, unknown>) || {}),
  }

  try {
    const baseId = localProviderConfig.baseId as string | undefined
    const airtableWebhookId = localProviderConfig.externalId as string | undefined

    if (!baseId || !airtableWebhookId) {
      logger.error(
        `[${requestId}] Missing baseId or externalId in providerConfig for webhook ${webhookData.id}. Cannot fetch payloads.`
      )
      return
    }

    const credentialId = localProviderConfig.credentialId as string | undefined
    if (!credentialId) {
      logger.error(
        `[${requestId}] Missing credentialId in providerConfig for Airtable webhook ${webhookData.id}.`
      )
      return
    }

    let ownerUserId: string | null = null
    try {
      const rows = await db
        .select()
        .from(account)
        .where(eq(account.id, credentialId))
        .limit(1)
      ownerUserId = rows.length ? rows[0].userId : null
    } catch {
      ownerUserId = null
    }

    if (!ownerUserId) {
      logger.error(
        `[${requestId}] Could not resolve owner for Airtable credential ${credentialId} on webhook ${webhookData.id}`
      )
      return
    }

    const storedCursor = localProviderConfig.externalWebhookCursor

    if (storedCursor === undefined || storedCursor === null) {
      logger.info(
        `[${requestId}] No cursor found in providerConfig for webhook ${webhookData.id}, initializing...`
      )
      localProviderConfig.externalWebhookCursor = null

      try {
        await db
          .update(webhook)
          .set({
            providerConfig: {
              ...localProviderConfig,
              externalWebhookCursor: null,
            },
            updatedAt: new Date(),
          })
          .where(eq(webhook.id, webhookData.id as string))

        localProviderConfig.externalWebhookCursor = null
        logger.info(
          `[${requestId}] Successfully initialized cursor for webhook ${webhookData.id}`
        )
      } catch (initError: unknown) {
        const errMsg =
          initError instanceof Error ? initError.message : String(initError)
        logger.error(`[${requestId}] Failed to initialize cursor in DB`, {
          webhookId: webhookData.id,
          error: errMsg,
        })
      }
    }

    if (storedCursor && typeof storedCursor === 'number') {
      currentCursor = storedCursor
      logger.debug(
        `[${requestId}] Using stored cursor: ${currentCursor} for webhook ${webhookData.id}`
      )
    } else {
      currentCursor = null
      logger.debug(
        `[${requestId}] No valid stored cursor for webhook ${webhookData.id}, starting from beginning`
      )
    }

    let accessToken: string | null = null
    try {
      accessToken = await refreshAccessTokenIfNeeded(credentialId, ownerUserId, requestId)
      if (!accessToken) {
        logger.error(
          `[${requestId}] Failed to obtain valid Airtable access token via credential ${credentialId}.`
        )
        throw new Error('Airtable access token not found.')
      }

      logger.info(`[${requestId}] Successfully obtained Airtable access token`)
    } catch (tokenError: unknown) {
      const errMsg =
        tokenError instanceof Error ? tokenError.message : String(tokenError)
      logger.error(
        `[${requestId}] Failed to get Airtable OAuth token for credential ${credentialId}`,
        {
          error: errMsg,
          credentialId,
        }
      )
      return
    }

    const airtableApiBase = 'https://api.airtable.com/v0'

    // --- Polling Loop ---
    while (mightHaveMore) {
      apiCallCount++
      if (apiCallCount > 10) {
        logger.warn(`[${requestId}] Reached maximum polling limit (10 calls)`, {
          webhookId: webhookData.id,
          consolidatedCount: consolidatedChangesMap.size,
        })
        mightHaveMore = false
        break
      }

      const apiUrl = `${airtableApiBase}/bases/${baseId}/webhooks/${airtableWebhookId}/payloads`
      const queryParams = new URLSearchParams()
      if (currentCursor !== null) {
        queryParams.set('cursor', currentCursor.toString())
      }
      const fullUrl = `${apiUrl}?${queryParams.toString()}`

      logger.debug(`[${requestId}] Fetching Airtable payloads (call ${apiCallCount})`, {
        url: fullUrl,
        webhookId: webhookData.id,
      })

      try {
        const fetchStartTime = Date.now()
        const response = await fetch(fullUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        })

        logger.debug(`[${requestId}] TRACE: Airtable API response received`, {
          status: response.status,
          duration: `${Date.now() - fetchStartTime}ms`,
          hasBody: true,
          apiCall: apiCallCount,
        })

        const responseBody = (await response.json()) as Record<string, unknown>

        if (!response.ok || responseBody.error) {
          const errorObj = responseBody.error as Record<string, unknown> | string | undefined
          const errorMessage =
            (typeof errorObj === 'object' ? (errorObj?.message as string) : undefined) ||
            (typeof errorObj === 'string' ? errorObj : undefined) ||
            `Airtable API error Status ${response.status}`
          logger.error(
            `[${requestId}] Airtable API request to /payloads failed (Call ${apiCallCount})`,
            {
              webhookId: webhookData.id,
              status: response.status,
              error: errorMessage,
            }
          )
          mightHaveMore = false
          break
        }

        const receivedPayloads =
          (responseBody.payloads as Array<Record<string, unknown>>) || []
        logger.debug(
          `[${requestId}] Received ${receivedPayloads.length} payloads from Airtable (call ${apiCallCount})`
        )

        // --- Process and Consolidate Changes ---
        if (receivedPayloads.length > 0) {
          payloadsFetched += receivedPayloads.length
          for (const p of receivedPayloads) {
            allPayloads.push(p)
          }

          let changeCount = 0
          for (const payload of receivedPayloads) {
            const changedTablesById = payload.changedTablesById as
              | Record<string, Record<string, unknown>>
              | undefined
            if (changedTablesById) {
              const tableIds = Object.keys(changedTablesById)
              logger.debug(`[${requestId}] TRACE: Processing changes for tables`, {
                tables: tableIds,
                payloadTimestamp: payload.timestamp,
              })

              for (const [tableId, tableChangesUntyped] of Object.entries(
                changedTablesById
              )) {
                const tableChanges = tableChangesUntyped as Record<string, unknown>

                // Handle created records
                const createdRecordsById = tableChanges.createdRecordsById as
                  | Record<string, Record<string, unknown>>
                  | undefined
                if (createdRecordsById) {
                  const createdCount = Object.keys(createdRecordsById).length
                  changeCount += createdCount
                  logger.debug(
                    `[${requestId}] TRACE: Processing ${createdCount} created records for table ${tableId}`
                  )

                  for (const [recordId, recordDataUntyped] of Object.entries(
                    createdRecordsById
                  )) {
                    const recordData = recordDataUntyped as Record<string, unknown>
                    const existingChange = consolidatedChangesMap.get(recordId)
                    if (existingChange) {
                      existingChange.changedFields = {
                        ...existingChange.changedFields,
                        ...((recordData.cellValuesByFieldId as Record<string, unknown>) ||
                          {}),
                      }
                    } else {
                      consolidatedChangesMap.set(recordId, {
                        tableId,
                        recordId,
                        changeType: 'created',
                        changedFields:
                          (recordData.cellValuesByFieldId as Record<string, unknown>) || {},
                      })
                    }
                  }
                }

                // Handle updated records
                const changedRecordsById = tableChanges.changedRecordsById as
                  | Record<string, Record<string, unknown>>
                  | undefined
                if (changedRecordsById) {
                  const updatedCount = Object.keys(changedRecordsById).length
                  changeCount += updatedCount
                  logger.debug(
                    `[${requestId}] TRACE: Processing ${updatedCount} updated records for table ${tableId}`
                  )

                  for (const [recordId, recordDataUntyped] of Object.entries(
                    changedRecordsById
                  )) {
                    const recordData = recordDataUntyped as Record<string, unknown>
                    const existingChange = consolidatedChangesMap.get(recordId)
                    const currentRecord = recordData.current as
                      | Record<string, unknown>
                      | undefined
                    const currentFields =
                      (currentRecord?.cellValuesByFieldId as Record<string, unknown>) || {}

                    if (existingChange) {
                      existingChange.changedFields = {
                        ...existingChange.changedFields,
                        ...currentFields,
                      }
                      existingChange.changeType = 'updated'
                    } else {
                      const newChange: AirtableChange = {
                        tableId,
                        recordId,
                        changeType: 'updated',
                        changedFields: currentFields,
                      }
                      const previousRecord = recordData.previous as
                        | Record<string, unknown>
                        | undefined
                      if (previousRecord?.cellValuesByFieldId) {
                        newChange.previousFields =
                          previousRecord.cellValuesByFieldId as Record<string, unknown>
                      }
                      consolidatedChangesMap.set(recordId, newChange)
                    }
                  }
                }
              }
            }
          }

          logger.debug(
            `[${requestId}] TRACE: Processed ${changeCount} changes in API call ${apiCallCount})`,
            {
              currentMapSize: consolidatedChangesMap.size,
            }
          )
        }

        const nextCursor = responseBody.cursor as number | undefined
        mightHaveMore = (responseBody.mightHaveMore as boolean) || false

        if (nextCursor && typeof nextCursor === 'number' && nextCursor !== currentCursor) {
          logger.debug(
            `[${requestId}] Updating cursor from ${currentCursor} to ${nextCursor}`
          )
          currentCursor = nextCursor

          const updatedConfig = {
            ...localProviderConfig,
            externalWebhookCursor: currentCursor,
          }
          try {
            await db
              .update(webhook)
              .set({
                providerConfig: updatedConfig,
                updatedAt: new Date(),
              })
              .where(eq(webhook.id, webhookData.id as string))

            localProviderConfig.externalWebhookCursor = currentCursor
          } catch (dbError: unknown) {
            const errMsg =
              dbError instanceof Error ? dbError.message : String(dbError)
            logger.error(`[${requestId}] Failed to persist Airtable cursor to DB`, {
              webhookId: webhookData.id,
              cursor: currentCursor,
              error: errMsg,
            })
            mightHaveMore = false
            throw new Error(
              'Failed to save Airtable cursor, stopping processing.'
            )
          }
        } else if (!nextCursor || typeof nextCursor !== 'number') {
          logger.warn(
            `[${requestId}] Invalid or missing cursor received, stopping poll`,
            {
              webhookId: webhookData.id,
              apiCall: apiCallCount,
              receivedCursor: nextCursor,
            }
          )
          mightHaveMore = false
        } else if (nextCursor === currentCursor) {
          logger.debug(
            `[${requestId}] Cursor hasn't changed (${currentCursor}), stopping poll`
          )
          mightHaveMore = false
        }
      } catch (fetchError: unknown) {
        logger.error(
          `[${requestId}] Network error calling Airtable GET /payloads (Call ${apiCallCount}) for webhook ${webhookData.id}`,
          fetchError
        )
        mightHaveMore = false
        break
      }
    }
    // --- End Polling Loop ---

    const finalConsolidatedChanges = Array.from(consolidatedChangesMap.values())
    logger.info(
      `[${requestId}] Consolidated ${finalConsolidatedChanges.length} Airtable changes across ${apiCallCount} API calls`
    )

    if (finalConsolidatedChanges.length > 0 || allPayloads.length > 0) {
      try {
        const latestPayload =
          allPayloads.length > 0 ? allPayloads[allPayloads.length - 1] : null
        const input: Record<string, unknown> = {
          payloads: allPayloads,
          latestPayload,
          airtableChanges: finalConsolidatedChanges,
          webhook: {
            data: {
              provider: 'airtable',
              providerConfig: webhookData.providerConfig,
              payload: latestPayload,
            },
          },
        }

        logger.info(
          `[${requestId}] CRITICAL_TRACE: Beginning workflow execution with ${finalConsolidatedChanges.length} Airtable changes`,
          {
            workflowId: workflowData.id,
            recordCount: finalConsolidatedChanges.length,
            timestamp: new Date().toISOString(),
            firstRecordId: finalConsolidatedChanges[0]?.recordId || 'none',
          }
        )

        logger.info(
          `[${requestId}] CRITICAL_TRACE: Airtable changes processed, returning input`,
          {
            workflowId: workflowData.id,
            recordCount: finalConsolidatedChanges.length,
            rawPayloadCount: allPayloads.length,
            timestamp: new Date().toISOString(),
          }
        )

        return input
      } catch (processingError: unknown) {
        const errMsg =
          processingError instanceof Error
            ? processingError.message
            : String(processingError)
        logger.error(
          `[${requestId}] CRITICAL_TRACE: Error processing Airtable changes`,
          {
            workflowId: workflowData.id,
            error: errMsg,
            timestamp: new Date().toISOString(),
          }
        )

        throw processingError
      }
    } else {
      logger.info(`[${requestId}] TRACE: No Airtable changes to process`, {
        workflowId: workflowData.id,
        apiCallCount,
        webhookId: webhookData.id,
      })
    }
  } catch (error) {
    logger.error(
      `[${requestId}] Unexpected error during asynchronous Airtable payload processing task`,
      {
        webhookId: webhookData.id,
        workflowId: workflowData.id,
        error: (error as Error).message,
      }
    )
  }

  logger.debug(`[${requestId}] TRACE: fetchAndProcessAirtablePayloads completed`, {
    totalFetched: payloadsFetched,
    totalApiCalls: apiCallCount,
    totalChanges: consolidatedChangesMap.size,
    timestamp: new Date().toISOString(),
  })
}

// ---------------------------------------------------------------------------
// syncWebhooksForCredentialSet
// ---------------------------------------------------------------------------

/**
 * Sync webhooks for a credential set.
 *
 * For credential sets, one webhook is created per credential in the set.
 * Each webhook has its own state and credentialId.
 *
 * Path strategy:
 * - Polling triggers (gmail, outlook, rss, imap): unique paths per credential
 * - External webhook triggers (slack, etc.): shared path
 *
 * This function:
 * 1. Gets all credentials in the credential set
 * 2. Gets existing webhooks for this workflow+block with this credentialSetId
 * 3. Creates webhooks for new credentials
 * 4. Updates config for existing webhooks (preserving state)
 * 5. Deletes webhooks for credentials no longer in the set
 */
export async function syncWebhooksForCredentialSet(params: {
  workflowId: string
  blockId: string
  provider: string
  basePath: string
  credentialSetId: string
  oauthProviderId: string
  providerConfig: Record<string, unknown>
  requestId: string
  tx?: DbOrTx
  deploymentVersionId?: string
}): Promise<CredentialSetWebhookSyncResult> {
  const {
    workflowId,
    blockId,
    provider,
    basePath,
    credentialSetId,
    oauthProviderId,
    providerConfig,
    requestId,
    tx,
    deploymentVersionId,
  } = params

  const dbCtx = tx ?? db

  const syncLogger = createLogger('CredentialSetWebhookSync')
  syncLogger.info(
    `[${requestId}] Syncing webhooks for credential set ${credentialSetId}, provider ${provider}`
  )

  const pollingProviders = ['gmail', 'outlook', 'rss', 'imap']
  const useUniquePaths = pollingProviders.includes(provider)

  const credentials = await getCredentialsForCredentialSet(credentialSetId, oauthProviderId)

  if (credentials.length === 0) {
    syncLogger.warn(
      `[${requestId}] No credentials found in credential set ${credentialSetId} for provider ${oauthProviderId}`
    )
    return { webhooks: [], created: 0, updated: 0, deleted: 0, failed: [] }
  }

  syncLogger.info(
    `[${requestId}] Found ${credentials.length} credentials in set ${credentialSetId}`
  )

  // Get existing webhooks for this workflow+block
  const existingWebhooks = await dbCtx
    .select()
    .from(webhook)
    .where(
      deploymentVersionId
        ? and(
            eq(webhook.workflowId, workflowId),
            eq(webhook.blockId, blockId),
            eq(webhook.deploymentVersionId, deploymentVersionId)
          )
        : and(eq(webhook.workflowId, workflowId), eq(webhook.blockId, blockId))
    )

  // Filter to only webhooks belonging to this credential set
  const credentialSetWebhooks = existingWebhooks.filter(
    (wh) => wh.credentialSetId === credentialSetId
  )

  syncLogger.info(
    `[${requestId}] Found ${credentialSetWebhooks.length} existing webhooks for credential set`
  )

  // Build maps for efficient lookup
  const existingByCredentialId = new Map<string, (typeof credentialSetWebhooks)[number]>()
  for (const wh of credentialSetWebhooks) {
    const config = wh.providerConfig as Record<string, unknown>
    if (config?.credentialId) {
      existingByCredentialId.set(config.credentialId as string, wh)
    }
  }

  const credentialIdsInSet = new Set(credentials.map((c) => c.credentialId))

  const result: CredentialSetWebhookSyncResult = {
    webhooks: [],
    created: 0,
    updated: 0,
    deleted: 0,
    failed: [],
  }

  // Process each credential in the set
  for (const cred of credentials) {
    try {
      const existingWebhook = existingByCredentialId.get(cred.credentialId)

      if (existingWebhook) {
        // Update existing webhook - preserve state fields
        const existingConfig = existingWebhook.providerConfig as Record<string, unknown>

        const updatedConfig = {
          ...providerConfig,
          basePath,
          credentialId: cred.credentialId,
          credentialSetId,
          historyId: existingConfig?.historyId,
          lastCheckedTimestamp: existingConfig?.lastCheckedTimestamp,
          setupCompleted: existingConfig?.setupCompleted,
          externalId: existingConfig?.externalId,
          userId: cred.userId,
        }

        await dbCtx
          .update(webhook)
          .set({
            ...(deploymentVersionId ? { deploymentVersionId } : {}),
            providerConfig: updatedConfig,
            isActive: true,
            updatedAt: new Date(),
          })
          .where(eq(webhook.id, existingWebhook.id))

        result.webhooks.push({
          id: existingWebhook.id,
          credentialId: cred.credentialId,
          isNew: false,
        })
        result.updated++

        syncLogger.debug(
          `[${requestId}] Updated webhook ${existingWebhook.id} for credential ${cred.credentialId}`
        )
      } else {
        // Create new webhook for this credential
        const webhookId = nanoid()
        const webhookPath = useUniquePaths
          ? `${basePath}-${cred.credentialId.slice(0, 8)}`
          : basePath

        const newConfig = {
          ...providerConfig,
          basePath,
          credentialId: cred.credentialId,
          credentialSetId,
          userId: cred.userId,
        }

        await dbCtx.insert(webhook).values({
          id: webhookId,
          workflowId,
          blockId,
          path: webhookPath,
          provider,
          providerConfig: newConfig,
          credentialSetId,
          isActive: true,
          ...(deploymentVersionId ? { deploymentVersionId } : {}),
          createdAt: new Date(),
          updatedAt: new Date(),
        })

        result.webhooks.push({
          id: webhookId,
          credentialId: cred.credentialId,
          isNew: true,
        })
        result.created++

        syncLogger.debug(
          `[${requestId}] Created webhook ${webhookId} for credential ${cred.credentialId}`
        )
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      syncLogger.error(
        `[${requestId}] Failed to sync webhook for credential ${cred.credentialId}: ${errorMessage}`
      )
      result.failed.push({
        credentialId: cred.credentialId,
        error: errorMessage,
      })
    }
  }

  // Delete webhooks for credentials no longer in the set
  for (const [credentialId, existingWebhook] of existingByCredentialId) {
    if (!credentialIdsInSet.has(credentialId)) {
      try {
        await dbCtx.delete(webhook).where(eq(webhook.id, existingWebhook.id))
        result.deleted++

        syncLogger.debug(
          `[${requestId}] Deleted webhook ${existingWebhook.id} for removed credential ${credentialId}`
        )
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        syncLogger.error(
          `[${requestId}] Failed to delete webhook ${existingWebhook.id} for credential ${credentialId}: ${errorMessage}`
        )
        result.failed.push({
          credentialId,
          error: `Failed to delete: ${errorMessage}`,
        })
      }
    }
  }

  syncLogger.info(
    `[${requestId}] Credential set webhook sync complete: ${result.created} created, ${result.updated} updated, ${result.deleted} deleted, ${result.failed.length} failed`
  )

  return result
}

// ---------------------------------------------------------------------------
// syncAllWebhooksForCredentialSet
// ---------------------------------------------------------------------------

/**
 * Sync all webhooks that use a specific credential set.
 * Called when credential set membership changes (member added/removed).
 *
 * This finds all workflows with webhooks using this credential set and resyncs them.
 */
export async function syncAllWebhooksForCredentialSet(
  credentialSetId: string,
  requestId: string,
  tx?: DbOrTx
): Promise<{ workflowsUpdated: number; totalCreated: number; totalDeleted: number }> {
  const dbCtx = tx ?? db
  const syncLogger = createLogger('CredentialSetMembershipSync')
  syncLogger.info(
    `[${requestId}] Syncing all webhooks for credential set ${credentialSetId}`
  )

  // Find all webhooks that use this credential set via the indexed column
  const webhooksForSet = await dbCtx
    .select({ webhook })
    .from(webhook)
    .leftJoin(
      workflowDeploymentVersion,
      and(
        eq(workflowDeploymentVersion.workflowId, webhook.workflowId),
        eq(workflowDeploymentVersion.isActive, true)
      )
    )
    .where(
      and(
        eq(webhook.credentialSetId, credentialSetId),
        or(
          eq(webhook.deploymentVersionId, workflowDeploymentVersion.id),
          and(
            isNull(workflowDeploymentVersion.id),
            isNull(webhook.deploymentVersionId)
          )
        )
      )
    )

  if (webhooksForSet.length === 0) {
    syncLogger.info(
      `[${requestId}] No webhooks found using credential set ${credentialSetId}`
    )
    return { workflowsUpdated: 0, totalCreated: 0, totalDeleted: 0 }
  }

  // Group webhooks by workflow+block to find unique triggers
  const triggerGroups = new Map<string, (typeof webhooksForSet)[number]['webhook']>()
  for (const row of webhooksForSet) {
    const wh = row.webhook
    const key = `${wh.workflowId}:${wh.blockId}`
    if (!triggerGroups.has(key)) {
      triggerGroups.set(key, wh)
    }
  }

  syncLogger.info(
    `[${requestId}] Found ${triggerGroups.size} triggers using credential set ${credentialSetId}`
  )

  let workflowsUpdated = 0
  let totalCreated = 0
  let totalDeleted = 0

  for (const [key, representativeWebhook] of triggerGroups) {
    if (!representativeWebhook.provider) {
      syncLogger.warn(`[${requestId}] Skipping webhook without provider: ${key}`)
      continue
    }

    const config = representativeWebhook.providerConfig as Record<string, unknown>
    const oauthProviderId = getProviderIdFromServiceId(representativeWebhook.provider)

    const {
      credentialId: _cId,
      userId: _uId,
      basePath: _bp,
      ...baseConfig
    } = config
    const basePath =
      (config.basePath as string) ||
      representativeWebhook.blockId ||
      representativeWebhook.path

    try {
      const syncResult = await syncWebhooksForCredentialSet({
        workflowId: representativeWebhook.workflowId,
        blockId: representativeWebhook.blockId || '',
        provider: representativeWebhook.provider,
        basePath,
        credentialSetId,
        oauthProviderId,
        providerConfig: baseConfig as Record<string, unknown>,
        requestId,
        tx: dbCtx,
        deploymentVersionId: representativeWebhook.deploymentVersionId || undefined,
      })

      workflowsUpdated++
      totalCreated += syncResult.created
      totalDeleted += syncResult.deleted

      syncLogger.debug(
        `[${requestId}] Synced webhooks for ${key}: ${syncResult.created} created, ${syncResult.deleted} deleted`
      )
    } catch (error) {
      syncLogger.error(`[${requestId}] Error syncing webhooks for ${key}`, error)
    }
  }

  syncLogger.info(
    `[${requestId}] Credential set membership sync complete: ${workflowsUpdated} workflows updated, ${totalCreated} webhooks created, ${totalDeleted} webhooks deleted`
  )

  return { workflowsUpdated, totalCreated, totalDeleted }
}

// ---------------------------------------------------------------------------
// configureGmailPolling
// ---------------------------------------------------------------------------

/**
 * Configure Gmail polling for a webhook.
 * Each webhook has its own credentialId (credential sets are fanned out at save time).
 */
export async function configureGmailPolling(
  webhookData: Record<string, unknown>,
  requestId: string
): Promise<boolean> {
  const pollingLogger = createLogger('GmailWebhookSetup')
  pollingLogger.info(
    `[${requestId}] Setting up Gmail polling for webhook ${webhookData.id}`
  )

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, unknown>) || {}
    const credentialId = providerConfig.credentialId as string | undefined

    if (!credentialId) {
      pollingLogger.error(
        `[${requestId}] Missing credentialId for Gmail webhook ${webhookData.id}`
      )
      return false
    }

    const rows = await db
      .select()
      .from(account)
      .where(eq(account.id, credentialId))
      .limit(1)
    if (rows.length === 0) {
      pollingLogger.error(
        `[${requestId}] Credential ${credentialId} not found for Gmail webhook ${webhookData.id}`
      )
      return false
    }

    const effectiveUserId = rows[0].userId

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      effectiveUserId,
      requestId
    )
    if (!accessToken) {
      pollingLogger.error(
        `[${requestId}] Failed to refresh/access Gmail token for credential ${credentialId}`
      )
      return false
    }

    const maxEmailsPerPoll =
      typeof providerConfig.maxEmailsPerPoll === 'string'
        ? Number.parseInt(providerConfig.maxEmailsPerPoll as string, 10) || 25
        : (providerConfig.maxEmailsPerPoll as number) || 25

    const pollingInterval =
      typeof providerConfig.pollingInterval === 'string'
        ? Number.parseInt(providerConfig.pollingInterval as string, 10) || 5
        : (providerConfig.pollingInterval as number) || 5

    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          userId: effectiveUserId,
          credentialId,
          maxEmailsPerPoll,
          pollingInterval,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          labelIds: providerConfig.labelIds || ['INBOX'],
          labelFilterBehavior: providerConfig.labelFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp:
            (providerConfig.lastCheckedTimestamp as string) || now.toISOString(),
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id as string))

    pollingLogger.info(
      `[${requestId}] Successfully configured Gmail polling for webhook ${webhookData.id}`
    )
    return true
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    pollingLogger.error(`[${requestId}] Failed to configure Gmail polling`, {
      webhookId: webhookData.id,
      error: errMsg,
    })
    return false
  }
}

// ---------------------------------------------------------------------------
// configureOutlookPolling
// ---------------------------------------------------------------------------

/**
 * Configure Outlook polling for a webhook.
 * Each webhook has its own credentialId (credential sets are fanned out at save time).
 */
export async function configureOutlookPolling(
  webhookData: Record<string, unknown>,
  requestId: string
): Promise<boolean> {
  const pollingLogger = createLogger('OutlookWebhookSetup')
  pollingLogger.info(
    `[${requestId}] Setting up Outlook polling for webhook ${webhookData.id}`
  )

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, unknown>) || {}
    const credentialId = providerConfig.credentialId as string | undefined

    if (!credentialId) {
      pollingLogger.error(
        `[${requestId}] Missing credentialId for Outlook webhook ${webhookData.id}`
      )
      return false
    }

    const rows = await db
      .select()
      .from(account)
      .where(eq(account.id, credentialId))
      .limit(1)
    if (rows.length === 0) {
      pollingLogger.error(
        `[${requestId}] Credential ${credentialId} not found for Outlook webhook ${webhookData.id}`
      )
      return false
    }

    const effectiveUserId = rows[0].userId

    const accessToken = await refreshAccessTokenIfNeeded(
      credentialId,
      effectiveUserId,
      requestId
    )
    if (!accessToken) {
      pollingLogger.error(
        `[${requestId}] Failed to refresh/access Outlook token for credential ${credentialId}`
      )
      return false
    }

    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          userId: effectiveUserId,
          credentialId,
          maxEmailsPerPoll:
            typeof providerConfig.maxEmailsPerPoll === 'string'
              ? Number.parseInt(providerConfig.maxEmailsPerPoll as string, 10) || 25
              : (providerConfig.maxEmailsPerPoll as number) || 25,
          pollingInterval:
            typeof providerConfig.pollingInterval === 'string'
              ? Number.parseInt(providerConfig.pollingInterval as string, 10) || 5
              : (providerConfig.pollingInterval as number) || 5,
          markAsRead: providerConfig.markAsRead || false,
          includeRawEmail: providerConfig.includeRawEmail || false,
          folderIds: providerConfig.folderIds || ['inbox'],
          folderFilterBehavior: providerConfig.folderFilterBehavior || 'INCLUDE',
          lastCheckedTimestamp:
            (providerConfig.lastCheckedTimestamp as string) || now.toISOString(),
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id as string))

    pollingLogger.info(
      `[${requestId}] Successfully configured Outlook polling for webhook ${webhookData.id}`
    )
    return true
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    pollingLogger.error(`[${requestId}] Failed to configure Outlook polling`, {
      webhookId: webhookData.id,
      error: errMsg,
    })
    return false
  }
}

// ---------------------------------------------------------------------------
// configureRssPolling
// ---------------------------------------------------------------------------

/**
 * Configure RSS polling for a webhook.
 * Sets the initial lastCheckedTimestamp and empty lastSeenGuids.
 */
export async function configureRssPolling(
  webhookData: Record<string, unknown>,
  requestId: string
): Promise<boolean> {
  const pollingLogger = createLogger('RssWebhookSetup')
  pollingLogger.info(
    `[${requestId}] Setting up RSS polling for webhook ${webhookData.id}`
  )

  try {
    const providerConfig = (webhookData.providerConfig as Record<string, unknown>) || {}
    const now = new Date()

    await db
      .update(webhook)
      .set({
        providerConfig: {
          ...providerConfig,
          lastCheckedTimestamp: now.toISOString(),
          lastSeenGuids: [],
          setupCompleted: true,
        },
        updatedAt: now,
      })
      .where(eq(webhook.id, webhookData.id as string))

    pollingLogger.info(
      `[${requestId}] Successfully configured RSS polling for webhook ${webhookData.id}`
    )
    return true
  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error)
    pollingLogger.error(`[${requestId}] Failed to configure RSS polling`, {
      webhookId: webhookData.id,
      error: errMsg,
    })
    return false
  }
}
