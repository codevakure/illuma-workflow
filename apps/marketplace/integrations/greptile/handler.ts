import type { ToolHandler } from '../../sdk/types'

function parseRepositories(repoString: string): Array<{ remote: string; branch: string; repository: string }> {
  return repoString
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((repo) => {
      const parts = repo.split(':')
      if (parts.length === 3) {
        return { remote: parts[0], branch: parts[1], repository: parts[2] }
      }
      return { remote: 'github', branch: 'main', repository: repo }
    })
}

const handler: ToolHandler = {
  operations: {
    greptile_query: async (params) => {
      const apiKey = params.apiKey as string
      const githubToken = params.githubToken as string
      const query = params.query as string
      const repositories = params.repositories as string

      if (!apiKey || !githubToken || !query || !repositories) {
        return { success: false, output: {}, error: 'Missing required parameters: apiKey, githubToken, query, repositories' }
      }

      const body: Record<string, unknown> = {
        messages: [{ role: 'user', content: query }],
        repositories: parseRepositories(repositories),
        stream: false,
      }

      if (params.sessionId) body.sessionId = params.sessionId
      if (params.genius != null) body.genius = params.genius

      const response = await fetch('https://api.greptile.com/v2/query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Github-Token': githubToken,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Greptile API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          message: data.message || '',
          sources: (data.sources || []).map((source: Record<string, unknown>) => ({
            repository: source.repository || '',
            remote: source.remote || '',
            branch: source.branch || '',
            filepath: source.filepath || '',
            linestart: source.linestart,
            lineend: source.lineend,
            summary: source.summary,
            distance: source.distance,
          })),
        },
      }
    },

    greptile_search: async (params) => {
      const apiKey = params.apiKey as string
      const githubToken = params.githubToken as string
      const query = params.query as string
      const repositories = params.repositories as string

      if (!apiKey || !githubToken || !query || !repositories) {
        return { success: false, output: {}, error: 'Missing required parameters: apiKey, githubToken, query, repositories' }
      }

      const body: Record<string, unknown> = {
        query,
        repositories: parseRepositories(repositories),
      }

      if (params.sessionId) body.sessionId = params.sessionId
      if (params.genius != null) body.genius = params.genius

      const response = await fetch('https://api.greptile.com/v2/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Github-Token': githubToken,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Greptile API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          sources: (data.sources || data || []).map((source: Record<string, unknown>) => ({
            repository: source.repository || '',
            remote: source.remote || '',
            branch: source.branch || '',
            filepath: source.filepath || '',
            linestart: source.linestart,
            lineend: source.lineend,
            summary: source.summary,
            distance: source.distance,
          })),
        },
      }
    },

    greptile_index_repo: async (params) => {
      const apiKey = params.apiKey as string
      const githubToken = params.githubToken as string
      const remote = params.remote as string
      const repository = params.repository as string
      const branch = params.branch as string

      if (!apiKey || !githubToken || !remote || !repository || !branch) {
        return { success: false, output: {}, error: 'Missing required parameters: apiKey, githubToken, remote, repository, branch' }
      }

      const body: Record<string, unknown> = { remote, repository, branch }
      if (params.reload != null) body.reload = params.reload
      if (params.notify != null) body.notify = params.notify

      const response = await fetch('https://api.greptile.com/v2/repositories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Github-Token': githubToken,
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Greptile API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()
      let repositoryId = ''
      if (data.statusEndpoint) {
        const match = data.statusEndpoint.match(/\/repositories\/(.+)$/)
        if (match) repositoryId = decodeURIComponent(match[1])
      }
      if (!repositoryId) {
        repositoryId = `${remote}:${branch}:${repository}`
      }

      return {
        success: true,
        output: {
          repositoryId,
          statusEndpoint: data.statusEndpoint || '',
          message: data.message || 'Repository submitted for indexing',
        },
      }
    },

    greptile_status: async (params) => {
      const apiKey = params.apiKey as string
      const githubToken = params.githubToken as string
      const remote = params.remote as string
      const repository = params.repository as string
      const branch = params.branch as string

      if (!apiKey || !githubToken || !remote || !repository || !branch) {
        return { success: false, output: {}, error: 'Missing required parameters: apiKey, githubToken, remote, repository, branch' }
      }

      const repositoryId = `${remote}:${branch}:${repository}`
      const response = await fetch(`https://api.greptile.com/v2/repositories/${encodeURIComponent(repositoryId)}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'X-Github-Token': githubToken,
        },
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Greptile API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          repository: data.repository || '',
          remote: data.remote || '',
          branch: data.branch || '',
          private: data.private || false,
          status: data.status || 'unknown',
          filesProcessed: data.filesProcessed,
          numFiles: data.numFiles,
          sampleQuestions: data.sampleQuestions || [],
          sha: data.sha,
        },
      }
    },
  },
}

export default handler
