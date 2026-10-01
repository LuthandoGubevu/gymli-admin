/**
 * Gymli business rules. Pure functions only — no Firebase, no clock.
 * The check-in app (C#) implements the same rules; both run shared/test-vectors.
 * See CLAUDE.md §3.
 */
import { addDays, addMonthsClamped, diffDays, formatSmart, type LocalDate } from './dates'

export type PeriodKind = 'day' | 'days' | 'months'

export interface PeriodDates {
  start: LocalDate
  end: LocalDate
  deleted?: boolean
}

/** Ending this week = 0–6 days left (shown yellow). */
export const ENDING_SOON_DAYS = 6
/** On the Today dashboard, cards with 3 days or less are highlighted. */
export const URGENT_DAYS = 3

/** Inclusive end date of a paid period. */
export function periodEnd(kind: PeriodKind, qty: number, start: LocalDate): LocalDate {
  if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantity must be a whole number of 1 or more')
  switch (kind) {
    case 'day':
      return start
    case 'days':
      return addDays(start, qty - 1)
    case 'months':
      return addDays(addMonthsClamped(start, qty), -1)
  }
}

/** Number of days in an inclusive period. */
export function periodLength(start: LocalDate, end: LocalDate): number {
  return diffDays(start, end) + 1
}

export function livePeriods<T extends PeriodDates>(periods: readonly T[]): T[] {
  return periods.filter((p) => !p.deleted)
}

export function covers(p: PeriodDates, day: LocalDate): boolean {
  return p.start <= day && day <= p.end
}

/**
 * End of the continuous run of periods (overlapping or back-to-back) that covers `today`.
 * null when no period covers today.
 */
export function paidUntil(periods: readonly PeriodDates[], today: LocalDate): LocalDate | null {
  const live = livePeriods(periods)
  if (!live.some((p) => covers(p, today))) return null
  let end = today
  let extended = true
  while (extended) {
    extended = false
    const next = addDays(end, 1)
    for (const p of live) {
      if (p.start <= next && p.end > end) {
        end = p.end
        extended = true
      }
    }
  }
  return end
}

export type DeniedReason = 'not_recognised' | 'ended' | 'starts' | 'none'

export type AccessDecision =
  | { allowed: true; paidUntil: LocalDate; daysLeft: number }
  | { allowed: false; reason: Exclude<DeniedReason, 'not_recognised'>; date: LocalDate | null }

/** May this member enter today? */
export function evaluateAccess(periods: readonly PeriodDates[], today: LocalDate): AccessDecision {
  const until = paidUntil(periods, today)
  if (until) return { allowed: true, paidUntil: until, daysLeft: diffDays(today, until) }

  const live = livePeriods(periods)
  const future = live.filter((p) => p.start > today).sort((a, b) => (a.start < b.start ? -1 : 1))
  if (future.length > 0) return { allowed: false, reason: 'starts', date: future[0].start }

  const past = live.filter((p) => p.end < today).sort((a, b) => (a.end > b.end ? -1 : 1))
  if (past.length > 0) return { allowed: false, reason: 'ended', date: past[0].end }

  return { allowed: false, reason: 'none', date: null }
}

/** Exact wording shown at the turnstile and in the door log. */
export function deniedText(reason: DeniedReason, date: LocalDate | null, today: LocalDate): string {
  switch (reason) {
    case 'not_recognised':
      return 'Fingerprint not recognised'
    case 'ended':
      return `Membership ended ${formatSmart(date!, today)}`
    case 'starts':
      return `Paid period starts ${formatSmart(date!, today)}`
    case 'none':
      return 'No paid membership'
  }
}

/** Default start date for a new payment. */
export function defaultStartDate(periods: readonly PeriodDates[], today: LocalDate): LocalDate {
  const until = paidUntil(periods, today)
  return until ? addDays(until, 1) : today
}

export type MemberStatus = 'paid' | 'ending' | 'locked' | 'future' | 'none'

export interface StatusInfo {
  status: MemberStatus
  paidUntil: LocalDate | null
  daysLeft: number | null
  /** For locked-out members: the day the last period ended. */
  endedOn: LocalDate | null
  /** For members whose paid period starts later. */
  startsOn: LocalDate | null
}

export function memberStatus(periods: readonly PeriodDates[], today: LocalDate): StatusInfo {
  const d = evaluateAccess(periods, today)
  if (d.allowed) {
    return {
      status: d.daysLeft <= ENDING_SOON_DAYS ? 'ending' : 'paid',
      paidUntil: d.paidUntil,
      daysLeft: d.daysLeft,
      endedOn: null,
      startsOn: null,
    }
  }
  const live = livePeriods(periods)
  const lastEnd = live.filter((p) => p.end < today).reduce<LocalDate | null>((m, p) => (!m || p.end > m ? p.end : m), null)
  if (d.reason === 'starts') return { status: 'future', paidUntil: null, daysLeft: null, endedOn: lastEnd, startsOn: d.date }
  if (d.reason === 'ended') return { status: 'locked', paidUntil: null, daysLeft: null, endedOn: d.date, startsOn: null }
  return { status: 'none', paidUntil: null, daysLeft: null, endedOn: null, startsOn: null }
}

/** "1 month", "3 months", "Day pass", "10 days" */
export function periodLabel(kind: PeriodKind, qty: number): string {
  if (kind === 'day') return 'Day pass'
  if (kind === 'days') return qty === 1 ? '1 day' : `${qty} days`
  return qty === 1 ? '1 month' : `${qty} months`
}

/** Is this period the one covering today? */
export function isCurrent(p: PeriodDates, today: LocalDate): boolean {
  return !p.deleted && covers(p, today)
}
