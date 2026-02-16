/**
 * GitHub webhook event matching utilities.
 * Used by the webhook processor to filter events based on trigger configuration.
 */

/**
 * Check if a GitHub event matches the expected trigger configuration.
 * Used for event filtering in the webhook processor.
 */
export function isGitHubEventMatch(
  triggerId: string,
  eventType: string,
  action?: string,
  payload?: any
): boolean {
  const eventMap: Record<
    string,
    { event: string; actions?: string[]; validator?: (payload: any) => boolean }
  > = {
    github_issue_opened: { event: 'issues', actions: ['opened'] },
    github_issue_closed: { event: 'issues', actions: ['closed'] },
    github_issue_comment: {
      event: 'issue_comment',
      validator: (p) => !p.issue?.pull_request,
    },
    github_pr_opened: { event: 'pull_request', actions: ['opened'] },
    github_pr_closed: {
      event: 'pull_request',
      actions: ['closed'],
      validator: (p) => p.pull_request?.merged === false,
    },
    github_pr_merged: {
      event: 'pull_request',
      actions: ['closed'],
      validator: (p) => p.pull_request?.merged === true,
    },
    github_pr_comment: {
      event: 'issue_comment',
      validator: (p) => !!p.issue?.pull_request,
    },
    github_pr_reviewed: { event: 'pull_request_review', actions: ['submitted'] },
    github_push: { event: 'push' },
    github_release_published: { event: 'release', actions: ['published'] },
  }

  const config = eventMap[triggerId]
  if (!config) {
    return true
  }

  if (config.event !== eventType) {
    return false
  }

  if (config.actions && action && !config.actions.includes(action)) {
    return false
  }

  if (config.validator && payload) {
    return config.validator(payload)
  }

  return true
}
