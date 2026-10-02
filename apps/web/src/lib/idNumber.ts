/** South African ID numbers and passports. */
import { isValidDate, makeDate, type LocalDate } from './dates'

export type IdType = 'sa' | 'passport'

export interface IdCheck {
  ok: boolean
  /** Short, plain-English reason when not ok */
  error?: string
  /** Date of birth (SA ID only) */
  dateOfBirth?: LocalDate
}

export const cleanId = (raw: string) => raw.replace(/[\s-]/g, '').toUpperCase()

/** Luhn check over all 13 digits (the last digit is the check digit). */
function luhnOk(digits: string): boolean {
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return sum % 10 === 0
}

/**
 * SA ID: YYMMDD SSSS C A Z — date of birth, sequence, citizenship (0 or 1), A, check digit.
 * `today` decides the century: a YY later than this year's is in the 1900s.
 */
export function checkSaId(raw: string, today: LocalDate): IdCheck {
  const id = cleanId(raw)
  if (!/^\d{13}$/.test(id)) return { ok: false, error: 'An SA ID number has 13 digits' }
  const yy = Number(id.slice(0, 2))
  const mm = Number(id.slice(2, 4))
  const dd = Number(id.slice(4, 6))
  const thisYear = Number(today.slice(0, 4))
  const century = 2000 + yy > thisYear ? 1900 : 2000
  const dob = makeDate(century + yy, mm, dd)
  if (!isValidDate(dob)) return { ok: false, error: 'The first 6 digits are not a valid date of birth' }
  if (id[10] !== '0' && id[10] !== '1') return { ok: false, error: 'This is not a valid SA ID number' }
  if (!luhnOk(id)) return { ok: false, error: 'Check the number: one digit is wrong' }
  return { ok: true, dateOfBirth: dob }
}

export function checkPassport(raw: string): IdCheck {
  const id = cleanId(raw)
  if (!/^[A-Z0-9]{6,20}$/.test(id)) return { ok: false, error: 'Use 6 to 20 letters and numbers' }
  return { ok: true }
}

export function checkId(type: IdType, raw: string, today: LocalDate): IdCheck {
  return type === 'sa' ? checkSaId(raw, today) : checkPassport(raw)
}

/** "920315 5108 087" */
export function formatSaId(raw: string): string {
  const id = cleanId(raw)
  return id.length === 13 ? `${id.slice(0, 6)} ${id.slice(6, 10)} ${id.slice(10)}` : id
}

/** What front desk sees: only the last 3 characters. */
export function maskId(type: IdType, last3: string): string {
  return type === 'sa' ? `•••••• •••• ${last3}` : `•••••${last3}`
}

export const ID_TYPE_LABEL: Record<IdType, string> = { sa: 'SA ID', passport: 'Passport' }
