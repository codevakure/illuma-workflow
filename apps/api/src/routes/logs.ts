import { Hono } from 'hono'
import { db } from '@sim/db'
import {
  workflow,
  workflowDeploymentVersion,
  workflowExecutionLogs,
  workflowExecutionSnapshots,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { getUserId, type AuthContext } from '@/middleware/auth'

const logger = createLogger('LogRoutes')

const app = new Hono<{ Variables: AuthContext }>()

/** Comparison operators for cost/duration filtering. */
type ComparisonOperator = '=' | '>' | '<' | '>=' | '<=' | '!='

/**
 * Escapes a value for safe CSV output.
 * Wraps in double-quotes if the value contains commas, quotes, or newlines.
 */
function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return ''
  const str = String(value)
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`
  }
  return str
}

/**
 * Builds dynamic SQL WHERE conditions from log filter query parameters.
 * Handles level, workflowIds, folderIds, triggers, date range, search,
 * cost comparison, and duration comparison filters.
 */
function buildFilterConditions(params: {
  level?: string
  workflowIds?: string
  folderIds?: string
  triggers?: string
  startDate?: string
  endDate?: string
  search?: string
  workflowName?: string
  executionId?: string
  costOperator?: string
  costValue?: number
  durationOperator?: string
  durationValue?: number
}): SQL | undefined {
  const conditions: SQL[] = []

  if (params.level && params.level !== 'all') {
    const levels = params.level.split(',').filter(Boolean)
    const levelConditions: SQL[] = []

    for (const level of levels) {
      if (level === 'error') {
        levelConditions.push(eq(workflowExecutionLogs.level, 'error'))
      } else if (level === 'info') {
        const condition = and(
          eq(workflowExecutionLogs.level, 'info'),
          isNotNull(workflowExecutionLogs.endedAt)
        )
        if (condition) levelConditions.push(condition)
      } else if (level === 'running') {
        const condition = and(
          eq(workflowExecutionLogs.level, 'info'),
          isNull(workflowExecutionLogs.endedAt)
        )
        if (condition) levelConditions.push(condition)
      } else if (level === 'pending') {
        const condition = and(
          eq(workflowExecutionLogs.level, 'info'),
          isNull(workflowExecutionLogs.endedAt)
        )
        if (condition) levelConditions.push(condition)
      }
    }

    if (levelConditions.length > 0) {
      conditions.push(
        levelConditions.length === 1 ? levelConditions[0] : or(...levelConditions)!
      )
    }
  }

  if (params.workflowIds) {
    const ids = params.workflowIds.split(',').filter(Boolean)
    if (ids.length > 0) {
      conditions.push(inArray(workflowExecutionLogs.workflowId, ids))
    }
  }

  if (params.folderIds) {
    const ids = params.folderIds.split(',').filter(Boolean)
    if (ids.length > 0) {
      conditions.push(inArray(workflow.folderId, ids))
    }
  }

  if (params.triggers) {
    const triggerList = params.triggers.split(',').filter(Boolean)
    if (triggerList.length > 0 && !triggerList.includes('all')) {
      conditions.push(inArray(workflowExecutionLogs.trigger, triggerList))
    }
  }

  if (params.startDate) {
    conditions.push(gte(workflowExecutionLogs.startedAt, new Date(params.startDate)))
  }
  if (params.endDate) {
    conditions.push(lte(workflowExecutionLogs.startedAt, new Date(params.endDate)))
  }

  if (params.search) {
    const searchTerm = `%${params.search}%`
    conditions.push(sql`${workflowExecutionLogs.executionId} ILIKE ${searchTerm}`)
  }

  if (params.workflowName) {
    const nameTerm = `%${params.workflowName}%`
    conditions.push(sql`${workflow.name} ILIKE ${nameTerm}`)
  }

  if (params.executionId) {
    conditions.push(eq(workflowExecutionLogs.executionId, params.executionId))
  }

  if (params.costOperator && params.costValue !== undefined) {
    const costField = sql`(${workflowExecutionLogs.cost}->>'total')::numeric`
    const op = params.costOperator as ComparisonOperator
    switch (op) {
      case '=':
        conditions.push(sql`${costField} = ${params.costValue}`)
        break
      case '>':
        conditions.push(sql`${costField} > ${params.costValue}`)
        break
      case '<':
        conditions.push(sql`${costField} < ${params.costValue}`)
        break
      case '>=':
        conditions.push(sql`${costField} >= ${params.costValue}`)
        break
      case '<=':
        conditions.push(sql`${costField} <= ${params.costValue}`)
        break
      case '!=':
        conditions.push(sql`${costField} != ${params.costValue}`)
        break
    }
  }

  if (params.durationOperator && params.durationValue !== undefined) {
    const durationField = workflowExecutionLogs.totalDurationMs
    const op = params.durationOperator as ComparisonOperator
    switch (op) {
      case '=':
        conditions.push(eq(durationField, params.durationValue))
        break
      case '>':
        conditions.push(gt(durationField, params.durationValue))
        break
      case '<':
        conditions.push(lt(durationField, params.durationValue))
        break
      case '>=':
        conditions.push(gte(durationField, params.durationValue))
        break
      case '<=':
        conditions.push(lte(durationField, params.durationValue))
        break
      case '!=':
        conditions.push(ne(durationField, params.durationValue))
        break
    }
  }

  if (conditions.length === 0) return undefined
  if (conditions.length === 1) return conditions[0]
  return and(...conditions)
}

/**
 * Parses common filter query parameters from the request.
 */
function parseFilterParams(c: { req: { query: (key: string) => string | undefined } }) {
  return {
    workspaceId: c.req.query('workspaceId'),
    level: c.req.query('level'),
    workflowIds: c.req.query('workflowIds'),
    folderIds: c.req.query('folderIds'),
    triggers: c.req.query('triggers'),
    startDate: c.req.query('startDate'),
    endDate: c.req.query('endDate'),
    search: c.req.query('search'),
    workflowName: c.req.query('workflowName'),
    executionId: c.req.query('executionId'),
    costOperator: c.req.query('costOperator'),
    costValue: c.req.query('costValue') ? Number(c.req.query('costValue')) : undefined,
    durationOperator: c.req.query('durationOperator'),
    durationValue: c.req.query('durationValue')
      ? Number(c.req.query('durationValue'))
      : undefined,
  }
}

// ---------------------------------------------------------------------------
// 1. GET /export - CSV streaming export
// ---------------------------------------------------------------------------

/**
 * GET /api/logs/export
 * Streams a CSV export of workflow execution logs with the same filtering
 * capabilities as the list endpoint. Processes rows in batches of 1000.
 */
app.get('/export', async (c) => {
  const userId = getUserId(c)

  try {
    const filterParams = parseFilterParams(c)

    if (!filterParams.workspaceId) {
      return c.json({ error: 'workspaceId is required' }, 400)
    }

    const workspaceCondition = eq(
      workflowExecutionLogs.workspaceId,
      filterParams.workspaceId
    )
    const filterConditions = buildFilterConditions(filterParams)
    const conditions = filterConditions
      ? and(workspaceCondition, filterConditions)
      : workspaceCondition

    const selectColumns = {
      id: workflowExecutionLogs.id,
      workflowId: workflowExecutionLogs.workflowId,
      executionId: workflowExecutionLogs.executionId,
      level: workflowExecutionLogs.level,
      trigger: workflowExecutionLogs.trigger,
      startedAt: workflowExecutionLogs.startedAt,
      endedAt: workflowExecutionLogs.endedAt,
      totalDurationMs: workflowExecutionLogs.totalDurationMs,
      cost: workflowExecutionLogs.cost,
      executionData: workflowExecutionLogs.executionData,
      workflowName: sql<string>`COALESCE(${workflow.name}, 'Deleted Workflow')`,
    }

    const header = [
      'startedAt',
      'level',
      'workflow',
      'trigger',
      'durationMs',
      'costTotal',
      'workflowId',
      'executionId',
      'message',
      'traceSpans',
    ].join(',')

    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start: async (controller) => {
        controller.enqueue(encoder.encode(`${header}\n`))
        const pageSize = 1000
        let offset = 0

        try {
          while (true) {
            const rows = await db
              .select(selectColumns)
              .from(workflowExecutionLogs)
              .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
              .where(conditions)
              .orderBy(desc(workflowExecutionLogs.startedAt))
              .limit(pageSize)
              .offset(offset)

            if (!rows.length) break

            for (const r of rows as Record<string, unknown>[]) {
              let message = ''
              let traces: unknown = null
              try {
                const ed = r.executionData as Record<string, unknown> | null
                if (ed) {
                  if (ed.finalOutput) {
                    message =
                      typeof ed.finalOutput === 'string'
                        ? ed.finalOutput
                        : JSON.stringify(ed.finalOutput)
                  }
                  if (ed.message) message = ed.message as string
                  if (ed.traceSpans) traces = ed.traceSpans
                }
              } catch {
                /* ignore parse errors */
              }

              const costObj = r.cost as Record<string, unknown> | null
              const line = [
                escapeCsv(
                  (r.startedAt as Date)?.toISOString?.() || r.startedAt
                ),
                escapeCsv(r.level),
                escapeCsv(r.workflowName),
                escapeCsv(r.trigger),
                escapeCsv(r.totalDurationMs ?? ''),
                escapeCsv(
                  costObj?.total ??
                    (costObj?.value as Record<string, unknown>)?.total ??
                    ''
                ),
                escapeCsv(r.workflowId ?? ''),
                escapeCsv(r.executionId ?? ''),
                escapeCsv(message),
                escapeCsv(traces ? JSON.stringify(traces) : ''),
              ].join(',')
              controller.enqueue(encoder.encode(`${line}\n`))
            }

            offset += pageSize
          }
          controller.close()
        } catch (e: unknown) {
          const errMsg = e instanceof Error ? e.message : String(e)
          logger.error('Export stream error', { error: errMsg })
          try {
            controller.error(e)
          } catch {
            /* controller may already be closed */
          }
        }
      },
    })

    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const filename = `logs-${ts}.csv`

    logger.info(`Streaming CSV export for user ${userId}`)
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    logger.error('Export error', error)
    return c.json({ error: 'Failed to export logs' }, 500)
  }
})

// ---------------------------------------------------------------------------
// 2. GET /stats - Dashboard statistics
// ---------------------------------------------------------------------------

interface SegmentStats {
  timestamp: string
  totalExecutions: number
  successfulExecutions: number
  avgDurationMs: number
}

interface WorkflowStats {
  workflowId: string
  workflowName: string
  segments: SegmentStats[]
  overallSuccessRate: number
  totalExecutions: number
  totalSuccessful: number
}

/**
 * GET /api/logs/stats
 * Returns dashboard statistics with time-segmented execution data.
 * Supports the same filters as the list endpoint plus a segmentCount parameter.
 */
app.get('/stats', async (c) => {
  const userId = getUserId(c)

  try {
    const filterParams = parseFilterParams(c)
    const segmentCount = Math.max(
      1,
      parseInt(c.req.query('segmentCount') ?? '72', 10) || 72
    )

    if (!filterParams.workspaceId) {
      return c.json({ error: 'workspaceId is required' }, 400)
    }

    const workspaceFilter = eq(
      workflowExecutionLogs.workspaceId,
      filterParams.workspaceId
    )
    const commonFilters = buildFilterConditions(filterParams)
    const whereCondition = commonFilters
      ? and(workspaceFilter, commonFilters)
      : workspaceFilter

    const boundsQuery = await db
      .select({
        minTime: sql<string>`MIN(${workflowExecutionLogs.startedAt})`,
        maxTime: sql<string>`MAX(${workflowExecutionLogs.startedAt})`,
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(whereCondition)

    const bounds = boundsQuery[0]
    const now = new Date()

    let startTime: Date
    let endTime: Date

    if (!bounds?.minTime || !bounds?.maxTime) {
      endTime = now
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    } else {
      startTime = new Date(bounds.minTime)
      endTime = new Date(
        Math.max(new Date(bounds.maxTime).getTime(), now.getTime())
      )
    }

    const totalMs = Math.max(1, endTime.getTime() - startTime.getTime())
    const segmentMs = Math.max(60000, Math.floor(totalMs / segmentCount))
    const startTimeIso = startTime.toISOString()

    const statsQuery = await db
      .select({
        workflowId:
          sql<string>`COALESCE(${workflowExecutionLogs.workflowId}, 'deleted')`,
        workflowName:
          sql<string>`COALESCE(${workflow.name}, 'Deleted Workflow')`,
        segmentIndex:
          sql<number>`FLOOR(EXTRACT(EPOCH FROM (${workflowExecutionLogs.startedAt} - ${startTimeIso}::timestamp)) * 1000 / ${segmentMs})`.as(
            'segment_index'
          ),
        totalExecutions: sql<number>`COUNT(*)`.as('total_executions'),
        successfulExecutions:
          sql<number>`COUNT(*) FILTER (WHERE ${workflowExecutionLogs.level} != 'error')`.as(
            'successful_executions'
          ),
        avgDurationMs:
          sql<number>`COALESCE(AVG(${workflowExecutionLogs.totalDurationMs}) FILTER (WHERE ${workflowExecutionLogs.totalDurationMs} > 0), 0)`.as(
            'avg_duration_ms'
          ),
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(whereCondition)
      .groupBy(
        sql`COALESCE(${workflowExecutionLogs.workflowId}, 'deleted')`,
        sql`COALESCE(${workflow.name}, 'Deleted Workflow')`,
        sql`segment_index`
      )

    const workflowMap = new Map<
      string,
      {
        workflowId: string
        workflowName: string
        segments: Map<number, SegmentStats>
        totalExecutions: number
        totalSuccessful: number
      }
    >()

    for (const row of statsQuery) {
      const segmentIndex = Math.min(
        segmentCount - 1,
        Math.max(0, Math.floor(Number(row.segmentIndex)))
      )

      if (!workflowMap.has(row.workflowId)) {
        workflowMap.set(row.workflowId, {
          workflowId: row.workflowId,
          workflowName: row.workflowName,
          segments: new Map(),
          totalExecutions: 0,
          totalSuccessful: 0,
        })
      }

      const wf = workflowMap.get(row.workflowId)!
      wf.totalExecutions += Number(row.totalExecutions)
      wf.totalSuccessful += Number(row.successfulExecutions)

      const existing = wf.segments.get(segmentIndex)
      if (existing) {
        const oldTotal = existing.totalExecutions
        const newTotal = oldTotal + Number(row.totalExecutions)
        existing.totalExecutions = newTotal
        existing.successfulExecutions += Number(row.successfulExecutions)
        existing.avgDurationMs =
          newTotal > 0
            ? (existing.avgDurationMs * oldTotal +
                Number(row.avgDurationMs || 0) * Number(row.totalExecutions)) /
              newTotal
            : 0
      } else {
        wf.segments.set(segmentIndex, {
          timestamp: new Date(
            startTime.getTime() + segmentIndex * segmentMs
          ).toISOString(),
          totalExecutions: Number(row.totalExecutions),
          successfulExecutions: Number(row.successfulExecutions),
          avgDurationMs: Number(row.avgDurationMs || 0),
        })
      }
    }

    const workflows: WorkflowStats[] = []
    for (const wf of workflowMap.values()) {
      const segments: SegmentStats[] = []
      for (let i = 0; i < segmentCount; i++) {
        const existing = wf.segments.get(i)
        if (existing) {
          segments.push(existing)
        } else {
          segments.push({
            timestamp: new Date(
              startTime.getTime() + i * segmentMs
            ).toISOString(),
            totalExecutions: 0,
            successfulExecutions: 0,
            avgDurationMs: 0,
          })
        }
      }

      workflows.push({
        workflowId: wf.workflowId,
        workflowName: wf.workflowName,
        segments,
        totalExecutions: wf.totalExecutions,
        totalSuccessful: wf.totalSuccessful,
        overallSuccessRate:
          wf.totalExecutions > 0
            ? (wf.totalSuccessful / wf.totalExecutions) * 100
            : 100,
      })
    }

    workflows.sort((a, b) => {
      const errA =
        a.overallSuccessRate < 100 ? 1 - a.overallSuccessRate / 100 : 0
      const errB =
        b.overallSuccessRate < 100 ? 1 - b.overallSuccessRate / 100 : 0
      if (errA !== errB) return errB - errA
      return a.workflowName.localeCompare(b.workflowName)
    })

    const aggregateSegments: SegmentStats[] = []
    let totalRuns = 0
    let totalErrors = 0
    let weightedLatencySum = 0
    let latencyCount = 0

    for (let i = 0; i < segmentCount; i++) {
      let segTotal = 0
      let segSuccess = 0
      let segWeightedLatency = 0
      let segLatencyCount = 0

      for (const wf of workflows) {
        const seg = wf.segments[i]
        segTotal += seg.totalExecutions
        segSuccess += seg.successfulExecutions
        if (seg.avgDurationMs > 0 && seg.totalExecutions > 0) {
          segWeightedLatency += seg.avgDurationMs * seg.totalExecutions
          segLatencyCount += seg.totalExecutions
        }
      }

      totalRuns += segTotal
      totalErrors += segTotal - segSuccess
      weightedLatencySum += segWeightedLatency
      latencyCount += segLatencyCount

      aggregateSegments.push({
        timestamp: new Date(
          startTime.getTime() + i * segmentMs
        ).toISOString(),
        totalExecutions: segTotal,
        successfulExecutions: segSuccess,
        avgDurationMs:
          segLatencyCount > 0 ? segWeightedLatency / segLatencyCount : 0,
      })
    }

    const avgLatency = latencyCount > 0 ? weightedLatencySum / latencyCount : 0

    logger.info(`Computed stats for user ${userId}`)
    return c.json({
      workflows,
      aggregateSegments,
      totalRuns,
      totalErrors,
      avgLatency,
      timeBounds: {
        start: startTime.toISOString(),
        end: endTime.toISOString(),
      },
      segmentMs,
    })
  } catch (error) {
    logger.error('Error computing log stats', error)
    return c.json({ error: 'Failed to compute stats' }, 500)
  }
})

// ---------------------------------------------------------------------------
// 3. GET /triggers - List distinct trigger types
// ---------------------------------------------------------------------------

/**
 * GET /api/logs/triggers
 * Returns unique non-core trigger types from workflow execution logs.
 * Excludes built-in triggers: api, manual, webhook, chat, schedule.
 */
app.get('/triggers', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspaceId')

  if (!workspaceId) {
    return c.json({ error: 'workspaceId is required' }, 400)
  }

  try {
    const triggers = await db
      .selectDistinct({
        trigger: workflowExecutionLogs.trigger,
      })
      .from(workflowExecutionLogs)
      .where(
        and(
          eq(workflowExecutionLogs.workspaceId, workspaceId),
          isNotNull(workflowExecutionLogs.trigger),
          sql`${workflowExecutionLogs.trigger} NOT IN ('api', 'manual', 'webhook', 'chat', 'schedule')`
        )
      )

    const triggerValues = triggers
      .map((row) => row.trigger)
      .filter((t): t is string => Boolean(t))
      .sort()

    logger.info(
      `Listed ${triggerValues.length} triggers for user ${userId}`
    )
    return c.json({
      triggers: triggerValues,
      count: triggerValues.length,
    })
  } catch (error) {
    logger.error('Error listing triggers', error)
    return c.json({ error: 'Failed to list triggers' }, 500)
  }
})

// ---------------------------------------------------------------------------
// 4. GET /execution/:executionId - Execution detail with workflow state
// ---------------------------------------------------------------------------

/**
 * GET /api/logs/execution/:executionId
 * Returns the full execution log along with the workflow state snapshot
 * that was used during execution.
 */
app.get('/execution/:executionId', async (c) => {
  const userId = getUserId(c)
  const executionId = c.req.param('executionId')

  try {
    const [workflowLog] = await db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        executionId: workflowExecutionLogs.executionId,
        stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        cost: workflowExecutionLogs.cost,
        executionData: workflowExecutionLogs.executionData,
      })
      .from(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.executionId, executionId))
      .limit(1)

    if (!workflowLog) {
      return c.json({ error: 'Workflow execution not found' }, 404)
    }

    const [snapshot] = await db
      .select()
      .from(workflowExecutionSnapshots)
      .where(eq(workflowExecutionSnapshots.id, workflowLog.stateSnapshotId))
      .limit(1)

    if (!snapshot) {
      return c.json({ error: 'Workflow state snapshot not found' }, 404)
    }

    const executionData = workflowLog.executionData as Record<
      string,
      unknown
    > | null

    interface TraceSpanLike {
      childWorkflowSnapshotId?: string
      children?: TraceSpanLike[]
    }

    const traceSpans = (executionData?.traceSpans as TraceSpanLike[]) || []
    const childSnapshotIds = new Set<string>()

    const collectSnapshotIds = (spans: TraceSpanLike[]) => {
      for (const span of spans) {
        if (typeof span.childWorkflowSnapshotId === 'string') {
          childSnapshotIds.add(span.childWorkflowSnapshotId)
        }
        if (span.children?.length) {
          collectSnapshotIds(span.children)
        }
      }
    }

    if (traceSpans.length > 0) {
      collectSnapshotIds(traceSpans)
    }

    const childWorkflowSnapshots =
      childSnapshotIds.size > 0
        ? await db
            .select()
            .from(workflowExecutionSnapshots)
            .where(
              inArray(
                workflowExecutionSnapshots.id,
                Array.from(childSnapshotIds)
              )
            )
        : []

    const childSnapshotMap = childWorkflowSnapshots.reduce<
      Record<string, unknown>
    >((acc, snap) => {
      acc[snap.id] = snap.stateData
      return acc
    }, {})

    const response = {
      executionId,
      workflowId: workflowLog.workflowId,
      workflowState: snapshot.stateData,
      childWorkflowSnapshots: childSnapshotMap,
      executionMetadata: {
        trigger: workflowLog.trigger,
        startedAt: workflowLog.startedAt.toISOString(),
        endedAt: workflowLog.endedAt?.toISOString() ?? null,
        totalDurationMs: workflowLog.totalDurationMs,
        cost: workflowLog.cost || null,
      },
    }

    logger.info(
      `Retrieved execution ${executionId} for user ${userId}`
    )
    return c.json(response)
  } catch (error) {
    logger.error(`Error fetching execution ${executionId}`, error)
    return c.json({ error: 'Failed to fetch execution data' }, 500)
  }
})

// ---------------------------------------------------------------------------
// 5. GET / - List logs with full filtering and pagination
// ---------------------------------------------------------------------------

/**
 * GET /api/logs
 * Lists workflow execution logs with full filtering, pagination, and
 * optional detail levels (basic excludes executionData and files).
 */
app.get('/', async (c) => {
  const userId = getUserId(c)

  try {
    const filterParams = parseFilterParams(c)
    const details =
      (c.req.query('details') as 'basic' | 'full' | undefined) ?? 'basic'
    const limit = Math.min(
      Math.max(parseInt(c.req.query('limit') ?? '50', 10) || 50, 1),
      200
    )
    const offset = Math.max(
      parseInt(c.req.query('offset') ?? '0', 10) || 0,
      0
    )

    if (!filterParams.workspaceId) {
      return c.json({ error: 'workspaceId is required' }, 400)
    }

    const workspaceCondition = eq(
      workflowExecutionLogs.workspaceId,
      filterParams.workspaceId
    )
    const filterConditions = buildFilterConditions(filterParams)
    const conditions = filterConditions
      ? and(workspaceCondition, filterConditions)
      : workspaceCondition

    const selectColumns =
      details === 'full'
        ? {
            id: workflowExecutionLogs.id,
            workflowId: workflowExecutionLogs.workflowId,
            executionId: workflowExecutionLogs.executionId,
            stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
            deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
            level: workflowExecutionLogs.level,
            status: workflowExecutionLogs.status,
            trigger: workflowExecutionLogs.trigger,
            startedAt: workflowExecutionLogs.startedAt,
            endedAt: workflowExecutionLogs.endedAt,
            totalDurationMs: workflowExecutionLogs.totalDurationMs,
            executionData: workflowExecutionLogs.executionData,
            cost: workflowExecutionLogs.cost,
            files: workflowExecutionLogs.files,
            createdAt: workflowExecutionLogs.createdAt,
            workflowName: workflow.name,
            workflowColor: workflow.color,
            workflowFolderId: workflow.folderId,
          }
        : {
            id: workflowExecutionLogs.id,
            workflowId: workflowExecutionLogs.workflowId,
            executionId: workflowExecutionLogs.executionId,
            stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
            deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
            level: workflowExecutionLogs.level,
            status: workflowExecutionLogs.status,
            trigger: workflowExecutionLogs.trigger,
            startedAt: workflowExecutionLogs.startedAt,
            endedAt: workflowExecutionLogs.endedAt,
            totalDurationMs: workflowExecutionLogs.totalDurationMs,
            executionData: sql<null>`NULL`,
            cost: workflowExecutionLogs.cost,
            files: sql<null>`NULL`,
            createdAt: workflowExecutionLogs.createdAt,
            workflowName: workflow.name,
            workflowColor: workflow.color,
            workflowFolderId: workflow.folderId,
          }

    const logs = await db
      .select(selectColumns)
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(conditions)
      .orderBy(desc(workflowExecutionLogs.startedAt))
      .limit(limit)
      .offset(offset)

    const countResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .where(conditions)

    const total = Number(countResult[0]?.count || 0)

    const data = logs.map((log) => {
      let traceSpans: unknown[] = []
      let finalOutput: unknown
      let costSummary = (log.cost as Record<string, unknown>) || { total: 0 }

      if (details === 'full' && log.executionData) {
        const ed = log.executionData as Record<string, unknown>
        const storedTraceSpans = ed?.traceSpans
        traceSpans =
          storedTraceSpans &&
          Array.isArray(storedTraceSpans) &&
          storedTraceSpans.length > 0
            ? storedTraceSpans
            : []

        costSummary =
          log.cost && Object.keys(log.cost as Record<string, unknown>).length > 0
            ? (log.cost as Record<string, unknown>)
            : { total: 0 }

        try {
          const fo = ed?.finalOutput
          if (fo !== undefined) finalOutput = fo
        } catch {
          /* ignore */
        }
      }

      const workflowSummary = log.workflowId
        ? {
            id: log.workflowId,
            name: log.workflowName,
            color: log.workflowColor,
            folderId: log.workflowFolderId,
          }
        : null

      return {
        id: log.id,
        workflowId: log.workflowId,
        executionId: log.executionId,
        deploymentVersionId: log.deploymentVersionId,
        level: log.level,
        status: log.status,
        duration: log.totalDurationMs ? `${log.totalDurationMs}ms` : null,
        trigger: log.trigger,
        createdAt: log.startedAt?.toISOString?.() ?? log.startedAt,
        files: details === 'full' ? log.files || undefined : undefined,
        workflow: workflowSummary,
        executionData:
          details === 'full'
            ? {
                totalDuration: log.totalDurationMs,
                traceSpans,
                finalOutput,
                enhanced: true,
              }
            : undefined,
        cost:
          details === 'full'
            ? costSummary
            : { total: (costSummary as Record<string, unknown>)?.total || 0 },
      }
    })

    logger.info(`Listed ${logs.length} logs for user ${userId}`)
    return c.json({
      data,
      total,
      page: Math.floor(offset / limit) + 1,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error) {
    logger.error('Error listing logs', error)
    return c.json({ error: 'Failed to list logs' }, 500)
  }
})

// ---------------------------------------------------------------------------
// 6. GET /:id - Single log by ID
// ---------------------------------------------------------------------------

/**
 * GET /api/logs/:id
 * Returns a single workflow execution log with full details including
 * workflow metadata and deployment version info.
 */
app.get('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  try {
    const rows = await db
      .select({
        id: workflowExecutionLogs.id,
        workflowId: workflowExecutionLogs.workflowId,
        executionId: workflowExecutionLogs.executionId,
        stateSnapshotId: workflowExecutionLogs.stateSnapshotId,
        deploymentVersionId: workflowExecutionLogs.deploymentVersionId,
        level: workflowExecutionLogs.level,
        status: workflowExecutionLogs.status,
        trigger: workflowExecutionLogs.trigger,
        startedAt: workflowExecutionLogs.startedAt,
        endedAt: workflowExecutionLogs.endedAt,
        totalDurationMs: workflowExecutionLogs.totalDurationMs,
        executionData: workflowExecutionLogs.executionData,
        cost: workflowExecutionLogs.cost,
        files: workflowExecutionLogs.files,
        createdAt: workflowExecutionLogs.createdAt,
        workflowName: workflow.name,
        workflowDescription: workflow.description,
        workflowColor: workflow.color,
        workflowFolderId: workflow.folderId,
        workflowUserId: workflow.userId,
        workflowWorkspaceId: workflow.workspaceId,
        workflowCreatedAt: workflow.createdAt,
        workflowUpdatedAt: workflow.updatedAt,
        deploymentVersion: workflowDeploymentVersion.version,
        deploymentVersionName: workflowDeploymentVersion.name,
      })
      .from(workflowExecutionLogs)
      .leftJoin(workflow, eq(workflowExecutionLogs.workflowId, workflow.id))
      .leftJoin(
        workflowDeploymentVersion,
        eq(
          workflowDeploymentVersion.id,
          workflowExecutionLogs.deploymentVersionId
        )
      )
      .where(eq(workflowExecutionLogs.id, id))
      .limit(1)

    const log = rows[0]
    if (!log) {
      return c.json({ error: 'Log not found' }, 404)
    }

    const workflowSummary = log.workflowId
      ? {
          id: log.workflowId,
          name: log.workflowName,
          description: log.workflowDescription,
          color: log.workflowColor,
          folderId: log.workflowFolderId,
          userId: log.workflowUserId,
          workspaceId: log.workflowWorkspaceId,
          createdAt: log.workflowCreatedAt,
          updatedAt: log.workflowUpdatedAt,
        }
      : null

    const response = {
      id: log.id,
      workflowId: log.workflowId,
      executionId: log.executionId,
      deploymentVersionId: log.deploymentVersionId,
      deploymentVersion: log.deploymentVersion ?? null,
      deploymentVersionName: log.deploymentVersionName ?? null,
      level: log.level,
      status: log.status,
      duration: log.totalDurationMs ? `${log.totalDurationMs}ms` : null,
      trigger: log.trigger,
      createdAt: log.startedAt.toISOString(),
      files: log.files || undefined,
      workflow: workflowSummary,
      executionData: {
        totalDuration: log.totalDurationMs,
        ...(log.executionData as Record<string, unknown>),
        enhanced: true,
      },
      cost: log.cost,
    }

    logger.info(`Retrieved log ${id} for user ${userId}`)
    return c.json({ data: response })
  } catch (error) {
    logger.error(`Error getting log ${id}`, error)
    return c.json({ error: 'Failed to get log' }, 500)
  }
})

// ---------------------------------------------------------------------------
// 7. DELETE / - Bulk delete logs
// ---------------------------------------------------------------------------

/**
 * DELETE /api/logs
 * Bulk-deletes workflow execution logs by an array of IDs.
 * Body: { ids: string[] }
 */
app.delete('/', async (c) => {
  const userId = getUserId(c)

  try {
    const body = await c.req.json<{ ids?: string[] }>()

    if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
      return c.json({ error: 'ids array is required and must not be empty' }, 400)
    }

    const result = await db
      .delete(workflowExecutionLogs)
      .where(inArray(workflowExecutionLogs.id, body.ids))

    const deleted = (result as unknown as { rowCount?: number })?.rowCount ?? body.ids.length

    logger.info(
      `Bulk deleted ${deleted} logs for user ${userId}`
    )
    return c.json({ deleted })
  } catch (error) {
    logger.error('Error bulk deleting logs', error)
    return c.json({ error: 'Failed to delete logs' }, 500)
  }
})

// ---------------------------------------------------------------------------
// 8. DELETE /:id - Delete single log
// ---------------------------------------------------------------------------

/**
 * DELETE /api/logs/:id
 * Deletes a single workflow execution log by ID.
 */
app.delete('/:id', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')

  try {
    await db
      .delete(workflowExecutionLogs)
      .where(eq(workflowExecutionLogs.id, id))

    logger.info(`Deleted log ${id} for user ${userId}`)
    return c.json({ success: true })
  } catch (error) {
    logger.error(`Error deleting log ${id}`, error)
    return c.json({ error: 'Failed to delete log' }, 500)
  }
})

export { app as logRoutes }
