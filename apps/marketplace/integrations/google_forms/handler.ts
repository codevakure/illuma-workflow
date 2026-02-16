import type { ToolHandler } from '../../sdk/types'

const FORMS_API_BASE = 'https://forms.googleapis.com/v1'

const handler: ToolHandler = {
  operations: {
    google_forms_create_form: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const title = params.title as string
      if (!accessToken || !title) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, title' }
      }

      const url = new URL(`${FORMS_API_BASE}/forms`)
      if (params.unpublished) url.searchParams.set('unpublished', 'true')

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          info: {
            title,
            ...(params.documentTitle ? { documentTitle: params.documentTitle } : {}),
          },
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to create form' }
      }

      return {
        success: true,
        output: {
          formId: data.formId ?? '',
          title: data.info?.title ?? null,
          documentTitle: data.info?.documentTitle ?? null,
          responderUri: data.responderUri ?? null,
          revisionId: data.revisionId ?? null,
        },
      }
    },

    google_forms_get_form: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const formId = params.formId as string
      if (!accessToken || !formId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, formId' }
      }

      const response = await fetch(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to get form' }
      }

      return {
        success: true,
        output: {
          formId: data.formId ?? '',
          title: data.info?.title ?? null,
          description: data.info?.description ?? null,
          documentTitle: data.info?.documentTitle ?? null,
          responderUri: data.responderUri ?? null,
          linkedSheetId: data.linkedSheetId ?? null,
          revisionId: data.revisionId ?? null,
          items: data.items ?? [],
          settings: data.settings ?? null,
          publishSettings: data.publishSettings ?? null,
        },
      }
    },

    google_forms_get_responses: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const formId = params.formId as string
      if (!accessToken || !formId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, formId' }
      }

      let url: string
      if (params.responseId) {
        url = `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(params.responseId as string)}`
      } else {
        const u = new URL(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/responses`)
        if (params.pageSize) u.searchParams.set('pageSize', String(Math.min(Number(params.pageSize), 5000)))
        url = u.toString()
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: data || {}, error: data?.error?.message || 'Failed to fetch responses' }
      }

      const normalizeAnswers = (answers: Record<string, unknown>): Record<string, unknown> => {
        if (!answers || typeof answers !== 'object') return {}
        const out: Record<string, unknown> = {}
        for (const [qId, answerObj] of Object.entries(answers)) {
          if (answerObj && typeof answerObj === 'object') {
            const aRec = answerObj as Record<string, unknown>
            const key = Object.keys(aRec).find(
              (k) => k.toLowerCase().endsWith('answers') && Array.isArray((aRec[k] as Record<string, unknown>)?.answers)
            )
            if (key) {
              const container = aRec[key] as Record<string, unknown>
              const innerAnswers = container.answers as unknown[]
              if (Array.isArray(innerAnswers)) {
                const values = innerAnswers.map((entry) => {
                  if (entry && typeof entry === 'object' && 'value' in (entry as Record<string, unknown>)) {
                    return (entry as Record<string, unknown>).value
                  }
                  return entry
                })
                out[qId] = values.length === 1 ? values[0] : values
                continue
              }
            }
          }
          out[qId] = answerObj
        }
        return out
      }

      const normalizeResponse = (r: Record<string, unknown>) => ({
        responseId: r.responseId,
        createTime: r.createTime,
        lastSubmittedTime: r.lastSubmittedTime,
        answers: normalizeAnswers(r.answers as Record<string, unknown>),
      })

      if (Array.isArray(data.responses)) {
        const sorted = (data.responses as Record<string, unknown>[]).slice().sort((a, b) => {
          const tA = Date.parse((b.lastSubmittedTime || b.createTime) as string) || 0
          const tB = Date.parse((a.lastSubmittedTime || a.createTime) as string) || 0
          return tA - tB
        })
        return { success: true, output: { responses: sorted.map(normalizeResponse), raw: data } }
      }

      return { success: true, output: { response: normalizeResponse(data), raw: data } }
    },

    google_forms_batch_update: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const formId = params.formId as string
      if (!accessToken || !formId || !params.requests) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, formId, requests' }
      }

      const response = await fetch(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}:batchUpdate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: params.requests,
          includeFormInResponse: params.includeFormInResponse ?? false,
        }),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to batch update form' }
      }

      return { success: true, output: { replies: data.replies ?? [], writeControl: data.writeControl ?? null, form: data.form ?? null } }
    },

    google_forms_set_publish_settings: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const formId = params.formId as string
      if (!accessToken || !formId || params.isPublished === undefined) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, formId, isPublished' }
      }

      const publishState: Record<string, unknown> = { isPublished: params.isPublished }
      if (params.isAcceptingResponses !== undefined) publishState.isAcceptingResponses = params.isAcceptingResponses

      const response = await fetch(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}:setPublishSettings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishSettings: { publishState }, updateMask: 'publishState' }),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to set publish settings' }
      }

      return { success: true, output: { formId: data.formId ?? '', publishSettings: data.publishSettings ?? {} } }
    },

    google_forms_create_watch: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const formId = params.formId as string
      if (!accessToken || !formId || !params.eventType || !params.topicName) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, formId, eventType, topicName' }
      }

      const body: Record<string, unknown> = {
        watch: { target: { topic: { topicName: params.topicName } }, eventType: params.eventType },
      }
      if (params.watchId) body.watchId = params.watchId

      const response = await fetch(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/watches`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to create watch' }
      }

      return {
        success: true,
        output: {
          id: data.id ?? '',
          eventType: data.eventType ?? '',
          topicName: data.target?.topic?.topicName ?? null,
          createTime: data.createTime ?? null,
          expireTime: data.expireTime ?? null,
          state: data.state ?? null,
        },
      }
    },

    google_forms_list_watches: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const formId = params.formId as string
      if (!accessToken || !formId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, formId' }
      }

      const response = await fetch(`${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/watches`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to list watches' }
      }

      const watches = (data.watches ?? []).map((w: Record<string, unknown>) => ({
        id: w.id,
        target: w.target,
        eventType: w.eventType,
        createTime: w.createTime,
        expireTime: w.expireTime,
        state: w.state,
        errorType: w.errorType,
      }))

      return { success: true, output: { watches } }
    },

    google_forms_delete_watch: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const formId = params.formId as string
      const watchId = params.watchId as string
      if (!accessToken || !formId || !watchId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, formId, watchId' }
      }

      const response = await fetch(
        `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/watches/${encodeURIComponent(watchId)}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      )

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        return { success: false, output: {}, error: (data as Record<string, unknown>)?.error?.toString() ?? 'Failed to delete watch' }
      }

      return { success: true, output: { deleted: true } }
    },

    google_forms_renew_watch: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const formId = params.formId as string
      const watchId = params.watchId as string
      if (!accessToken || !formId || !watchId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, formId, watchId' }
      }

      const response = await fetch(
        `${FORMS_API_BASE}/forms/${encodeURIComponent(formId)}/watches/${encodeURIComponent(watchId)}:renew`,
        { method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } }
      )

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to renew watch' }
      }

      return {
        success: true,
        output: { id: data.id ?? '', eventType: data.eventType ?? null, expireTime: data.expireTime ?? null, state: data.state ?? null },
      }
    },
  },
}

export default handler
