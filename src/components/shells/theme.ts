export type ShellTheme = 'light' | 'navy' | 'vendor' | 'rider'

/** One look per area. Tailwind needs whole class names, so every variant is spelled out here. */
export const SHELL_THEMES: Record<
  ShellTheme,
  {
    dark: boolean
    aside: string
    label: string
    link: string
    divider: string
    topBar: string
    chip: string | null
    chipLabel: string | null
  }
> = {
  light: {
    dark: false,
    aside: 'border-r border-line bg-card',
    label: 'text-muted',
    link: 'text-ink hover:bg-brand-50',
    divider: 'border-line',
    topBar: 'border-t-gold-400',
    chip: null,
    chipLabel: null,
  },
  navy: {
    dark: true,
    aside: 'bg-navy-900 text-white',
    label: 'text-navy-text/80',
    link: 'text-navy-text hover:bg-navy-800 hover:text-white',
    divider: 'border-white/10',
    topBar: 'border-t-gold-400',
    chip: null,
    chipLabel: null,
  },
  vendor: {
    dark: true,
    aside: 'bg-vendor-900 text-white',
    label: 'text-vendor-text/80',
    link: 'text-vendor-text hover:bg-vendor-800 hover:text-white',
    divider: 'border-white/10',
    topBar: 'border-t-vendor-800',
    chip: 'bg-vendor-50 text-vendor-800',
    chipLabel: 'Shop',
  },
  rider: {
    dark: true,
    aside: 'bg-rider-900 text-white',
    label: 'text-rider-text/80',
    link: 'text-rider-text hover:bg-rider-800 hover:text-white',
    divider: 'border-white/10',
    topBar: 'border-t-rider-800',
    chip: 'bg-rider-50 text-rider-800',
    chipLabel: 'Rider',
  },
}
