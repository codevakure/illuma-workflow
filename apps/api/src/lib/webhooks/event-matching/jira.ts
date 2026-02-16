/**
 * Jira webhook event matching and data extraction utilities.
 * Used by the webhook processor to filter events and extract structured data.
 */

/**
 * Check if a Jira event matches the expected trigger configuration.
 */
export function isJiraEventMatch(
  triggerId: string,
  webhookEvent: string,
  issueEventTypeName?: string
): boolean {
  const eventMappings: Record<string, string[]> = {
    jira_issue_created: ['jira:issue_created', 'issue_created'],
    jira_issue_updated: ['jira:issue_updated', 'issue_updated', 'issue_generic'],
    jira_issue_deleted: ['jira:issue_deleted', 'issue_deleted'],
    jira_issue_commented: ['comment_created'],
    jira_worklog_created: ['worklog_created'],
    jira_worklog_updated: ['worklog_updated'],
    jira_worklog_deleted: ['worklog_deleted'],
    jira_webhook: ['*'],
  }

  const expectedEvents = eventMappings[triggerId]
  if (!expectedEvents) {
    return false
  }

  if (expectedEvents.includes('*')) {
    return true
  }

  return (
    expectedEvents.includes(webhookEvent) ||
    (issueEventTypeName !== undefined && expectedEvents.includes(issueEventTypeName))
  )
}

/**
 * Extract issue data from a Jira webhook payload.
 */
export function extractIssueData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    issue_event_type_name: body.issue_event_type_name,
    issue: body.issue || {},
    changelog: body.changelog,
  }
}

/**
 * Extract comment data from a Jira webhook payload.
 */
export function extractCommentData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    issue: body.issue || {},
    comment: body.comment || {},
  }
}

/**
 * Extract worklog data from a Jira webhook payload.
 */
export function extractWorklogData(body: any) {
  return {
    webhookEvent: body.webhookEvent,
    timestamp: body.timestamp,
    issue: body.issue || {},
    worklog: body.worklog || {},
  }
}
