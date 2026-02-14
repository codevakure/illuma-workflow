/**
 * Lightweight logger for the marketplace service.
 * Matches the @sim/logger interface used across the monorepo.
 */

import chalk from 'chalk'

type LogLevel = 'info' | 'warn' | 'error' | 'debug'

interface Logger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

function formatMeta(meta?: Record<string, unknown>): string {
  if (!meta || Object.keys(meta).length === 0) return ''
  return ' ' + JSON.stringify(meta)
}

export function createLogger(context: string): Logger {
  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const timestamp = new Date().toISOString()
    const metaStr = formatMeta(meta)

    switch (level) {
      case 'info':
        console.log(`${chalk.gray(timestamp)} ${chalk.blue('INFO')} [${context}] ${message}${metaStr}`)
        break
      case 'warn':
        console.log(`${chalk.gray(timestamp)} ${chalk.yellow('WARN')} [${context}] ${message}${metaStr}`)
        break
      case 'error':
        console.log(`${chalk.gray(timestamp)} ${chalk.red('ERROR')} [${context}] ${message}${metaStr}`)
        break
      case 'debug':
        if (process.env.DEBUG) {
          console.log(`${chalk.gray(timestamp)} ${chalk.magenta('DEBUG')} [${context}] ${message}${metaStr}`)
        }
        break
    }
  }

  return {
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    debug: (message, meta) => log('debug', message, meta),
  }
}
