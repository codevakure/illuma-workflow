import { Hono } from 'hono'
import { createLogger } from '@sim/logger'
import { generateRequestId } from '@/lib/core/utils/request'
import { validateHallucination } from '@/lib/guardrails/validate_hallucination'
import { validateJson } from '@/lib/guardrails/validate_json'
import { validatePII } from '@/lib/guardrails/validate_pii'
import { validateRegex } from '@/lib/guardrails/validate_regex'
import type { AuthContext } from '@/middleware/auth'

const logger = createLogger('GuardrailsValidateAPI')

const app = new Hono<{ Variables: AuthContext }>()

/**
 * Convert input to string for validation
 */
function convertInputToString(input: unknown): string {
  if (typeof input === 'string') {
    return input
  }
  if (input === null || input === undefined) {
    return ''
  }
  if (typeof input === 'object') {
    return JSON.stringify(input)
  }
  return String(input)
}

/**
 * Execute validation using the appropriate validator
 */
async function executeValidation(
  validationType: string,
  inputStr: string,
  regex: string | undefined,
  knowledgeBaseId: string | undefined,
  threshold: string | undefined,
  topK: string | undefined,
  model: string,
  apiKey: string | undefined,
  workflowId: string | undefined,
  piiEntityTypes: string[] | undefined,
  piiMode: string | undefined,
  piiLanguage: string | undefined,
  requestId: string
): Promise<{
  passed: boolean
  error?: string
  score?: number
  reasoning?: string
  detectedEntities?: unknown[]
  maskedText?: string
}> {
  if (validationType === 'json') {
    return validateJson(inputStr)
  }
  if (validationType === 'regex') {
    if (!regex) {
      return {
        passed: false,
        error: 'Regex pattern is required',
      }
    }
    return validateRegex(inputStr, regex)
  }
  if (validationType === 'hallucination') {
    if (!knowledgeBaseId) {
      return {
        passed: false,
        error: 'Knowledge base ID is required for hallucination check',
      }
    }

    return await validateHallucination({
      userInput: inputStr,
      knowledgeBaseId,
      threshold: threshold != null ? Number.parseFloat(threshold) : 3,
      topK: topK ? Number.parseInt(topK) : 10,
      model,
      apiKey,
      workflowId,
      requestId,
    })
  }
  if (validationType === 'pii') {
    return await validatePII({
      text: inputStr,
      entityTypes: piiEntityTypes || [],
      mode: (piiMode as 'block' | 'mask') || 'block',
      language: piiLanguage || 'en',
      requestId,
    })
  }
  return {
    passed: false,
    error: 'Unknown validation type',
  }
}

/**
 * POST /validate
 * Validates input against the specified validation type (json, regex, hallucination, pii).
 */
app.post('/validate', async (c) => {
  const requestId = generateRequestId()
  logger.info(`[${requestId}] Guardrails validation request received`)

  try {
    const body = await c.req.json()
    const {
      validationType,
      input,
      regex,
      knowledgeBaseId,
      threshold,
      topK,
      model,
      apiKey,
      workflowId,
      piiEntityTypes,
      piiMode,
      piiLanguage,
    } = body

    if (!validationType) {
      return c.json({
        success: true,
        output: {
          passed: false,
          validationType: 'unknown',
          input: input || '',
          error: 'Missing required field: validationType',
        },
      })
    }

    if (input === undefined || input === null) {
      return c.json({
        success: true,
        output: {
          passed: false,
          validationType,
          input: '',
          error: 'Input is missing or undefined',
        },
      })
    }

    if (
      validationType !== 'json' &&
      validationType !== 'regex' &&
      validationType !== 'hallucination' &&
      validationType !== 'pii'
    ) {
      return c.json({
        success: true,
        output: {
          passed: false,
          validationType,
          input: input || '',
          error: 'Invalid validationType. Must be "json", "regex", "hallucination", or "pii"',
        },
      })
    }

    if (validationType === 'regex' && !regex) {
      return c.json({
        success: true,
        output: {
          passed: false,
          validationType,
          input: input || '',
          error: 'Regex pattern is required for regex validation',
        },
      })
    }

    if (validationType === 'hallucination' && !model) {
      return c.json({
        success: true,
        output: {
          passed: false,
          validationType,
          input: input || '',
          error: 'Model is required for hallucination validation',
        },
      })
    }

    const inputStr = convertInputToString(input)

    logger.info(`[${requestId}] Executing validation locally`, {
      validationType,
      inputType: typeof input,
    })

    const validationResult = await executeValidation(
      validationType,
      inputStr,
      regex,
      knowledgeBaseId,
      threshold,
      topK,
      model,
      apiKey,
      workflowId,
      piiEntityTypes,
      piiMode,
      piiLanguage,
      requestId
    )

    logger.info(`[${requestId}] Validation completed`, {
      passed: validationResult.passed,
      hasError: !!validationResult.error,
      score: validationResult.score,
    })

    return c.json({
      success: true,
      output: {
        passed: validationResult.passed,
        validationType,
        input,
        error: validationResult.error,
        score: validationResult.score,
        reasoning: validationResult.reasoning,
        detectedEntities: validationResult.detectedEntities,
        maskedText: validationResult.maskedText,
      },
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Validation failed due to unexpected error'
    logger.error(`[${requestId}] Guardrails validation failed`, { error })
    return c.json({
      success: true,
      output: {
        passed: false,
        validationType: 'unknown',
        input: '',
        error: message,
      },
    })
  }
})

export { app as guardrailRoutes }
