import { createLogger } from '@sim/logger'
import { z } from 'zod'
import { generateRequestId } from '@/lib/core/utils/request'
import type { ToolProxyHandler } from '@/routes/tool-proxy/handler-registry'

const logger = createLogger('GitHubHandler')

const LatestCommitSchema = z.object({
  accessToken: z.string().min(1, 'Access token is required'),
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repo is required'),
  branch: z.string().optional().default('main'),
})

/**
 * Fetch the latest commit for a GitHub repository.
 */
const handleLatestCommit: ToolProxyHandler = async (body) => {
  const requestId = generateRequestId()

  try {
    const validated = LatestCommitSchema.parse(body)

    const url = `https://api.github.com/repos/${validated.owner}/${validated.repo}/commits?sha=${validated.branch}&per_page=1`

    logger.info(`[${requestId}] Fetching latest GitHub commit`, {
      owner: validated.owner,
      repo: validated.repo,
      branch: validated.branch,
    })

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${validated.accessToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}))
      const errorMessage = (errorData as Record<string, string>).message || `GitHub API error: ${response.status}`
      throw new Error(errorMessage)
    }

    const commits = await response.json()
    const commit = Array.isArray(commits) ? commits[0] : commits

    if (!commit) {
      return {
        success: true,
        output: { message: 'No commits found', commit: null },
      }
    }

    logger.info(`[${requestId}] Latest commit fetched successfully`, {
      sha: commit.sha,
    })

    return {
      success: true,
      output: {
        sha: commit.sha,
        message: commit.commit?.message,
        author: commit.commit?.author,
        committer: commit.commit?.committer,
        html_url: commit.html_url,
        stats: commit.stats,
      },
    }
  } catch (error) {
    logger.error(`[${requestId}] Error fetching GitHub latest commit:`, error)
    return {
      success: false,
      output: {},
      error: error instanceof Error ? error.message : 'Failed to fetch latest commit',
    }
  }
}

export const githubHandlers: Record<string, ToolProxyHandler> = {
  'latest-commit': handleLatestCommit,
}
