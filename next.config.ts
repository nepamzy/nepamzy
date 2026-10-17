import type { NextConfig } from 'next'

const commonHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
]
const POLICY = (geo: string) => ({
  key: 'Permissions-Policy',
  value: `camera=(), microphone=(), geolocation=${geo}, payment=()`,
})

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // `forbidden()` (HTTP 403 pages) is still experimental in Next 16; tracked in docs/known-issues.md.
  experimental: { authInterrupts: true },
  async headers() {
    // Location is blocked everywhere EXCEPT the rider area (where a rider who chose Go Active can share it).
    return [
      { source: '/:path*', headers: commonHeaders },
      { source: '/rider', headers: [POLICY('(self)')] },
      { source: '/rider/:path*', headers: [POLICY('(self)')] },
      { source: '/((?!rider(?:/|$)).*)', headers: [POLICY('()')] },
    ]
  },
}

export default nextConfig
