/**
 * Shim for next/link - provides React Router Link
 */
import { Link as RouterLink, type LinkProps as RouterLinkProps } from 'react-router-dom'
import type { AnchorHTMLAttributes, ReactNode } from 'react'

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: string
  children: ReactNode
  prefetch?: boolean
  replace?: boolean
  scroll?: boolean
  shallow?: boolean
  passHref?: boolean
  legacyBehavior?: boolean
}

export default function Link({
  href,
  children,
  prefetch,
  replace,
  scroll,
  shallow,
  passHref,
  legacyBehavior,
  ...props
}: LinkProps) {
  // Handle external links
  if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    )
  }

  return (
    <RouterLink to={href} replace={replace} {...props}>
      {children}
    </RouterLink>
  )
}
