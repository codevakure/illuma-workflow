import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { cn } from '@/lib/core/utils/cn'

interface ResumeLinks {
  apiUrl: string
  uiUrl: string
  contextId: string
  executionId: string
  workflowId: string
}

interface NormalizedInputField {
  id: string
  name: string
  label: string
  type: string
  description?: string
  placeholder?: string
  value?: unknown
  required?: boolean
  options?: unknown[]
  rows?: number
}

interface ResponseStructureRow {
  id: string
  name: string
  type: string
  value: unknown
}

interface ResumeQueueEntrySummary {
  id: string
  contextId: string
  status: string
  queuedAt: string | null
  claimedAt: string | null
  completedAt: string | null
  failureReason: string | null
  newExecutionId: string
  resumeInput: Record<string, unknown>
}

interface PausePointWithQueue {
  contextId: string
  triggerBlockId?: string
  blockId?: string
  response: Record<string, unknown>
  registeredAt: string
  resumeStatus: string
  snapshotReady: boolean
  resumeLinks?: ResumeLinks
  queuePosition?: number | null
  latestResumeEntry?: ResumeQueueEntrySummary | null
  parallelScope?: unknown
  loopScope?: unknown
}

interface PausedExecutionDetail {
  id: string
  workflowId: string
  executionId: string
  status: string
  totalPauseCount: number
  resumedCount: number
  pausedAt: string | null
  updatedAt: string | null
  expiresAt: string | null
  metadata: Record<string, unknown> | null
  triggerIds: string[]
  pausePoints: PausePointWithQueue[]
  executionSnapshot: Record<string, unknown>
  queue: ResumeQueueEntrySummary[]
}

interface PauseContextDetail {
  execution: PausedExecutionDetail
  pausePoint: PausePointWithQueue
  queue: ResumeQueueEntrySummary[]
  activeResumeEntry?: ResumeQueueEntrySummary | null
}

const STATUS_COLORS: Record<string, string> = {
  paused: 'bg-orange-100 text-orange-700 border-orange-200',
  queued: 'bg-blue-100 text-blue-700 border-blue-200',
  resuming: 'bg-blue-100 text-blue-700 border-blue-200',
  resumed: 'bg-green-100 text-green-700 border-green-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
}

/**
 * Formats a date string for display.
 */
function formatDate(value: string | null): string {
  if (!value) return '--'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

/**
 * Status badge component for resume statuses.
 */
function StatusBadge({ status }: { status: string }) {
  const label = status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown'
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        STATUS_COLORS[status] || 'bg-gray-100 text-gray-700 border-gray-200'
      )}
    >
      {label}
    </span>
  )
}

/**
 * Normalizes raw input format fields from the API response.
 */
function normalizeInputFormatFields(raw: unknown): NormalizedInputField[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((field: Record<string, unknown>, index: number) => {
      if (!field || typeof field !== 'object') return null
      const name = typeof field.name === 'string' ? (field.name as string).trim() : ''
      if (!name) return null
      return {
        id: typeof field.id === 'string' && (field.id as string).length > 0 ? field.id : `field_${index}`,
        name,
        label:
          typeof field.label === 'string' && (field.label as string).trim().length > 0
            ? (field.label as string).trim()
            : name,
        type:
          typeof field.type === 'string' && (field.type as string).trim().length > 0
            ? (field.type as string)
            : 'string',
        description:
          typeof field.description === 'string' && (field.description as string).trim().length > 0
            ? (field.description as string).trim()
            : undefined,
        placeholder:
          typeof field.placeholder === 'string' && (field.placeholder as string).trim().length > 0
            ? (field.placeholder as string).trim()
            : undefined,
        value: field.value,
        required: field.required === true,
        options: Array.isArray(field.options) ? field.options : undefined,
        rows: typeof field.rows === 'number' ? field.rows : undefined,
      } as NormalizedInputField
    })
    .filter((field): field is NormalizedInputField => field !== null)
}

/**
 * Formats a value for display in a disabled input field.
 */
function formatValueForInputField(field: NormalizedInputField, value: unknown): string {
  if (value === undefined || value === null) return ''
  switch (field.type) {
    case 'boolean':
      if (typeof value === 'boolean') return value ? 'true' : 'false'
      if (typeof value === 'string') {
        const normalized = (value as string).trim().toLowerCase()
        if (normalized === 'true' || normalized === 'false') return normalized
      }
      return ''
    case 'number':
      if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
      if (typeof value === 'string') return value as string
      return ''
    case 'array':
    case 'object':
    case 'files':
      if (typeof value === 'string') return value as string
      try {
        return JSON.stringify(value, null, 2)
      } catch {
        return ''
      }
    default:
      return typeof value === 'string' ? (value as string) : JSON.stringify(value)
  }
}

/**
 * Attempts to extract block name from the execution snapshot.
 */
function getBlockNameFromSnapshot(
  executionSnapshot: Record<string, unknown> | null | undefined,
  blockId: string | undefined
): string | null {
  if (!executionSnapshot || !blockId) return null
  const snapshotStr = (executionSnapshot as Record<string, unknown>).snapshot
  if (typeof snapshotStr !== 'string') return null
  try {
    const parsed = JSON.parse(snapshotStr)
    const workflowState = parsed?.workflow
    if (!workflowState?.blocks || !Array.isArray(workflowState.blocks)) return null
    const block = workflowState.blocks.find((b: { id: string }) => b.id === blockId)
    return block?.metadata?.name || null
  } catch {
    return null
  }
}

/**
 * Public resume/HITL page.
 * Communicates with /api/resume/:workflowId/:executionId and
 * /api/resume/:workflowId/:executionId/:contextId.
 */
export default function ResumePage() {
  const { workflowId, executionId, contextId: routeContextId } = useParams<{
    workflowId: string
    executionId: string
    contextId?: string
  }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()

  const initialContextId = routeContextId || searchParams.get('contextId') || undefined

  const [executionDetail, setExecutionDetail] = useState<PausedExecutionDetail | null>(null)
  const [selectedContextId, setSelectedContextId] = useState<string | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<PauseContextDetail | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<string>('paused')
  const [queuePosition, setQueuePosition] = useState<number | null | undefined>(undefined)
  const [resumeInput, setResumeInput] = useState('')
  const [resumeInputsByContext, setResumeInputsByContext] = useState<Record<string, string>>({})
  const [formValues, setFormValues] = useState<Record<string, string>>({})
  const [formValuesByContext, setFormValuesByContext] = useState<
    Record<string, Record<string, string>>
  >({})
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})
  const [isPageLoading, setIsPageLoading] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingAction, setLoadingAction] = useState(false)
  const [refreshingExecution, setRefreshingExecution] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const pausePoints = executionDetail?.pausePoints ?? []

  // Redirect contextId route param to search param
  useEffect(() => {
    if (routeContextId && workflowId && executionId) {
      navigate(`/resume/${workflowId}/${executionId}?contextId=${routeContextId}`, { replace: true })
    }
  }, [routeContextId, workflowId, executionId, navigate])

  // Fetch execution detail on mount
  useEffect(() => {
    if (!workflowId || !executionId) return

    const controller = new AbortController()
    const fetchExecution = async () => {
      setIsPageLoading(true)
      try {
        const response = await fetch(`/api/resume/${workflowId}/${executionId}`, {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) {
          setExecutionDetail(null)
          return
        }
        const data: PausedExecutionDetail = await response.json()
        setExecutionDetail(data)

        const defaultCtx =
          initialContextId ||
          data.pausePoints.find((p) => p.resumeStatus === 'paused')?.contextId ||
          data.pausePoints[0]?.contextId ||
          null
        setSelectedContextId(defaultCtx)
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setExecutionDetail(null)
        }
      } finally {
        setIsPageLoading(false)
      }
    }

    fetchExecution()
    return () => controller.abort()
  }, [workflowId, executionId, initialContextId])

  // Build initial form values from input format fields
  const buildInitialFormValues = useCallback(
    (fields: NormalizedInputField[], submission?: Record<string, unknown>) => {
      const initial: Record<string, string> = {}
      for (const field of fields) {
        const candidate =
          submission && Object.hasOwn(submission, field.name)
            ? submission[field.name]
            : field.value
        initial[field.name] = formatValueForInputField(field, candidate)
      }
      return initial
    },
    []
  )

  // Fetch selected pause context detail
  useEffect(() => {
    if (!selectedContextId || !workflowId || !executionId) {
      setSelectedDetail(null)
      return
    }

    const controller = new AbortController()
    const loadDetail = async () => {
      setLoadingDetail(true)
      try {
        const response = await fetch(
          `/api/resume/${workflowId}/${executionId}/${selectedContextId}`,
          {
            method: 'GET',
            credentials: 'include',
            cache: 'no-store',
            signal: controller.signal,
          }
        )
        if (!response.ok) {
          setSelectedDetail(null)
          return
        }
        const data: PauseContextDetail = await response.json()
        setSelectedDetail(data)
        setSelectedStatus(data.pausePoint.resumeStatus)
        setQueuePosition(data.pausePoint.queuePosition)

        const responseData = (data.pausePoint.response as Record<string, unknown>)?.data as Record<string, unknown> ?? {}
        const operation = (responseData.operation as string) || 'human'
        const fetchedInputFields = normalizeInputFormatFields(responseData.inputFormat)
        const submission =
          responseData &&
          typeof responseData.submission === 'object' &&
          !Array.isArray(responseData.submission)
            ? (responseData.submission as Record<string, unknown>)
            : undefined

        if (operation === 'human' && fetchedInputFields.length > 0) {
          const baseValues = buildInitialFormValues(fetchedInputFields, submission)
          let mergedValues = baseValues
          setFormValuesByContext((prev) => {
            const existing = prev[data.pausePoint.contextId]
            if (existing) mergedValues = { ...baseValues, ...existing }
            return { ...prev, [data.pausePoint.contextId]: mergedValues }
          })
          setFormValues(mergedValues)
          setFormErrors({})
          setResumeInput('')
        } else {
          const initialValue =
            typeof responseData === 'string'
              ? responseData
              : JSON.stringify(responseData ?? {}, null, 2)
          setResumeInputsByContext((prev) => {
            if (prev[data.pausePoint.contextId] !== undefined) {
              setResumeInput(prev[data.pausePoint.contextId])
              return prev
            }
            setResumeInput(initialValue)
            return { ...prev, [data.pausePoint.contextId]: initialValue }
          })
          setFormValues({})
          setFormErrors({})
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          setSelectedDetail(null)
        }
      } finally {
        setLoadingDetail(false)
      }
    }

    loadDetail()
    return () => controller.abort()
  }, [workflowId, executionId, selectedContextId, buildInitialFormValues])

  const selectedOperation = useMemo(
    () =>
      ((selectedDetail?.pausePoint.response as Record<string, unknown>)?.data as Record<string, unknown>)
        ?.operation as string || 'human',
    [selectedDetail]
  )
  const isHumanMode = selectedOperation === 'human'

  const inputFormatFields = useMemo(
    () =>
      normalizeInputFormatFields(
        ((selectedDetail?.pausePoint.response as Record<string, unknown>)?.data as Record<string, unknown>)
          ?.inputFormat
      ),
    [selectedDetail]
  )
  const hasInputFormat = inputFormatFields.length > 0

  const responseStructureRows = useMemo<ResponseStructureRow[]>(() => {
    const raw = ((selectedDetail?.pausePoint.response as Record<string, unknown>)?.data as Record<string, unknown>)
      ?.responseStructure
    if (!Array.isArray(raw)) return []
    return raw
      .map((entry: Record<string, unknown>, index: number) => {
        if (!entry || typeof entry !== 'object') return null
        const name =
          typeof entry.name === 'string' && (entry.name as string).length > 0
            ? (entry.name as string)
            : `field_${index}`
        const type =
          typeof entry.type === 'string' && (entry.type as string).length > 0
            ? (entry.type as string)
            : Array.isArray(entry.value)
              ? 'array'
              : typeof entry.value
        return {
          id: (entry.id as string) ?? `${name}_${index}`,
          name,
          type,
          value: entry.value,
        } as ResponseStructureRow
      })
      .filter((row): row is ResponseStructureRow => row !== null)
  }, [selectedDetail])

  const refreshExecutionDetail = useCallback(async () => {
    if (!workflowId || !executionId) return
    setRefreshingExecution(true)
    try {
      const response = await fetch(`/api/resume/${workflowId}/${executionId}`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      })
      if (!response.ok) return
      const data: PausedExecutionDetail = await response.json()
      setExecutionDetail(data)
      if (!selectedContextId) {
        const first =
          data.pausePoints?.find((point) => point.resumeStatus === 'paused')?.contextId ?? null
        setSelectedContextId(first)
      }
    } catch {
      /* ignore */
    } finally {
      setRefreshingExecution(false)
    }
  }, [workflowId, executionId, selectedContextId])

  const handleFormFieldChange = useCallback(
    (fieldName: string, newValue: string) => {
      if (!selectedContextId) return
      setFormValues((prev) => {
        const updated = { ...prev, [fieldName]: newValue }
        setFormValuesByContext((map) => ({ ...map, [selectedContextId]: updated }))
        return updated
      })
      setFormErrors((prev) => {
        if (!prev[fieldName]) return prev
        const { [fieldName]: _, ...rest } = prev
        return rest
      })
    },
    [selectedContextId]
  )

  const parseFormValue = useCallback(
    (field: NormalizedInputField, rawValue: string): { value: unknown; error?: string } => {
      const value = rawValue ?? ''
      switch (field.type) {
        case 'number': {
          if (!value.trim()) return { value: null }
          const numericValue = Number(value)
          if (Number.isNaN(numericValue)) return { value: null, error: 'Enter a valid number.' }
          return { value: numericValue }
        }
        case 'boolean': {
          if (value === 'true') return { value: true }
          if (value === 'false') return { value: false }
          if (!value) return { value: null }
          return { value: null, error: 'Select true or false.' }
        }
        case 'array':
        case 'object':
        case 'files': {
          if (!value.trim()) {
            if (field.type === 'array') return { value: [] }
            return { value: {} }
          }
          try {
            return { value: JSON.parse(value) }
          } catch {
            return { value: null, error: 'Enter valid JSON.' }
          }
        }
        default:
          return { value }
      }
    },
    []
  )

  const handleResume = useCallback(async () => {
    if (!selectedContextId || !selectedDetail || !workflowId || !executionId) return
    setLoadingAction(true)
    setError(null)
    setMessage(null)

    let resumePayload: unknown
    if (isHumanMode && hasInputFormat) {
      const errors: Record<string, string> = {}
      const submission: Record<string, unknown> = {}
      for (const field of inputFormatFields) {
        const rawValue = formValues[field.name] ?? ''
        const hasValue =
          field.type === 'boolean'
            ? rawValue === 'true' || rawValue === 'false'
            : rawValue.trim().length > 0 && rawValue !== '__unset__'
        if (!hasValue || rawValue === '__unset__') {
          if (field.required) errors[field.name] = 'This field is required.'
          continue
        }
        const { value, error: parseError } = parseFormValue(field, rawValue)
        if (parseError) {
          errors[field.name] = parseError
          continue
        }
        if (value !== undefined) submission[field.name] = value
      }
      if (Object.keys(errors).length > 0) {
        setFormErrors(errors)
        setLoadingAction(false)
        return
      }
      setFormErrors({})
      resumePayload = { submission }
    } else {
      let parsedInput: unknown
      if (resumeInput && resumeInput.trim().length > 0) {
        try {
          parsedInput = JSON.parse(resumeInput)
        } catch {
          setError('Resume input must be valid JSON.')
          setLoadingAction(false)
          return
        }
      }
      resumePayload = parsedInput
    }

    try {
      const response = await fetch(
        `/api/resume/${workflowId}/${executionId}/${selectedContextId}`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(resumePayload ? { input: resumePayload } : {}),
        }
      )
      const payload = await response.json()
      if (!response.ok) {
        setError(payload.error || 'Failed to resume execution.')
        return
      }

      const nextStatus = payload.status === 'queued' ? 'queued' : 'resuming'
      const nextQueuePosition = payload.queuePosition ?? null

      setExecutionDetail((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          pausePoints: prev.pausePoints.map((point) =>
            point.contextId === selectedContextId
              ? { ...point, resumeStatus: nextStatus, queuePosition: nextQueuePosition }
              : point
          ),
        }
      })
      setSelectedStatus(nextStatus)
      setQueuePosition(nextQueuePosition)

      const fallbackContextId =
        executionDetail?.pausePoints.find(
          (point) => point.contextId !== selectedContextId && point.resumeStatus === 'paused'
        )?.contextId ?? null
      setSelectedContextId(fallbackContextId)

      setMessage(
        payload.status === 'queued' ? 'Resume request queued.' : 'Resume started successfully.'
      )
      await refreshExecutionDetail()
    } catch (err) {
      setError((err as Error).message || 'Unexpected error while resuming execution.')
    } finally {
      setLoadingAction(false)
    }
  }, [
    workflowId,
    executionId,
    selectedContextId,
    isHumanMode,
    hasInputFormat,
    inputFormatFields,
    formValues,
    parseFormValue,
    resumeInput,
    selectedDetail,
    executionDetail,
    refreshExecutionDetail,
  ])

  const isFormComplete = useMemo(() => {
    if (!isHumanMode || !hasInputFormat) return true
    return inputFormatFields.every((field) => {
      const rawValue = formValues[field.name] ?? ''
      if (field.type === 'boolean') {
        if (field.required) return rawValue === 'true' || rawValue === 'false'
        return rawValue === '' || rawValue === 'true' || rawValue === 'false'
      }
      if (!field.required) return true
      return rawValue.trim().length > 0
    })
  }, [isHumanMode, hasInputFormat, inputFormatFields, formValues])

  const resumeDisabled =
    loadingAction ||
    selectedStatus === 'resumed' ||
    selectedStatus === 'failed' ||
    selectedStatus === 'resuming' ||
    selectedStatus === 'queued' ||
    (isHumanMode && hasInputFormat && (!isFormComplete || Object.keys(formErrors).length > 0))

  const getBlockName = useCallback(
    (pause: PausePointWithQueue) => {
      const pauseBlockId = pause.blockId || pause.triggerBlockId
      return (
        getBlockNameFromSnapshot(executionDetail?.executionSnapshot, pauseBlockId) ||
        'Human in the Loop'
      )
    },
    [executionDetail]
  )

  const formatStructureValue = useCallback((value: unknown): string => {
    if (value === null || value === undefined) return '--'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }, [])

  // Page loading state
  if (isPageLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-1)] border-t-[var(--text-primary)]" />
          <p className="text-sm text-[var(--text-secondary)]">Loading execution...</p>
        </div>
      </div>
    )
  }

  // Not found state
  if (!executionDetail) {
    return (
      <div className="flex min-h-screen flex-col bg-[var(--bg)]">
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="text-center">
            <h1 className="mb-2 text-xl font-medium text-[var(--text-primary)]">
              Execution Not Found
            </h1>
            <p className="mb-6 text-sm text-[var(--text-secondary)]">
              This execution could not be located or has already completed.
            </p>
            <button
              onClick={() => navigate('/')}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-4)]"
            >
              Return Home
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      {/* Page content */}
      <div className="mx-auto max-w-[1200px] px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-medium text-[var(--text-primary)]">Paused Execution</h1>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Select a pause point to review and resume
            </p>
          </div>
          <button
            onClick={refreshExecutionDetail}
            disabled={refreshingExecution}
            className="flex items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2 transition-colors hover:bg-[var(--surface-4)] disabled:opacity-50"
            title="Refresh"
          >
            <svg
              className={cn('h-4 w-4 text-[var(--text-secondary)]', refreshingExecution && 'animate-spin')}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>

        {/* Main layout */}
        <div className="grid grid-cols-[280px_1fr] gap-6">
          {/* Pause points list */}
          <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
            <div className="border-b border-[var(--border)] px-4 py-3">
              <h2 className="text-sm font-medium text-[var(--text-primary)]">Pause Points</h2>
            </div>
            <div>
              {pausePoints.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-[var(--text-secondary)]">
                  No pause points
                </div>
              ) : (
                pausePoints.map((pause) => (
                  <button
                    key={pause.contextId}
                    onClick={() => {
                      setSelectedContextId(pause.contextId)
                      setError(null)
                      setMessage(null)
                    }}
                    className={cn(
                      'flex w-full items-center justify-between px-4 py-3 text-left transition-colors',
                      pause.contextId === selectedContextId
                        ? 'bg-[var(--surface-4)]'
                        : 'hover:bg-[var(--surface-3)]'
                    )}
                  >
                    <span className="truncate text-sm text-[var(--text-primary)]">
                      {getBlockName(pause)}
                    </span>
                    <StatusBadge status={pause.resumeStatus} />
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Detail panel */}
          <div>
            {loadingDetail && !selectedDetail ? (
              <div className="flex h-[200px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
                <p className="text-sm text-[var(--text-secondary)]">Loading...</p>
              </div>
            ) : !selectedContextId ? (
              <div className="flex h-[200px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
                <p className="text-sm text-[var(--text-secondary)]">Select a pause point</p>
              </div>
            ) : !selectedDetail ? (
              <div className="flex h-[200px] items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
                <p className="text-sm text-[var(--text-secondary)]">Could not load details</p>
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Status header */}
                <div className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--surface-1)] px-4 py-3">
                  <div>
                    <h3 className="text-sm font-medium text-[var(--text-primary)]">
                      {getBlockName(selectedDetail.pausePoint)}
                    </h3>
                    <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                      Paused at {formatDate(selectedDetail.pausePoint.registeredAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={selectedStatus} />
                    {queuePosition != null && queuePosition > 0 && (
                      <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                        Queue #{queuePosition}
                      </span>
                    )}
                  </div>
                </div>

                {/* Already resolved */}
                {selectedStatus === 'resumed' || selectedStatus === 'failed' ? (
                  <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
                    <div className="border-b border-[var(--border)] px-4 py-3">
                      <h3 className="text-sm font-medium text-[var(--text-primary)]">Resume Form</h3>
                    </div>
                    <div className="flex flex-col gap-4 p-4">
                      {selectedStatus === 'failed' &&
                        selectedDetail.pausePoint.latestResumeEntry?.failureReason && (
                          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                            {selectedDetail.pausePoint.latestResumeEntry.failureReason}
                          </div>
                        )}
                      {inputFormatFields.length > 0 &&
                      selectedDetail.pausePoint.latestResumeEntry?.resumeInput ? (
                        inputFormatFields.map((field) => {
                          const resumedValues =
                            (selectedDetail.pausePoint.latestResumeEntry?.resumeInput as Record<string, unknown>)?.submission ??
                            selectedDetail.pausePoint.latestResumeEntry?.resumeInput ??
                            {}
                          const rawValue = (resumedValues as Record<string, unknown>)[field.name]
                          const displayValue =
                            rawValue !== undefined
                              ? typeof rawValue === 'object'
                                ? JSON.stringify(rawValue)
                                : String(rawValue)
                              : ''
                          return (
                            <div key={field.id} className="flex flex-col gap-1.5">
                              <label className="text-sm font-medium text-[var(--text-primary)]">
                                {field.label}
                              </label>
                              {field.description && (
                                <p className="text-xs text-[var(--text-muted)]">{field.description}</p>
                              )}
                              <input
                                value={displayValue}
                                disabled
                                className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-4)] px-3 py-2 text-sm text-[var(--text-secondary)] opacity-70"
                              />
                            </div>
                          )
                        })
                      ) : selectedDetail.pausePoint.latestResumeEntry?.resumeInput ? (
                        <textarea
                          value={JSON.stringify(
                            selectedDetail.pausePoint.latestResumeEntry.resumeInput,
                            null,
                            2
                          )}
                          disabled
                          rows={6}
                          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-4)] px-3 py-2 font-mono text-xs text-[var(--text-secondary)] opacity-70"
                        />
                      ) : (
                        <p className="text-sm text-[var(--text-muted)]">No input data provided</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Display data */}
                    <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
                      <div className="border-b border-[var(--border)] px-4 py-3">
                        <h3 className="text-sm font-medium text-[var(--text-primary)]">Display Data</h3>
                      </div>
                      <div className="p-4">
                        {responseStructureRows.length > 0 ? (
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="border-b border-[var(--border)]">
                                <th className="pb-2 pr-4 font-medium text-[var(--text-secondary)]">Field</th>
                                <th className="pb-2 pr-4 font-medium text-[var(--text-secondary)]">Type</th>
                                <th className="pb-2 font-medium text-[var(--text-secondary)]">Value</th>
                              </tr>
                            </thead>
                            <tbody>
                              {responseStructureRows.map((row) => (
                                <tr key={row.id} className="border-b border-[var(--border)] last:border-b-0">
                                  <td className="py-2 pr-4 text-[var(--text-primary)]">{row.name}</td>
                                  <td className="py-2 pr-4 text-[var(--text-muted)]">{row.type}</td>
                                  <td className="py-2">
                                    <code className="text-xs text-[var(--text-secondary)]">
                                      {formatStructureValue(row.value)}
                                    </code>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        ) : (
                          <p className="text-sm text-[var(--text-muted)]">
                            No display data configured
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Resume form */}
                    {isHumanMode && hasInputFormat ? (
                      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
                        <div className="border-b border-[var(--border)] px-4 py-3">
                          <h3 className="text-sm font-medium text-[var(--text-primary)]">Resume Form</h3>
                        </div>
                        <div className="flex flex-col gap-4 p-4">
                          {inputFormatFields.map((field) => (
                            <div key={field.id} className="flex flex-col gap-1.5">
                              <label className="text-sm font-medium text-[var(--text-primary)]">
                                {field.label}
                                {field.required && (
                                  <span className="ml-1 text-red-500">*</span>
                                )}
                              </label>
                              {field.description && (
                                <p className="text-xs text-[var(--text-muted)]">{field.description}</p>
                              )}
                              <ResumeFieldInput
                                field={field}
                                value={formValues[field.name] ?? ''}
                                onChange={(val) => handleFormFieldChange(field.name, val)}
                              />
                              {formErrors[field.name] && (
                                <p className="text-xs text-red-500">{formErrors[field.name]}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-1)]">
                        <div className="border-b border-[var(--border)] px-4 py-3">
                          <h3 className="text-sm font-medium text-[var(--text-primary)]">
                            Resume Input (JSON)
                          </h3>
                        </div>
                        <div className="p-4">
                          <textarea
                            value={resumeInput}
                            onChange={(e) => {
                              setResumeInput(e.target.value)
                              if (selectedContextId) {
                                setResumeInputsByContext((prev) => ({
                                  ...prev,
                                  [selectedContextId]: e.target.value,
                                }))
                              }
                            }}
                            placeholder='{"example": "value"}'
                            rows={6}
                            className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-5)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-1)] focus:outline-none"
                          />
                        </div>
                      </div>
                    )}

                    {/* Messages */}
                    {error && (
                      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                        {error}
                      </div>
                    )}
                    {message && (
                      <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-600">
                        {message}
                      </div>
                    )}

                    {/* Action button */}
                    <button
                      onClick={handleResume}
                      disabled={resumeDisabled}
                      className="rounded-lg bg-[var(--brand-400)] px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {loadingAction ? 'Resuming...' : 'Resume Execution'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 border-t border-[var(--border)] py-4 text-center text-sm text-[var(--text-muted)]">
        Need help?{' '}
        <a href="mailto:support@simstudio.ai" className="text-[var(--text-secondary)] hover:underline">
          Contact support
        </a>
      </div>
    </div>
  )
}

interface ResumeFieldInputProps {
  field: NormalizedInputField
  value: string
  onChange: (value: string) => void
}

/**
 * Renders the appropriate input element for a resume form field.
 */
function ResumeFieldInput({ field, value, onChange }: ResumeFieldInputProps) {
  const baseClass =
    'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-5)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-1)] focus:outline-none'

  switch (field.type) {
    case 'boolean': {
      return (
        <select
          value={value === 'true' || value === 'false' ? value : '__unset__'}
          onChange={(e) => onChange(e.target.value)}
          className={baseClass}
        >
          {!field.required && <option value="__unset__">Not set</option>}
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      )
    }
    case 'number':
      return (
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? 'Enter a number...'}
          className={baseClass}
        />
      )
    case 'array':
    case 'object':
    case 'files':
      return (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? (field.type === 'array' ? '[...]' : '{...}')}
          rows={5}
          className={cn(baseClass, 'resize-y font-mono text-xs')}
        />
      )
    default: {
      if (field.rows !== undefined && field.rows > 3) {
        return (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder ?? 'Enter value...'}
            rows={5}
            className={cn(baseClass, 'resize-y')}
          />
        )
      }
      return (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder ?? 'Enter value...'}
          className={baseClass}
        />
      )
    }
  }
}
