'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  ChevronLeft,
  ChevronRight,
  Download,
  LayoutDashboard,
  List,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/emcn'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/core/utils/cn'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'
import {
  formatDate,
  formatLatency,
  getDisplayStatus,
  LOG_COLUMN_ORDER,
  LOG_COLUMNS,
  parseDuration,
  StatusBadge,
  TriggerBadge,
} from '@/app/workspace/[workspaceId]/logs/utils'
import { useLogs, useLogStats } from '@/hooks/queries/logs'
import type { LogsParams, WorkflowLog } from '@/hooks/queries/logs'
import { useWorkflows } from '@/hooks/queries/workflows'
import { useFolders } from '@/hooks/queries/folders'
import { useDebounce } from '@/hooks/use-debounce'
import { useFilterStore } from '@/stores/logs/filters/store'
import type { TimeRange } from '@/stores/logs/filters/types'

const logger = createLogger('LogsPage')

const LOGS_PER_PAGE = 50 as const

const TIME_RANGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'All time', label: 'All time' },
  { value: 'Past 30 minutes', label: 'Past 30 minutes' },
  { value: 'Past hour', label: 'Past hour' },
  { value: 'Past 6 hours', label: 'Past 6 hours' },
  { value: 'Past 12 hours', label: 'Past 12 hours' },
  { value: 'Past 24 hours', label: 'Past 24 hours' },
  { value: 'Past 3 days', label: 'Past 3 days' },
  { value: 'Past 7 days', label: 'Past 7 days' },
  { value: 'Past 14 days', label: 'Past 14 days' },
  { value: 'Past 30 days', label: 'Past 30 days' },
] as const

const LEVEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All levels' },
  { value: 'info', label: 'Success' },
  { value: 'error', label: 'Error' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Pending' },
] as const

/**
 * Computes start/end ISO strings from a time range for API requests.
 */
function getDateBoundsFromTimeRange(
  timeRange: TimeRange,
  customStart?: string,
  customEnd?: string
): { startDate?: string; endDate?: string } {
  if (timeRange === 'All time') return {}

  if (timeRange === 'Custom range') {
    return {
      startDate: customStart,
      endDate: customEnd,
    }
  }

  const now = new Date()
  const msMap: Record<string, number> = {
    'Past 30 minutes': 30 * 60 * 1000,
    'Past hour': 60 * 60 * 1000,
    'Past 6 hours': 6 * 60 * 60 * 1000,
    'Past 12 hours': 12 * 60 * 60 * 1000,
    'Past 24 hours': 24 * 60 * 60 * 1000,
    'Past 3 days': 3 * 24 * 60 * 60 * 1000,
    'Past 7 days': 7 * 24 * 60 * 60 * 1000,
    'Past 14 days': 14 * 24 * 60 * 60 * 1000,
    'Past 30 days': 30 * 24 * 60 * 60 * 1000,
  }

  const ms = msMap[timeRange]
  if (!ms) return {}

  return {
    startDate: new Date(now.getTime() - ms).toISOString(),
    endDate: now.toISOString(),
  }
}

/**
 * Formats a cost object into a dollar string.
 */
function formatCost(cost: Record<string, unknown> | null | undefined): string {
  if (!cost) return '--'
  const total = cost.total as number | undefined
  if (typeof total !== 'number' || !Number.isFinite(total)) return '--'
  if (total === 0) return '$0.00'
  if (total < 0.01) return `$${total.toFixed(4)}`
  return `$${total.toFixed(2)}`
}

/**
 * Logs page displaying workflow execution history with filtering, search,
 * pagination, and a dashboard summary view.
 */
export default function LogsPage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const {
    setWorkspaceId,
    initializeFromURL,
    timeRange,
    startDate,
    endDate,
    level,
    workflowIds,
    folderIds,
    triggers,
    viewMode,
    setViewMode,
    setTimeRange,
    setLevel,
    setWorkflowIds,
    searchQuery: storeSearchQuery,
    setSearchQuery: setStoreSearchQuery,
  } = useFilterStore()

  const isInitialized = useRef(false)
  const [localSearch, setLocalSearch] = useState('')
  const debouncedSearch = useDebounce(localSearch, 300)
  const [currentPage, setCurrentPage] = useState(1)
  const [selectedLogId, setSelectedLogId] = useState<string | null>(null)
  const [isExporting, setIsExporting] = useState(false)

  useEffect(() => {
    setWorkspaceId(workspaceId)
  }, [workspaceId, setWorkspaceId])

  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true
      initializeFromURL()
      const urlSearch = new URLSearchParams(window.location.search).get('search') || ''
      if (urlSearch) {
        setLocalSearch(urlSearch)
      }
    }
  }, [initializeFromURL])

  useEffect(() => {
    if (isInitialized.current) {
      setStoreSearchQuery(debouncedSearch)
    }
  }, [debouncedSearch, setStoreSearchQuery])

  useEffect(() => {
    setCurrentPage(1)
  }, [timeRange, level, workflowIds, folderIds, triggers, debouncedSearch])

  const dateBounds = useMemo(
    () => getDateBoundsFromTimeRange(timeRange, startDate, endDate),
    [timeRange, startDate, endDate]
  )

  const logsParams: LogsParams = useMemo(
    () => ({
      workspaceId,
      level: level !== 'all' ? level : undefined,
      workflowIds: workflowIds.length > 0 ? workflowIds.join(',') : undefined,
      folderIds: folderIds.length > 0 ? folderIds.join(',') : undefined,
      triggers: triggers.length > 0 ? triggers.join(',') : undefined,
      startDate: dateBounds.startDate,
      endDate: dateBounds.endDate,
      search: debouncedSearch || undefined,
      limit: LOGS_PER_PAGE,
      offset: (currentPage - 1) * LOGS_PER_PAGE,
    }),
    [workspaceId, level, workflowIds, folderIds, triggers, dateBounds, debouncedSearch, currentPage]
  )

  const statsParams: LogsParams = useMemo(
    () => ({
      workspaceId,
      level: level !== 'all' ? level : undefined,
      workflowIds: workflowIds.length > 0 ? workflowIds.join(',') : undefined,
      folderIds: folderIds.length > 0 ? folderIds.join(',') : undefined,
      triggers: triggers.length > 0 ? triggers.join(',') : undefined,
      startDate: dateBounds.startDate,
      endDate: dateBounds.endDate,
      search: debouncedSearch || undefined,
    }),
    [workspaceId, level, workflowIds, folderIds, triggers, dateBounds, debouncedSearch]
  )

  const logsQuery = useLogs(logsParams, { enabled: Boolean(workspaceId) && isInitialized.current })
  const statsQuery = useLogStats(statsParams, {
    enabled: Boolean(workspaceId) && isInitialized.current && viewMode === 'dashboard',
  })

  const { data: workflows } = useWorkflows(workspaceId, { syncRegistry: false })
  useFolders(workspaceId)

  const logs = logsQuery.data?.data ?? []
  const totalPages = logsQuery.data?.totalPages ?? 0
  const totalLogs = logsQuery.data?.total ?? 0

  const handleLogClick = useCallback(
    (log: WorkflowLog) => {
      setSelectedLogId(selectedLogId === log.id ? null : log.id)
    },
    [selectedLogId]
  )

  const handleExport = useCallback(() => {
    setIsExporting(true)
    try {
      const exportParams = new URLSearchParams()
      exportParams.set('workspaceId', workspaceId)
      if (level !== 'all') exportParams.set('level', level)
      if (triggers.length > 0) exportParams.set('triggers', triggers.join(','))
      if (workflowIds.length > 0) exportParams.set('workflowIds', workflowIds.join(','))
      if (folderIds.length > 0) exportParams.set('folderIds', folderIds.join(','))
      if (dateBounds.startDate) exportParams.set('startDate', dateBounds.startDate)
      if (dateBounds.endDate) exportParams.set('endDate', dateBounds.endDate)
      if (debouncedSearch) exportParams.set('search', debouncedSearch)

      window.open(`/api/logs/export?${exportParams.toString()}`, '_blank')
    } finally {
      setIsExporting(false)
    }
  }, [workspaceId, level, triggers, workflowIds, folderIds, dateBounds, debouncedSearch])

  const handleWorkflowFilterChange = useCallback(
    (value: string) => {
      if (value === '__all__') {
        setWorkflowIds([])
      } else {
        setWorkflowIds([value])
      }
    },
    [setWorkflowIds]
  )

  const isDashboard = viewMode === 'dashboard'

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar />
      <main className="flex h-full flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex flex-shrink-0 flex-col gap-3 border-b border-[var(--border)] px-6 pt-5 pb-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-[var(--text-primary)]">Execution Logs</h1>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExport}
                disabled={isExporting || logs.length === 0}
                className="gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </Button>
              <div className="flex items-center rounded-md border border-[var(--border)]">
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-1 rounded-l-md px-2.5 py-1.5 text-xs transition-colors',
                    !isDashboard
                      ? 'bg-[var(--surface-4)] text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  )}
                  onClick={() => setViewMode('logs')}
                >
                  <List className="h-3.5 w-3.5" />
                  Logs
                </button>
                <button
                  type="button"
                  className={cn(
                    'flex items-center gap-1 rounded-r-md px-2.5 py-1.5 text-xs transition-colors',
                    isDashboard
                      ? 'bg-[var(--surface-4)] text-[var(--text-primary)]'
                      : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                  )}
                  onClick={() => setViewMode('dashboard')}
                >
                  <LayoutDashboard className="h-3.5 w-3.5" />
                  Dashboard
                </button>
              </div>
            </div>
          </div>

          {/* Filter bar */}
          <div className="flex items-center gap-2">
            <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIME_RANGE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={level} onValueChange={(v) => setLevel(v as typeof level)}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVEL_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={workflowIds.length === 1 ? workflowIds[0] : '__all__'}
              onValueChange={handleWorkflowFilterChange}
            >
              <SelectTrigger className="h-8 w-[180px] text-xs">
                <SelectValue placeholder="All workflows" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All workflows</SelectItem>
                {workflows?.map((wf) => (
                  <SelectItem key={wf.id} value={wf.id}>
                    {wf.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="relative flex-1">
              <Search className="absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-tertiary)]" />
              <Input
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Search by execution ID..."
                className="h-8 pl-8 text-xs"
              />
              {localSearch && (
                <button
                  type="button"
                  className="absolute top-1/2 right-2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  onClick={() => setLocalSearch('')}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto">
          {isDashboard ? (
            <DashboardView stats={statsQuery.data} isLoading={statsQuery.isLoading} />
          ) : (
            <LogsTable
              logs={logs}
              isLoading={logsQuery.isLoading}
              isError={logsQuery.isError}
              error={logsQuery.error}
              selectedLogId={selectedLogId}
              onLogClick={handleLogClick}
            />
          )}
        </div>

        {/* Pagination footer (only for logs view) */}
        {!isDashboard && totalPages > 0 && (
          <footer className="flex flex-shrink-0 items-center justify-between border-t border-[var(--border)] px-6 py-3">
            <span className="text-xs text-[var(--text-tertiary)]">
              Showing {Math.min((currentPage - 1) * LOGS_PER_PAGE + 1, totalLogs)}-
              {Math.min(currentPage * LOGS_PER_PAGE, totalLogs)} of {totalLogs} logs
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="h-7 w-7 p-0"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-xs text-[var(--text-secondary)]">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="h-7 w-7 p-0"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </footer>
        )}
      </main>
    </div>
  )
}

interface LogsTableProps {
  logs: WorkflowLog[]
  isLoading: boolean
  isError: boolean
  error: Error | null
  selectedLogId: string | null
  onLogClick: (log: WorkflowLog) => void
}

/**
 * Renders the logs data table with column headers and clickable rows.
 */
function LogsTable({ logs, isLoading, isError, error, selectedLogId, onLogClick }: LogsTableProps) {
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-[var(--text-secondary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading logs...</span>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-[var(--text-error)]">
          Error: {error?.message || 'Failed to load logs'}
        </span>
      </div>
    )
  }

  if (logs.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-[var(--text-tertiary)]">No logs found</span>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/* Table header */}
      <div className="flex-shrink-0 bg-[var(--surface-3)] px-6 py-2.5">
        <div className="flex items-center">
          {LOG_COLUMN_ORDER.map((key) => {
            const col = LOG_COLUMNS[key]
            return (
              <span
                key={key}
                className={cn(
                  col.width,
                  col.minWidth,
                  'text-[11px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]'
                )}
              >
                {col.label}
              </span>
            )
          })}
        </div>
      </div>

      {/* Table body */}
      <div className="flex-1 overflow-auto">
        {logs.map((log) => {
          const date = formatDate(log.createdAt)
          const status = getDisplayStatus(log.level)
          const duration = parseDuration({
            totalDurationMs: log.totalDurationMs ?? undefined,
          })

          return (
            <div
              key={log.id}
              role="button"
              tabIndex={0}
              className={cn(
                'flex cursor-pointer items-center border-b border-[var(--border)] px-6 py-2.5 transition-colors hover:bg-[var(--surface-3)]',
                selectedLogId === log.id && 'bg-[var(--surface-4)]'
              )}
              onClick={() => onLogClick(log)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onLogClick(log)
              }}
            >
              {/* Date */}
              <span
                className={cn(
                  LOG_COLUMNS.date.width,
                  LOG_COLUMNS.date.minWidth,
                  'text-[13px] text-[var(--text-secondary)]'
                )}
              >
                {date.compactDate}
              </span>

              {/* Time */}
              <span
                className={cn(
                  LOG_COLUMNS.time.width,
                  LOG_COLUMNS.time.minWidth,
                  'font-mono text-[13px] text-[var(--text-secondary)]'
                )}
              >
                {date.formatted}
              </span>

              {/* Status */}
              <span className={cn(LOG_COLUMNS.status.width, LOG_COLUMNS.status.minWidth)}>
                <StatusBadge status={status} />
              </span>

              {/* Workflow */}
              <span
                className={cn(
                  LOG_COLUMNS.workflow.width,
                  LOG_COLUMNS.workflow.minWidth,
                  'truncate text-[13px] text-[var(--text-primary)]'
                )}
              >
                {log.workflow?.name ?? 'Deleted Workflow'}
              </span>

              {/* Cost */}
              <span
                className={cn(
                  LOG_COLUMNS.cost.width,
                  LOG_COLUMNS.cost.minWidth,
                  'font-mono text-[13px] text-[var(--text-secondary)]'
                )}
              >
                {formatCost(log.cost)}
              </span>

              {/* Trigger */}
              <span className={cn(LOG_COLUMNS.trigger.width, LOG_COLUMNS.trigger.minWidth)}>
                <TriggerBadge trigger={log.trigger || 'manual'} />
              </span>

              {/* Duration */}
              <span
                className={cn(
                  LOG_COLUMNS.duration.width,
                  LOG_COLUMNS.duration.minWidth,
                  'font-mono text-[13px] text-[var(--text-secondary)]'
                )}
              >
                {duration !== null ? formatLatency(duration) : '--'}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

interface DashboardViewProps {
  stats: ReturnType<typeof useLogStats>['data']
  isLoading: boolean
}

/**
 * Dashboard summary view showing aggregate stats and per-workflow breakdown.
 */
function DashboardView({ stats, isLoading }: DashboardViewProps) {
  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-[var(--text-tertiary)]">No dashboard data available</span>
      </div>
    )
  }

  const successRate =
    stats.totalRuns > 0
      ? (((stats.totalRuns - stats.totalErrors) / stats.totalRuns) * 100).toFixed(1)
      : '0.0'

  return (
    <div className="space-y-6 p-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-5">
          <p className="text-xs font-medium text-[var(--text-tertiary)]">Total Runs</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
            {stats.totalRuns.toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-5">
          <p className="text-xs font-medium text-[var(--text-tertiary)]">Success Rate</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{successRate}%</p>
          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
            {stats.totalErrors.toLocaleString()} errors
          </p>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-5">
          <p className="text-xs font-medium text-[var(--text-tertiary)]">Avg Latency</p>
          <p className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">
            {formatLatency(stats.avgLatency)}
          </p>
        </div>
      </div>

      {/* Per-workflow breakdown */}
      {stats.workflows.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)]">
          <div className="border-b border-[var(--border)] px-5 py-3">
            <h2 className="text-sm font-medium text-[var(--text-primary)]">Workflow Breakdown</h2>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {stats.workflows.map((wf) => (
              <div key={wf.workflowId} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">
                    {wf.workflowName || 'Unknown Workflow'}
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)]">
                    {wf.totalExecutions.toLocaleString()} executions
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-sm font-medium text-[var(--text-primary)]">
                      {wf.overallSuccessRate.toFixed(1)}%
                    </p>
                    <p className="text-xs text-[var(--text-tertiary)]">success rate</p>
                  </div>
                  <div className="h-2 w-24 overflow-hidden rounded-full bg-[var(--surface-4)]">
                    <div
                      className="h-full rounded-full bg-green-500"
                      style={{ width: `${Math.min(wf.overallSuccessRate, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
