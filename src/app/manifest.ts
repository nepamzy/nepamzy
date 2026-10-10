import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AFIT Market',
    short_name: 'AFIT Market',
    description: 'Order from approved campus vendors for pickup or delivery.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f6f2',
    theme_color: '#0b5551',
    icons: [
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
    ],
  }
}
