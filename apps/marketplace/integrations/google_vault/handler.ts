import type { ToolHandler } from '../../sdk/types'

const VAULT_API_BASE = 'https://vault.googleapis.com/v1'

const handler: ToolHandler = {
  operations: {
    google_vault_create_matters: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const name = params.name as string
      if (!accessToken || !name) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, name' }
      }

      const response = await fetch(`${VAULT_API_BASE}/matters`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description: params.description }),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to create matter' }
      }

      return { success: true, output: { matter: data } }
    },

    google_vault_list_matters: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      let url: string
      if (params.matterId) {
        url = `${VAULT_API_BASE}/matters/${params.matterId}`
      } else {
        const u = new URL(`${VAULT_API_BASE}/matters`)
        if (params.pageSize) {
          const pageSize = Number(params.pageSize)
          if (Number.isFinite(pageSize) && pageSize > 0) u.searchParams.set('pageSize', String(pageSize))
        }
        if (params.pageToken) u.searchParams.set('pageToken', params.pageToken as string)
        url = u.toString()
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to list matters' }
      }

      if (params.matterId) {
        return { success: true, output: { matter: data } }
      }
      return { success: true, output: data }
    },

    google_vault_create_matters_export: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const matterId = params.matterId as string
      const exportName = params.exportName as string
      const corpus = params.corpus as string
      if (!accessToken || !matterId || !exportName || !corpus) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, matterId, exportName, corpus' }
      }

      let emails: string[] = []
      if (params.accountEmails) {
        if (Array.isArray(params.accountEmails)) {
          emails = params.accountEmails as string[]
        } else if (typeof params.accountEmails === 'string') {
          emails = params.accountEmails.split(',').map((e) => e.trim()).filter(Boolean)
        }
      }

      const scope = emails.length > 0
        ? { accountInfo: { emails } }
        : params.orgUnitId
          ? { orgUnitInfo: { orgUnitId: params.orgUnitId } }
          : {}

      const searchMethod = emails.length > 0 ? 'ACCOUNT' : params.orgUnitId ? 'ORG_UNIT' : undefined

      const query: Record<string, unknown> = {
        corpus,
        dataScope: 'ALL_DATA',
        searchMethod,
        terms: params.terms || undefined,
        startTime: params.startTime || undefined,
        endTime: params.endTime || undefined,
        ...scope,
      }

      const response = await fetch(`${VAULT_API_BASE}/matters/${matterId}/exports`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: exportName, query }),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to create export' }
      }

      return { success: true, output: { export: data } }
    },

    google_vault_list_matters_export: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const matterId = params.matterId as string
      if (!accessToken || !matterId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, matterId' }
      }

      let url: string
      if (params.exportId) {
        url = `${VAULT_API_BASE}/matters/${matterId}/exports/${params.exportId}`
      } else {
        const u = new URL(`${VAULT_API_BASE}/matters/${matterId}/exports`)
        if (params.pageSize) {
          const pageSize = Number(params.pageSize)
          if (Number.isFinite(pageSize) && pageSize > 0) u.searchParams.set('pageSize', String(pageSize))
        }
        if (params.pageToken) u.searchParams.set('pageToken', params.pageToken as string)
        url = u.toString()
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to list exports' }
      }

      if (params.exportId) {
        return { success: true, output: { export: data } }
      }
      return { success: true, output: data }
    },

    google_vault_create_matters_holds: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const matterId = params.matterId as string
      const holdName = params.holdName as string
      const corpus = params.corpus as string
      if (!accessToken || !matterId || !holdName || !corpus) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, matterId, holdName, corpus' }
      }

      let emails: string[] = []
      if (params.accountEmails) {
        if (Array.isArray(params.accountEmails)) {
          emails = params.accountEmails as string[]
        } else if (typeof params.accountEmails === 'string') {
          emails = params.accountEmails.split(',').map((e) => e.trim()).filter(Boolean)
        }
      }

      const body: Record<string, unknown> = { name: holdName, corpus }

      if (emails.length > 0) {
        body.accounts = emails.map((email) => ({ email }))
      } else if (params.orgUnitId) {
        body.orgUnit = { orgUnitId: params.orgUnitId }
      }

      if (corpus === 'MAIL' || corpus === 'GROUPS') {
        if (params.terms || params.startTime || params.endTime) {
          const queryObj: Record<string, unknown> = {}
          if (params.terms) queryObj.terms = params.terms
          if (params.startTime) queryObj.startTime = params.startTime
          if (params.endTime) queryObj.endTime = params.endTime
          body.query = corpus === 'MAIL' ? { mailQuery: queryObj } : { groupsQuery: queryObj }
        }
      } else if (corpus === 'DRIVE' && params.includeSharedDrives) {
        body.query = { driveQuery: { includeSharedDriveFiles: params.includeSharedDrives } }
      }

      const response = await fetch(`${VAULT_API_BASE}/matters/${matterId}/holds`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to create hold' }
      }

      return { success: true, output: { hold: data } }
    },

    google_vault_list_matters_holds: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const matterId = params.matterId as string
      if (!accessToken || !matterId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, matterId' }
      }

      let url: string
      if (params.holdId) {
        url = `${VAULT_API_BASE}/matters/${matterId}/holds/${params.holdId}`
      } else {
        const u = new URL(`${VAULT_API_BASE}/matters/${matterId}/holds`)
        if (params.pageSize) {
          const pageSize = Number(params.pageSize)
          if (Number.isFinite(pageSize) && pageSize > 0) u.searchParams.set('pageSize', String(pageSize))
        }
        if (params.pageToken) u.searchParams.set('pageToken', params.pageToken as string)
        url = u.toString()
      }

      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      const data = await response.json()
      if (!response.ok) {
        return { success: false, output: {}, error: data.error?.message ?? 'Failed to list holds' }
      }

      if (params.holdId) {
        return { success: true, output: { hold: data } }
      }
      return { success: true, output: data }
    },

    google_vault_download_export_file: async (params, ctx) => {
      const accessToken = (params.accessToken as string) || ctx.accessToken
      const bucketName = params.bucketName as string
      const objectName = params.objectName as string
      if (!accessToken || !bucketName || !objectName) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, bucketName, objectName' }
      }

      const gcsUrl = `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucketName)}/o/${encodeURIComponent(objectName)}?alt=media`
      const response = await fetch(gcsUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Failed to download export file: ${response.status} ${errorText}` }
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream'
      const fileName = (params.fileName as string) || objectName.split('/').pop() || 'export-file'
      const buffer = await response.arrayBuffer()
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)))

      return {
        success: true,
        output: {
          file: {
            name: fileName,
            mimeType: contentType,
            data: base64,
            size: buffer.byteLength,
          },
        },
      }
    },
  },
}

export default handler
