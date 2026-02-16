import type { ToolHandler } from '../../sdk/types'

function sfHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  }
}

function sfBaseUrl(instanceUrl: unknown): string {
  return ((instanceUrl as string) || '').replace(/\/+$/, '')
}

async function sfSoqlQuery(instanceUrl: string, accessToken: string, soql: string) {
  const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/query/?q=${encodeURIComponent(soql)}`, {
    headers: sfHeaders(accessToken),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`Salesforce API error: ${response.status} ${err}`)
  }

  return response.json()
}

async function sfCreateRecord(instanceUrl: string, accessToken: string, objectName: string, fields: Record<string, any>) {
  const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/sobjects/${objectName}/`, {
    method: 'POST',
    headers: sfHeaders(accessToken),
    body: JSON.stringify(fields),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`Salesforce API error: ${response.status} ${err}`)
  }

  return response.json()
}

async function sfUpdateRecord(instanceUrl: string, accessToken: string, objectName: string, recordId: string, fields: Record<string, any>) {
  const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/sobjects/${objectName}/${recordId}`, {
    method: 'PATCH',
    headers: sfHeaders(accessToken),
    body: JSON.stringify(fields),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`Salesforce API error: ${response.status} ${err}`)
  }

  return { id: recordId, updated: true }
}

async function sfDeleteRecord(instanceUrl: string, accessToken: string, objectName: string, recordId: string) {
  const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/sobjects/${objectName}/${recordId}`, {
    method: 'DELETE',
    headers: sfHeaders(accessToken),
  })

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`Salesforce API error: ${response.status} ${err}`)
  }

  return { id: recordId, deleted: true }
}

function buildGetQuery(objectName: string, fields: string | undefined, limit: string | undefined, orderBy: string | undefined): string {
  const f = fields || 'FIELDS(STANDARD)'
  let soql = `SELECT ${f} FROM ${objectName}`
  if (orderBy) soql += ` ORDER BY ${orderBy}`
  soql += ` LIMIT ${limit || '25'}`
  return soql
}

const handler: ToolHandler = {
  operations: {
    salesforce_get_accounts: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfSoqlQuery(instanceUrl, accessToken, buildGetQuery('Account', params.fields as string, params.limit as string, params.orderBy as string))
        return { success: true, output: { accounts: data.records, paging: { totalSize: data.totalSize, done: data.done, nextRecordsUrl: data.nextRecordsUrl }, metadata: { totalReturned: data.records.length, hasMore: !data.done }, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_create_account: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = { Name: params.name }
      if (params.type) fields.Type = params.type
      if (params.industry) fields.Industry = params.industry
      if (params.phone) fields.Phone = params.phone
      if (params.website) fields.Website = params.website
      if (params.description) fields.Description = params.description
      if (params.annualRevenue) fields.AnnualRevenue = Number(params.annualRevenue)
      if (params.numberOfEmployees) fields.NumberOfEmployees = Number(params.numberOfEmployees)

      try {
        const data = await sfCreateRecord(instanceUrl, accessToken, 'Account', fields)
        return { success: true, output: { id: data.id, success: data.success, created: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_update_account: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const accountId = params.accountId as string
      if (!accessToken || !instanceUrl || !accountId) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = {}
      if (params.name) fields.Name = params.name
      if (params.type) fields.Type = params.type
      if (params.industry) fields.Industry = params.industry
      if (params.phone) fields.Phone = params.phone
      if (params.website) fields.Website = params.website
      if (params.description) fields.Description = params.description

      try {
        const data = await sfUpdateRecord(instanceUrl, accessToken, 'Account', accountId, fields)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_delete_account: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const accountId = params.accountId as string
      if (!accessToken || !instanceUrl || !accountId) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfDeleteRecord(instanceUrl, accessToken, 'Account', accountId)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_get_contacts: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfSoqlQuery(instanceUrl, accessToken, buildGetQuery('Contact', params.fields as string, params.limit as string, params.orderBy as string))
        return { success: true, output: { contacts: data.records, paging: { totalSize: data.totalSize, done: data.done, nextRecordsUrl: data.nextRecordsUrl }, metadata: { totalReturned: data.records.length, hasMore: !data.done }, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_create_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = { LastName: params.lastName }
      if (params.firstName) fields.FirstName = params.firstName
      if (params.email) fields.Email = params.email
      if (params.phone) fields.Phone = params.phone
      if (params.accountId) fields.AccountId = params.accountId
      if (params.title) fields.Title = params.title
      if (params.department) fields.Department = params.department
      if (params.description) fields.Description = params.description

      try {
        const data = await sfCreateRecord(instanceUrl, accessToken, 'Contact', fields)
        return { success: true, output: { id: data.id, success: data.success, created: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_update_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const contactId = params.contactId as string
      if (!accessToken || !instanceUrl || !contactId) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = {}
      if (params.lastName) fields.LastName = params.lastName
      if (params.firstName) fields.FirstName = params.firstName
      if (params.email) fields.Email = params.email
      if (params.phone) fields.Phone = params.phone
      if (params.title) fields.Title = params.title
      if (params.description) fields.Description = params.description

      try {
        const data = await sfUpdateRecord(instanceUrl, accessToken, 'Contact', contactId, fields)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_delete_contact: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const contactId = params.contactId as string
      if (!accessToken || !instanceUrl || !contactId) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfDeleteRecord(instanceUrl, accessToken, 'Contact', contactId)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_get_leads: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfSoqlQuery(instanceUrl, accessToken, buildGetQuery('Lead', params.fields as string, params.limit as string, params.orderBy as string))
        return { success: true, output: { leads: data.records, paging: { totalSize: data.totalSize, done: data.done, nextRecordsUrl: data.nextRecordsUrl }, metadata: { totalReturned: data.records.length, hasMore: !data.done }, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_create_lead: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = { LastName: params.lastName, Company: params.company }
      if (params.firstName) fields.FirstName = params.firstName
      if (params.email) fields.Email = params.email
      if (params.phone) fields.Phone = params.phone
      if (params.status) fields.Status = params.status
      if (params.leadSource) fields.LeadSource = params.leadSource
      if (params.title) fields.Title = params.title
      if (params.description) fields.Description = params.description

      try {
        const data = await sfCreateRecord(instanceUrl, accessToken, 'Lead', fields)
        return { success: true, output: { id: data.id, success: data.success, created: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_update_lead: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const leadId = params.leadId as string
      if (!accessToken || !instanceUrl || !leadId) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = {}
      if (params.lastName) fields.LastName = params.lastName
      if (params.company) fields.Company = params.company
      if (params.email) fields.Email = params.email
      if (params.phone) fields.Phone = params.phone
      if (params.status) fields.Status = params.status
      if (params.title) fields.Title = params.title
      if (params.description) fields.Description = params.description

      try {
        const data = await sfUpdateRecord(instanceUrl, accessToken, 'Lead', leadId, fields)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_delete_lead: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const leadId = params.leadId as string
      if (!accessToken || !instanceUrl || !leadId) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfDeleteRecord(instanceUrl, accessToken, 'Lead', leadId)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_get_opportunities: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfSoqlQuery(instanceUrl, accessToken, buildGetQuery('Opportunity', params.fields as string, params.limit as string, params.orderBy as string))
        return { success: true, output: { opportunities: data.records, paging: { totalSize: data.totalSize, done: data.done, nextRecordsUrl: data.nextRecordsUrl }, metadata: { totalReturned: data.records.length, hasMore: !data.done }, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_create_opportunity: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = { Name: params.name, StageName: params.stageName, CloseDate: params.closeDate }
      if (params.accountId) fields.AccountId = params.accountId
      if (params.amount) fields.Amount = Number(params.amount)
      if (params.probability) fields.Probability = Number(params.probability)
      if (params.description) fields.Description = params.description

      try {
        const data = await sfCreateRecord(instanceUrl, accessToken, 'Opportunity', fields)
        return { success: true, output: { id: data.id, success: data.success, created: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_update_opportunity: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const opportunityId = params.opportunityId as string
      if (!accessToken || !instanceUrl || !opportunityId) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = {}
      if (params.name) fields.Name = params.name
      if (params.stageName) fields.StageName = params.stageName
      if (params.closeDate) fields.CloseDate = params.closeDate
      if (params.amount) fields.Amount = Number(params.amount)
      if (params.description) fields.Description = params.description

      try {
        const data = await sfUpdateRecord(instanceUrl, accessToken, 'Opportunity', opportunityId, fields)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_delete_opportunity: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const opportunityId = params.opportunityId as string
      if (!accessToken || !instanceUrl || !opportunityId) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfDeleteRecord(instanceUrl, accessToken, 'Opportunity', opportunityId)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_get_cases: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfSoqlQuery(instanceUrl, accessToken, buildGetQuery('Case', params.fields as string, params.limit as string, params.orderBy as string))
        return { success: true, output: { cases: data.records, paging: { totalSize: data.totalSize, done: data.done, nextRecordsUrl: data.nextRecordsUrl }, metadata: { totalReturned: data.records.length, hasMore: !data.done }, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_create_case: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = { Subject: params.subject }
      if (params.status) fields.Status = params.status
      if (params.priority) fields.Priority = params.priority
      if (params.origin) fields.Origin = params.origin
      if (params.contactId) fields.ContactId = params.contactId
      if (params.accountId) fields.AccountId = params.accountId
      if (params.description) fields.Description = params.description

      try {
        const data = await sfCreateRecord(instanceUrl, accessToken, 'Case', fields)
        return { success: true, output: { id: data.id, success: data.success, created: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_update_case: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const caseId = params.caseId as string
      if (!accessToken || !instanceUrl || !caseId) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = {}
      if (params.subject) fields.Subject = params.subject
      if (params.status) fields.Status = params.status
      if (params.priority) fields.Priority = params.priority
      if (params.description) fields.Description = params.description

      try {
        const data = await sfUpdateRecord(instanceUrl, accessToken, 'Case', caseId, fields)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_delete_case: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const caseId = params.caseId as string
      if (!accessToken || !instanceUrl || !caseId) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfDeleteRecord(instanceUrl, accessToken, 'Case', caseId)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_get_tasks: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfSoqlQuery(instanceUrl, accessToken, buildGetQuery('Task', params.fields as string, params.limit as string, params.orderBy as string))
        return { success: true, output: { tasks: data.records, paging: { totalSize: data.totalSize, done: data.done, nextRecordsUrl: data.nextRecordsUrl }, metadata: { totalReturned: data.records.length, hasMore: !data.done }, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_create_task: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = { Subject: params.subject }
      if (params.status) fields.Status = params.status
      if (params.priority) fields.Priority = params.priority
      if (params.activityDate) fields.ActivityDate = params.activityDate
      if (params.whoId) fields.WhoId = params.whoId
      if (params.whatId) fields.WhatId = params.whatId
      if (params.description) fields.Description = params.description

      try {
        const data = await sfCreateRecord(instanceUrl, accessToken, 'Task', fields)
        return { success: true, output: { id: data.id, success: data.success, created: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_update_task: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const taskId = params.taskId as string
      if (!accessToken || !instanceUrl || !taskId) return { success: false, output: {}, error: 'Missing required parameters' }

      const fields: Record<string, any> = {}
      if (params.subject) fields.Subject = params.subject
      if (params.status) fields.Status = params.status
      if (params.priority) fields.Priority = params.priority
      if (params.activityDate) fields.ActivityDate = params.activityDate
      if (params.description) fields.Description = params.description

      try {
        const data = await sfUpdateRecord(instanceUrl, accessToken, 'Task', taskId, fields)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_delete_task: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const taskId = params.taskId as string
      if (!accessToken || !instanceUrl || !taskId) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfDeleteRecord(instanceUrl, accessToken, 'Task', taskId)
        return { success: true, output: data }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_query: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const query = params.query as string
      if (!accessToken || !instanceUrl || !query) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const data = await sfSoqlQuery(instanceUrl, accessToken, query)
        return { success: true, output: { records: data.records, totalSize: data.totalSize, done: data.done, nextRecordsUrl: data.nextRecordsUrl, query, metadata: { totalReturned: data.records.length, hasMore: !data.done }, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_query_more: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const nextRecordsUrl = params.nextRecordsUrl as string
      if (!accessToken || !instanceUrl || !nextRecordsUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const response = await fetch(`${sfBaseUrl(instanceUrl)}${nextRecordsUrl}`, { headers: sfHeaders(accessToken) })
        if (!response.ok) throw new Error(`Salesforce API error: ${response.status}`)
        const data = await response.json()
        return { success: true, output: { records: data.records, totalSize: data.totalSize, done: data.done, nextRecordsUrl: data.nextRecordsUrl, metadata: { totalReturned: data.records.length, hasMore: !data.done }, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_describe_object: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const objectName = params.objectName as string
      if (!accessToken || !instanceUrl || !objectName) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/sobjects/${objectName}/describe/`, { headers: sfHeaders(accessToken) })
        if (!response.ok) throw new Error(`Salesforce API error: ${response.status}`)
        const data = await response.json()
        return { success: true, output: { objectName: data.name, label: data.label, labelPlural: data.labelPlural, fields: data.fields, keyPrefix: data.keyPrefix, queryable: data.queryable, createable: data.createable, updateable: data.updateable, deletable: data.deletable, childRelationships: data.childRelationships, recordTypeInfos: data.recordTypeInfos, fieldCount: data.fields?.length || 0, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_list_objects: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/sobjects/`, { headers: sfHeaders(accessToken) })
        if (!response.ok) throw new Error(`Salesforce API error: ${response.status}`)
        const data = await response.json()
        return { success: true, output: { objects: data.sobjects, encoding: data.encoding, maxBatchSize: data.maxBatchSize, totalReturned: data.sobjects?.length || 0, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_list_reports: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/analytics/reports`, { headers: sfHeaders(accessToken) })
        if (!response.ok) throw new Error(`Salesforce API error: ${response.status}`)
        const data = await response.json()
        return { success: true, output: { reports: data, totalReturned: data.length, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_run_report: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const reportId = params.reportId as string
      if (!accessToken || !instanceUrl || !reportId) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const qp = new URLSearchParams()
        if (params.includeDetails) qp.set('includeDetails', params.includeDetails as string)
        const qs = qp.toString()
        const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/analytics/reports/${reportId}${qs ? `?${qs}` : ''}`, { headers: sfHeaders(accessToken) })
        if (!response.ok) throw new Error(`Salesforce API error: ${response.status}`)
        const data = await response.json()
        return { success: true, output: { reportId, reportMetadata: data.reportMetadata, reportExtendedMetadata: data.reportExtendedMetadata, factMap: data.factMap, groupingsDown: data.groupingsDown, groupingsAcross: data.groupingsAcross, hasDetailRows: data.hasDetailRows, allData: data.allData, reportName: data.reportMetadata?.name, reportFormat: data.reportMetadata?.reportFormat, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_list_dashboards: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      if (!accessToken || !instanceUrl) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/analytics/dashboards`, { headers: sfHeaders(accessToken) })
        if (!response.ok) throw new Error(`Salesforce API error: ${response.status}`)
        const data = await response.json()
        const dashboards = data.dashboards || data
        return { success: true, output: { dashboards, totalReturned: Array.isArray(dashboards) ? dashboards.length : 0, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_get_dashboard: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const dashboardId = params.dashboardId as string
      if (!accessToken || !instanceUrl || !dashboardId) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/analytics/dashboards/${dashboardId}`, { headers: sfHeaders(accessToken) })
        if (!response.ok) throw new Error(`Salesforce API error: ${response.status}`)
        const data = await response.json()
        return { success: true, output: { dashboard: data, dashboardId, components: data.componentData || [], dashboardName: data.name, folderId: data.folderId, runningUser: data.runningUser, success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },

    salesforce_refresh_dashboard: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const instanceUrl = params.instanceUrl as string
      const dashboardId = params.dashboardId as string
      if (!accessToken || !instanceUrl || !dashboardId) return { success: false, output: {}, error: 'Missing required parameters' }

      try {
        const response = await fetch(`${sfBaseUrl(instanceUrl)}/services/data/v60.0/analytics/dashboards/${dashboardId}`, {
          method: 'PUT',
          headers: sfHeaders(accessToken),
          body: JSON.stringify({}),
        })
        if (!response.ok) throw new Error(`Salesforce API error: ${response.status}`)
        const data = await response.json()
        return { success: true, output: { dashboard: data, dashboardId, components: data.componentData || [], dashboardName: data.name, refreshDate: new Date().toISOString(), success: true } }
      } catch (e: any) { return { success: false, output: {}, error: e.message } }
    },
  },
}

export default handler
