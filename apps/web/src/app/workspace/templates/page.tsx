import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Layout, Search, Star } from 'lucide-react'
import { useParams, useNavigate } from 'react-router-dom'
import { Input } from '@/components/ui/input'
import { useTemplates, type Template } from '@/hooks/queries/templates'
import { useDebounce } from '@/hooks/use-debounce'
import { Sidebar } from '@/app/workspace/[workspaceId]/w/components/sidebar/sidebar'

const logger = createLogger('TemplatesPage')

/** Number of skeleton cards to show during loading */
const SKELETON_COUNT = 8

/**
 * Renders a single template card in the grid.
 */
function TemplateCard({ template, onClick }: { template: Template; onClick: () => void }) {
  const credentialKeys = template.requiredCredentials
    ? Object.keys(template.requiredCredentials)
    : []

  return (
    <div
      className="group cursor-pointer rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-4 transition-colors hover:border-[var(--border-1)] hover:bg-[var(--surface-4)]"
      onClick={onClick}
    >
      <div className="mb-2 flex items-start justify-between">
        <h3 className="line-clamp-1 font-medium text-sm text-[var(--text-primary)]">
          {template.name}
        </h3>
        <div className="flex flex-shrink-0 items-center gap-1 text-[var(--text-muted)]">
          <Star className="h-3 w-3" />
          <span className="text-xs">{template.stars}</span>
        </div>
      </div>

      {template.details?.tagline && (
        <p className="mb-3 line-clamp-2 text-xs text-[var(--text-tertiary)]">
          {template.details.tagline}
        </p>
      )}

      {template.creator?.name && (
        <p className="mb-3 text-xs text-[var(--text-muted)]">
          by {template.creator.name}
        </p>
      )}

      {template.tags.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1">
          {template.tags.slice(0, 4).map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-[var(--surface-6)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)]"
            >
              {tag}
            </span>
          ))}
          {template.tags.length > 4 && (
            <span className="rounded-full bg-[var(--surface-6)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-muted)]">
              +{template.tags.length - 4}
            </span>
          )}
        </div>
      )}

      {credentialKeys.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {credentialKeys.map((cred) => (
            <span
              key={cred}
              className="rounded bg-[var(--surface-5)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]"
            >
              {cred}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Renders a placeholder skeleton card during loading.
 */
function TemplateCardSkeleton() {
  return (
    <div className="animate-pulse rounded-lg border border-[var(--border)] bg-[var(--surface-3)] p-4">
      <div className="mb-2 flex items-start justify-between">
        <div className="h-4 w-3/4 rounded bg-[var(--surface-5)]" />
        <div className="h-3 w-8 rounded bg-[var(--surface-5)]" />
      </div>
      <div className="mb-3 space-y-1.5">
        <div className="h-3 w-full rounded bg-[var(--surface-5)]" />
        <div className="h-3 w-2/3 rounded bg-[var(--surface-5)]" />
      </div>
      <div className="mb-3 h-3 w-20 rounded bg-[var(--surface-5)]" />
      <div className="flex gap-1">
        <div className="h-4 w-12 rounded-full bg-[var(--surface-5)]" />
        <div className="h-4 w-14 rounded-full bg-[var(--surface-5)]" />
      </div>
    </div>
  )
}

/**
 * Templates page displaying a searchable grid of workflow templates.
 *
 * Fetches templates via the `useTemplates` query hook and provides
 * client-side search filtering by name and tagline.
 */
export default function TemplatesPage() {
  const params = useParams()
  const navigate = useNavigate()
  const workspaceId = params.workspaceId as string

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)

  const { data, isLoading } = useTemplates({ status: 'approved' })
  const templates = data?.data ?? []

  const filteredTemplates = useMemo(() => {
    if (!debouncedSearch) return templates

    const query = debouncedSearch.toLowerCase()
    return templates.filter((template) => {
      const searchableText = [template.name, template.details?.tagline, template.creator?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return searchableText.includes(query)
    })
  }, [templates, debouncedSearch])

  const handleNavigateToDetail = (templateId: string) => {
    navigate(`/workspace/${workspaceId}/templates/${templateId}`)
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar />
      <main className="flex h-full flex-1 flex-col overflow-hidden">
        <header className="flex flex-shrink-0 items-center gap-3 border-b border-[var(--border)] px-6 py-4">
          <div className="flex items-center gap-2">
            <div className="flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border border-[#5BA8D9] bg-[#E8F4FB] dark:border-[#1A5070] dark:bg-[#153347]">
              <Layout className="h-[14px] w-[14px] text-[#5BA8D9] dark:text-[#33b4ff]" />
            </div>
            <h1 className="font-semibold text-lg text-[var(--text-primary)]">Templates</h1>
          </div>
          <div className="flex h-[32px] w-[320px] items-center gap-[6px] rounded-[8px] bg-[var(--surface-4)] px-[8px]">
            <Search className="h-[14px] w-[14px] flex-shrink-0 text-[var(--text-subtle)]" />
            <Input
              placeholder="Search templates..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0"
            />
          </div>
        </header>

        <div className="flex-1 overflow-auto p-6">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
                <TemplateCardSkeleton key={`skeleton-${index}`} />
              ))}
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="flex h-64 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-3)]">
              <div className="text-center">
                <Layout className="mx-auto mb-2 h-8 w-8 text-[var(--text-muted)]" />
                <p className="font-medium text-sm text-[var(--text-tertiary)]">
                  {debouncedSearch ? 'No templates found' : 'No templates available'}
                </p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  {debouncedSearch
                    ? 'Try a different search term'
                    : 'Templates will appear once they are published'}
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onClick={() => handleNavigateToDetail(template.id)}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
