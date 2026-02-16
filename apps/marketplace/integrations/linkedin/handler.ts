import type { ToolHandler } from '../../sdk/types'

function linkedinHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'X-Restli-Protocol-Version': '2.0.0',
  }
}

function extractProfileId(output: Record<string, unknown>): string | null {
  const profile = output.profile as Record<string, unknown> | undefined
  return (
    (profile?.id as string) ||
    (output.sub as string) ||
    (output.id as string) ||
    null
  )
}

const handler: ToolHandler = {
  operations: {
    linkedin_get_profile: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }

      const resp = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: linkedinHeaders(accessToken),
      })

      if (!resp.ok) {
        return {
          success: false,
          output: {},
          error: `Failed to get profile: ${resp.statusText}`,
        }
      }

      const profile = await resp.json()

      return {
        success: true,
        output: {
          profile: {
            id: profile.sub,
            name: profile.name,
            email: profile.email,
            picture: profile.picture,
          },
        },
      }
    },

    linkedin_share_post: async (params, ctx) => {
      const accessToken = (ctx.accessToken || params.accessToken) as string
      const text = params.text as string
      if (!accessToken) return { success: false, output: {}, error: 'Missing access token' }
      if (!text) return { success: false, output: {}, error: 'Missing required parameter: text' }

      const profileResp = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: linkedinHeaders(accessToken),
      })

      if (!profileResp.ok) {
        return {
          success: false,
          output: {},
          error: `Failed to fetch user profile: ${profileResp.statusText}`,
        }
      }

      const profileData = await profileResp.json()
      const authorId = extractProfileId(profileData)

      if (!authorId) {
        return {
          success: false,
          output: {},
          error: 'Could not extract LinkedIn profile ID from response',
        }
      }

      const authorUrn = `urn:li:person:${authorId}`

      const postData = {
        author: authorUrn,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text },
            shareMediaCategory: 'NONE',
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility':
            (params.visibility as string) || 'PUBLIC',
        },
      }

      const postResp = await fetch('https://api.linkedin.com/v2/ugcPosts', {
        method: 'POST',
        headers: {
          ...linkedinHeaders(accessToken),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(postData),
      })

      if (!postResp.ok) {
        const error = await postResp.text()
        return {
          success: false,
          output: {},
          error: `LinkedIn API error: ${error}`,
        }
      }

      const result = await postResp.json()

      return {
        success: true,
        output: { postId: result.id },
      }
    },
  },
}

export default handler
