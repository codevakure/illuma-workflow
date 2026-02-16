import type { ToolHandler } from '../../sdk/types'

const API_BASE = 'https://api.incident.io/v2'

async function incidentioRequest(
  apiKey: string,
  method: string,
  path: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }

  const opts: RequestInit = { method, headers }
  if (body && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
    opts.body = JSON.stringify(body)
  }

  const response = await fetch(`${API_BASE}${path}`, opts)

  if (method === 'DELETE' && response.ok) {
    return { ok: true, data: { deleted: true } }
  }

  const data = await response.json().catch(() => ({}))
  return { ok: response.ok, data: data as Record<string, unknown> }
}

function getApiKey(params: Record<string, unknown>): string {
  return (params.apiKey as string) || ''
}

function errMsg(data: Record<string, unknown>, fallback: string): string {
  if (data.error && typeof data.error === 'object') {
    return ((data.error as Record<string, unknown>).message as string) ?? fallback
  }
  return (data.message as string) ?? (data.detail as string) ?? fallback
}

function buildQueryString(params: Record<string, unknown>, mapping: Record<string, string>): string {
  const sp = new URLSearchParams()
  for (const [paramKey, queryKey] of Object.entries(mapping)) {
    const val = params[paramKey]
    if (val !== undefined && val !== null && val !== '') sp.set(queryKey, String(val))
  }
  const qs = sp.toString()
  return qs ? `?${qs}` : ''
}

function listOp(resource: string, path: string, queryMapping: Record<string, string> = {}): (params: Record<string, unknown>) => Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  return async (params) => {
    const apiKey = getApiKey(params)
    if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
    const qs = buildQueryString(params, { pageSize: 'page_size', after: 'after', ...queryMapping })
    const { ok, data } = await incidentioRequest(apiKey, 'GET', `${path}${qs}`)
    if (!ok) return { success: false, output: {}, error: errMsg(data, `Failed to list ${resource}`) }
    return { success: true, output: data }
  }
}

function showOp(resource: string, pathFn: (params: Record<string, unknown>) => string, idParam: string): (params: Record<string, unknown>) => Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  return async (params) => {
    const apiKey = getApiKey(params)
    const id = params[idParam] as string
    if (!apiKey || !id) return { success: false, output: {}, error: `Missing required parameters: apiKey, ${idParam}` }
    const { ok, data } = await incidentioRequest(apiKey, 'GET', pathFn(params))
    if (!ok) return { success: false, output: {}, error: errMsg(data, `Failed to get ${resource}`) }
    return { success: true, output: data }
  }
}

function createOp(resource: string, path: string, bodyBuilder: (params: Record<string, unknown>) => Record<string, unknown>): (params: Record<string, unknown>) => Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  return async (params) => {
    const apiKey = getApiKey(params)
    if (!apiKey) return { success: false, output: {}, error: 'Missing required parameter: apiKey' }
    const body = bodyBuilder(params)
    const { ok, data } = await incidentioRequest(apiKey, 'POST', path, body)
    if (!ok) return { success: false, output: {}, error: errMsg(data, `Failed to create ${resource}`) }
    return { success: true, output: data }
  }
}

function updateOp(resource: string, pathFn: (params: Record<string, unknown>) => string, idParam: string, bodyBuilder: (params: Record<string, unknown>) => Record<string, unknown>): (params: Record<string, unknown>) => Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  return async (params) => {
    const apiKey = getApiKey(params)
    const id = params[idParam] as string
    if (!apiKey || !id) return { success: false, output: {}, error: `Missing required parameters: apiKey, ${idParam}` }
    const body = bodyBuilder(params)
    const { ok, data } = await incidentioRequest(apiKey, 'PUT', pathFn(params), body)
    if (!ok) return { success: false, output: {}, error: errMsg(data, `Failed to update ${resource}`) }
    return { success: true, output: data }
  }
}

function deleteOp(resource: string, pathFn: (params: Record<string, unknown>) => string, idParam: string): (params: Record<string, unknown>) => Promise<{ success: boolean; output: Record<string, unknown>; error?: string }> {
  return async (params) => {
    const apiKey = getApiKey(params)
    const id = params[idParam] as string
    if (!apiKey || !id) return { success: false, output: {}, error: `Missing required parameters: apiKey, ${idParam}` }
    const { ok, data } = await incidentioRequest(apiKey, 'DELETE', pathFn(params))
    if (!ok) return { success: false, output: {}, error: errMsg(data, `Failed to delete ${resource}`) }
    return { success: true, output: data }
  }
}

function filterUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''))
}

const handler: ToolHandler = {
  operations: {
    incidentio_incidents_list: listOp('incidents', '/incidents', { status: 'status[one_of]' }),
    incidentio_incidents_show: showOp('incident', (p) => `/incidents/${p.incidentId}`, 'incidentId'),
    incidentio_incidents_create: createOp('incident', '/incidents', (p) => filterUndefined({
      idempotency_key: crypto.randomUUID(),
      incident_type_id: p.incidentTypeId,
      name: p.name,
      summary: p.summary,
      severity_id: p.severityId,
      mode: p.mode ?? 'standard',
      visibility: p.visibility ?? 'public',
      status: p.status,
      custom_field_entries: p.customFieldEntries,
      incident_role_assignments: p.incidentRoleAssignments,
    })),
    incidentio_incidents_update: updateOp('incident', (p) => `/incidents/${p.incidentId}`, 'incidentId', (p) => filterUndefined({
      incident: filterUndefined({
        name: p.name,
        summary: p.summary,
        severity_id: p.severityId,
        status: p.status,
        custom_field_entries: p.customFieldEntries,
        incident_role_assignments: p.incidentRoleAssignments,
      }),
    })),

    incidentio_actions_list: listOp('actions', '/actions', { incidentId: 'incident_id' }),
    incidentio_actions_show: showOp('action', (p) => `/actions/${p.actionId}`, 'actionId'),

    incidentio_follow_ups_list: listOp('follow-ups', '/follow_ups', { incidentId: 'incident_id' }),
    incidentio_follow_ups_show: showOp('follow-up', (p) => `/follow_ups/${p.followUpId}`, 'followUpId'),

    incidentio_workflows_list: listOp('workflows', '/workflows'),
    incidentio_workflows_show: showOp('workflow', (p) => `/workflows/${p.workflowId}`, 'workflowId'),
    incidentio_workflows_create: createOp('workflow', '/workflows', (p) => filterUndefined({
      name: p.name,
      trigger: p.trigger,
      steps: p.steps,
      condition_groups: p.conditionGroups,
      once_for: p.onceFor,
      runs_on_incidents: p.runsOnIncidents ?? 'newly_created',
      runs_on_incident_modes: p.runsOnIncidentModes,
      include_private_incidents: p.includePrivateIncidents ?? false,
      continue_on_step_error: p.continueOnStepError ?? true,
      state: p.state ?? 'active',
    })),
    incidentio_workflows_update: updateOp('workflow', (p) => `/workflows/${p.workflowId}`, 'workflowId', (p) => filterUndefined({
      name: p.name,
      trigger: p.trigger,
      steps: p.steps,
      condition_groups: p.conditionGroups,
      once_for: p.onceFor,
      state: p.state,
    })),
    incidentio_workflows_delete: deleteOp('workflow', (p) => `/workflows/${p.workflowId}`, 'workflowId'),

    incidentio_custom_fields_list: listOp('custom fields', '/custom_fields'),
    incidentio_custom_fields_show: showOp('custom field', (p) => `/custom_fields/${p.customFieldId}`, 'customFieldId'),
    incidentio_custom_fields_create: createOp('custom field', '/custom_fields', (p) => filterUndefined({
      name: p.name,
      description: p.description,
      field_type: p.fieldType,
      required: p.required ?? 'never',
      show_before_creation: p.showBeforeCreation ?? true,
      show_before_closure: p.showBeforeClosure ?? true,
      show_before_update: p.showBeforeUpdate ?? true,
      show_in_announcement_post: p.showInAnnouncementPost ?? false,
    })),
    incidentio_custom_fields_update: updateOp('custom field', (p) => `/custom_fields/${p.customFieldId}`, 'customFieldId', (p) => filterUndefined({
      name: p.name,
      description: p.description,
      required: p.required,
      show_before_creation: p.showBeforeCreation,
      show_before_closure: p.showBeforeClosure,
      show_before_update: p.showBeforeUpdate,
    })),
    incidentio_custom_fields_delete: deleteOp('custom field', (p) => `/custom_fields/${p.customFieldId}`, 'customFieldId'),

    incidentio_users_list: listOp('users', '/users'),
    incidentio_users_show: showOp('user', (p) => `/users/${p.userId}`, 'userId'),

    incidentio_severities_list: listOp('severities', '/severities'),
    incidentio_incident_statuses_list: listOp('incident statuses', '/incident_statuses'),
    incidentio_incident_types_list: listOp('incident types', '/incident_types'),

    incidentio_escalations_list: listOp('escalations', '/escalations'),
    incidentio_escalations_show: showOp('escalation', (p) => `/escalations/${p.escalationId}`, 'escalationId'),
    incidentio_escalations_create: createOp('escalation', '/escalations', (p) => filterUndefined({
      title: p.title,
      summary: p.summary,
      escalation_path_id: p.escalationPathId,
      priority: p.priority,
    })),

    incidentio_schedules_list: listOp('schedules', '/schedules'),
    incidentio_schedules_show: showOp('schedule', (p) => `/schedules/${p.scheduleId}`, 'scheduleId'),
    incidentio_schedules_create: createOp('schedule', '/schedules', (p) => filterUndefined({
      name: p.name,
      timezone: p.timezone,
      config: p.config,
    })),
    incidentio_schedules_update: updateOp('schedule', (p) => `/schedules/${p.scheduleId}`, 'scheduleId', (p) => filterUndefined({
      name: p.name,
      timezone: p.timezone,
      config: p.config,
    })),
    incidentio_schedules_delete: deleteOp('schedule', (p) => `/schedules/${p.scheduleId}`, 'scheduleId'),

    incidentio_incident_roles_list: listOp('incident roles', '/incident_roles'),
    incidentio_incident_roles_show: showOp('incident role', (p) => `/incident_roles/${p.roleId}`, 'roleId'),
    incidentio_incident_roles_create: createOp('incident role', '/incident_roles', (p) => filterUndefined({
      name: p.name,
      description: p.description,
      instructions: p.instructions,
      shortform: p.shortform,
      required: p.required ?? false,
    })),
    incidentio_incident_roles_update: updateOp('incident role', (p) => `/incident_roles/${p.roleId}`, 'roleId', (p) => filterUndefined({
      name: p.name,
      description: p.description,
      instructions: p.instructions,
      shortform: p.shortform,
      required: p.required,
    })),
    incidentio_incident_roles_delete: deleteOp('incident role', (p) => `/incident_roles/${p.roleId}`, 'roleId'),

    incidentio_incident_timestamps_list: listOp('incident timestamps', '/incident_timestamps'),
    incidentio_incident_timestamps_show: showOp('incident timestamp', (p) => `/incident_timestamps/${p.timestampId}`, 'timestampId'),

    incidentio_incident_updates_list: async (params) => {
      const apiKey = getApiKey(params)
      const incidentId = params.incidentId as string
      if (!apiKey || !incidentId) return { success: false, output: {}, error: 'Missing required parameters: apiKey, incidentId' }
      const qs = buildQueryString(params, { pageSize: 'page_size', after: 'after' })
      const { ok, data } = await incidentioRequest(apiKey, 'GET', `/incidents/${incidentId}/incident_updates${qs}`)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to list incident updates') }
      return { success: true, output: data }
    },

    incidentio_schedule_entries_list: async (params) => {
      const apiKey = getApiKey(params)
      const scheduleId = params.scheduleId as string
      if (!apiKey || !scheduleId) return { success: false, output: {}, error: 'Missing required parameters: apiKey, scheduleId' }
      const qs = buildQueryString(params, { entryStart: 'entry_start', entryEnd: 'entry_end' })
      const { ok, data } = await incidentioRequest(apiKey, 'GET', `/schedule_entries?schedule_id=${encodeURIComponent(scheduleId)}${qs ? `&${qs.slice(1)}` : ''}`)
      if (!ok) return { success: false, output: {}, error: errMsg(data, 'Failed to list schedule entries') }
      return { success: true, output: data }
    },

    incidentio_schedule_overrides_create: createOp('schedule override', '/schedule_overrides', (p) => filterUndefined({
      schedule_id: p.scheduleId,
      start_at: p.startAt,
      end_at: p.endAt,
      layer_id: p.layerId,
      rotation_id: p.rotationId,
      user: p.user,
    })),

    incidentio_escalation_paths_create: createOp('escalation path', '/escalation_paths', (p) => filterUndefined({
      name: p.name,
      path: p.path,
    })),
    incidentio_escalation_paths_show: showOp('escalation path', (p) => `/escalation_paths/${p.escalationPathId}`, 'escalationPathId'),
    incidentio_escalation_paths_update: updateOp('escalation path', (p) => `/escalation_paths/${p.escalationPathId}`, 'escalationPathId', (p) => filterUndefined({
      name: p.name,
      path: p.path,
    })),
    incidentio_escalation_paths_delete: deleteOp('escalation path', (p) => `/escalation_paths/${p.escalationPathId}`, 'escalationPathId'),
  },
}

export default handler
