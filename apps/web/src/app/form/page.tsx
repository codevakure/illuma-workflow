import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams } from 'react-router-dom'
import { cn } from '@/lib/core/utils/cn'

interface InputField {
  name: string
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'files'
  description?: string
  value?: unknown
  required?: boolean
}

interface FieldConfig {
  name: string
  type: string
  label: string
  description?: string
  required?: boolean
}

interface FormConfig {
  id: string
  title: string
  description?: string
  customizations: {
    primaryColor?: string
    thankYouMessage?: string
    logoUrl?: string
    fieldConfigs?: FieldConfig[]
  } | null
  authType?: 'public' | 'password' | 'email'
  showBranding?: boolean
  inputSchema?: InputField[]
}

/**
 * Public form widget page.
 * Communicates with the API at /api/form/:identifier.
 */
export default function FormPage() {
  const { identifier } = useParams<{ identifier: string }>()
  const [formConfig, setFormConfig] = useState<FormConfig | null>(null)
  const [formData, setFormData] = useState<Record<string, unknown>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({})
  const [authRequired, setAuthRequired] = useState<'password' | 'email' | null>(null)
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [thankYouData, setThankYouData] = useState<{
    title: string
    message: string
  } | null>(null)

  const abortControllerRef = useRef<AbortController | null>(null)

  const fetchFormConfig = useCallback(
    async (signal?: AbortSignal) => {
      if (!identifier) return
      try {
        setIsLoading(true)
        setError(null)

        const response = await fetch(`/api/form/${identifier}`, { signal })
        if (signal?.aborted) return

        const data = await response.json()

        if (!response.ok) {
          if (response.status === 401) {
            const authError = data.error
            if (authError === 'auth_required_password') {
              setAuthRequired('password')
              setFormConfig({
                id: '',
                title: data.title || 'Form',
                customizations: data.customizations || {},
              })
              return
            }
            if (authError === 'auth_required_email') {
              setAuthRequired('email')
              setFormConfig({
                id: '',
                title: data.title || 'Form',
                customizations: data.customizations || {},
              })
              return
            }
          }
          throw new Error(data.error || 'Failed to load form')
        }

        setFormConfig(data)
        setAuthRequired(null)

        const fields: InputField[] = data.inputSchema || []
        if (fields.length > 0) {
          const initialData: Record<string, unknown> = {}
          for (const field of fields) {
            if (field.value !== undefined) {
              initialData[field.name] = field.value
            } else {
              switch (field.type) {
                case 'boolean':
                  initialData[field.name] = false
                  break
                case 'number':
                  initialData[field.name] = ''
                  break
                case 'array':
                case 'files':
                  initialData[field.name] = []
                  break
                case 'object':
                  initialData[field.name] = {}
                  break
                default:
                  initialData[field.name] = ''
              }
            }
          }
          setFormData(initialData)
        }
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        setError(err instanceof Error ? err.message : 'Failed to load form')
      } finally {
        setIsLoading(false)
      }
    },
    [identifier]
  )

  useEffect(() => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller
    fetchFormConfig(controller.signal)
    return () => controller.abort()
  }, [fetchFormConfig])

  const handleFieldChange = useCallback((fieldName: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [fieldName]: value }))
    setValidationErrors((prev) => {
      if (!prev[fieldName]) return prev
      const { [fieldName]: _, ...rest } = prev
      return rest
    })
  }, [])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!formConfig || !identifier) return

      const fields = formConfig.inputSchema || []
      const errors: Record<string, string> = {}
      const fieldConfigMap = new Map(
        (formConfig.customizations?.fieldConfigs || []).map((fc) => [fc.name, fc])
      )

      for (const field of fields) {
        const config = fieldConfigMap.get(field.name)
        const isRequired = config?.required ?? field.required
        if (isRequired) {
          const value = formData[field.name]
          if (value === undefined || value === null || value === '') {
            errors[field.name] = 'This field is required'
          }
        }
      }

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors)
        return
      }

      try {
        setIsSubmitting(true)
        setError(null)

        const response = await fetch(`/api/form/${identifier}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ formData }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to submit form')
        }

        setThankYouData({
          title: data.thankYouTitle || 'Thank you!',
          message:
            data.thankYouMessage ||
            formConfig.customizations?.thankYouMessage ||
            'Your response has been submitted successfully.',
        })
        setIsSubmitted(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to submit form')
      } finally {
        setIsSubmitting(false)
      }
    },
    [identifier, formConfig, formData]
  )

  const handlePasswordAuth = useCallback(
    async (submittedPassword: string) => {
      if (!identifier) return
      try {
        setIsLoading(true)
        setAuthError(null)

        const response = await fetch(`/api/form/${identifier}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: submittedPassword }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Invalid password')
        }

        await fetchFormConfig()
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Invalid password')
        setIsLoading(false)
      }
    },
    [identifier, fetchFormConfig]
  )

  const primaryColor = formConfig?.customizations?.primaryColor || '#6f3dfa'

  // Loading state
  if (isLoading && !authRequired) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-1)] border-t-[var(--text-primary)]" />
          <p className="text-sm text-[var(--text-secondary)]">Loading form...</p>
        </div>
      </div>
    )
  }

  // Error state (before config loads)
  if (error && !authRequired && !formConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
        <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
            <svg className="h-6 w-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Form Unavailable</h2>
          <p className="text-sm text-[var(--text-secondary)]">{error}</p>
        </div>
      </div>
    )
  }

  // Password auth
  if (authRequired === 'password') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
        <div className="w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-8 shadow-sm">
          <div className="mb-6 text-center">
            <div
              className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: `${primaryColor}15` }}
            >
              <svg className="h-6 w-6" style={{ color: primaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            </div>
            <h2 className="text-lg font-medium text-[var(--text-primary)]">Password Required</h2>
            <p className="mt-1 text-sm text-[var(--text-secondary)]">
              Enter the password to access this form.
            </p>
          </div>
          <div className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handlePasswordAuth(password)}
              placeholder="Enter password"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-5)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--border-1)] focus:outline-none"
              autoFocus
            />
            {authError && (
              <p className="text-center text-sm text-red-500">{authError}</p>
            )}
            <button
              onClick={() => handlePasswordAuth(password)}
              disabled={!password}
              className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: primaryColor }}
            >
              Continue
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Thank you / success state
  if (isSubmitted && thankYouData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
        <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-8 text-center shadow-sm">
          <div
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full"
            style={{ backgroundColor: `${primaryColor}15` }}
          >
            <svg className="h-7 w-7" style={{ color: primaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="mb-2 text-xl font-medium text-[var(--text-primary)]">{thankYouData.title}</h2>
          <p className="text-sm text-[var(--text-secondary)]">{thankYouData.message}</p>
        </div>
      </div>
    )
  }

  // Config not loaded
  if (!formConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg)] p-4">
        <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-8 text-center shadow-sm">
          <h2 className="mb-2 text-lg font-medium text-[var(--text-primary)]">Form Not Found</h2>
          <p className="text-sm text-[var(--text-secondary)]">This form could not be loaded.</p>
        </div>
      </div>
    )
  }

  const fields = formConfig.inputSchema || []
  const fieldConfigMap = new Map(
    (formConfig.customizations?.fieldConfigs || []).map((fc) => [fc.name, fc])
  )

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <div className="flex flex-1 justify-center px-4 pb-24 pt-16">
        <div className="w-full max-w-[420px]">
          {/* Form header */}
          <div className="mb-8 text-center">
            {formConfig.customizations?.logoUrl && (
              <img
                src={formConfig.customizations.logoUrl}
                alt=""
                className="mx-auto mb-4 h-12 w-12 rounded-full object-cover"
              />
            )}
            <h1 className="text-2xl font-medium tracking-tight text-[var(--text-primary)]">
              {formConfig.title}
            </h1>
            {formConfig.description && (
              <p className="mt-2 text-sm text-[var(--text-secondary)]">
                {formConfig.description}
              </p>
            )}
          </div>

          {/* Form fields */}
          <form onSubmit={handleSubmit} className="space-y-6">
            {fields.length === 0 ? (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-4)] p-6 text-center text-sm text-[var(--text-secondary)]">
                This form has no fields configured.
              </div>
            ) : (
              fields.map((field) => {
                const config = fieldConfigMap.get(field.name)
                const label = config?.label || field.name
                const description = config?.description || field.description
                const isRequired = config?.required ?? field.required
                const fieldType = field.type || 'string'
                const value = formData[field.name]
                const fieldError = validationErrors[field.name]

                return (
                  <div key={field.name} className="space-y-1.5">
                    <label className="block text-sm font-medium text-[var(--text-primary)]">
                      {label}
                      {isRequired && (
                        <span className="ml-1 text-red-500">*</span>
                      )}
                    </label>
                    {description && (
                      <p className="text-xs text-[var(--text-muted)]">{description}</p>
                    )}

                    <FormFieldInput
                      type={fieldType}
                      value={value}
                      onChange={(val) => handleFieldChange(field.name, val)}
                      primaryColor={primaryColor}
                      hasError={Boolean(fieldError)}
                    />

                    {fieldError && (
                      <p className="text-xs text-red-500">{fieldError}</p>
                    )}
                  </div>
                )
              })
            )}

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                {error}
              </div>
            )}

            {fields.length > 0 && (
              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ backgroundColor: primaryColor }}
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
            )}
          </form>
        </div>
      </div>

      {formConfig.showBranding !== false && (
        <div className="py-4 text-center text-xs text-[var(--text-muted)]">
          Powered by Illuma
        </div>
      )}
    </div>
  )
}

interface FormFieldInputProps {
  type: string
  value: unknown
  onChange: (value: unknown) => void
  primaryColor: string
  hasError: boolean
}

/**
 * Renders the appropriate input element based on field type.
 */
function FormFieldInput({ type, value, onChange, primaryColor, hasError }: FormFieldInputProps) {
  const baseInputClass = cn(
    'w-full rounded-lg border bg-[var(--surface-5)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none transition-colors',
    hasError
      ? 'border-red-400 focus:border-red-500'
      : 'border-[var(--border)] focus:border-[var(--border-1)]'
  )

  switch (type) {
    case 'boolean':
      return (
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={Boolean(value)}
            onClick={() => onChange(!value)}
            className={cn(
              'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
              value ? '' : 'bg-[var(--surface-5)]'
            )}
            style={value ? { backgroundColor: primaryColor } : undefined}
          >
            <span
              className={cn(
                'pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                value ? 'translate-x-5' : 'translate-x-0'
              )}
            />
          </button>
          <span className="text-sm text-[var(--text-secondary)]">
            {value ? 'Yes' : 'No'}
          </span>
        </div>
      )

    case 'number':
      return (
        <input
          type="number"
          value={value as string}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter a number"
          className={baseInputClass}
        />
      )

    case 'array':
    case 'object':
      return (
        <textarea
          value={
            typeof value === 'string'
              ? value
              : value !== undefined && value !== null
                ? JSON.stringify(value, null, 2)
                : ''
          }
          onChange={(e) => {
            try {
              onChange(JSON.parse(e.target.value))
            } catch {
              onChange(e.target.value)
            }
          }}
          placeholder={type === 'array' ? '["item1", "item2"]' : '{"key": "value"}'}
          rows={4}
          className={cn(baseInputClass, 'resize-y font-mono text-xs')}
        />
      )

    case 'files':
      return (
        <div className="rounded-lg border border-dashed border-[var(--border-1)] bg-[var(--surface-5)] p-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">File upload not supported in this view</p>
        </div>
      )

    default:
      return (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter a value"
          className={baseInputClass}
        />
      )
  }
}
