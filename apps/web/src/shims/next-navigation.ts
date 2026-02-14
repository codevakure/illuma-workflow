/**
 * Shim for next/navigation - provides React Router equivalents
 */
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom'

export function useRouter() {
  const navigate = useNavigate()
  const location = useLocation()

  return {
    push: (path: string) => navigate(path),
    replace: (path: string) => navigate(path, { replace: true }),
    back: () => navigate(-1),
    forward: () => navigate(1),
    refresh: () => window.location.reload(),
    prefetch: () => {},
    pathname: location.pathname,
  }
}

export { useParams, useSearchParams }

export function usePathname() {
  const location = useLocation()
  return location.pathname
}

export function redirect(path: string) {
  window.location.href = path
}

export function notFound() {
  throw new Error('Not Found')
}
