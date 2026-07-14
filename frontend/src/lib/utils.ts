import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDateTime(dt: string | null | undefined): string {
  if (!dt) return '—'
  const date = new Date(dt)
  const formatted = date.toLocaleString(undefined, { timeZoneName: 'short' })
  // Some platforms emit "GMT+5:30" instead of a named abbreviation like "IST".
  // In that case, derive initials from toTimeString()'s "(India Standard Time)" suffix.
  if (!/GMT[+-]/.test(formatted)) return formatted
  const m = date.toTimeString().match(/\(([^)]+)\)$/)
  if (m) {
    const words = m[1].split(/\s+/)
    const abbr = words.length > 1 ? words.map((w) => w[0]).join('') : m[1]
    return formatted.replace(/GMT[+-]\d+(?::\d+)?/, abbr)
  }
  return formatted
}
