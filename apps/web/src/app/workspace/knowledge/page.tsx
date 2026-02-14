import { useCallback, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowLeft, Database, Plus, Trash2, Upload } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { Button, Input, Loader, Textarea, Tooltip } from '@/components/emcn'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/emcn'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/core/utils/cn'
import {
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useKnowledgeBasesQuery,
  useKnowledgeDocumentsQuery,
} from '@/hooks/queries/knowledge'
import type { KnowledgeBaseData } from '@/lib/knowledge/types'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

const logger = createLogger('KnowledgePage')

/** Default chunking configuration for new knowledge bases */
const DEFAULT_CHUNKING_CONFIG = {
  maxSize: 1024,
  minSize: 100,
  overlap: 200,
} as const

/** Number of documents per page in the detail view */
const DOCUMENTS_PAGE_SIZE = 20

/**
 * Formats a byte count into a human-readable file size string.
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/**
 * Formats an ISO date string into a localized short date.
 */
function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

interface CreateKBFormState {
  name: string
  description: string
}

interface KBListProps {
  knowledgeBases: KnowledgeBaseData[]
  isLoading: boolean
  onSelect: (id: string) => void
  onDelete: (id: string) => void
  deletingId: string | null
  onOpenCreate: () => void
}

/**
 * Renders the grid of knowledge base cards.
 */
function KBList({
  knowledgeBases,
  isLoading,
  onSelect,
  onDelete,
  deletingId,
  onOpenCreate,
}: KBListProps) {
  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader className="h-5 w-5" animate />
      </div>
    )
  }

  if (knowledgeBases.length === 0) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <Database className="h-10 w-10 text-[var(--text-muted)]" />
        <p className="text-sm text-[var(--text-tertiary)]">
          No knowledge bases yet. Create one to get started.
        </p>
        <Button variant="primary" size="md" onClick={onOpenCreate}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Create Knowledge Base
        </Button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {knowledgeBases.map((kb) => (
        <div
          key={kb.id}
          className="group relative cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-4 transition-colors hover:border-[var(--border-1)] hover:bg-[var(--surface-4)]"
          onClick={() => onSelect(kb.id)}
        >
          <div className="mb-2 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 flex-shrink-0 text-[var(--brand-400)]" />
              <h3 className="truncate font-medium text-sm text-[var(--text-primary)]">
                {kb.name}
              </h3>
            </div>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  className="flex-shrink-0 rounded p-1 text-[var(--text-muted)] opacity-0 transition-opacity hover:bg-[var(--surface-6)] hover:text-[var(--text-error)] group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(kb.id)
                  }}
                  disabled={deletingId === kb.id}
                >
                  {deletingId === kb.id ? (
                    <Loader className="h-3.5 w-3.5" animate />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <p>Delete knowledge base</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
          {kb.description && (
            <p className="mb-3 line-clamp-2 text-xs text-[var(--text-tertiary)]">
              {kb.description}
            </p>
          )}
          <div className="flex items-center gap-3 text-xs text-[var(--text-muted)]">
            <span>{kb.tokenCount.toLocaleString()} tokens</span>
            <span>Created {formatDate(kb.createdAt)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

interface KBDetailProps {
  knowledgeBaseId: string
  knowledgeBase: KnowledgeBaseData | undefined
  onBack: () => void
}

/**
 * Renders the detail view for a selected knowledge base,
 * including documents table, pagination, and file upload zone.
 */
function KBDetail({ knowledgeBaseId, knowledgeBase, onBack }: KBDetailProps) {
  const [docOffset, setDocOffset] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)

  const { data: docsData, isLoading: docsLoading } = useKnowledgeDocumentsQuery({
    knowledgeBaseId,
    limit: DOCUMENTS_PAGE_SIZE,
    offset: docOffset,
  })

  const documents = docsData?.documents ?? []
  const pagination = docsData?.pagination ?? { total: 0, limit: DOCUMENTS_PAGE_SIZE, offset: 0, hasMore: false }

  const handleFileUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return

      setIsUploading(true)
      try {
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const formData = new FormData()
          formData.append('file', file)

          const response = await fetch(`/api/knowledge/${knowledgeBaseId}/documents`, {
            method: 'POST',
            body: formData,
          })

          if (!response.ok) {
            const result = await response.json()
            logger.error('Failed to upload document', { filename: file.name, error: result.error })
          } else {
            logger.info('Document uploaded', { filename: file.name })
          }
        }
      } catch (error) {
        logger.error('Upload failed', { error })
      } finally {
        setIsUploading(false)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [knowledgeBaseId]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      e.stopPropagation()
      handleFileUpload(e.dataTransfer.files)
    },
    [handleFileUpload]
  )

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const totalPages = Math.ceil(pagination.total / DOCUMENTS_PAGE_SIZE)
  const currentPage = Math.floor(docOffset / DOCUMENTS_PAGE_SIZE) + 1

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-6)] hover:text-[var(--text-primary)]"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div>
          <h2 className="font-medium text-lg text-[var(--text-primary)]">
            {knowledgeBase?.name ?? 'Knowledge Base'}
          </h2>
          {knowledgeBase?.description && (
            <p className="mt-0.5 text-sm text-[var(--text-tertiary)]">
              {knowledgeBase.description}
            </p>
          )}
        </div>
      </div>

      {/* Upload zone */}
      <div
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[var(--border)] bg-[var(--surface-3)] p-8 transition-colors hover:border-[var(--brand-400)] hover:bg-[var(--surface-4)]"
        onClick={() => fileInputRef.current?.click()}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {isUploading ? (
          <Loader className="h-6 w-6 text-[var(--brand-400)]" animate />
        ) : (
          <Upload className="h-6 w-6 text-[var(--text-muted)]" />
        )}
        <p className="text-sm text-[var(--text-tertiary)]">
          {isUploading ? 'Uploading...' : 'Drop files here or click to upload'}
        </p>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleFileUpload(e.target.files)}
        />
      </div>

      {/* Documents table */}
      {docsLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader className="h-5 w-5" animate />
        </div>
      ) : documents.length === 0 ? (
        <div className="flex h-32 items-center justify-center">
          <p className="text-sm text-[var(--text-tertiary)]">No documents uploaded yet.</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <Table>
              <TableHeader>
                <TableRow className="bg-[var(--surface-3)]">
                  <TableHead className="text-xs text-[var(--text-tertiary)]">Name</TableHead>
                  <TableHead className="text-xs text-[var(--text-tertiary)]">Size</TableHead>
                  <TableHead className="text-xs text-[var(--text-tertiary)]">Status</TableHead>
                  <TableHead className="text-xs text-[var(--text-tertiary)]">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.map((doc) => (
                  <TableRow
                    key={doc.id}
                    className="cursor-pointer transition-colors hover:bg-[var(--surface-4)]"
                  >
                    <TableCell className="max-w-[240px] truncate font-medium text-sm text-[var(--text-primary)]">
                      {doc.filename}
                    </TableCell>
                    <TableCell className="text-sm text-[var(--text-tertiary)]">
                      {formatFileSize(doc.fileSize)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          doc.processingStatus === 'completed' &&
                            'bg-green-500/10 text-green-500',
                          doc.processingStatus === 'processing' &&
                            'bg-yellow-500/10 text-yellow-500',
                          doc.processingStatus === 'pending' &&
                            'bg-blue-500/10 text-blue-500',
                          doc.processingStatus === 'failed' &&
                            'bg-red-500/10 text-red-500',
                          !doc.enabled && 'opacity-50'
                        )}
                      >
                        {doc.enabled ? doc.processingStatus : 'disabled'}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-[var(--text-tertiary)]">
                      {formatDate(doc.uploadedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-xs text-[var(--text-muted)]">
                Showing {docOffset + 1}-{Math.min(docOffset + DOCUMENTS_PAGE_SIZE, pagination.total)}{' '}
                of {pagination.total}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  disabled={currentPage <= 1}
                  onClick={() => setDocOffset(Math.max(0, docOffset - DOCUMENTS_PAGE_SIZE))}
                >
                  Previous
                </Button>
                <span className="text-xs text-[var(--text-tertiary)]">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="default"
                  size="sm"
                  disabled={!pagination.hasMore}
                  onClick={() => setDocOffset(docOffset + DOCUMENTS_PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Knowledge Base management page.
 *
 * Displays a grid of knowledge bases with options to create, delete, and drill
 * into detail views showing documents and upload functionality.
 */
export default function KnowledgePage() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const [selectedKBId, setSelectedKBId] = useState<string | null>(null)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [formState, setFormState] = useState<CreateKBFormState>({ name: '', description: '' })

  const { data: knowledgeBases, isLoading } = useKnowledgeBasesQuery(workspaceId)
  const createKB = useCreateKnowledgeBase(workspaceId)
  const deleteKB = useDeleteKnowledgeBase(workspaceId)

  const selectedKB = knowledgeBases?.find((kb) => kb.id === selectedKBId)

  const handleCreate = useCallback(async () => {
    if (!formState.name.trim()) return

    try {
      await createKB.mutateAsync({
        name: formState.name.trim(),
        description: formState.description.trim() || undefined,
        workspaceId,
        chunkingConfig: DEFAULT_CHUNKING_CONFIG,
      })
      setFormState({ name: '', description: '' })
      setShowCreateDialog(false)
      logger.info('Knowledge base created', { name: formState.name })
    } catch (error) {
      logger.error('Failed to create knowledge base', { error })
    }
  }, [formState, workspaceId, createKB])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirmId) return

    try {
      await deleteKB.mutateAsync({ knowledgeBaseId: deleteConfirmId })
      if (selectedKBId === deleteConfirmId) {
        setSelectedKBId(null)
      }
      logger.info('Knowledge base deleted', { id: deleteConfirmId })
    } catch (error) {
      logger.error('Failed to delete knowledge base', { error })
    } finally {
      setDeleteConfirmId(null)
    }
  }, [deleteConfirmId, deleteKB, selectedKBId])

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar />
      <main className="flex h-full flex-1 flex-col overflow-hidden">
        {/* Header */}
        <header className="flex flex-shrink-0 items-center justify-between border-b border-[var(--border)] px-6 py-4">
          <h1 className="font-medium text-lg text-[var(--text-primary)]">Knowledge Base</h1>
          {!selectedKBId && (
            <Button
              variant="primary"
              size="md"
              onClick={() => setShowCreateDialog(true)}
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create
            </Button>
          )}
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {selectedKBId ? (
            <KBDetail
              knowledgeBaseId={selectedKBId}
              knowledgeBase={selectedKB}
              onBack={() => setSelectedKBId(null)}
            />
          ) : (
            <KBList
              knowledgeBases={knowledgeBases ?? []}
              isLoading={isLoading}
              onSelect={setSelectedKBId}
              onDelete={setDeleteConfirmId}
              deletingId={deleteKB.isPending ? deleteConfirmId : null}
              onOpenCreate={() => setShowCreateDialog(true)}
            />
          )}
        </div>
      </main>

      {/* Create Knowledge Base Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Knowledge Base</DialogTitle>
            <DialogDescription>
              Add a new knowledge base to organize your documents.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                Name <span className="text-[var(--text-error)]">*</span>
              </label>
              <Input
                placeholder="My Knowledge Base"
                value={formState.name}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, name: e.target.value }))
                }
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[var(--text-secondary)]">
                Description
              </label>
              <Textarea
                placeholder="Optional description..."
                value={formState.description}
                onChange={(e) =>
                  setFormState((prev) => ({ ...prev, description: e.target.value }))
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="default"
              size="md"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              disabled={!formState.name.trim() || createKB.isPending}
              onClick={handleCreate}
            >
              {createKB.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Knowledge Base</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this knowledge base? All documents and chunks will be
              permanently removed. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="default" size="md" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="md"
              disabled={deleteKB.isPending}
              onClick={handleDeleteConfirm}
            >
              {deleteKB.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
