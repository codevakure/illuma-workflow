import type { ToolHandler } from '../../sdk/types'

const API_VERSION = '2024-10'

function shopifyUrl(params: Record<string, unknown>): string {
  const domain = (params.shopDomain || params.idToken) as string
  return `https://${domain}/admin/api/${API_VERSION}/graphql.json`
}

function shopifyHeaders(accessToken: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken,
  }
}

function extractEdgeNodes(edges: Array<{ node: unknown }>): unknown[] {
  return (edges || []).map((edge) => edge.node)
}

async function shopifyGql(
  params: Record<string, unknown>,
  query: string,
  variables: Record<string, unknown>
): Promise<{ data: Record<string, unknown> | null; errors: Array<{ message: string }> | null }> {
  const accessToken = params.accessToken as string
  if (!accessToken) throw new Error('Missing access token')

  const response = await fetch(shopifyUrl(params), {
    method: 'POST',
    headers: shopifyHeaders(accessToken),
    body: JSON.stringify({ query, variables }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}: ${text}`)
  }

  return response.json()
}

function gqlError(data: { errors: Array<{ message: string }> | null }, fallback: string): string {
  return data.errors?.[0]?.message || fallback
}

function userErrors(
  result: Record<string, unknown> | null | undefined,
  field: string
): string | null {
  const errors = (result as Record<string, unknown>)?.[field] as
    | Array<{ message: string }>
    | undefined
  if (errors && errors.length > 0) {
    return errors.map((e) => e.message).join(', ')
  }
  return null
}

function parseTags(tags: unknown): string[] | undefined {
  if (!tags) return undefined
  if (Array.isArray(tags)) return tags
  if (typeof tags === 'string') {
    try {
      const parsed = JSON.parse(tags)
      if (Array.isArray(parsed)) return parsed
    } catch {
      return tags
        .split(',')
        .map((t: string) => t.trim())
        .filter(Boolean)
    }
  }
  return undefined
}

function parseAddresses(addresses: unknown): unknown[] | undefined {
  if (!addresses) return undefined
  if (Array.isArray(addresses)) return addresses
  if (typeof addresses === 'string') {
    try {
      const parsed = JSON.parse(addresses)
      if (Array.isArray(parsed)) return parsed
    } catch {
      /* skip */
    }
  }
  return undefined
}

const handler: ToolHandler = {
  operations: {
    shopify_list_products: async (params) => {
      const shopDomain = params.shopDomain || params.idToken
      if (!shopDomain || !params.accessToken) {
        return { success: false, output: {}, error: 'Missing required parameters: shopDomain, accessToken' }
      }

      const first = Math.min((params.first as number) || 50, 250)

      try {
        const data = await shopifyGql(params, `
          query listProducts($first: Int!, $query: String) {
            products(first: $first, query: $query) {
              edges {
                node {
                  id
                  title
                  handle
                  descriptionHtml
                  vendor
                  productType
                  tags
                  status
                  createdAt
                  updatedAt
                  variants(first: 10) {
                    edges {
                      node {
                        id
                        title
                        price
                        compareAtPrice
                        sku
                        inventoryQuantity
                      }
                    }
                  }
                  images(first: 5) {
                    edges {
                      node {
                        id
                        url
                        altText
                      }
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
              }
            }
          }
        `, { first, query: (params.query as string) || null })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to list products') }
        }

        const productsData = (data.data as Record<string, unknown>)?.products as Record<string, unknown>
        if (!productsData) {
          return { success: false, output: {}, error: 'Failed to retrieve products' }
        }

        const products = extractEdgeNodes(productsData.edges as Array<{ node: unknown }>)
        return { success: true, output: { products, pageInfo: productsData.pageInfo } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_get_product: async (params) => {
      const productId = params.productId as string
      if (!params.accessToken || !productId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      try {
        const data = await shopifyGql(params, `
          query getProduct($id: ID!) {
            product(id: $id) {
              id
              title
              handle
              descriptionHtml
              vendor
              productType
              tags
              status
              createdAt
              updatedAt
              variants(first: 50) {
                edges {
                  node {
                    id
                    title
                    price
                    compareAtPrice
                    sku
                    inventoryQuantity
                  }
                }
              }
              images(first: 20) {
                edges {
                  node {
                    id
                    url
                    altText
                  }
                }
              }
            }
          }
        `, { id: productId })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to get product') }
        }

        const product = (data.data as Record<string, unknown>)?.product
        if (!product) {
          return { success: false, output: {}, error: 'Product not found' }
        }

        return { success: true, output: { product } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_create_product: async (params) => {
      const title = params.title as string
      if (!params.accessToken || !title?.trim()) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, title' }
      }

      const input: Record<string, unknown> = { title }
      if (params.descriptionHtml) input.descriptionHtml = params.descriptionHtml
      if (params.vendor) input.vendor = params.vendor
      if (params.productType) input.productType = params.productType
      if (params.status) input.status = params.status
      const tags = parseTags(params.tags)
      if (tags) input.tags = tags

      try {
        const data = await shopifyGql(params, `
          mutation productCreate($input: ProductInput!) {
            productCreate(input: $input) {
              product {
                id
                title
                handle
                descriptionHtml
                vendor
                productType
                tags
                status
                createdAt
                updatedAt
                variants(first: 10) {
                  edges {
                    node {
                      id
                      title
                      price
                      compareAtPrice
                      sku
                      inventoryQuantity
                    }
                  }
                }
                images(first: 10) {
                  edges {
                    node {
                      id
                      url
                      altText
                    }
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `, { input })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to create product') }
        }

        const result = (data.data as Record<string, unknown>)?.productCreate as Record<string, unknown>
        const ue = userErrors(result, 'userErrors')
        if (ue) return { success: false, output: {}, error: ue }

        const product = result?.product
        if (!product) {
          return { success: false, output: {}, error: 'Product creation was not successful' }
        }

        return { success: true, output: { product } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_update_product: async (params) => {
      const productId = params.productId as string
      if (!params.accessToken || !productId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const input: Record<string, unknown> = { id: productId }
      if (params.title !== undefined) input.title = params.title
      if (params.descriptionHtml !== undefined) input.descriptionHtml = params.descriptionHtml
      if (params.vendor !== undefined) input.vendor = params.vendor
      if (params.productType !== undefined) input.productType = params.productType
      if (params.status !== undefined) input.status = params.status
      if (params.tags !== undefined) {
        const tags = parseTags(params.tags)
        if (tags) input.tags = tags
      }

      try {
        const data = await shopifyGql(params, `
          mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
              product {
                id
                title
                handle
                descriptionHtml
                vendor
                productType
                tags
                status
                createdAt
                updatedAt
                variants(first: 10) {
                  edges {
                    node {
                      id
                      title
                      price
                      compareAtPrice
                      sku
                      inventoryQuantity
                    }
                  }
                }
                images(first: 10) {
                  edges {
                    node {
                      id
                      url
                      altText
                    }
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `, { input })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to update product') }
        }

        const result = (data.data as Record<string, unknown>)?.productUpdate as Record<string, unknown>
        const ue = userErrors(result, 'userErrors')
        if (ue) return { success: false, output: {}, error: ue }

        const product = result?.product
        if (!product) {
          return { success: false, output: {}, error: 'Product update was not successful' }
        }

        return { success: true, output: { product } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_delete_product: async (params) => {
      const productId = params.productId as string
      if (!params.accessToken || !productId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      try {
        const data = await shopifyGql(params, `
          mutation productDelete($input: ProductDeleteInput!) {
            productDelete(input: $input) {
              deletedProductId
              userErrors {
                field
                message
              }
            }
          }
        `, { input: { id: productId } })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to delete product') }
        }

        const result = (data.data as Record<string, unknown>)?.productDelete as Record<string, unknown>
        const ue = userErrors(result, 'userErrors')
        if (ue) return { success: false, output: {}, error: ue }

        if (!result?.deletedProductId) {
          return { success: false, output: {}, error: 'Product deletion was not successful' }
        }

        return { success: true, output: { deletedId: result.deletedProductId } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_list_orders: async (params) => {
      const shopDomain = params.shopDomain || params.idToken
      if (!shopDomain || !params.accessToken) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const first = Math.min((params.first as number) || 50, 250)
      const queryParts: string[] = []
      if (params.status && params.status !== 'any') {
        queryParts.push(`status:${params.status}`)
      }
      if (params.query) {
        queryParts.push(params.query as string)
      }
      const queryString = queryParts.length > 0 ? queryParts.join(' ') : null

      try {
        const data = await shopifyGql(params, `
          query listOrders($first: Int!, $query: String) {
            orders(first: $first, query: $query) {
              edges {
                node {
                  id
                  name
                  email
                  phone
                  createdAt
                  updatedAt
                  cancelledAt
                  closedAt
                  displayFinancialStatus
                  displayFulfillmentStatus
                  totalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  subtotalPriceSet {
                    shopMoney {
                      amount
                      currencyCode
                    }
                  }
                  note
                  tags
                  customer {
                    id
                    email
                    firstName
                    lastName
                  }
                  lineItems(first: 10) {
                    edges {
                      node {
                        id
                        title
                        quantity
                        variant {
                          id
                          title
                          price
                          sku
                        }
                      }
                    }
                  }
                  shippingAddress {
                    firstName
                    lastName
                    city
                    province
                    country
                    zip
                  }
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
              }
            }
          }
        `, { first, query: queryString })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to list orders') }
        }

        const ordersData = (data.data as Record<string, unknown>)?.orders as Record<string, unknown>
        if (!ordersData) {
          return { success: false, output: {}, error: 'Failed to retrieve orders' }
        }

        const orders = extractEdgeNodes(ordersData.edges as Array<{ node: unknown }>)
        return { success: true, output: { orders, pageInfo: ordersData.pageInfo } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_get_order: async (params) => {
      const orderId = params.orderId as string
      if (!params.accessToken || !orderId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      try {
        const data = await shopifyGql(params, `
          query getOrder($id: ID!) {
            order(id: $id) {
              id
              name
              email
              phone
              createdAt
              updatedAt
              cancelledAt
              closedAt
              displayFinancialStatus
              displayFulfillmentStatus
              totalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              subtotalPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalTaxSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              totalShippingPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
              note
              tags
              customer {
                id
                email
                firstName
                lastName
                phone
              }
              lineItems(first: 50) {
                edges {
                  node {
                    id
                    title
                    quantity
                    variant {
                      id
                      title
                      price
                      sku
                    }
                    originalTotalSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                    discountedTotalSet {
                      shopMoney {
                        amount
                        currencyCode
                      }
                    }
                  }
                }
              }
              shippingAddress {
                firstName
                lastName
                address1
                address2
                city
                province
                provinceCode
                country
                countryCode
                zip
                phone
              }
              billingAddress {
                firstName
                lastName
                address1
                address2
                city
                province
                provinceCode
                country
                countryCode
                zip
                phone
              }
              fulfillments {
                id
                status
                createdAt
                updatedAt
                trackingInfo {
                  company
                  number
                  url
                }
              }
            }
          }
        `, { id: orderId })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to get order') }
        }

        const order = (data.data as Record<string, unknown>)?.order
        if (!order) {
          return { success: false, output: {}, error: 'Order not found' }
        }

        return { success: true, output: { order } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_update_order: async (params) => {
      const orderId = params.orderId as string
      if (!params.accessToken || !orderId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const input: Record<string, unknown> = { id: orderId }
      if (params.note !== undefined) input.note = params.note
      if (params.tags !== undefined) {
        const tags = parseTags(params.tags)
        if (tags) input.tags = tags
      }
      if (params.email !== undefined) input.email = params.email

      try {
        const data = await shopifyGql(params, `
          mutation orderUpdate($input: OrderInput!) {
            orderUpdate(input: $input) {
              order {
                id
                name
                email
                phone
                createdAt
                updatedAt
                note
                tags
                displayFinancialStatus
                displayFulfillmentStatus
                totalPriceSet {
                  shopMoney {
                    amount
                    currencyCode
                  }
                }
                customer {
                  id
                  email
                  firstName
                  lastName
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `, { input })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to update order') }
        }

        const result = (data.data as Record<string, unknown>)?.orderUpdate as Record<string, unknown>
        const ue = userErrors(result, 'userErrors')
        if (ue) return { success: false, output: {}, error: ue }

        const order = result?.order
        if (!order) {
          return { success: false, output: {}, error: 'Order update was not successful' }
        }

        return { success: true, output: { order } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_cancel_order: async (params) => {
      const orderId = params.orderId as string
      const reason = params.reason as string
      if (!params.accessToken || !orderId || !reason) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, orderId, reason' }
      }

      try {
        const data = await shopifyGql(params, `
          mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $notifyCustomer: Boolean, $refund: Boolean!, $restock: Boolean!, $staffNote: String) {
            orderCancel(orderId: $orderId, reason: $reason, notifyCustomer: $notifyCustomer, refund: $refund, restock: $restock, staffNote: $staffNote) {
              job {
                id
                done
              }
              orderCancelUserErrors {
                field
                message
                code
              }
            }
          }
        `, {
          orderId,
          reason,
          notifyCustomer: (params.notifyCustomer as boolean) ?? false,
          refund: (params.refund as boolean) ?? false,
          restock: (params.restock as boolean) ?? false,
          staffNote: (params.staffNote as string) || null,
        })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to cancel order') }
        }

        const result = (data.data as Record<string, unknown>)?.orderCancel as Record<string, unknown>
        const ue = userErrors(result, 'orderCancelUserErrors')
        if (ue) return { success: false, output: {}, error: ue }

        const job = result?.job as Record<string, unknown> | undefined
        return {
          success: true,
          output: {
            order: {
              id: job?.id,
              cancelled: job?.done ?? true,
              message: 'Order cancellation initiated',
            },
          },
        }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_list_customers: async (params) => {
      const shopDomain = params.shopDomain || params.idToken
      if (!shopDomain || !params.accessToken) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const first = Math.min((params.first as number) || 50, 250)

      try {
        const data = await shopifyGql(params, `
          query listCustomers($first: Int!, $query: String) {
            customers(first: $first, query: $query) {
              edges {
                node {
                  id
                  email
                  firstName
                  lastName
                  phone
                  createdAt
                  updatedAt
                  note
                  tags
                  amountSpent {
                    amount
                    currencyCode
                  }
                  defaultAddress {
                    address1
                    city
                    province
                    country
                    zip
                  }
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
              }
            }
          }
        `, { first, query: (params.query as string) || null })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to list customers') }
        }

        const customersData = (data.data as Record<string, unknown>)?.customers as Record<string, unknown>
        if (!customersData) {
          return { success: false, output: {}, error: 'Failed to retrieve customers' }
        }

        const customers = extractEdgeNodes(customersData.edges as Array<{ node: unknown }>)
        return { success: true, output: { customers, pageInfo: customersData.pageInfo } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_get_customer: async (params) => {
      const customerId = params.customerId as string
      if (!params.accessToken || !customerId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      try {
        const data = await shopifyGql(params, `
          query getCustomer($id: ID!) {
            customer(id: $id) {
              id
              email
              firstName
              lastName
              phone
              createdAt
              updatedAt
              note
              tags
              amountSpent {
                amount
                currencyCode
              }
              addresses {
                firstName
                lastName
                address1
                address2
                city
                province
                provinceCode
                country
                countryCode
                zip
                phone
              }
              defaultAddress {
                firstName
                lastName
                address1
                address2
                city
                province
                country
                zip
              }
            }
          }
        `, { id: customerId })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to get customer') }
        }

        const customer = (data.data as Record<string, unknown>)?.customer
        if (!customer) {
          return { success: false, output: {}, error: 'Customer not found' }
        }

        return { success: true, output: { customer } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_create_customer: async (params) => {
      if (!params.accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const hasEmail = (params.email as string)?.trim()
      const hasPhone = (params.phone as string)?.trim()
      const hasFirstName = (params.firstName as string)?.trim()
      const hasLastName = (params.lastName as string)?.trim()

      if (!hasEmail && !hasPhone && !hasFirstName && !hasLastName) {
        return { success: false, output: {}, error: 'Customer must have at least one of: email, phone, firstName, or lastName' }
      }

      const input: Record<string, unknown> = {}
      if (hasEmail) input.email = params.email
      if (hasFirstName) input.firstName = params.firstName
      if (hasLastName) input.lastName = params.lastName
      if (hasPhone) input.phone = params.phone
      if (params.note) input.note = params.note
      const tags = parseTags(params.tags)
      if (tags) input.tags = tags
      const addresses = parseAddresses(params.addresses)
      if (addresses) input.addresses = addresses

      try {
        const data = await shopifyGql(params, `
          mutation customerCreate($input: CustomerInput!) {
            customerCreate(input: $input) {
              customer {
                id
                email
                firstName
                lastName
                phone
                createdAt
                updatedAt
                note
                tags
                amountSpent {
                  amount
                  currencyCode
                }
                addresses {
                  address1
                  address2
                  city
                  province
                  country
                  zip
                  phone
                }
                defaultAddress {
                  address1
                  city
                  province
                  country
                  zip
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `, { input })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to create customer') }
        }

        const result = (data.data as Record<string, unknown>)?.customerCreate as Record<string, unknown>
        const ue = userErrors(result, 'userErrors')
        if (ue) return { success: false, output: {}, error: ue }

        const customer = result?.customer
        if (!customer) {
          return { success: false, output: {}, error: 'Customer creation was not successful' }
        }

        return { success: true, output: { customer } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_update_customer: async (params) => {
      const customerId = params.customerId as string
      if (!params.accessToken || !customerId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const input: Record<string, unknown> = { id: customerId }
      if (params.email !== undefined) input.email = params.email
      if (params.firstName !== undefined) input.firstName = params.firstName
      if (params.lastName !== undefined) input.lastName = params.lastName
      if (params.phone !== undefined) input.phone = params.phone
      if (params.note !== undefined) input.note = params.note
      if (params.tags !== undefined) {
        const tags = parseTags(params.tags)
        if (tags) input.tags = tags
      }

      try {
        const data = await shopifyGql(params, `
          mutation customerUpdate($input: CustomerInput!) {
            customerUpdate(input: $input) {
              customer {
                id
                email
                firstName
                lastName
                phone
                createdAt
                updatedAt
                note
                tags
                amountSpent {
                  amount
                  currencyCode
                }
                addresses {
                  address1
                  city
                  province
                  country
                  zip
                }
                defaultAddress {
                  address1
                  city
                  province
                  country
                  zip
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `, { input })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to update customer') }
        }

        const result = (data.data as Record<string, unknown>)?.customerUpdate as Record<string, unknown>
        const ue = userErrors(result, 'userErrors')
        if (ue) return { success: false, output: {}, error: ue }

        const customer = result?.customer
        if (!customer) {
          return { success: false, output: {}, error: 'Customer update was not successful' }
        }

        return { success: true, output: { customer } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_delete_customer: async (params) => {
      const customerId = params.customerId as string
      if (!params.accessToken || !customerId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      try {
        const data = await shopifyGql(params, `
          mutation customerDelete($input: CustomerDeleteInput!) {
            customerDelete(input: $input) {
              deletedCustomerId
              userErrors {
                field
                message
              }
            }
          }
        `, { input: { id: customerId } })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to delete customer') }
        }

        const result = (data.data as Record<string, unknown>)?.customerDelete as Record<string, unknown>
        const ue = userErrors(result, 'userErrors')
        if (ue) return { success: false, output: {}, error: ue }

        if (!result?.deletedCustomerId) {
          return { success: false, output: {}, error: 'Customer deletion was not successful' }
        }

        return { success: true, output: { deletedId: result.deletedCustomerId } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_create_fulfillment: async (params) => {
      const fulfillmentOrderId = params.fulfillmentOrderId as string
      if (!params.accessToken || !fulfillmentOrderId) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, fulfillmentOrderId' }
      }

      const trackingInfo: Record<string, unknown> = {}
      if (params.trackingNumber) trackingInfo.number = params.trackingNumber
      if (params.trackingCompany) trackingInfo.company = params.trackingCompany
      if (params.trackingUrl) trackingInfo.url = params.trackingUrl

      const fulfillmentInput: Record<string, unknown> = {
        lineItemsByFulfillmentOrder: [{ fulfillmentOrderId }],
        notifyCustomer: (params.notifyCustomer as boolean) !== false,
      }
      if (Object.keys(trackingInfo).length > 0) {
        fulfillmentInput.trackingInfo = trackingInfo
      }

      try {
        const data = await shopifyGql(params, `
          mutation fulfillmentCreateV2($fulfillment: FulfillmentV2Input!) {
            fulfillmentCreateV2(fulfillment: $fulfillment) {
              fulfillment {
                id
                status
                createdAt
                updatedAt
                trackingInfo {
                  company
                  number
                  url
                }
                fulfillmentLineItems(first: 50) {
                  edges {
                    node {
                      id
                      quantity
                      lineItem {
                        title
                      }
                    }
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `, { fulfillment: fulfillmentInput })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to create fulfillment') }
        }

        const result = (data.data as Record<string, unknown>)?.fulfillmentCreateV2 as Record<string, unknown>
        if (!result) {
          return { success: false, output: {}, error: 'Failed to create fulfillment' }
        }

        const ue = userErrors(result, 'userErrors')
        if (ue) return { success: false, output: {}, error: ue }

        const fulfillment = result.fulfillment as Record<string, unknown>
        if (!fulfillment) {
          return { success: false, output: {}, error: 'No fulfillment returned' }
        }

        const fulfillmentLineItems = extractEdgeNodes(
          ((fulfillment.fulfillmentLineItems as Record<string, unknown>)?.edges as Array<{ node: unknown }>) || []
        )

        return {
          success: true,
          output: {
            fulfillment: {
              id: fulfillment.id,
              status: fulfillment.status,
              createdAt: fulfillment.createdAt,
              updatedAt: fulfillment.updatedAt,
              trackingInfo: fulfillment.trackingInfo || [],
              fulfillmentLineItems,
            },
          },
        }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_get_inventory_level: async (params) => {
      const inventoryItemId = params.inventoryItemId as string
      if (!params.accessToken || !inventoryItemId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      try {
        const data = await shopifyGql(params, `
          query getInventoryItem($id: ID!) {
            inventoryItem(id: $id) {
              id
              sku
              tracked
              inventoryLevels(first: 50) {
                edges {
                  node {
                    id
                    quantities(names: ["available", "on_hand", "committed", "incoming", "reserved"]) {
                      name
                      quantity
                    }
                    location {
                      id
                      name
                    }
                  }
                }
              }
            }
          }
        `, { id: inventoryItemId })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to get inventory level') }
        }

        const inventoryItem = (data.data as Record<string, unknown>)?.inventoryItem as Record<string, unknown>
        if (!inventoryItem) {
          return { success: false, output: {}, error: 'Inventory item not found' }
        }

        const inventoryLevelsData = inventoryItem.inventoryLevels as Record<string, unknown>
        const edges = (inventoryLevelsData?.edges as Array<{ node: Record<string, unknown> }>) || []

        const inventoryLevels = edges.map((edge) => {
          const node = edge.node
          const quantities = (node.quantities as Array<{ name: string; quantity: number }>) || []
          const quantitiesMap: Record<string, number> = {}
          quantities.forEach((q) => {
            quantitiesMap[q.name] = q.quantity
          })
          return {
            id: node.id,
            available: quantitiesMap.available ?? 0,
            onHand: quantitiesMap.on_hand ?? 0,
            committed: quantitiesMap.committed ?? 0,
            incoming: quantitiesMap.incoming ?? 0,
            reserved: quantitiesMap.reserved ?? 0,
            location: node.location,
          }
        })

        return {
          success: true,
          output: {
            inventoryLevel: {
              id: inventoryItem.id,
              sku: inventoryItem.sku,
              tracked: inventoryItem.tracked,
              levels: inventoryLevels,
            },
          },
        }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_adjust_inventory: async (params) => {
      const inventoryItemId = params.inventoryItemId as string
      const locationId = params.locationId as string
      const delta = params.delta as number
      if (!params.accessToken || !inventoryItemId || !locationId || delta === undefined || delta === null) {
        return { success: false, output: {}, error: 'Missing required parameters: accessToken, inventoryItemId, locationId, delta' }
      }

      try {
        const data = await shopifyGql(params, `
          mutation inventoryAdjustQuantities($input: InventoryAdjustQuantitiesInput!) {
            inventoryAdjustQuantities(input: $input) {
              inventoryAdjustmentGroup {
                createdAt
                reason
                changes {
                  name
                  delta
                  quantityAfterChange
                  item {
                    id
                    sku
                  }
                  location {
                    id
                    name
                  }
                }
              }
              userErrors {
                field
                message
              }
            }
          }
        `, {
          input: {
            reason: 'correction',
            name: 'available',
            changes: [{ inventoryItemId, locationId, delta }],
          },
        })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to adjust inventory') }
        }

        const result = (data.data as Record<string, unknown>)?.inventoryAdjustQuantities as Record<string, unknown>
        const ue = userErrors(result, 'userErrors')
        if (ue) return { success: false, output: {}, error: ue }

        const adjustmentGroup = result?.inventoryAdjustmentGroup as Record<string, unknown>
        if (!adjustmentGroup) {
          return { success: false, output: {}, error: 'Inventory adjustment was not successful' }
        }

        return {
          success: true,
          output: {
            inventoryLevel: {
              adjustmentGroup,
              changes: adjustmentGroup.changes,
            },
          },
        }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_list_inventory_items: async (params) => {
      const shopDomain = params.shopDomain || params.idToken
      if (!shopDomain || !params.accessToken) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const first = Math.min((params.first as number) || 50, 250)

      try {
        const data = await shopifyGql(params, `
          query listInventoryItems($first: Int!, $query: String) {
            inventoryItems(first: $first, query: $query) {
              edges {
                node {
                  id
                  sku
                  tracked
                  createdAt
                  updatedAt
                  variant {
                    id
                    title
                    product {
                      id
                      title
                    }
                  }
                  inventoryLevels(first: 10) {
                    edges {
                      node {
                        id
                        quantities(names: ["available", "on_hand"]) {
                          name
                          quantity
                        }
                        location {
                          id
                          name
                        }
                      }
                    }
                  }
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
              }
            }
          }
        `, { first, query: (params.query as string) || null })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to list inventory items') }
        }

        const inventoryItemsData = (data.data as Record<string, unknown>)?.inventoryItems as Record<string, unknown>
        if (!inventoryItemsData) {
          return { success: false, output: {}, error: 'Failed to retrieve inventory items' }
        }

        const edges = (inventoryItemsData.edges as Array<{ node: Record<string, unknown> }>) || []
        const inventoryItems = edges.map((edge) => {
          const node = edge.node
          const levelsData = node.inventoryLevels as Record<string, unknown>
          const levelEdges = (levelsData?.edges as Array<{ node: Record<string, unknown> }>) || []

          const inventoryLevels = levelEdges.map((levelEdge) => {
            const levelNode = levelEdge.node
            const quantities = (levelNode.quantities as Array<{ name: string; quantity: number }>) || []
            const availableQty = quantities.find((q) => q.name === 'available')?.quantity ?? 0
            return {
              id: levelNode.id,
              available: availableQty,
              location: levelNode.location,
            }
          })

          return {
            id: node.id,
            sku: node.sku,
            tracked: node.tracked,
            createdAt: node.createdAt,
            updatedAt: node.updatedAt,
            variant: node.variant,
            inventoryLevels,
          }
        })

        return { success: true, output: { inventoryItems, pageInfo: inventoryItemsData.pageInfo } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_list_locations: async (params) => {
      const shopDomain = params.shopDomain || params.idToken
      if (!shopDomain || !params.accessToken) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const first = Math.min((params.first as number) || 50, 250)

      try {
        const data = await shopifyGql(params, `
          query listLocations($first: Int!, $includeInactive: Boolean) {
            locations(first: $first, includeInactive: $includeInactive) {
              edges {
                node {
                  id
                  name
                  isActive
                  fulfillsOnlineOrders
                  address {
                    address1
                    address2
                    city
                    province
                    provinceCode
                    country
                    countryCode
                    zip
                    phone
                  }
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
              }
            }
          }
        `, { first, includeInactive: (params.includeInactive as boolean) || false })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to list locations') }
        }

        const locationsData = (data.data as Record<string, unknown>)?.locations as Record<string, unknown>
        if (!locationsData) {
          return { success: false, output: {}, error: 'Failed to retrieve locations' }
        }

        const locations = extractEdgeNodes(locationsData.edges as Array<{ node: unknown }>)
        return { success: true, output: { locations, pageInfo: locationsData.pageInfo } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_list_collections: async (params) => {
      const shopDomain = params.shopDomain || params.idToken
      if (!shopDomain || !params.accessToken) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const first = Math.min((params.first as number) || 50, 250)

      try {
        const data = await shopifyGql(params, `
          query listCollections($first: Int!, $query: String) {
            collections(first: $first, query: $query) {
              edges {
                node {
                  id
                  title
                  handle
                  description
                  descriptionHtml
                  productsCount {
                    count
                  }
                  sortOrder
                  updatedAt
                  image {
                    url
                    altText
                  }
                }
              }
              pageInfo {
                hasNextPage
                hasPreviousPage
              }
            }
          }
        `, { first, query: (params.query as string) || null })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to list collections') }
        }

        const collectionsData = (data.data as Record<string, unknown>)?.collections as Record<string, unknown>
        if (!collectionsData) {
          return { success: false, output: {}, error: 'Failed to retrieve collections' }
        }

        const edges = (collectionsData.edges as Array<{ node: Record<string, unknown> }>) || []
        const collections = edges.map((edge) => {
          const node = edge.node
          const productsCount = node.productsCount as Record<string, unknown> | undefined
          return {
            id: node.id,
            title: node.title,
            handle: node.handle,
            description: node.description,
            descriptionHtml: node.descriptionHtml,
            productsCount: (productsCount?.count as number) ?? 0,
            sortOrder: node.sortOrder,
            updatedAt: node.updatedAt,
            image: node.image,
          }
        })

        return { success: true, output: { collections, pageInfo: collectionsData.pageInfo } }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },

    shopify_get_collection: async (params) => {
      const collectionId = params.collectionId as string
      if (!params.accessToken || !collectionId) {
        return { success: false, output: {}, error: 'Missing required parameters' }
      }

      const productsFirst = Math.min((params.productsFirst as number) || 50, 250)

      try {
        const data = await shopifyGql(params, `
          query getCollection($id: ID!, $productsFirst: Int!) {
            collection(id: $id) {
              id
              title
              handle
              description
              descriptionHtml
              productsCount {
                count
              }
              sortOrder
              updatedAt
              image {
                url
                altText
              }
              products(first: $productsFirst) {
                edges {
                  node {
                    id
                    title
                    handle
                    status
                    vendor
                    productType
                    totalInventory
                    featuredMedia {
                      preview {
                        image {
                          url
                          altText
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        `, { id: collectionId, productsFirst })

        if (data.errors) {
          return { success: false, output: {}, error: gqlError(data, 'Failed to get collection') }
        }

        const collection = (data.data as Record<string, unknown>)?.collection as Record<string, unknown>
        if (!collection) {
          return { success: false, output: {}, error: 'Collection not found' }
        }

        const productsEdges = ((collection.products as Record<string, unknown>)?.edges as Array<{ node: Record<string, unknown> }>) || []
        const products = productsEdges.map((edge) => {
          const product = edge.node
          const featuredMedia = product.featuredMedia as Record<string, unknown> | undefined
          const preview = featuredMedia?.preview as Record<string, unknown> | undefined
          const image = preview?.image as Record<string, unknown> | undefined
          return {
            id: product.id,
            title: product.title,
            handle: product.handle,
            status: product.status,
            vendor: product.vendor,
            productType: product.productType,
            totalInventory: product.totalInventory,
            featuredImage: image || null,
          }
        })

        const productsCount = collection.productsCount as Record<string, unknown> | undefined
        return {
          success: true,
          output: {
            collection: {
              id: collection.id,
              title: collection.title,
              handle: collection.handle,
              description: collection.description,
              descriptionHtml: collection.descriptionHtml,
              productsCount: (productsCount?.count as number) ?? 0,
              sortOrder: collection.sortOrder,
              updatedAt: collection.updatedAt,
              image: collection.image,
              products,
            },
          },
        }
      } catch (err) {
        return { success: false, output: {}, error: (err as Error).message }
      }
    },
  },
}

export default handler
