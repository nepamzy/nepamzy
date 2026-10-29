'use client'

import { useRouter, usePathname } from 'next/navigation'
import { useRef, type MouseEvent } from 'react'
import { Logo } from '@/components/ui/logo'

/**
 * The header logo. On the home page, tapping it three times quickly opens the administrator sign-in. On every other page,
 * and for one or two taps, it is an ordinary link home. The page it opens is not a secret that protects anything.
 */
export function StaffTapLogo() {
  const router = useRouter()
  const onHome = usePathname() === '/'
  const taps = useRef<number[]>([])
  function onClickCapture(e: MouseEvent) {
    if (!onHome) return
    const now = Date.now()
    taps.current = [...taps.current.filter((t) => now - t < 900), now]
    if (taps.current.length >= 3) {
      taps.current = []
      e.preventDefault()
      e.stopPropagation()
      router.push('/staff-login')
    }
  }
  return (
    <span onClickCapture={onClickCapture} className="inline-flex">
      <Logo />
    </span>
  )
}
