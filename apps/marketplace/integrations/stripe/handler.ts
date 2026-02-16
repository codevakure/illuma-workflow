import crypto from 'node:crypto'
import type { ToolHandler } from '../../sdk/types'

const STRIPE_API = 'https://api.stripe.com/v1'

/**
 * Builds a URL-encoded form body from flat key-value params.
 * Handles nested objects (address, metadata, recurring) and arrays (items, images).
 */
function buildFormBody(fields: Record<string, unknown>): string {
  const formData = new URLSearchParams()

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue

    if (key === 'metadata' && typeof value === 'object') {
      for (const [mk, mv] of Object.entries(value as Record<string, unknown>)) {
        formData.append(`metadata[${mk}]`, String(mv))
      }
    } else if (key === 'address' && typeof value === 'object') {
      for (const [ak, av] of Object.entries(value as Record<string, unknown>)) {
        if (av) formData.append(`address[${ak}]`, String(av))
      }
    } else if (key === 'recurring' && typeof value === 'object') {
      for (const [rk, rv] of Object.entries(value as Record<string, unknown>)) {
        if (rv) formData.append(`recurring[${rk}]`, String(rv))
      }
    } else if (key === 'items' && Array.isArray(value)) {
      (value as Array<Record<string, unknown>>).forEach((item, index) => {
        if (item.price) formData.append(`items[${index}][price]`, String(item.price))
        if (item.quantity) formData.append(`items[${index}][quantity]`, String(item.quantity))
      })
    } else if (key === 'images' && Array.isArray(value)) {
      (value as string[]).forEach((img, index) => {
        formData.append(`images[${index}]`, img)
      })
    } else if (key === 'automatic_payment_methods' && typeof value === 'object') {
      const apm = value as Record<string, unknown>
      if (apm.enabled) formData.append('automatic_payment_methods[enabled]', 'true')
    } else if (typeof value === 'boolean') {
      formData.append(key, String(value))
    } else if (typeof value === 'number') {
      formData.append(key, String(value))
    } else {
      formData.append(key, String(value))
    }
  }

  return formData.toString()
}

/**
 * Makes a request to the Stripe API.
 */
async function stripeRequest(
  method: string,
  path: string,
  apiKey: string,
  body?: string
): Promise<{ ok: boolean; data: Record<string, unknown>; status: number }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    ...(body !== undefined ? { body } : {}),
  })

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    const error = (data as Record<string, unknown>).error as Record<string, unknown> | undefined
    const errorMsg = (error?.message as string) || `Stripe API error: ${response.status}`
    return { ok: false, data: { error: errorMsg }, status: response.status }
  }

  return { ok: true, data: data as Record<string, unknown>, status: response.status }
}

/**
 * Parse JSON params that may have been passed as strings.
 */
function parseJsonParam(value: unknown): unknown {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }
  return value
}

const handler: ToolHandler = {
  operations: {
    // ========================================================================
    // Customers
    // ========================================================================
    stripe_create_customer: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const body = buildFormBody({
        email: params.email,
        name: params.name,
        phone: params.phone,
        description: params.description,
        address: parseJsonParam(params.address),
        metadata: parseJsonParam(params.metadata),
        payment_method: params.payment_method,
      })

      const result = await stripeRequest('POST', '/customers', apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          customer: result.data,
          metadata: {
            id: result.data.id,
            email: result.data.email ?? null,
            name: result.data.name ?? null,
          },
        },
      }
    },

    stripe_retrieve_customer: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('GET', `/customers/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          customer: result.data,
          metadata: {
            id: result.data.id,
            email: result.data.email ?? null,
            name: result.data.name ?? null,
          },
        },
      }
    },

    stripe_update_customer: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        email: params.email,
        name: params.name,
        phone: params.phone,
        description: params.description,
        address: parseJsonParam(params.address),
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', `/customers/${id}`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          customer: result.data,
          metadata: {
            id: result.data.id,
            email: result.data.email ?? null,
            name: result.data.name ?? null,
          },
        },
      }
    },

    stripe_delete_customer: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('DELETE', `/customers/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          deleted: result.data.deleted,
          id: result.data.id,
        },
      }
    },

    stripe_list_customers: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = new URL(`${STRIPE_API}/customers`)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.email) url.searchParams.append('email', params.email as string)
      if (params.created) {
        const created = parseJsonParam(params.created) as Record<string, unknown>
        if (typeof created === 'object' && created) {
          for (const [key, value] of Object.entries(created)) {
            url.searchParams.append(`created[${key}]`, String(value))
          }
        }
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          customers: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    stripe_search_customers: async (params) => {
      const apiKey = params.apiKey as string
      const query = params.query as string
      if (!apiKey || !query) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = new URL(`${STRIPE_API}/customers/search`)
      url.searchParams.append('query', query)
      if (params.limit) url.searchParams.append('limit', String(params.limit))

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          customers: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    // ========================================================================
    // Payment Intents
    // ========================================================================
    stripe_create_payment_intent: async (params) => {
      const apiKey = params.apiKey as string
      const amount = params.amount
      const currency = params.currency as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!amount) return { success: false, output: {}, error: 'Missing required parameter: amount' }
      if (!currency) return { success: false, output: {}, error: 'Missing required parameter: currency' }

      const body = buildFormBody({
        amount: Number(amount),
        currency,
        customer: params.customer,
        payment_method: params.payment_method,
        description: params.description,
        receipt_email: params.receipt_email,
        metadata: parseJsonParam(params.metadata),
        automatic_payment_methods: parseJsonParam(params.automatic_payment_methods),
      })

      const result = await stripeRequest('POST', '/payment_intents', apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          payment_intent: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount: result.data.amount,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_retrieve_payment_intent: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('GET', `/payment_intents/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          payment_intent: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount: result.data.amount,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_update_payment_intent: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        amount: params.amount !== undefined ? Number(params.amount) : undefined,
        currency: params.currency,
        customer: params.customer,
        description: params.description,
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', `/payment_intents/${id}`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          payment_intent: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount: result.data.amount,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_confirm_payment_intent: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        payment_method: params.payment_method,
      })

      const result = await stripeRequest('POST', `/payment_intents/${id}/confirm`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          payment_intent: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount: result.data.amount,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_capture_payment_intent: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        amount_to_capture: params.amount_to_capture !== undefined ? Number(params.amount_to_capture) : undefined,
      })

      const result = await stripeRequest('POST', `/payment_intents/${id}/capture`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          payment_intent: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount: result.data.amount,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_cancel_payment_intent: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        cancellation_reason: params.cancellation_reason,
      })

      const result = await stripeRequest('POST', `/payment_intents/${id}/cancel`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          payment_intent: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount: result.data.amount,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_list_payment_intents: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = new URL(`${STRIPE_API}/payment_intents`)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.customer) url.searchParams.append('customer', params.customer as string)
      if (params.created) {
        const created = parseJsonParam(params.created) as Record<string, unknown>
        if (typeof created === 'object' && created) {
          for (const [key, value] of Object.entries(created)) {
            url.searchParams.append(`created[${key}]`, String(value))
          }
        }
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          payment_intents: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    stripe_search_payment_intents: async (params) => {
      const apiKey = params.apiKey as string
      const query = params.query as string
      if (!apiKey || !query) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = new URL(`${STRIPE_API}/payment_intents/search`)
      url.searchParams.append('query', query)
      if (params.limit) url.searchParams.append('limit', String(params.limit))

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          payment_intents: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    // ========================================================================
    // Subscriptions
    // ========================================================================
    stripe_create_subscription: async (params) => {
      const apiKey = params.apiKey as string
      const customer = params.customer as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!customer) return { success: false, output: {}, error: 'Missing required parameter: customer' }

      const items = parseJsonParam(params.items)
      if (!items) return { success: false, output: {}, error: 'Missing required parameter: items' }

      const body = buildFormBody({
        customer,
        items: items as Array<Record<string, unknown>>,
        trial_period_days: params.trial_period_days !== undefined ? Number(params.trial_period_days) : undefined,
        default_payment_method: params.default_payment_method,
        cancel_at_period_end: params.cancel_at_period_end,
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', '/subscriptions', apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          subscription: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            customer: result.data.customer,
          },
        },
      }
    },

    stripe_retrieve_subscription: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('GET', `/subscriptions/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          subscription: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            customer: result.data.customer,
          },
        },
      }
    },

    stripe_update_subscription: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        items: parseJsonParam(params.items) as Array<Record<string, unknown>> | undefined,
        cancel_at_period_end: params.cancel_at_period_end,
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', `/subscriptions/${id}`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          subscription: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            customer: result.data.customer,
          },
        },
      }
    },

    stripe_cancel_subscription: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        prorate: params.prorate,
        invoice_now: params.invoice_now,
      })

      const result = await stripeRequest('DELETE', `/subscriptions/${id}`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          subscription: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            customer: result.data.customer,
          },
        },
      }
    },

    stripe_resume_subscription: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('POST', `/subscriptions/${id}/resume`, apiKey, '')
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          subscription: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            customer: result.data.customer,
          },
        },
      }
    },

    stripe_list_subscriptions: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = new URL(`${STRIPE_API}/subscriptions`)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.customer) url.searchParams.append('customer', params.customer as string)
      if (params.status) url.searchParams.append('status', params.status as string)
      if (params.price) url.searchParams.append('price', params.price as string)

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          subscriptions: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    stripe_search_subscriptions: async (params) => {
      const apiKey = params.apiKey as string
      const query = params.query as string
      if (!apiKey || !query) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = new URL(`${STRIPE_API}/subscriptions/search`)
      url.searchParams.append('query', query)
      if (params.limit) url.searchParams.append('limit', String(params.limit))

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          subscriptions: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    // ========================================================================
    // Invoices
    // ========================================================================
    stripe_create_invoice: async (params) => {
      const apiKey = params.apiKey as string
      const customer = params.customer as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!customer) return { success: false, output: {}, error: 'Missing required parameter: customer' }

      const body = buildFormBody({
        customer,
        description: params.description,
        auto_advance: params.auto_advance,
        collection_method: params.collection_method,
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', '/invoices', apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          invoice: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount_due: result.data.amount_due,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_retrieve_invoice: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('GET', `/invoices/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          invoice: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount_due: result.data.amount_due,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_update_invoice: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        description: params.description,
        auto_advance: params.auto_advance,
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', `/invoices/${id}`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          invoice: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount_due: result.data.amount_due,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_delete_invoice: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('DELETE', `/invoices/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          deleted: result.data.deleted,
          id: result.data.id,
        },
      }
    },

    stripe_finalize_invoice: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        auto_advance: params.auto_advance,
      })

      const result = await stripeRequest('POST', `/invoices/${id}/finalize`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          invoice: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount_due: result.data.amount_due,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_pay_invoice: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        paid_out_of_band: params.paid_out_of_band,
      })

      const result = await stripeRequest('POST', `/invoices/${id}/pay`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          invoice: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount_due: result.data.amount_due,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_void_invoice: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('POST', `/invoices/${id}/void`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          invoice: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount_due: result.data.amount_due,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_send_invoice: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('POST', `/invoices/${id}/send`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          invoice: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount_due: result.data.amount_due,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_list_invoices: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = new URL(`${STRIPE_API}/invoices`)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.customer) url.searchParams.append('customer', params.customer as string)
      if (params.status) url.searchParams.append('status', params.status as string)

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          invoices: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    stripe_search_invoices: async (params) => {
      const apiKey = params.apiKey as string
      const query = params.query as string
      if (!apiKey || !query) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = new URL(`${STRIPE_API}/invoices/search`)
      url.searchParams.append('query', query)
      if (params.limit) url.searchParams.append('limit', String(params.limit))

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          invoices: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    // ========================================================================
    // Charges
    // ========================================================================
    stripe_create_charge: async (params) => {
      const apiKey = params.apiKey as string
      const amount = params.amount
      const currency = params.currency as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!amount) return { success: false, output: {}, error: 'Missing required parameter: amount' }
      if (!currency) return { success: false, output: {}, error: 'Missing required parameter: currency' }

      const body = buildFormBody({
        amount: Number(amount),
        currency,
        customer: params.customer,
        source: params.source,
        description: params.description,
        capture: params.capture,
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', '/charges', apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          charge: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount: result.data.amount,
            currency: result.data.currency,
            paid: result.data.paid,
          },
        },
      }
    },

    stripe_retrieve_charge: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('GET', `/charges/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          charge: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount: result.data.amount,
            currency: result.data.currency,
            paid: result.data.paid,
          },
        },
      }
    },

    stripe_update_charge: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        description: params.description,
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', `/charges/${id}`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          charge: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount: result.data.amount,
            currency: result.data.currency,
            paid: result.data.paid,
          },
        },
      }
    },

    stripe_capture_charge: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        amount: params.amount !== undefined ? Number(params.amount) : undefined,
      })

      const result = await stripeRequest('POST', `/charges/${id}/capture`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          charge: result.data,
          metadata: {
            id: result.data.id,
            status: result.data.status,
            amount: result.data.amount,
            currency: result.data.currency,
            paid: result.data.paid,
          },
        },
      }
    },

    stripe_list_charges: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = new URL(`${STRIPE_API}/charges`)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.customer) url.searchParams.append('customer', params.customer as string)
      if (params.created) {
        const created = parseJsonParam(params.created) as Record<string, unknown>
        if (typeof created === 'object' && created) {
          for (const [key, value] of Object.entries(created)) {
            url.searchParams.append(`created[${key}]`, String(value))
          }
        }
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          charges: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    stripe_search_charges: async (params) => {
      const apiKey = params.apiKey as string
      const query = params.query as string
      if (!apiKey || !query) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = new URL(`${STRIPE_API}/charges/search`)
      url.searchParams.append('query', query)
      if (params.limit) url.searchParams.append('limit', String(params.limit))

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          charges: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    // ========================================================================
    // Products
    // ========================================================================
    stripe_create_product: async (params) => {
      const apiKey = params.apiKey as string
      const name = params.name as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!name) return { success: false, output: {}, error: 'Missing required parameter: name' }

      const body = buildFormBody({
        name,
        description: params.description,
        active: params.active,
        images: parseJsonParam(params.images),
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', '/products', apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          product: result.data,
          metadata: {
            id: result.data.id,
            name: result.data.name,
            active: result.data.active,
          },
        },
      }
    },

    stripe_retrieve_product: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('GET', `/products/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          product: result.data,
          metadata: {
            id: result.data.id,
            name: result.data.name,
            active: result.data.active,
          },
        },
      }
    },

    stripe_update_product: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        name: params.name,
        description: params.description,
        active: params.active,
        images: parseJsonParam(params.images),
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', `/products/${id}`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          product: result.data,
          metadata: {
            id: result.data.id,
            name: result.data.name,
            active: result.data.active,
          },
        },
      }
    },

    stripe_delete_product: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('DELETE', `/products/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          deleted: result.data.deleted,
          id: result.data.id,
        },
      }
    },

    stripe_list_products: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = new URL(`${STRIPE_API}/products`)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.active !== undefined) url.searchParams.append('active', String(params.active))

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          products: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    stripe_search_products: async (params) => {
      const apiKey = params.apiKey as string
      const query = params.query as string
      if (!apiKey || !query) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = new URL(`${STRIPE_API}/products/search`)
      url.searchParams.append('query', query)
      if (params.limit) url.searchParams.append('limit', String(params.limit))

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          products: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    // ========================================================================
    // Prices
    // ========================================================================
    stripe_create_price: async (params) => {
      const apiKey = params.apiKey as string
      const product = params.product as string
      const currency = params.currency as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
      if (!product) return { success: false, output: {}, error: 'Missing required parameter: product' }
      if (!currency) return { success: false, output: {}, error: 'Missing required parameter: currency' }

      const body = buildFormBody({
        product,
        currency,
        unit_amount: params.unit_amount !== undefined ? Number(params.unit_amount) : undefined,
        billing_scheme: params.billing_scheme,
        recurring: parseJsonParam(params.recurring),
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', '/prices', apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          price: result.data,
          metadata: {
            id: result.data.id,
            product: result.data.product,
            unit_amount: result.data.unit_amount ?? null,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_retrieve_price: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('GET', `/prices/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          price: result.data,
          metadata: {
            id: result.data.id,
            product: result.data.product,
            unit_amount: result.data.unit_amount ?? null,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_update_price: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const body = buildFormBody({
        active: params.active,
        metadata: parseJsonParam(params.metadata),
      })

      const result = await stripeRequest('POST', `/prices/${id}`, apiKey, body)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          price: result.data,
          metadata: {
            id: result.data.id,
            product: result.data.product,
            unit_amount: result.data.unit_amount ?? null,
            currency: result.data.currency,
          },
        },
      }
    },

    stripe_list_prices: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = new URL(`${STRIPE_API}/prices`)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.product) url.searchParams.append('product', params.product as string)
      if (params.active !== undefined) url.searchParams.append('active', String(params.active))

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          prices: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    stripe_search_prices: async (params) => {
      const apiKey = params.apiKey as string
      const query = params.query as string
      if (!apiKey || !query) return { success: false, output: {}, error: 'Missing required parameters' }

      const url = new URL(`${STRIPE_API}/prices/search`)
      url.searchParams.append('query', query)
      if (params.limit) url.searchParams.append('limit', String(params.limit))

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          prices: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    // ========================================================================
    // Events
    // ========================================================================
    stripe_retrieve_event: async (params) => {
      const apiKey = params.apiKey as string
      const id = params.id as string
      if (!apiKey || !id) return { success: false, output: {}, error: 'Missing required parameters' }

      const result = await stripeRequest('GET', `/events/${id}`, apiKey)
      if (!result.ok) return { success: false, output: {}, error: result.data.error as string }

      return {
        success: true,
        output: {
          event: result.data,
          metadata: {
            id: result.data.id,
            type: result.data.type,
            created: result.data.created,
          },
        },
      }
    },

    stripe_list_events: async (params) => {
      const apiKey = params.apiKey as string
      if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }

      const url = new URL(`${STRIPE_API}/events`)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.type) url.searchParams.append('type', params.type as string)
      if (params.created) {
        const created = parseJsonParam(params.created) as Record<string, unknown>
        if (typeof created === 'object' && created) {
          for (const [key, value] of Object.entries(created)) {
            url.searchParams.append(`created[${key}]`, String(value))
          }
        }
      }

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}))
        const error = (errData as Record<string, unknown>).error as Record<string, unknown> | undefined
        return { success: false, output: {}, error: (error?.message as string) || `Stripe API error: ${response.status}` }
      }

      const data = await response.json()
      return {
        success: true,
        output: {
          events: data.data || [],
          metadata: {
            count: (data.data || []).length,
            has_more: data.has_more || false,
          },
        },
      }
    },

    /**
     * Verify Stripe webhook signature.
     * Stripe uses: t=timestamp,v1=HMAC_SHA256(timestamp.body, secret)
     * Called by the auth engine for custom auth verification.
     */
    stripe_verify_webhook: async (params) => {
      const headers = params.headers as Record<string, string>
      const body = params.body as string
      const config = params.config as Record<string, unknown>

      const webhookSecret = config.webhookSecret as string | undefined
      if (!webhookSecret) {
        return { success: true, output: { valid: true } }
      }

      const sigHeader = headers['stripe-signature']
      if (!sigHeader) {
        return {
          success: true,
          output: { valid: false, error: 'Missing Stripe-Signature header' },
        }
      }

      // Parse the signature header: t=timestamp,v1=sig1[,v1=sig2...]
      const elements = sigHeader.split(',')
      let timestamp: string | undefined
      const signatures: string[] = []

      for (const element of elements) {
        const [key, value] = element.split('=', 2)
        if (key === 't') {
          timestamp = value
        } else if (key === 'v1') {
          signatures.push(value)
        }
      }

      if (!timestamp || signatures.length === 0) {
        return {
          success: true,
          output: { valid: false, error: 'Invalid Stripe-Signature header format' },
        }
      }

      // Reject requests older than 5 minutes to prevent replay attacks
      const now = Math.floor(Date.now() / 1000)
      if (Math.abs(now - Number(timestamp)) > 300) {
        return {
          success: true,
          output: { valid: false, error: 'Request timestamp too old (possible replay attack)' },
        }
      }

      // Compute expected signature
      const signedPayload = `${timestamp}.${body}`
      const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(signedPayload, 'utf8')
        .digest('hex')

      // Check if any v1 signature matches
      const isValid = signatures.some((sig) => {
        if (sig.length !== expectedSignature.length) return false
        return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSignature))
      })

      return {
        success: true,
        output: { valid: isValid, error: isValid ? undefined : 'Invalid Stripe signature' },
      }
    },
  },
}

export default handler
