import type { Member } from '../../lib/types'

/** Search by name, cellphone (any part of the digits) or GY-number ("GY-1007", "1007"). */
export function matchesSearch(m: Member, raw: string): boolean {
  const q = raw.trim().toLowerCase()
  if (!q) return true
  const name = `${m.firstName} ${m.lastName}`.toLowerCase()
  if (q.split(/\s+/).every((part) => name.includes(part))) return true
  const code = q.replace(/^gy-?/, '')
  if (/^\d+$/.test(code) && String(m.number).startsWith(code) && code.length >= 2) return true
  const digits = q.replace(/\D/g, '')
  if (digits.length >= 3) {
    const phone = m.cellphone
    const intl = phone.startsWith('0') ? '27' + phone.slice(1) : phone
    if (phone.includes(digits) || intl.includes(digits)) return true
  }
  return false
}
