import { createLogger } from '@sim/logger'

const logger = createLogger('PdfParser')

interface PdfParseResult {
  content: string
  metadata?: {
    pageCount?: number
  }
}

/**
 * Minimal PDF text extractor.
 *
 * Attempts to pull readable text out of a PDF buffer by scanning for
 * text-showing operators inside BT/ET blocks.  This is intentionally
 * lightweight and does not depend on any native PDF library.  When a
 * full-featured parser (e.g. `unpdf`) is available it should be
 * preferred instead.
 */
export class PdfParser {
  async parseBuffer(buffer: Buffer): Promise<PdfParseResult> {
    try {
      logger.info('Starting PDF buffer parse, size:', buffer.length)

      const raw = buffer.toString('latin1')

      // Count pages via /Type /Page entries (exclude /Type /Pages which is the parent)
      const pageMatches = raw.match(/\/Type\s*\/Page(?!s)/g)
      const pageCount = pageMatches ? pageMatches.length : 0

      const textChunks: string[] = []

      // Strategy 1: Extract text between BT (begin text) and ET (end text) operators
      const btEtRegex = /BT\s([\s\S]*?)ET/g
      let btMatch: RegExpExecArray | null
      while ((btMatch = btEtRegex.exec(raw)) !== null) {
        const block = btMatch[1]

        // Match text-showing operators: Tj, TJ, ', "
        // Tj: (text) Tj
        const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g)
        if (tjMatches) {
          for (const m of tjMatches) {
            const inner = m.match(/\(([^)]*)\)/)
            if (inner) {
              textChunks.push(this.decodePdfString(inner[1]))
            }
          }
        }

        // TJ: array of strings and positioning values  [(text) num (text) ...] TJ
        const tjArrayMatches = block.match(/\[([^\]]*)\]\s*TJ/g)
        if (tjArrayMatches) {
          for (const m of tjArrayMatches) {
            const innerArray = m.match(/\[([^\]]*)\]/)
            if (innerArray) {
              const parts = innerArray[1].match(/\(([^)]*)\)/g)
              if (parts) {
                const assembled = parts
                  .map((p) => {
                    const s = p.match(/\(([^)]*)\)/)
                    return s ? this.decodePdfString(s[1]) : ''
                  })
                  .join('')
                textChunks.push(assembled)
              }
            }
          }
        }

        // ' operator: (text) '
        const quoteMatches = block.match(/\(([^)]*)\)\s*'/g)
        if (quoteMatches) {
          for (const m of quoteMatches) {
            const inner = m.match(/\(([^)]*)\)/)
            if (inner) {
              textChunks.push(this.decodePdfString(inner[1]))
            }
          }
        }
      }

      // Strategy 2: If we got no text from BT/ET, try a broad stream-based extraction
      if (textChunks.length === 0) {
        const streamRegex = /stream\r?\n([\s\S]*?)endstream/g
        let streamMatch: RegExpExecArray | null
        while ((streamMatch = streamRegex.exec(raw)) !== null) {
          const streamData = streamMatch[1]
          // Only pick streams that look like they have text operators
          if (/\(.*?\)\s*Tj/s.test(streamData) || /\[.*?\]\s*TJ/s.test(streamData)) {
            const tjFallback = streamData.match(/\(([^)]*)\)\s*Tj/g)
            if (tjFallback) {
              for (const m of tjFallback) {
                const inner = m.match(/\(([^)]*)\)/)
                if (inner) {
                  textChunks.push(this.decodePdfString(inner[1]))
                }
              }
            }
          }
        }
      }

      let content = textChunks
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()

      // Remove null bytes and control chars
      content = content.replace(/\u0000/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')

      if (!content) {
        content = ''
        logger.warn('Could not extract text from PDF - document may contain only images or encoded fonts')
      }

      logger.info('PDF parsed, pages:', pageCount, 'text length:', content.length)

      return {
        content,
        metadata: {
          pageCount,
        },
      }
    } catch (error) {
      logger.error('Error parsing PDF buffer:', error)
      throw error
    }
  }

  /**
   * Decode basic PDF escape sequences inside parenthesised strings.
   */
  private decodePdfString(s: string): string {
    return s
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .replace(/\\(\d{1,3})/g, (_match, octal: string) =>
        String.fromCharCode(parseInt(octal, 8))
      )
  }
}
