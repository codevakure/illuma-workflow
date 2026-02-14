import { useCallback, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowLeft, Layout, Star, User } from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'
import { Button, Loader } from '@/components/emcn'
import { useTemplate } from '@/hooks/queries/templates'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

const logger = createLogger('TemplateDetailPage')

/**
 * Template detail page displaying full information about a single template
 * with the ability to import it as a new workflow.
 */
export default function TemplateDetailPage() {
  const params = useParams()
  const navigate = useNavigate()
  const workspaceId = params.workspaceId as string
  const templateId = params.templateId as string

  const { data: template, isLoading } = useTemplate(templateId)

  const [isImporting, setIsImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)

  const handleBack = useCallback(() => {
    navigate(`/workspace/${workspaceId}/templates`)
  }, [navigate, workspaceId])

  const handleImport = useCallback(async () => {
    if (!template?.state) {
      logger.warn('Cannot import template without state', { templateId })
      return
    }

    setIsImporting(true)
    setImportError(null)

    try {
      const response = await fetch('/api/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: template.name,
          state: template.state,
          workspaceId,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to create workflow from template')
      }

      const result = await response.json()
      const workflowId = result.data?.id || result.id

      if (workflowId) {
        logger.info('Workflow created from template', { templateId, workflowId })
        navigate(`/workspace/${workspaceId}/w/${workflowId}`)
      } else {
        logger.info('Workflow created from template, navigating to workspace')
        navigate(`/workspace/${workspaceId}/w`)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to import template'
      logger.error('Failed to import template', { templateId, error })
      setImportError(message)
    } finally {
      setIsImporting(false)
    }
  }, [template, templateId, workspaceId, navigate])

  const credentialKeys = template?.requiredCredentials
    ? Object.keys(template.requiredCredentials)
    : []

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar />
      <main className="flex h-full flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center gap-3 border-b border-[var(--border)] px-6 py-4">
          <button
            type="button"
            className="rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--surface-6)] hover:text-[var(--text-primary)]"
            onClick={handleBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="font-semibold text-lg text-[var(--text-primary)]">Template Details</h1>
        </header>

        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader className="h-5 w-5" animate />
            </div>
          ) : !template ? (
            <div className="flex h-64 flex-col items-center justify-center gap-3">
              <Layout className="h-10 w-10 text-[var(--text-muted)]" />
              <p className="text-sm text-[var(--text-tertiary)]">Template not found.</p>
              <Button variant="default" size="md" onClick={handleBack}>
                Back to Templates
              </Button>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              {/* Template header */}
              <div className="mb-6 flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h2 className="font-semibold text-2xl text-[var(--text-primary)]">
                    {template.name}
                  </h2>
                  {template.details?.tagline && (
                    <p className="mt-2 text-sm text-[var(--text-tertiary)]">
                      {template.details.tagline}
                    </p>
                  )}
                </div>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleImport}
                  disabled={isImporting || !template.state}
                >
                  {isImporting ? 'Importing...' : 'Import as Workflow'}
                </Button>
              </div>

              {importError && (
                <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3">
                  <p className="text-sm text-[var(--text-error)]">{importError}</p>
                </div>
              )}

              {/* Stats row */}
              <div className="mb-6 flex items-center gap-6">
                <div className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
                  <Star className="h-3.5 w-3.5" />
                  <span>{template.stars} stars</span>
                </div>
                <div className="text-sm text-[var(--text-muted)]">
                  {template.views} views
                </div>
              </div>

              {/* Creator */}
              {template.creator && (
                <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-4">
                  <h3 className="mb-2 font-medium text-xs text-[var(--text-muted)] uppercase tracking-wide">
                    Creator
                  </h3>
                  <div className="flex items-center gap-3">
                    {template.creator.profileImageUrl ? (
                      <img
                        src={template.creator.profileImageUrl}
                        alt={template.creator.name}
                        className="h-8 w-8 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--surface-6)]">
                        <User className="h-4 w-4 text-[var(--text-muted)]" />
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-sm text-[var(--text-primary)]">
                        {template.creator.name}
                      </p>
                      {template.creator.verified && (
                        <span className="text-xs text-[var(--brand-400)]">Verified</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* About */}
              {template.details?.about && (
                <div className="mb-6">
                  <h3 className="mb-2 font-medium text-xs text-[var(--text-muted)] uppercase tracking-wide">
                    About
                  </h3>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-[var(--text-secondary)]">
                    {template.details.about}
                  </p>
                </div>
              )}

              {/* Tags */}
              {template.tags.length > 0 && (
                <div className="mb-6">
                  <h3 className="mb-2 font-medium text-xs text-[var(--text-muted)] uppercase tracking-wide">
                    Tags
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {template.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-full bg-[var(--surface-6)] px-3 py-1 text-xs font-medium text-[var(--text-tertiary)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Required credentials */}
              {credentialKeys.length > 0 && (
                <div className="mb-6">
                  <h3 className="mb-2 font-medium text-xs text-[var(--text-muted)] uppercase tracking-wide">
                    Required Credentials
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {credentialKeys.map((cred) => (
                      <span
                        key={cred}
                        className="rounded bg-[var(--surface-5)] px-2.5 py-1 text-xs text-[var(--text-tertiary)]"
                      >
                        {cred}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
