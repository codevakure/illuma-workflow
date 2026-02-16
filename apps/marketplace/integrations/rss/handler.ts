import type { ToolHandler } from '../../sdk/types'

const handler: ToolHandler = {
  operations: {
    rss_execute: async (params) => {
      const feedUrl = params.feedUrl as string || params.url as string
      if (!feedUrl) {
        return { success: false, output: {}, error: 'Missing required parameter: feedUrl' }
      }

      const response = await fetch(feedUrl, {
        headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
      })

      if (!response.ok) {
        return { success: false, output: {}, error: `Failed to fetch RSS feed: ${response.status}` }
      }

      const xml = await response.text()

      const items = parseRssItems(xml)
      const feedTitle = extractXmlValue(xml, 'title') || ''
      const feedDescription = extractXmlValue(xml, 'description') || ''
      const feedLink = extractXmlValue(xml, 'link') || feedUrl

      return {
        success: true,
        output: {
          title: feedTitle,
          link: feedLink,
          pubDate: items[0]?.pubDate || '',
          item: items[0] || null,
          feed: {
            title: feedTitle,
            description: feedDescription,
            link: feedLink,
            items,
          },
        },
      }
    },
  },
}

function extractXmlValue(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)</${tagName}>`)
  const match = xml.match(regex)
  return match ? match[1].trim() : undefined
}

function parseRssItems(xml: string): Array<Record<string, string>> {
  const items: Array<Record<string, string>> = []

  // Try RSS 2.0 <item> elements
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1]
    items.push({
      title: extractXmlValue(itemXml, 'title') || '',
      link: extractXmlValue(itemXml, 'link') || '',
      description: extractXmlValue(itemXml, 'description') || '',
      pubDate: extractXmlValue(itemXml, 'pubDate') || '',
      guid: extractXmlValue(itemXml, 'guid') || '',
      author: extractXmlValue(itemXml, 'author') || extractXmlValue(itemXml, 'dc:creator') || '',
    })
  }

  // If no RSS items found, try Atom <entry> elements
  if (items.length === 0) {
    const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
    while ((match = entryRegex.exec(xml)) !== null) {
      const entryXml = match[1]
      const linkMatch = entryXml.match(/<link[^>]*href="([^"]*)"[^>]*>/)
      items.push({
        title: extractXmlValue(entryXml, 'title') || '',
        link: linkMatch ? linkMatch[1] : (extractXmlValue(entryXml, 'link') || ''),
        description: extractXmlValue(entryXml, 'summary') || extractXmlValue(entryXml, 'content') || '',
        pubDate: extractXmlValue(entryXml, 'published') || extractXmlValue(entryXml, 'updated') || '',
        guid: extractXmlValue(entryXml, 'id') || '',
        author: extractXmlValue(entryXml, 'name') || '',
      })
    }
  }

  return items
}

export default handler
