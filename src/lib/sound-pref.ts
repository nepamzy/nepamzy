'use client'
const MUTE_KEY = 'afit.sound.muted'
export const MUTE_EVENT = 'afit-mute-change'

export function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}
export function writeMuted(m: boolean): void {
  try {
    localStorage.setItem(MUTE_KEY, m ? '1' : '0')
  } catch {
    /* private mode: setting lasts until reload */
  }
  window.dispatchEvent(new Event(MUTE_EVENT))
}

export function subscribeMuted(cb: () => void): () => void {
  window.addEventListener(MUTE_EVENT, cb)
  window.addEventListener('storage', cb)
  return () => {
    window.removeEventListener(MUTE_EVENT, cb)
    window.removeEventListener('storage', cb)
  }
}
