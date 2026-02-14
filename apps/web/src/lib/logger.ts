/**
 * @sim/logger (browser build)
 *
 * Browser-safe logging utilities for the Illuma platform.
 * Provides standardized console logging with environment-aware configuration.
 * Note: This is the browser version — no chalk dependency.
 */

/**
 * LogLevel enum defines the severity levels for logging
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Logger configuration options
 */
export interface LoggerConfig {
  /** Minimum log level to display */
  logLevel?: LogLevel | string
  /** Whether to colorize output */
  colorize?: boolean
  /** Whether logging is enabled */
  enabled?: boolean
}

const getNodeEnv = (): string => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.NODE_ENV || 'development'
  }
  return 'development'
}

const getLogLevel = (): string | undefined => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env.LOG_LEVEL
  }
  return undefined
}

/**
 * Get the minimum log level from environment variable or use defaults
 * - Development: DEBUG (show all logs)
 * - Production: ERROR (only show errors, but can be overridden by LOG_LEVEL env var)
 * - Test: ERROR (only show errors in tests)
 */
const getMinLogLevel = (): LogLevel => {
  const logLevelEnv = getLogLevel()
  if (logLevelEnv && Object.values(LogLevel).includes(logLevelEnv as LogLevel)) {
    return logLevelEnv as LogLevel
  }

  const nodeEnv = getNodeEnv()
  switch (nodeEnv) {
    case 'development':
      return LogLevel.DEBUG
    case 'production':
      return LogLevel.ERROR
    case 'test':
      return LogLevel.ERROR
    default:
      return LogLevel.DEBUG
  }
}

/**
 * Configuration for different environments
 */
const getLogConfig = () => {
  const nodeEnv = getNodeEnv()
  const minLevel = getMinLogLevel()

  switch (nodeEnv) {
    case 'development':
      return {
        enabled: true,
        minLevel,
        colorize: true,
      }
    case 'production':
      return {
        enabled: true,
        minLevel,
        colorize: false,
      }
    case 'test':
      return {
        enabled: false,
        minLevel,
        colorize: false,
      }
    default:
      return {
        enabled: true,
        minLevel,
        colorize: true,
      }
  }
}

/**
 * Format objects for logging
 */
const formatObject = (obj: unknown, isDev: boolean): string => {
  try {
    if (obj instanceof Error) {
      const errorObj: Record<string, unknown> = {
        message: obj.message,
        stack: isDev ? obj.stack : undefined,
        name: obj.name,
      }
      for (const key of Object.keys(obj)) {
        if (!(key in errorObj)) {
          errorObj[key] = (obj as unknown as Record<string, unknown>)[key]
        }
      }
      return JSON.stringify(errorObj, null, isDev ? 2 : 0)
    }
    return JSON.stringify(obj, null, isDev ? 2 : 0)
  } catch {
    return '[Circular or Non-Serializable Object]'
  }
}

/** Browser CSS colors for console log styling */
const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'color: #5b9bd5',
  [LogLevel.INFO]: 'color: #6ab04c',
  [LogLevel.WARN]: 'color: #f0932b',
  [LogLevel.ERROR]: 'color: #eb4d4b',
}
const MODULE_COLOR = 'color: #22a6b3'
const TIMESTAMP_COLOR = 'color: #999'

/**
 * Logger class for standardized console logging
 */
export class Logger {
  private module: string
  private config: ReturnType<typeof getLogConfig>
  private isDev: boolean

  constructor(module: string, overrideConfig?: LoggerConfig) {
    this.module = module
    this.config = getLogConfig()
    this.isDev = getNodeEnv() === 'development'

    if (overrideConfig) {
      if (overrideConfig.logLevel !== undefined) {
        const level =
          typeof overrideConfig.logLevel === 'string'
            ? (overrideConfig.logLevel as LogLevel)
            : overrideConfig.logLevel
        if (Object.values(LogLevel).includes(level)) {
          this.config.minLevel = level
        }
      }
      if (overrideConfig.colorize !== undefined) {
        this.config.colorize = overrideConfig.colorize
      }
      if (overrideConfig.enabled !== undefined) {
        this.config.enabled = overrideConfig.enabled
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.config.enabled) return false

    if (getNodeEnv() === 'production' && typeof window !== 'undefined') {
      return false
    }

    const levels = [LogLevel.DEBUG, LogLevel.INFO, LogLevel.WARN, LogLevel.ERROR]
    const minLevelIndex = levels.indexOf(this.config.minLevel)
    const currentLevelIndex = levels.indexOf(level)

    return currentLevelIndex >= minLevelIndex
  }

  private formatArgs(args: unknown[]): unknown[] {
    return args.map((arg) => {
      if (arg === null || arg === undefined) return arg
      if (typeof arg === 'object') return formatObject(arg, this.isDev)
      return arg
    })
  }

  private log(level: LogLevel, message: string, ...args: unknown[]) {
    if (!this.shouldLog(level)) return

    const timestamp = new Date().toISOString()
    const formattedArgs = this.formatArgs(args)

    if (this.config.colorize && typeof window !== 'undefined') {
      // Use CSS-based console styling in the browser
      const template = `%c[${timestamp}] %c[${level}] %c[${this.module}]%c`
      const styles = [TIMESTAMP_COLOR, LEVEL_COLORS[level], MODULE_COLOR, 'color: inherit']

      if (level === LogLevel.ERROR) {
        console.error(template, ...styles, message, ...formattedArgs)
      } else {
        console.log(template, ...styles, message, ...formattedArgs)
      }
    } else {
      const prefix = `[${timestamp}] [${level}] [${this.module}]`

      if (level === LogLevel.ERROR) {
        console.error(prefix, message, ...formattedArgs)
      } else {
        console.log(prefix, message, ...formattedArgs)
      }
    }
  }

  debug(message: string, ...args: unknown[]) {
    this.log(LogLevel.DEBUG, message, ...args)
  }

  info(message: string, ...args: unknown[]) {
    this.log(LogLevel.INFO, message, ...args)
  }

  warn(message: string, ...args: unknown[]) {
    this.log(LogLevel.WARN, message, ...args)
  }

  error(message: string, ...args: unknown[]) {
    this.log(LogLevel.ERROR, message, ...args)
  }
}

/**
 * Create a logger for a specific module
 */
export function createLogger(module: string, config?: LoggerConfig): Logger {
  return new Logger(module, config)
}
