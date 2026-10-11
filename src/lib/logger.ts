/** Minimal structured logger with redaction. Never log passwords, tokens, secrets or TOTP codes. */
const SENSITIVE =
  /pass(word)?|secret|token|authorization|cookie|api[-_]?key|otp|code|signature|jwt|key/i

export function redact(value: unknown, depth = 0): unknown {
  if (value == null || typeof value !== 'object') return value
  if (depth > 4) return '[truncated]'
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? '[redacted]' : redact(v, depth + 1)
  }
  return out
}

type Level = 'debug' | 'info' | 'warn' | 'error'

/** The id set by the proxy for this request (undefined outside a request, e.g. in tests or scripts). */
async function currentRequestId(): Promise<string | undefined> {
  try {
    const { headers } = await import('next/headers')
    return (await headers()).get('x-request-id') ?? undefined
  } catch {
    return undefined
  }
}

export function formatLine(
  level: Level,
  msg: string,
  ctx: Record<string, unknown>,
  requestId?: string,
) {
  return JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    ...(requestId ? { requestId } : {}),
    ...(redact(ctx) as object),
  })
}

export function log(level: Level, msg: string, ctx: Record<string, unknown> = {}) {
  void currentRequestId().then((rid) => {
    const line = formatLine(level, msg, ctx, rid)
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.log(line)
  })
}
export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => log('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => log('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => log('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => log('error', m, c),
}
