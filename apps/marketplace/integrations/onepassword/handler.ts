import type { ToolHandler } from '../../sdk/types'

/**
 * Resolves which authentication mode to use based on provided params.
 * Returns the token and base URL for API calls.
 */
function resolveCredentials(params: Record<string, unknown>): {
  mode: 'service_account' | 'connect'
  token: string
  baseUrl: string
} {
  const connectionMode = params.connectionMode as string | undefined
  const mode = connectionMode ?? (params.serviceAccountToken ? 'service_account' : 'connect')

  if (mode === 'service_account') {
    const token = params.serviceAccountToken as string | undefined
    if (!token) {
      throw new Error('Service Account token is required for Service Account mode')
    }
    return { mode: 'service_account', token, baseUrl: '' }
  }

  const serverUrl = params.serverUrl as string | undefined
  const apiKey = params.apiKey as string | undefined
  if (!serverUrl || !apiKey) {
    throw new Error('Server URL and Connect token are required for Connect Server mode')
  }
  const baseUrl = serverUrl.replace(/\/$/, '')
  return { mode: 'connect', token: apiKey, baseUrl }
}

/**
 * Makes an authenticated request to the 1Password Connect Server API.
 */
async function connectFetch(options: {
  baseUrl: string
  token: string
  path: string
  method: string
  body?: unknown
  query?: string
}): Promise<Response> {
  const queryStr = options.query ? `?${options.query}` : ''
  const url = `${options.baseUrl}${options.path}${queryStr}`

  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.token}`,
  }

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }

  return fetch(url, {
    method: options.method,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
}

/**
 * Parses a JSON string if provided as a string, otherwise returns as-is.
 */
function parseJsonParam(value: unknown): unknown {
  if (typeof value === 'string') {
    return JSON.parse(value)
  }
  return value
}

const handler: ToolHandler = {
  operations: {
    onepassword_list_vaults: async (params) => {
      const creds = resolveCredentials(params)

      if (creds.mode === 'service_account') {
        return {
          success: false,
          output: {},
          error: 'Service Account mode requires the 1Password SDK which is not available in the marketplace handler. Use Connect Server mode instead.',
        }
      }

      const query = params.filter
        ? `filter=${encodeURIComponent(params.filter as string)}`
        : undefined

      const resp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: '/v1/vaults',
        method: 'GET',
        query,
      })

      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error: ${resp.status} ${err}`,
        }
      }

      const data = await resp.json()
      const vaults = Array.isArray(data) ? data : [data]
      return {
        success: true,
        output: {
          vaults: vaults.map((vault: Record<string, unknown>) => ({
            id: vault.id ?? null,
            name: vault.name ?? null,
            description: vault.description ?? null,
            attributeVersion: vault.attributeVersion ?? 0,
            contentVersion: vault.contentVersion ?? 0,
            items: vault.items ?? 0,
            type: vault.type ?? null,
            createdAt: vault.createdAt ?? null,
            updatedAt: vault.updatedAt ?? null,
          })),
        },
      }
    },

    onepassword_get_vault: async (params) => {
      const creds = resolveCredentials(params)

      if (creds.mode === 'service_account') {
        return {
          success: false,
          output: {},
          error: 'Service Account mode requires the 1Password SDK which is not available in the marketplace handler. Use Connect Server mode instead.',
        }
      }

      if (!params.vaultId) {
        return { success: false, output: {}, error: 'Missing required parameter: vaultId' }
      }

      const resp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: `/v1/vaults/${params.vaultId}`,
        method: 'GET',
      })

      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error: ${resp.status} ${err}`,
        }
      }

      const data = await resp.json()
      return {
        success: true,
        output: {
          id: data.id ?? null,
          name: data.name ?? null,
          description: data.description ?? null,
          attributeVersion: data.attributeVersion ?? 0,
          contentVersion: data.contentVersion ?? 0,
          items: data.items ?? 0,
          type: data.type ?? null,
          createdAt: data.createdAt ?? null,
          updatedAt: data.updatedAt ?? null,
        },
      }
    },

    onepassword_list_items: async (params) => {
      const creds = resolveCredentials(params)

      if (creds.mode === 'service_account') {
        return {
          success: false,
          output: {},
          error: 'Service Account mode requires the 1Password SDK which is not available in the marketplace handler. Use Connect Server mode instead.',
        }
      }

      if (!params.vaultId) {
        return { success: false, output: {}, error: 'Missing required parameter: vaultId' }
      }

      const query = params.filter
        ? `filter=${encodeURIComponent(params.filter as string)}`
        : undefined

      const resp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: `/v1/vaults/${params.vaultId}/items`,
        method: 'GET',
        query,
      })

      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error: ${resp.status} ${err}`,
        }
      }

      const data = await resp.json()
      const items = Array.isArray(data) ? data : [data]
      return {
        success: true,
        output: {
          items: items.map((item: Record<string, unknown>) => ({
            id: item.id ?? null,
            title: item.title ?? null,
            vault: item.vault ?? null,
            category: item.category ?? null,
            urls: Array.isArray(item.urls)
              ? item.urls.map((url: Record<string, unknown>) => ({
                  href: url.href ?? null,
                  label: url.label ?? null,
                  primary: url.primary ?? false,
                }))
              : [],
            favorite: item.favorite ?? false,
            tags: item.tags ?? [],
            version: item.version ?? 0,
            state: item.state ?? null,
            createdAt: item.createdAt ?? null,
            updatedAt: item.updatedAt ?? null,
            lastEditedBy: item.lastEditedBy ?? null,
          })),
        },
      }
    },

    onepassword_get_item: async (params) => {
      const creds = resolveCredentials(params)

      if (creds.mode === 'service_account') {
        return {
          success: false,
          output: {},
          error: 'Service Account mode requires the 1Password SDK which is not available in the marketplace handler. Use Connect Server mode instead.',
        }
      }

      if (!params.vaultId) {
        return { success: false, output: {}, error: 'Missing required parameter: vaultId' }
      }
      if (!params.itemId) {
        return { success: false, output: {}, error: 'Missing required parameter: itemId' }
      }

      const resp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: `/v1/vaults/${params.vaultId}/items/${params.itemId}`,
        method: 'GET',
      })

      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error: ${resp.status} ${err}`,
        }
      }

      const data = await resp.json()
      return { success: true, output: transformFullItem(data) }
    },

    onepassword_create_item: async (params) => {
      const creds = resolveCredentials(params)

      if (creds.mode === 'service_account') {
        return {
          success: false,
          output: {},
          error: 'Service Account mode requires the 1Password SDK which is not available in the marketplace handler. Use Connect Server mode instead.',
        }
      }

      if (!params.vaultId) {
        return { success: false, output: {}, error: 'Missing required parameter: vaultId' }
      }
      if (!params.category) {
        return { success: false, output: {}, error: 'Missing required parameter: category' }
      }

      const body: Record<string, unknown> = {
        vault: { id: params.vaultId },
        category: params.category,
      }
      if (params.title) {
        body.title = params.title
      }
      if (params.tags) {
        body.tags = String(params.tags)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      }
      if (params.fields) {
        body.fields = parseJsonParam(params.fields)
      }

      const resp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: `/v1/vaults/${params.vaultId}/items`,
        method: 'POST',
        body,
      })

      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error: ${resp.status} ${err}`,
        }
      }

      const data = await resp.json()
      return { success: true, output: transformFullItem(data) }
    },

    onepassword_replace_item: async (params) => {
      const creds = resolveCredentials(params)

      if (creds.mode === 'service_account') {
        return {
          success: false,
          output: {},
          error: 'Service Account mode requires the 1Password SDK which is not available in the marketplace handler. Use Connect Server mode instead.',
        }
      }

      if (!params.vaultId) {
        return { success: false, output: {}, error: 'Missing required parameter: vaultId' }
      }
      if (!params.itemId) {
        return { success: false, output: {}, error: 'Missing required parameter: itemId' }
      }
      if (!params.item) {
        return { success: false, output: {}, error: 'Missing required parameter: item' }
      }

      const itemData = parseJsonParam(params.item)

      const resp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: `/v1/vaults/${params.vaultId}/items/${params.itemId}`,
        method: 'PUT',
        body: itemData,
      })

      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error: ${resp.status} ${err}`,
        }
      }

      const data = await resp.json()
      return { success: true, output: transformFullItem(data) }
    },

    onepassword_update_item: async (params) => {
      const creds = resolveCredentials(params)

      if (creds.mode === 'service_account') {
        return {
          success: false,
          output: {},
          error: 'Service Account mode requires the 1Password SDK which is not available in the marketplace handler. Use Connect Server mode instead.',
        }
      }

      if (!params.vaultId) {
        return { success: false, output: {}, error: 'Missing required parameter: vaultId' }
      }
      if (!params.itemId) {
        return { success: false, output: {}, error: 'Missing required parameter: itemId' }
      }
      if (!params.operations) {
        return { success: false, output: {}, error: 'Missing required parameter: operations' }
      }

      const ops = parseJsonParam(params.operations)

      const resp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: `/v1/vaults/${params.vaultId}/items/${params.itemId}`,
        method: 'PATCH',
        body: ops,
      })

      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error: ${resp.status} ${err}`,
        }
      }

      const data = await resp.json()
      return { success: true, output: transformFullItem(data) }
    },

    onepassword_delete_item: async (params) => {
      const creds = resolveCredentials(params)

      if (creds.mode === 'service_account') {
        return {
          success: false,
          output: {},
          error: 'Service Account mode requires the 1Password SDK which is not available in the marketplace handler. Use Connect Server mode instead.',
        }
      }

      if (!params.vaultId) {
        return { success: false, output: {}, error: 'Missing required parameter: vaultId' }
      }
      if (!params.itemId) {
        return { success: false, output: {}, error: 'Missing required parameter: itemId' }
      }

      const resp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: `/v1/vaults/${params.vaultId}/items/${params.itemId}`,
        method: 'DELETE',
      })

      if (!resp.ok) {
        const err = await resp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error: ${resp.status} ${err}`,
        }
      }

      return {
        success: true,
        output: { deleted: true, itemId: params.itemId, vaultId: params.vaultId },
      }
    },

    onepassword_resolve_secret: async (params) => {
      const creds = resolveCredentials(params)

      if (creds.mode === 'service_account') {
        return {
          success: false,
          output: {},
          error: 'Service Account mode requires the 1Password SDK which is not available in the marketplace handler. Use Connect Server mode instead.',
        }
      }

      if (!params.secretReference) {
        return { success: false, output: {}, error: 'Missing required parameter: secretReference' }
      }

      const ref = String(params.secretReference)
      const parsed = parseSecretReference(ref)
      if (!parsed) {
        return {
          success: false,
          output: {},
          error: `Invalid secret reference format: "${ref}". Expected op://vault/item/[section/]field`,
        }
      }

      // Step 1: List vaults to find the vault by name or ID
      const vaultsResp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: '/v1/vaults',
        method: 'GET',
        query: `filter=${encodeURIComponent(`name eq "${parsed.vault}"`)}`,
      })

      if (!vaultsResp.ok) {
        const err = await vaultsResp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error listing vaults: ${vaultsResp.status} ${err}`,
        }
      }

      const vaults = await vaultsResp.json()
      const vaultList = Array.isArray(vaults) ? vaults : [vaults]
      const vault = vaultList.find(
        (v: Record<string, unknown>) =>
          v.name === parsed.vault || v.id === parsed.vault
      ) as Record<string, unknown> | undefined

      if (!vault) {
        return {
          success: false,
          output: {},
          error: `Vault "${parsed.vault}" not found`,
        }
      }

      // Step 2: List items in the vault to find the item by name or ID
      const itemsResp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: `/v1/vaults/${vault.id}/items`,
        method: 'GET',
        query: `filter=${encodeURIComponent(`title eq "${parsed.item}"`)}`,
      })

      if (!itemsResp.ok) {
        const err = await itemsResp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error listing items: ${itemsResp.status} ${err}`,
        }
      }

      const items = await itemsResp.json()
      const itemList = Array.isArray(items) ? items : [items]
      const item = itemList.find(
        (i: Record<string, unknown>) =>
          i.title === parsed.item || i.id === parsed.item
      ) as Record<string, unknown> | undefined

      if (!item) {
        return {
          success: false,
          output: {},
          error: `Item "${parsed.item}" not found in vault "${parsed.vault}"`,
        }
      }

      // Step 3: Get the full item to access field values
      const fullItemResp = await connectFetch({
        baseUrl: creds.baseUrl,
        token: creds.token,
        path: `/v1/vaults/${vault.id}/items/${item.id}`,
        method: 'GET',
      })

      if (!fullItemResp.ok) {
        const err = await fullItemResp.text().catch(() => '')
        return {
          success: false,
          output: {},
          error: `1Password API error getting item: ${fullItemResp.status} ${err}`,
        }
      }

      const fullItem = await fullItemResp.json()
      const fields = Array.isArray(fullItem.fields) ? fullItem.fields : []
      const sections = Array.isArray(fullItem.sections) ? fullItem.sections : []

      // Step 4: Find the field value
      let matchedField: Record<string, unknown> | undefined

      if (parsed.section) {
        // Find the section first
        const section = sections.find(
          (s: Record<string, unknown>) =>
            s.label === parsed.section || s.id === parsed.section
        ) as Record<string, unknown> | undefined

        if (section) {
          matchedField = fields.find(
            (f: Record<string, unknown>) =>
              (f.label === parsed.field || f.id === parsed.field) &&
              (f.section as Record<string, unknown> | undefined)?.id === section.id
          ) as Record<string, unknown> | undefined
        }
      }

      // Fall back to searching without section constraint
      if (!matchedField) {
        matchedField = fields.find(
          (f: Record<string, unknown>) =>
            f.label === parsed.field || f.id === parsed.field
        ) as Record<string, unknown> | undefined
      }

      if (!matchedField) {
        return {
          success: false,
          output: {},
          error: `Field "${parsed.field}" not found in item "${parsed.item}"`,
        }
      }

      return {
        success: true,
        output: {
          value: (matchedField.value as string) ?? '',
          reference: ref,
        },
      }
    },
  },
}

/**
 * Transforms a raw FullItem API response into a standardized output shape.
 */
function transformFullItem(data: Record<string, unknown>): Record<string, unknown> {
  const urls = Array.isArray(data.urls) ? data.urls : []
  const fields = Array.isArray(data.fields) ? data.fields : []
  const sections = Array.isArray(data.sections) ? data.sections : []

  return {
    id: data.id ?? null,
    title: data.title ?? null,
    vault: data.vault ?? null,
    category: data.category ?? null,
    urls: urls.map((url: Record<string, unknown>) => ({
      href: url.href ?? null,
      label: url.label ?? null,
      primary: url.primary ?? false,
    })),
    favorite: data.favorite ?? false,
    tags: data.tags ?? [],
    version: data.version ?? 0,
    state: data.state ?? null,
    fields: fields.map((field: Record<string, unknown>) => ({
      id: field.id ?? null,
      label: field.label ?? null,
      type: field.type ?? 'STRING',
      purpose: field.purpose ?? '',
      value: field.value ?? null,
      section: field.section ?? null,
      generate: field.generate ?? false,
      recipe: field.recipe
        ? {
            length: (field.recipe as Record<string, unknown>).length ?? null,
            characterSets: (field.recipe as Record<string, unknown>).characterSets ?? [],
            excludeCharacters: (field.recipe as Record<string, unknown>).excludeCharacters ?? null,
          }
        : null,
      entropy: field.entropy ?? null,
    })),
    sections: sections.map((section: Record<string, unknown>) => ({
      id: section.id ?? null,
      label: section.label ?? null,
    })),
    createdAt: data.createdAt ?? null,
    updatedAt: data.updatedAt ?? null,
    lastEditedBy: data.lastEditedBy ?? null,
  }
}

/**
 * Parses an op:// secret reference URI into its component parts.
 * Supports formats:
 *   op://vault/item/field
 *   op://vault/item/section/field
 */
function parseSecretReference(
  ref: string
): { vault: string; item: string; section: string | null; field: string } | null {
  if (!ref.startsWith('op://')) {
    return null
  }

  const path = ref.slice('op://'.length)
  const parts = path.split('/').filter(Boolean)

  if (parts.length === 3) {
    return { vault: parts[0], item: parts[1], section: null, field: parts[2] }
  }
  if (parts.length === 4) {
    return { vault: parts[0], item: parts[1], section: parts[2], field: parts[3] }
  }

  return null
}

export default handler
