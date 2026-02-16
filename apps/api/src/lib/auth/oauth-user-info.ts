interface OAuthUserInfo {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image?: string
  createdAt: Date
  updatedAt: Date
}

interface OAuth2Tokens {
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAt?: Date
  scopes?: string[]
}

interface ProviderConfig {
  userInfo: { type: string }
}

type GetUserInfoFn = (tokens: OAuth2Tokens) => Promise<OAuthUserInfo | null>

/**
 * Creates a unique ID by appending a random UUID to the provider-specific ID.
 */
function uniqueId(id: string): string {
  return `${id}-${crypto.randomUUID()}`
}

/**
 * Creates a base user info object with timestamps.
 */
function makeUserInfo(
  id: string,
  name: string,
  email: string,
  emailVerified: boolean,
  image?: string
): OAuthUserInfo {
  const now = new Date()
  return {
    id: uniqueId(id),
    name,
    email,
    emailVerified,
    ...(image ? { image } : {}),
    createdAt: now,
    updatedAt: now,
  }
}

function googleHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      return makeUserInfo(
        data.sub,
        data.name,
        data.email,
        Boolean(data.email_verified),
        data.picture
      )
    } catch (e) {
      console.error('Google getUserInfo failed:', e)
      return null
    }
  }
}

function microsoftHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      return makeUserInfo(
        data.id,
        data.displayName,
        data.mail || data.userPrincipalName,
        true
      )
    } catch (e) {
      console.error('Microsoft getUserInfo failed:', e)
      return null
    }
  }
}

function githubHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const headers = {
        Authorization: `Bearer ${tokens.accessToken}`,
        'User-Agent': 'sim-studio',
      }
      const res = await fetch('https://api.github.com/user', { headers })
      if (!res.ok) return null
      const data = await res.json()

      let email = data.email
      if (!email) {
        const emailRes = await fetch('https://api.github.com/user/emails', { headers })
        if (emailRes.ok) {
          const emails = await emailRes.json()
          const primary = emails.find((e: { primary: boolean }) => e.primary)
          email = primary?.email || emails[0]?.email
        }
      }

      return makeUserInfo(
        String(data.id),
        data.name || data.login,
        email,
        Boolean(email),
        data.avatar_url
      )
    } catch (e) {
      console.error('GitHub getUserInfo failed:', e)
      return null
    }
  }
}

function slackHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      const teamId = data.team_id
      const userId = data.user_id || data.bot_id
      return makeUserInfo(
        `${teamId}-${userId}`,
        data.team || 'Slack User',
        `${teamId}-${userId}@slack.bot`,
        false
      )
    } catch (e) {
      console.error('Slack getUserInfo failed:', e)
      return null
    }
  }
}

function atlassianHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.atlassian.com/me', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      const accountId = data.account_id
      return makeUserInfo(
        accountId,
        data.name || data.display_name,
        data.email || `${accountId}@atlassian.com`,
        true,
        data.picture
      )
    } catch (e) {
      console.error('Atlassian getUserInfo failed:', e)
      return null
    }
  }
}

function notionHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.notion.com/v1/users/me', {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Notion-Version': '2022-06-28',
        },
      })
      if (!res.ok) return null
      const data = await res.json()
      const id = data.bot?.owner?.user?.id || data.id
      const name = data.name || data.bot?.owner?.user?.name || 'Notion User'
      const email = data.person?.email || `${id}@notion.user`
      return makeUserInfo(id, name, email, Boolean(data.person?.email))
    } catch (e) {
      console.error('Notion getUserInfo failed:', e)
      return null
    }
  }
}

function redditHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://oauth.reddit.com/api/v1/me', {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'User-Agent': 'sim-studio/1.0',
        },
      })
      if (!res.ok) return null
      const data = await res.json()
      return makeUserInfo(
        data.id,
        data.name,
        `${data.name}@reddit.user`,
        false,
        data.icon_img
      )
    } catch (e) {
      console.error('Reddit getUserInfo failed:', e)
      return null
    }
  }
}

function wealthboxHandler(): GetUserInfoFn {
  return async () => {
    return makeUserInfo(
      'wealthbox-user',
      'Wealthbox User',
      'wealthbox-user@wealthbox.user',
      false
    )
  }
}

function hubspotHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch(
        `https://api.hubapi.com/oauth/v1/access-tokens/${tokens.accessToken}`
      )
      if (!res.ok) return null
      const text = await res.text()
      const data = JSON.parse(text)

      if (data.scopes && Array.isArray(data.scopes)) {
        tokens.scopes = data.scopes
      }

      return makeUserInfo(
        String(data.user_id || data.hub_id),
        data.user || 'HubSpot User',
        data.user || 'hubspot@hubspot.user',
        true
      )
    } catch (e) {
      console.error('HubSpot getUserInfo failed:', e)
      return null
    }
  }
}

function linearHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: '{ viewer { id email name avatarUrl } }',
        }),
      })
      if (!res.ok) return null
      const json = await res.json()
      const viewer = json.data?.viewer
      if (!viewer) return null
      return makeUserInfo(
        viewer.id,
        viewer.name,
        viewer.email,
        true,
        viewer.avatarUrl
      )
    } catch (e) {
      console.error('Linear getUserInfo failed:', e)
      return null
    }
  }
}

function dropboxHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      return makeUserInfo(
        data.account_id,
        data.name?.display_name || data.email,
        data.email,
        Boolean(data.email_verified),
        data.profile_photo_url
      )
    } catch (e) {
      console.error('Dropbox getUserInfo failed:', e)
      return null
    }
  }
}

function webflowHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.webflow.com/v2/token/introspect', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      const userId = data.user_id
      return makeUserInfo(
        userId,
        data.user_name || 'Webflow User',
        `webflow-${userId}@webflow.user`,
        false
      )
    } catch (e) {
      console.error('Webflow getUserInfo failed:', e)
      return null
    }
  }
}

function calcomHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.cal.com/v2/me', {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'cal-api-version': '2024-08-13',
        },
      })
      if (!res.ok) return null
      const json = await res.json()
      const data = json.data || json
      return makeUserInfo(
        String(data.id || json.id),
        data.name || 'Cal.com User',
        data.email,
        true
      )
    } catch (e) {
      console.error('Cal.com getUserInfo failed:', e)
      return null
    }
  }
}

function salesforceHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://login.salesforce.com/services/oauth2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      return makeUserInfo(
        data.user_id || data.sub,
        data.name,
        data.email,
        Boolean(data.email_verified),
        data.picture
      )
    } catch (e) {
      console.error('Salesforce getUserInfo failed:', e)
      return null
    }
  }
}

function xHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch(
        'https://api.x.com/2/users/me?user.fields=profile_image_url,username,name,verified',
        { headers: { Authorization: `Bearer ${tokens.accessToken}` } }
      )
      if (!res.ok) return null
      const json = await res.json()
      const data = json.data
      if (!data) return null
      return makeUserInfo(
        data.id,
        data.name,
        `${data.username}@x.com`,
        Boolean(data.verified),
        data.profile_image_url
      )
    } catch (e) {
      console.error('X getUserInfo failed:', e)
      return null
    }
  }
}

function pipedriveHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.pipedrive.com/v1/users/me', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const json = await res.json()
      const data = json.data
      if (!data) return null
      return makeUserInfo(
        String(data.id),
        data.name,
        data.email,
        Boolean(data.activated),
        data.icon_url
      )
    } catch (e) {
      console.error('Pipedrive getUserInfo failed:', e)
      return null
    }
  }
}

function airtableHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.airtable.com/v0/meta/whoami', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      const email = data.email || ''
      const name = email ? email.split('@')[0] : 'Airtable User'
      return makeUserInfo(data.id, name, email, Boolean(email))
    } catch (e) {
      console.error('Airtable getUserInfo failed:', e)
      return null
    }
  }
}

function linkedinHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      return makeUserInfo(
        data.sub,
        data.name,
        data.email,
        Boolean(data.email_verified),
        data.picture
      )
    } catch (e) {
      console.error('LinkedIn getUserInfo failed:', e)
      return null
    }
  }
}

function zoomHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.zoom.us/v2/users/me', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      const name = [data.first_name, data.last_name].filter(Boolean).join(' ')
      return makeUserInfo(
        data.id,
        name || 'Zoom User',
        data.email,
        data.verified === 1,
        data.pic_url
      )
    } catch (e) {
      console.error('Zoom getUserInfo failed:', e)
      return null
    }
  }
}

function spotifyHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://api.spotify.com/v1/me', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      const image = data.images?.[0]?.url
      return makeUserInfo(
        data.id,
        data.display_name || 'Spotify User',
        data.email,
        true,
        image
      )
    } catch (e) {
      console.error('Spotify getUserInfo failed:', e)
      return null
    }
  }
}

function asanaHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://app.asana.com/api/1.0/users/me', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const result = await res.json()
      const profile = result.data
      return makeUserInfo(
        profile.gid,
        profile.name || 'Asana User',
        profile.email || `${profile.gid}@asana.user`,
        Boolean(profile.email),
        profile.photo?.image_128x128
      )
    } catch (e) {
      console.error('Asana getUserInfo failed:', e)
      return null
    }
  }
}

function wordpressHandler(): GetUserInfoFn {
  return async (tokens) => {
    try {
      const res = await fetch('https://public-api.wordpress.com/rest/v1.1/me', {
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
      })
      if (!res.ok) return null
      const data = await res.json()
      return makeUserInfo(
        String(data.ID || data.id),
        data.display_name || data.username,
        data.email,
        Boolean(data.email_verified),
        data.avatar_URL
      )
    } catch (e) {
      console.error('WordPress getUserInfo failed:', e)
      return null
    }
  }
}

/**
 * Returns a custom getUserInfo handler for the given OAuth provider config,
 * or undefined if the provider uses standard OIDC userinfo.
 */
export function getUserInfoHandler(
  provider: ProviderConfig
): GetUserInfoFn | undefined {
  switch (provider.userInfo.type) {
    case 'google':
      return googleHandler()
    case 'microsoft':
      return microsoftHandler()
    case 'github':
      return githubHandler()
    case 'slack':
      return slackHandler()
    case 'atlassian':
      return atlassianHandler()
    case 'notion':
      return notionHandler()
    case 'reddit':
      return redditHandler()
    case 'wealthbox':
      return wealthboxHandler()
    case 'hubspot':
      return hubspotHandler()
    case 'linear':
      return linearHandler()
    case 'dropbox':
      return dropboxHandler()
    case 'webflow':
      return webflowHandler()
    case 'calcom':
      return calcomHandler()
    case 'salesforce':
      return salesforceHandler()
    case 'x':
      return xHandler()
    case 'pipedrive':
      return pipedriveHandler()
    case 'airtable':
      return airtableHandler()
    case 'linkedin':
      return linkedinHandler()
    case 'zoom':
      return zoomHandler()
    case 'spotify':
      return spotifyHandler()
    case 'asana':
      return asanaHandler()
    case 'wordpress':
      return wordpressHandler()
    default:
      return undefined
  }
}
