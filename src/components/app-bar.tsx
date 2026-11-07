'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { pushWords, usePush } from '@/lib/use-push'

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
const HIDE_KEY = 'afit.bar.hiddenUntil'
const WEEK = 7 * 24 * 60 * 60 * 1000

function hiddenNow(): boolean {
  try {
    return Number(localStorage.getItem(HIDE_KEY) ?? 0) > Date.now()
  } catch {
    return false
  }
}
function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

const BTN =
  'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60'

/**
 * Slim bar at the top of every page: "Download app" (adds the website to the home screen) and "Turn on notifications".
 * Hidden for 7 days when closed; comes back if either is still not done. Hidden for good when both are done.
 */
export function AppBar({ publicKey }: { publicKey: string | null }) {
  const push = usePush(publicKey)
  const env = useSyncExternalStore(
    () => () => undefined,
    () => `${isStandalone() ? 'S' : '-'}${isIos() ? 'I' : '-'}${hiddenNow() ? 'H' : '-'}`,
    () => 'server',
  )
  const ready = env !== 'server'
  const [justInstalled, setJustInstalled] = useState(false)
  const [closed, setClosed] = useState(false)
  const installed = justInstalled || env[0] === 'S'
  const ios = env[1] === 'I'
  const hidden = closed || env[2] === 'H'
  const [prompt, setPrompt] = useState<InstallEvent | null>(null)
  const [help, setHelp] = useState<'ios' | 'nobrowser' | null>(null)

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setPrompt(e as InstallEvent)
    }
    const onInstalled = () => {
      setJustInstalled(true)
      setPrompt(null)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const install = useCallback(async () => {
    if (prompt) {
      await prompt.prompt()
      const c = await prompt.userChoice.catch(() => null)
      if (c?.outcome === 'accepted') setJustInstalled(true)
      setPrompt(null)
    } else if (ios) setHelp(help === 'ios' ? null : 'ios')
    else setHelp(help === 'nobrowser' ? null : 'nobrowser')
  }, [prompt, ios, help])

  const close = () => {
    try {
      localStorage.setItem(HIDE_KEY, String(Date.now() + WEEK))
    } catch {
      /* ignore */
    }
    setClosed(true)
  }

  if (!ready || hidden) return null
  const alertsOn = push.phase === 'on'
  if (installed && alertsOn) return null
  if (push.phase === 'checking') return null

  return (
    <aside
      aria-label="Install and notifications"
      data-testid="app-bar"
      className="bg-brand-800 text-white"
    >
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {installed ? (
            <span className="text-sm font-semibold">✓ App installed</span>
          ) : (
            <button
              type="button"
              onClick={install}
              className={`${BTN} bg-white text-brand-800 hover:bg-white/90`}
              data-testid="bar-install"
            >
              Download app
            </button>
          )}
          {alertsOn ? (
            <span className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/15 px-3 py-2 text-sm font-semibold">
                ✓ Notifications on
              </span>
              <button
                type="button"
                onClick={push.turnOff}
                className="min-h-11 px-2 text-sm underline"
              >
                Turn off
              </button>
            </span>
          ) : push.phase === 'unsupported' || push.phase === 'blocked' ? null : push.phase ===
            'signin' ? (
            <Link href="/login" className={`${BTN} bg-gold-400 text-brand-800`}>
              Sign in to turn on notifications
            </Link>
          ) : (
            <button
              type="button"
              onClick={push.turnOn}
              disabled={push.phase === 'working'}
              className={`${BTN} bg-gold-400 text-brand-800 hover:brightness-95`}
              data-testid="bar-notify"
            >
              Turn on notifications
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={close}
          aria-label="Hide this bar for 7 days"
          className="inline-flex size-11 items-center justify-center rounded-lg text-xl hover:bg-white/10"
        >
          ×
        </button>
        {(push.error || ['blocked', 'unsupported', 'signin'].includes(push.phase)) && (
          <p className="basis-full text-xs text-white/85" role="status" data-testid="bar-state">
            {pushWords(push.phase)}
            {push.error ? ` ${push.error}` : ''}
          </p>
        )}
        {help === 'ios' && (
          <ol
            className="basis-full list-decimal space-y-1 rounded-lg bg-white/10 p-3 pl-8 text-sm"
            data-testid="ios-help"
          >
            <li>
              In Safari, tap the Share button (a square with an arrow pointing up) at the bottom.
            </li>
            <li>Scroll down and tap “Add to Home Screen”.</li>
            <li>Tap “Add” at the top right. The AFIT Market icon is now on your Home Screen.</li>
            <li>Open AFIT Market from that icon, then tap “Turn on notifications”.</li>
          </ol>
        )}
        {help === 'nobrowser' && (
          <p className="basis-full rounded-lg bg-white/10 p-3 text-sm" data-testid="nobrowser-help">
            Open this page in Chrome (Android) or Safari (iPhone) to install. If you are already in
            Chrome, open the menu (⋮) and tap “Add to Home screen”.
          </p>
        )}
      </div>
    </aside>
  )
}
