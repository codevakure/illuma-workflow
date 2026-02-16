import type { ToolHandler } from '../../sdk/types'

const REDDIT_USER_AGENT = 'sim-studio/1.0 (https://github.com/simstudioai/sim)'

function normalizeSubreddit(subreddit: string): string {
  return subreddit.trim().replace(/^r\//, '')
}

function redditHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': REDDIT_USER_AGENT,
    Accept: 'application/json',
  }
}

function redditFormHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'User-Agent': REDDIT_USER_AGENT,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

function transformPosts(data: Record<string, unknown>, fallbackSubreddit: string) {
  const listing = data.data as Record<string, unknown> | undefined
  const children = (listing?.children || []) as Array<Record<string, unknown>>

  const subredditName =
    (children[0] as Record<string, unknown>)?.data
      ? ((children[0] as Record<string, unknown>).data as Record<string, unknown>)?.subreddit as string
      : fallbackSubreddit

  const posts = children.map((child) => {
    const post = (child.data || {}) as Record<string, unknown>
    return {
      id: post.id || '',
      title: post.title || '',
      author: post.author || '[deleted]',
      url: post.url || '',
      permalink: post.permalink ? `https://www.reddit.com${post.permalink}` : '',
      created_utc: post.created_utc || 0,
      score: post.score || 0,
      num_comments: post.num_comments || 0,
      is_self: !!post.is_self,
      selftext: post.selftext || '',
      thumbnail: post.thumbnail || '',
      subreddit: (post.subreddit as string) || subredditName,
    }
  })

  return { subreddit: subredditName || fallbackSubreddit, posts }
}

const handler: ToolHandler = {
  operations: {
    reddit_get_posts: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const subreddit = params.subreddit as string
      if (!subreddit) {
        return { success: false, output: {}, error: 'Missing required parameter: subreddit' }
      }

      const normalized = normalizeSubreddit(subreddit)
      const sort = (params.sort as string) || 'hot'
      const limit = Math.min(Math.max(1, Number(params.limit) || 10), 100)

      const urlParams = new URLSearchParams({ limit: String(limit), raw_json: '1' })
      if (sort === 'top' && params.time) urlParams.append('t', params.time as string)

      const response = await fetch(
        `https://oauth.reddit.com/r/${normalized}/${sort}?${urlParams.toString()}`,
        { headers: redditHeaders(accessToken) }
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Reddit API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()
      return { success: true, output: transformPosts(data, subreddit) }
    },

    reddit_get_comments: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const postId = params.postId as string
      const subreddit = params.subreddit as string
      if (!postId || !subreddit) {
        return { success: false, output: {}, error: 'Missing required parameters: postId, subreddit' }
      }

      const normalized = normalizeSubreddit(subreddit)
      const sort = (params.commentSort as string) || (params.sort as string) || 'confidence'
      const limit = Math.min(Math.max(1, Number(params.commentLimit || params.limit) || 50), 100)

      const urlParams = new URLSearchParams({ sort, limit: String(limit), raw_json: '1' })
      if (params.depth !== undefined) urlParams.append('depth', String(params.depth))

      const response = await fetch(
        `https://oauth.reddit.com/r/${normalized}/comments/${postId}?${urlParams.toString()}`,
        { headers: redditHeaders(accessToken) }
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Reddit API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      const postData = (data[0]?.data?.children?.[0]?.data || {}) as Record<string, unknown>
      const commentsData = (data[1]?.data?.children || []) as Array<Record<string, unknown>>

      const processComments = (comments: Array<Record<string, unknown>>): Array<Record<string, unknown>> => {
        return comments
          .map((comment) => {
            const cd = comment.data as Record<string, unknown>
            if (!cd || comment.kind !== 't1') return null

            const replies = cd.replies
              ? processComments(
                  ((cd.replies as Record<string, unknown>).data as Record<string, unknown>)
                    ?.children as Array<Record<string, unknown>> || []
                )
              : []

            return {
              id: cd.id || '',
              author: cd.author || '[deleted]',
              body: cd.body || '',
              created_utc: cd.created_utc || 0,
              score: cd.score || 0,
              permalink: cd.permalink ? `https://www.reddit.com${cd.permalink}` : '',
              replies: replies.filter(Boolean),
            }
          })
          .filter(Boolean) as Array<Record<string, unknown>>
      }

      return {
        success: true,
        output: {
          post: {
            id: postData.id || '',
            title: postData.title || '',
            author: postData.author || '[deleted]',
            selftext: postData.selftext || '',
            created_utc: postData.created_utc || 0,
            score: postData.score || 0,
            permalink: postData.permalink ? `https://www.reddit.com${postData.permalink}` : '',
          },
          comments: processComments(commentsData),
        },
      }
    },

    reddit_get_controversial: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const subreddit = params.subreddit as string
      if (!subreddit) {
        return { success: false, output: {}, error: 'Missing required parameter: subreddit' }
      }

      const normalized = normalizeSubreddit(subreddit)
      const limit = Math.min(Math.max(1, Number(params.controversialLimit || params.limit) || 10), 100)

      const urlParams = new URLSearchParams({ limit: String(limit), raw_json: '1' })
      if (params.controversialTime || params.time) {
        urlParams.append('t', (params.controversialTime || params.time) as string)
      }

      const response = await fetch(
        `https://oauth.reddit.com/r/${normalized}/controversial?${urlParams.toString()}`,
        { headers: redditHeaders(accessToken) }
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Reddit API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()
      return { success: true, output: transformPosts(data, subreddit) }
    },

    reddit_search: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const subreddit = params.subreddit as string
      const query = (params.searchQuery || params.query) as string
      if (!subreddit || !query) {
        return { success: false, output: {}, error: 'Missing required parameters: subreddit, searchQuery' }
      }

      const normalized = normalizeSubreddit(subreddit)
      const sort = (params.searchSort || params.sort) as string || 'relevance'
      const limit = Math.min(Math.max(1, Number(params.searchLimit || params.limit) || 10), 100)

      const urlParams = new URLSearchParams({
        q: query,
        sort,
        limit: String(limit),
        restrict_sr: 'true',
        raw_json: '1',
      })

      if (params.searchTime || params.time) {
        urlParams.append('t', (params.searchTime || params.time) as string)
      }

      const response = await fetch(
        `https://oauth.reddit.com/r/${normalized}/search?${urlParams.toString()}`,
        { headers: redditHeaders(accessToken) }
      )

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Reddit API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()
      return { success: true, output: transformPosts(data, subreddit) }
    },

    reddit_submit_post: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const subreddit = params.submitSubreddit || params.subreddit
      const title = params.title as string
      if (!subreddit || !title) {
        return { success: false, output: {}, error: 'Missing required parameters: subreddit, title' }
      }

      const normalized = normalizeSubreddit(subreddit as string)
      const formData = new URLSearchParams({ sr: normalized, title, api_type: 'json' })

      const postType = params.postType as string
      if (postType === 'link' && params.url) {
        formData.append('kind', 'link')
        formData.append('url', params.url as string)
      } else {
        formData.append('kind', 'self')
        formData.append('text', (params.text as string) || '')
      }

      if (params.nsfw !== undefined) formData.append('nsfw', String(params.nsfw))
      if (params.spoiler !== undefined) formData.append('spoiler', String(params.spoiler))

      const response = await fetch('https://oauth.reddit.com/api/submit', {
        method: 'POST',
        headers: redditFormHeaders(accessToken),
        body: formData.toString(),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Reddit API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      if (data.json?.errors && data.json.errors.length > 0) {
        const errors = data.json.errors.map((err: string[]) => err.join(': ')).join(', ')
        return { success: false, output: { success: false, message: `Failed to submit post: ${errors}` } }
      }

      const postData = data.json?.data
      return {
        success: true,
        output: {
          success: true,
          message: 'Post submitted successfully',
          data: {
            id: postData?.id,
            name: postData?.name,
            url: postData?.url,
            permalink: `https://www.reddit.com${postData?.url}`,
          },
        },
      }
    },

    reddit_vote: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const id = (params.voteId || params.id) as string
      const dir = Number(params.voteDirection ?? params.dir)
      if (!id) {
        return { success: false, output: {}, error: 'Missing required parameter: id (voteId)' }
      }

      if (![1, 0, -1].includes(dir)) {
        return { success: false, output: {}, error: 'dir must be 1 (upvote), 0 (unvote), or -1 (downvote)' }
      }

      const formData = new URLSearchParams({ id, dir: String(dir) })
      const response = await fetch('https://oauth.reddit.com/api/vote', {
        method: 'POST',
        headers: redditFormHeaders(accessToken),
        body: formData.toString(),
      })

      if (!response.ok) {
        return { success: false, output: { success: false, message: 'Failed to vote' } }
      }

      await response.json()
      const action = dir === 1 ? 'upvoted' : dir === -1 ? 'downvoted' : 'unvoted'
      return { success: true, output: { success: true, message: `Successfully ${action} ${id}` } }
    },

    reddit_save: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const id = (params.saveId || params.id) as string
      if (!id) {
        return { success: false, output: {}, error: 'Missing required parameter: id (saveId)' }
      }

      const formData = new URLSearchParams({ id })
      if (params.saveCategory || params.category) {
        formData.append('category', (params.saveCategory || params.category) as string)
      }

      const response = await fetch('https://oauth.reddit.com/api/save', {
        method: 'POST',
        headers: redditFormHeaders(accessToken),
        body: formData.toString(),
      })

      if (!response.ok) {
        return { success: false, output: { success: false, message: 'Failed to save item' } }
      }

      await response.json()
      return { success: true, output: { success: true, message: `Successfully saved ${id}` } }
    },

    reddit_unsave: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const id = (params.saveId || params.id) as string
      if (!id) {
        return { success: false, output: {}, error: 'Missing required parameter: id' }
      }

      const formData = new URLSearchParams({ id })
      const response = await fetch('https://oauth.reddit.com/api/unsave', {
        method: 'POST',
        headers: redditFormHeaders(accessToken),
        body: formData.toString(),
      })

      if (!response.ok) {
        return { success: false, output: { success: false, message: 'Failed to unsave item' } }
      }

      await response.json()
      return { success: true, output: { success: true, message: `Successfully unsaved ${id}` } }
    },

    reddit_reply: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const parentId = (params.replyParentId || params.parent_id) as string
      const text = (params.replyText || params.text) as string
      if (!parentId || !text) {
        return { success: false, output: {}, error: 'Missing required parameters: parentId, text' }
      }

      const formData = new URLSearchParams({ thing_id: parentId, text, api_type: 'json' })
      const response = await fetch('https://oauth.reddit.com/api/comment', {
        method: 'POST',
        headers: redditFormHeaders(accessToken),
        body: formData.toString(),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Reddit API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      if (data.json?.errors && data.json.errors.length > 0) {
        const errors = data.json.errors.map((err: string[]) => err.join(': ')).join(', ')
        return { success: false, output: { success: false, message: `Failed to post reply: ${errors}` } }
      }

      const commentData = data.json?.data?.things?.[0]?.data
      return {
        success: true,
        output: {
          success: true,
          message: 'Reply posted successfully',
          data: {
            id: commentData?.id,
            name: commentData?.name,
            permalink: commentData?.permalink ? `https://www.reddit.com${commentData.permalink}` : undefined,
            body: commentData?.body,
          },
        },
      }
    },

    reddit_edit: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const thingId = (params.editThingId || params.thing_id) as string
      const text = (params.editText || params.text) as string
      if (!thingId || !text) {
        return { success: false, output: {}, error: 'Missing required parameters: thingId, text' }
      }

      const formData = new URLSearchParams({ thing_id: thingId, text, api_type: 'json' })
      const response = await fetch('https://oauth.reddit.com/api/editusertext', {
        method: 'POST',
        headers: redditFormHeaders(accessToken),
        body: formData.toString(),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        return { success: false, output: {}, error: `Reddit API error: ${response.status} ${errorText}` }
      }

      const data = await response.json()

      if (data.json?.errors && data.json.errors.length > 0) {
        const errors = data.json.errors.map((err: string[]) => err.join(': ')).join(', ')
        return { success: false, output: { success: false, message: `Failed to edit: ${errors}` } }
      }

      const thingData = data.json?.data?.things?.[0]?.data
      return {
        success: true,
        output: {
          success: true,
          message: `Successfully edited ${thingId}`,
          data: {
            id: thingData?.id,
            body: thingData?.body,
            selftext: thingData?.selftext,
          },
        },
      }
    },

    reddit_delete: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const id = (params.deleteId || params.id) as string
      if (!id) {
        return { success: false, output: {}, error: 'Missing required parameter: id (deleteId)' }
      }

      const formData = new URLSearchParams({ id })
      const response = await fetch('https://oauth.reddit.com/api/del', {
        method: 'POST',
        headers: redditFormHeaders(accessToken),
        body: formData.toString(),
      })

      if (!response.ok) {
        return { success: false, output: { success: false, message: 'Failed to delete item' } }
      }

      await response.json()
      return { success: true, output: { success: true, message: `Successfully deleted ${id}` } }
    },

    reddit_subscribe: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) {
        return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      }

      const subreddit = (params.subscribeSubreddit || params.subreddit) as string
      const action = (params.subscribeAction || params.action) as string
      if (!subreddit || !action) {
        return { success: false, output: {}, error: 'Missing required parameters: subreddit, action' }
      }

      if (!['sub', 'unsub'].includes(action)) {
        return { success: false, output: {}, error: 'action must be "sub" or "unsub"' }
      }

      const normalized = normalizeSubreddit(subreddit)
      const formData = new URLSearchParams({ action, sr_name: normalized })

      const response = await fetch('https://oauth.reddit.com/api/subscribe', {
        method: 'POST',
        headers: redditFormHeaders(accessToken),
        body: formData.toString(),
      })

      if (!response.ok) {
        return { success: false, output: { success: false, message: 'Failed to update subscription' } }
      }

      await response.json()
      const actionText = action === 'sub'
        ? `subscribed to r/${subreddit}`
        : `unsubscribed from r/${subreddit}`

      return { success: true, output: { success: true, message: `Successfully ${actionText}` } }
    },
  },
}

export default handler
