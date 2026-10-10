import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'

export default [
  ...nextVitals,
  ...nextTs,
  { ignores: ['.next/**', 'node_modules/**', 'supabase/.temp/**', 'playwright-report/**', 'test-results/**', 'next-env.d.ts'] },
]
