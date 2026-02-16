import type { ToolHandler } from '../../sdk/types'

const TWITTER_API_BASE = 'https://api.twitter.com/2'

interface TransformedTweet {
  id: string
  text: string
  createdAt: string
  authorId: string
  conversationId?: string
  inReplyToUserId?: string
  attachments?: {
    mediaKeys?: string[]
    pollId?: string
  }
  contextAnnotations?: unknown[]
  publicMetrics?: {
    retweetCount: number
    replyCount: number
    likeCount: number
    quoteCount: number
  }
}

interface TransformedUser {
  id: string
  username: string
  name: string
  description?: string
  profileImageUrl?: string
  verified: boolean
  metrics: {
    followersCount: number
    followingCount: number
    tweetCount: number
  }
}

function transformTweet(tweet: Record<string, unknown>): TransformedTweet {
  const attachments = tweet.attachments as Record<string, unknown> | undefined
  const publicMetrics = tweet.public_metrics as Record<string, number> | undefined
  return {
    id: tweet.id as string,
    text: tweet.text as string,
    createdAt: tweet.created_at as string,
    authorId: tweet.author_id as string,
    conversationId: tweet.conversation_id as string | undefined,
    inReplyToUserId: tweet.in_reply_to_user_id as string | undefined,
    attachments: {
      mediaKeys: attachments?.media_keys as string[] | undefined,
      pollId: (attachments?.poll_ids as string[] | undefined)?.[0],
    },
    contextAnnotations: tweet.context_annotations as unknown[] | undefined,
    publicMetrics: publicMetrics
      ? {
          retweetCount: publicMetrics.retweet_count,
          replyCount: publicMetrics.reply_count,
          likeCount: publicMetrics.like_count,
          quoteCount: publicMetrics.quote_count,
        }
      : undefined,
  }
}

function transformUser(user: Record<string, unknown>): TransformedUser {
  const metrics = user.public_metrics as Record<string, number> | undefined
  return {
    id: user.id as string,
    username: user.username as string,
    name: (user.name as string) || '',
    description: (user.description as string) || '',
    profileImageUrl: (user.profile_image_url as string) || '',
    verified: !!(user.verified as boolean),
    metrics: {
      followersCount: metrics?.followers_count || 0,
      followingCount: metrics?.following_count || 0,
      tweetCount: metrics?.tweet_count || 0,
    },
  }
}

const handler: ToolHandler = {
  operations: {
    x_write: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.text) return { success: false, output: {}, error: 'Missing required parameter: text' }

      const body: Record<string, unknown> = { text: params.text }
      if (params.replyTo) {
        body.reply = { in_reply_to_tweet_id: params.replyTo }
      }
      if (params.mediaIds && (params.mediaIds as string[]).length > 0) {
        body.media = { media_ids: params.mediaIds }
      }
      if (params.poll) {
        const poll = params.poll as Record<string, unknown>
        body.poll = {
          options: poll.options,
          duration_minutes: poll.durationMinutes,
        }
      }

      const response = await fetch(`${TWITTER_API_BASE}/tweets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`X API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()

      return {
        success: true,
        output: {
          tweet: transformTweet(data.data),
        },
      }
    },

    x_read: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.tweetId) return { success: false, output: {}, error: 'Missing required parameter: tweetId' }

      const expansions = [
        'author_id', 'in_reply_to_user_id', 'referenced_tweets.id',
        'referenced_tweets.id.author_id', 'attachments.media_keys', 'attachments.poll_ids',
      ].join(',')
      const tweetFields = [
        'created_at', 'conversation_id', 'in_reply_to_user_id',
        'attachments', 'context_annotations', 'public_metrics',
      ].join(',')
      const userFields = [
        'name', 'username', 'description', 'profile_image_url', 'verified', 'public_metrics',
      ].join(',')

      const qp = new URLSearchParams({
        expansions,
        'tweet.fields': tweetFields,
        'user.fields': userFields,
      })

      const response = await fetch(
        `${TWITTER_API_BASE}/tweets/${params.tweetId}?${qp.toString()}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`X API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()

      if (data.errors && !data.data) {
        return {
          success: false,
          output: {},
          error: data.errors?.[0]?.detail || data.errors?.[0]?.message || 'Failed to fetch tweet',
        }
      }

      const mainTweet = transformTweet(data.data)
      const context: Record<string, unknown> = {}

      if (data.includes?.tweets) {
        const referencedTweets = data.data.referenced_tweets || []
        const parentRef = referencedTweets.find((ref: Record<string, string>) => ref.type === 'replied_to')
        const quotedRef = referencedTweets.find((ref: Record<string, string>) => ref.type === 'quoted')

        if (parentRef) {
          const parentTweet = data.includes.tweets.find((t: Record<string, string>) => t.id === parentRef.id)
          if (parentTweet) context.parentTweet = transformTweet(parentTweet)
        }
        if (!parentRef && quotedRef) {
          const quotedTweet = data.includes.tweets.find((t: Record<string, string>) => t.id === quotedRef.id)
          if (quotedTweet) context.rootTweet = transformTweet(quotedTweet)
        }
      }

      let replies: TransformedTweet[] = []
      if (params.includeReplies && mainTweet.id) {
        try {
          const conversationId = mainTweet.conversationId || mainTweet.id
          const searchParams = new URLSearchParams({
            query: `conversation_id:${conversationId}`,
            expansions: 'author_id,referenced_tweets.id',
            'tweet.fields': 'created_at,conversation_id,in_reply_to_user_id,public_metrics',
            max_results: '100',
          })

          const repliesResponse = await fetch(
            `${TWITTER_API_BASE}/tweets/search/recent?${searchParams.toString()}`,
            {
              method: 'GET',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          )

          if (repliesResponse.ok) {
            const repliesData = await repliesResponse.json()
            if (repliesData.data && Array.isArray(repliesData.data)) {
              replies = repliesData.data
                .filter((tweet: Record<string, string>) => tweet.id !== mainTweet.id)
                .map(transformTweet)
            }
          }
        } catch {
          // Silently handle reply fetch failures
        }
      }

      const output: Record<string, unknown> = { tweet: mainTweet }
      if (replies.length > 0) output.replies = replies
      if (Object.keys(context).length > 0) output.context = context

      return { success: true, output }
    },

    x_search: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.query) return { success: false, output: {}, error: 'Missing required parameter: query' }

      const expansions = [
        'author_id', 'referenced_tweets.id', 'attachments.media_keys', 'attachments.poll_ids',
      ].join(',')

      const qp = new URLSearchParams({
        query: params.query as string,
        expansions,
        'tweet.fields': 'created_at,conversation_id,in_reply_to_user_id,attachments,context_annotations,public_metrics',
        'user.fields': 'name,username,description,profile_image_url,verified,public_metrics',
      })

      const maxResults = params.maxResults as number | undefined
      if (maxResults && maxResults < 10) {
        qp.append('max_results', '10')
      } else if (maxResults) {
        qp.append('max_results', String(maxResults))
      }
      if (params.startTime) qp.append('start_time', params.startTime as string)
      if (params.endTime) qp.append('end_time', params.endTime as string)
      if (params.sortOrder) qp.append('sort_order', params.sortOrder as string)

      const response = await fetch(
        `${TWITTER_API_BASE}/tweets/search/recent?${qp.toString()}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`X API error: ${response.status} - ${errorText}`)
      }

      const data = await response.json()

      if (!data.data || !Array.isArray(data.data)) {
        return {
          success: false,
          output: {
            tweets: [],
            includes: { users: [], media: [], polls: [] },
            meta: { resultCount: 0, newestId: null, oldestId: null, nextToken: null },
          },
          error: data.error?.detail || data.error?.title || 'No results found',
        }
      }

      return {
        success: true,
        output: {
          tweets: data.data.map(transformTweet),
          includes: {
            users: (data.includes?.users || []).map(transformUser),
            media: data.includes?.media || [],
            polls: data.includes?.polls || [],
          },
          meta: {
            resultCount: data.meta.result_count,
            newestId: data.meta.newest_id,
            oldestId: data.meta.oldest_id,
            nextToken: data.meta.next_token,
          },
        },
      }
    },

    x_user: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing required parameter: accessToken' }
      if (!params.username) return { success: false, output: {}, error: 'Missing required parameter: username' }

      const username = encodeURIComponent(params.username as string)
      const userFields = 'description,profile_image_url,verified,public_metrics'

      const response = await fetch(
        `${TWITTER_API_BASE}/users/by/username/${username}?user.fields=${userFields}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      )

      if (response.status === 429) {
        const resetTime = response.headers.get('x-rate-limit-reset')
        const message = resetTime
          ? `Rate limit exceeded. Please try again after ${new Date(parseInt(resetTime) * 1000).toLocaleTimeString()}.`
          : 'X API rate limit exceeded. Please try again later.'
        throw new Error(message)
      }

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`X API error: ${response.status} - ${errorText}`)
      }

      const responseData = await response.json()

      if (!responseData.data) {
        if (responseData.errors && responseData.errors.length > 0) {
          const error = responseData.errors[0]
          const cleanedMessage = error.detail ? error.detail.replace(/\[(.*?)\]/, '$1') : ''
          throw new Error(`X API error: ${cleanedMessage || error.message || JSON.stringify(error)}`)
        }
        throw new Error('Invalid response format from X API')
      }

      return {
        success: true,
        output: {
          user: transformUser(responseData.data),
        },
      }
    },
  },
}

export default handler
