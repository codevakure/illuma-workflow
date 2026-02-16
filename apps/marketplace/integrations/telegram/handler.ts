import type { ToolHandler } from '../../sdk/types'

/**
 * Converts basic markdown formatting to Telegram-compatible HTML.
 */
function convertMarkdownToHTML(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<i>$1</i>')
    .replace(/__(.+?)__/g, '<u>$1</u>')
    .replace(/~~(.+?)~~/g, '<s>$1</s>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
}

const handler: ToolHandler = {
  operations: {
    telegram_message: async (params) => {
      const botToken = params.botToken as string
      const chatId = params.chatId as string
      const text = params.text as string

      if (!botToken) {
        return { success: false, output: {}, error: 'Missing required parameter: botToken' }
      }
      if (!chatId) {
        return { success: false, output: {}, error: 'Missing required parameter: chatId' }
      }
      if (!text) {
        return { success: false, output: {}, error: 'Missing required parameter: text' }
      }

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: convertMarkdownToHTML(text),
            parse_mode: 'HTML',
          }),
        }
      )

      const data = await response.json()

      if (!data.ok) {
        return {
          success: false,
          output: {},
          error: data.description || data.error || 'Failed to send message',
        }
      }

      return {
        success: true,
        output: {
          message: 'Message sent successfully',
          data: data.result,
        },
      }
    },

    telegram_send_photo: async (params) => {
      const botToken = params.botToken as string
      const chatId = params.chatId as string
      const photo = params.photo as string

      if (!botToken) {
        return { success: false, output: {}, error: 'Missing required parameter: botToken' }
      }
      if (!chatId) {
        return { success: false, output: {}, error: 'Missing required parameter: chatId' }
      }
      if (!photo) {
        return { success: false, output: {}, error: 'Missing required parameter: photo' }
      }

      const body: Record<string, unknown> = {
        chat_id: chatId,
        photo,
      }

      if (params.caption) {
        body.caption = convertMarkdownToHTML(params.caption as string)
        body.parse_mode = 'HTML'
      }

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendPhoto`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      const data = await response.json()

      if (!data.ok) {
        return {
          success: false,
          output: {},
          error: data.description || data.error || 'Failed to send photo',
        }
      }

      return {
        success: true,
        output: {
          message: 'Photo sent successfully',
          data: data.result,
        },
      }
    },

    telegram_send_audio: async (params) => {
      const botToken = params.botToken as string
      const chatId = params.chatId as string
      const audio = params.audio as string

      if (!botToken) {
        return { success: false, output: {}, error: 'Missing required parameter: botToken' }
      }
      if (!chatId) {
        return { success: false, output: {}, error: 'Missing required parameter: chatId' }
      }
      if (!audio) {
        return { success: false, output: {}, error: 'Missing required parameter: audio' }
      }

      const body: Record<string, unknown> = {
        chat_id: chatId,
        audio,
      }

      if (params.caption) {
        body.caption = convertMarkdownToHTML(params.caption as string)
        body.parse_mode = 'HTML'
      }

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendAudio`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      const data = await response.json()

      if (!data.ok) {
        return {
          success: false,
          output: {},
          error: data.description || data.error || 'Failed to send audio',
        }
      }

      return {
        success: true,
        output: {
          message: 'Audio sent successfully',
          data: data.result,
        },
      }
    },

    telegram_send_video: async (params) => {
      const botToken = params.botToken as string
      const chatId = params.chatId as string
      const video = params.video as string

      if (!botToken) {
        return { success: false, output: {}, error: 'Missing required parameter: botToken' }
      }
      if (!chatId) {
        return { success: false, output: {}, error: 'Missing required parameter: chatId' }
      }
      if (!video) {
        return { success: false, output: {}, error: 'Missing required parameter: video' }
      }

      const body: Record<string, unknown> = {
        chat_id: chatId,
        video,
      }

      if (params.caption) {
        body.caption = convertMarkdownToHTML(params.caption as string)
        body.parse_mode = 'HTML'
      }

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendVideo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      const data = await response.json()

      if (!data.ok) {
        return {
          success: false,
          output: {},
          error: data.description || data.error || 'Failed to send video',
        }
      }

      return {
        success: true,
        output: {
          message: 'Video sent successfully',
          data: data.result,
        },
      }
    },

    telegram_send_animation: async (params) => {
      const botToken = params.botToken as string
      const chatId = params.chatId as string
      const animation = params.animation as string

      if (!botToken) {
        return { success: false, output: {}, error: 'Missing required parameter: botToken' }
      }
      if (!chatId) {
        return { success: false, output: {}, error: 'Missing required parameter: chatId' }
      }
      if (!animation) {
        return { success: false, output: {}, error: 'Missing required parameter: animation' }
      }

      const body: Record<string, unknown> = {
        chat_id: chatId,
        animation,
      }

      if (params.caption) {
        body.caption = convertMarkdownToHTML(params.caption as string)
        body.parse_mode = 'HTML'
      }

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendAnimation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      )

      const data = await response.json()

      if (!data.ok) {
        return {
          success: false,
          output: {},
          error: data.description || data.error || 'Failed to send animation',
        }
      }

      return {
        success: true,
        output: {
          message: 'Animation sent successfully',
          data: data.result,
        },
      }
    },

    telegram_send_document: async (params, ctx) => {
      const botToken = params.botToken as string
      const chatId = params.chatId as string

      if (!botToken) {
        return { success: false, output: {}, error: 'Missing required parameter: botToken' }
      }
      if (!chatId) {
        return { success: false, output: {}, error: 'Missing required parameter: chatId' }
      }

      const files = params.files as unknown[] | undefined
      if (!files || (Array.isArray(files) && files.length === 0)) {
        return { success: false, output: {}, error: 'Missing required parameter: files' }
      }

      const fileList = Array.isArray(files) ? files : [files]

      if (!ctx.downloadFile) {
        return { success: false, output: {}, error: 'File download not available in this context' }
      }

      const fileBuffer = await ctx.downloadFile(fileList[0])
      const fileObj = fileList[0] as Record<string, unknown>
      const fileName = (fileObj.name as string) || 'document'
      const mimeType = (fileObj.mimeType as string) || 'application/octet-stream'

      const formData = new FormData()
      formData.append('chat_id', chatId)
      formData.append('document', new Blob([fileBuffer], { type: mimeType }), fileName)
      if (params.caption) {
        formData.append('caption', convertMarkdownToHTML(params.caption as string))
        formData.append('parse_mode', 'HTML')
      }

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendDocument`,
        {
          method: 'POST',
          body: formData,
        }
      )

      const data = await response.json()

      if (!data.ok) {
        return {
          success: false,
          output: {},
          error: data.description || data.error || 'Failed to send document',
        }
      }

      return {
        success: true,
        output: {
          message: 'Document sent successfully',
          data: data.result,
        },
      }
    },

    telegram_delete_message: async (params) => {
      const botToken = params.botToken as string
      const chatId = params.chatId as string
      const messageId = params.messageId as string | number

      if (!botToken) {
        return { success: false, output: {}, error: 'Missing required parameter: botToken' }
      }
      if (!chatId) {
        return { success: false, output: {}, error: 'Missing required parameter: chatId' }
      }
      if (!messageId) {
        return { success: false, output: {}, error: 'Missing required parameter: messageId' }
      }

      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/deleteMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            message_id: messageId,
          }),
        }
      )

      const data = await response.json()

      if (!data.ok) {
        return {
          success: false,
          output: {},
          error: data.description || data.error || 'Failed to delete message',
        }
      }

      return {
        success: true,
        output: {
          message: 'Message deleted successfully',
          data: {
            ok: data.ok,
            deleted: data.result,
          },
        },
      }
    },
  },
}

export default handler
