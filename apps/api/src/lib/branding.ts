/**
 * Branding configuration types and defaults.
 */

export interface ThemeColors {
  primaryColor?: string
  primaryHoverColor?: string
  accentColor?: string
  accentHoverColor?: string
  backgroundColor?: string
}

export interface BrandConfig {
  name?: string
  logoUrl?: string
  faviconUrl?: string
  customCssUrl?: string
  supportEmail?: string
  documentationUrl?: string
  termsUrl?: string
  privacyUrl?: string
  theme?: ThemeColors
}

export const defaultBrandConfig: BrandConfig = {
  name: 'Sim',
  theme: {
    primaryColor: '#000000',
    primaryHoverColor: '#333333',
    accentColor: '#0066ff',
    accentHoverColor: '#0052cc',
    backgroundColor: '#ffffff',
  },
}
