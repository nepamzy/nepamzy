import { z } from 'zod'

const publicish = z.object({
  SITE_URL: z.url(),
  SUPABASE_URL: z.url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
})
const privileged = z.object({ SUPABASE_SERVICE_ROLE_KEY: z.string().min(10) })
/** Unset or unrecognised means `production`: features that must never run in production fail closed. */
const appEnvSchema = z.enum(['local', 'staging', 'production']).catch('production')

function parse<T extends z.ZodType>(schema: T, label: string): z.infer<T> {
  const r = schema.safeParse(process.env)
  if (!r.success) {
    // Names of the offending variables only - never values.
    const names = r.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Invalid ${label} environment configuration. Check: ${names}`)
  }
  return r.data
}

/** Variables needed for normal server-side requests. Fails fast, never prints values. */
export const serverEnv = () => parse(publicish, 'server')
/** Service-role key. Only call from server-only modules. */
export const serviceEnv = () => parse(privileged, 'service-role')

export type AppEnv = z.infer<typeof appEnvSchema>
export const appEnv = (): AppEnv => appEnvSchema.parse(process.env.APP_ENV)
/** The mock payment button/action exists ONLY when APP_ENV=local (the database flag is a second guard). */
export const mockPaymentsAllowed = () => appEnv() === 'local'
