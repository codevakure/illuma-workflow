import { existsSync } from 'fs'
import { readFile } from 'fs/promises'
import path from 'path'
import { Readable } from 'stream'
import { createLogger } from '@sim/logger'
import { type Options, parse } from 'csv-parse'

const logger = createLogger('FileParser')

/**
 * Result returned by file parsing functions.
 */
export interface FileParseResult {
  content: string
  metadata?: Record<string, unknown>
}

/**
 * Text-based file extensions that the parser natively understands.
 */
const SUPPORTED_TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'json',
  'csv',
  'xml',
  'html',
  'htm',
  'yaml',
  'yml',
  'toml',
  'ini',
  'log',
  'env',
  'cfg',
  'conf',
  'properties',
  'ts',
  'tsx',
  'js',
  'jsx',
  'py',
  'rb',
  'java',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'go',
  'rs',
  'sh',
  'bash',
  'zsh',
  'sql',
  'graphql',
  'gql',
  'css',
  'scss',
  'less',
  'sass',
  'svg',
  'vue',
  'svelte',
  'astro',
  'php',
  'r',
  'swift',
  'kt',
  'kts',
  'scala',
  'lua',
  'pl',
  'pm',
  'makefile',
  'dockerfile',
])

/**
 * Check whether a given file extension is supported for text parsing.
 *
 * @param extension - File extension without the leading dot (e.g. `"csv"`)
 */
export function isSupportedFileType(extension: string): boolean {
  return SUPPORTED_TEXT_EXTENSIONS.has(extension.toLowerCase())
}

/**
 * Parse CSV content from a buffer using `csv-parse`.
 */
async function parseCsvBuffer(buffer: Buffer): Promise<FileParseResult> {
  return new Promise((resolve, reject) => {
    const MAX_PREVIEW_ROWS = 1000
    let rowCount = 0
    let headers: string[] = []
    let processedContent = ''
    let firstRowProcessed = false
    let aborted = false

    const parserOptions: Options = {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      relax_quotes: true,
      skip_records_with_error: true,
      raw: false,
      cast: false,
    }
    const csvParser = parse(parserOptions)

    csvParser.on('readable', () => {
      let record
      while ((record = csvParser.read()) !== null && !aborted) {
        rowCount++

        if (!firstRowProcessed && record) {
          headers = Object.keys(record).map(String)
          processedContent = `${headers.join(', ')}\n`
          firstRowProcessed = true
        }

        if (rowCount <= MAX_PREVIEW_ROWS) {
          try {
            const cleanValues = Object.values(record).map((v: unknown) => String(v ?? ''))
            processedContent += `${cleanValues.join(', ')}\n`
          } catch {
            logger.warn(`Error processing CSV row ${rowCount}`)
          }
        }
      }
    })

    csvParser.on('error', (err: Error) => {
      logger.error('CSV parser error:', err)
      reject(new Error(`CSV parsing failed: ${err.message}`))
    })

    csvParser.on('end', () => {
      if (!aborted) {
        if (rowCount > MAX_PREVIEW_ROWS) {
          processedContent += `\n[... ${rowCount.toLocaleString()} total rows, showing first ${MAX_PREVIEW_ROWS} ...]\n`
        }

        logger.info(`CSV parsing complete: ${rowCount} rows`)

        resolve({
          content: processedContent,
          metadata: {
            rowCount,
            headers,
            truncated: rowCount > MAX_PREVIEW_ROWS,
          },
        })
      }
    })

    const stream = Readable.from(buffer)

    stream.on('error', (err) => {
      logger.error('CSV input stream error:', err)
      csvParser.destroy()
      reject(new Error(`Stream error: ${err.message}`))
    })

    stream.pipe(csvParser)
  })
}

/**
 * Parse a buffer based on its file type / extension.
 *
 * @param buffer   - The raw file bytes.
 * @param fileType - Extension without the dot (e.g. `"csv"`, `"json"`).
 */
export async function parseBuffer(buffer: Buffer, fileType: string): Promise<FileParseResult> {
  if (!buffer || buffer.length === 0) {
    throw new Error('Empty buffer provided')
  }

  const ext = fileType.toLowerCase()
  logger.info('Parsing buffer with extension:', ext)

  if (ext === 'csv') {
    return parseCsvBuffer(buffer)
  }

  if (ext === 'json') {
    try {
      const text = buffer.toString('utf-8')
      const parsed = JSON.parse(text)
      return {
        content: JSON.stringify(parsed, null, 2),
        metadata: { type: 'json' },
      }
    } catch {
      return { content: buffer.toString('utf-8'), metadata: { type: 'json', parseError: true } }
    }
  }

  // Default: treat as plain text
  return {
    content: buffer.toString('utf-8'),
    metadata: { type: ext },
  }
}

/**
 * Parse a file from disk based on its extension.
 *
 * @param filePath - Absolute path to the file.
 */
export async function parseFile(filePath: string): Promise<FileParseResult> {
  if (!filePath) {
    throw new Error('No file path provided')
  }

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`)
  }

  const extension = path.extname(filePath).toLowerCase().substring(1)
  logger.info('Parsing file with extension:', extension)

  const buffer = await readFile(filePath)

  if (extension === 'pdf') {
    const { PdfParser } = await import('@/lib/file-parsers/pdf-parser')
    const parser = new PdfParser()
    return parser.parseBuffer(buffer)
  }

  if (isSupportedFileType(extension)) {
    return parseBuffer(buffer, extension)
  }

  // Fallback: return raw text
  return {
    content: buffer.toString('utf-8'),
    metadata: { type: extension },
  }
}
