/** Wording and colours for statuses, in the design's tone. */
import { formatRand } from './accounts'
import { memberStatus, periodLabel, type StatusInfo } from './access'
import { dateAtGym, diffDays, formatDayMonth, formatFull, formatSmart, timeAtGym, type LocalDate } from './dates'
import { PAYMENT_METHOD_LABEL, type Member, type Period } from './types'
import type { Tone } from '../components/ui'

export interface MemberView {
  member: Member
  info: StatusInfo
  lastPayment: Period | null
}

export function viewMember(member: Member, today: LocalDate): MemberView {
  const live = member.periods.filter((p) => !p.deleted)
  const lastPayment = live.reduce<Period | null>((a, p) => (!a || p.loggedAt > a.loggedAt ? p : a), null)
  return { member, info: memberStatus(member.periods, today), lastPayment }
}

export function statusPill(info: StatusInfo): { tone: Tone; text: string } {
  switch (info.status) {
    case 'paid':
      return { tone: 'green', text: 'Paid up' }
    case 'ending':
      return { tone: 'yellow', text: info.daysLeft === 0 ? 'Last day today' : `Ends in ${daysText(info.daysLeft!)}` }
    case 'locked':
      return { tone: 'red', text: 'Locked out' }
    case 'future':
      return { tone: 'neutral', text: `Starts ${formatDayMonth(info.startsOn!)}` }
    case 'none':
      return { tone: 'neutral', text: 'No payment yet' }
  }
}

/** Profile header pill (design 03: "Ending this week") */
export function profilePill(info: StatusInfo): { tone: Tone; text: string } {
  if (info.status === 'ending') return { tone: 'yellow', text: 'Ending this week' }
  return statusPill(info)
}

export const daysText = (n: number) => (n === 1 ? '1 day' : `${n} days`)
export const daysLeftText = (n: number) => (n === 0 ? 'last day' : n === 1 ? '1 day left' : `${n} days left`)
export const daysAgoText = (n: number) => (n === 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`)

/** Two lines for the "Paid until" column */
export function paidUntilCell(info: StatusInfo, today: LocalDate): { main: string; sub: string } {
  if (info.paidUntil) return { main: formatSmart(info.paidUntil, today), sub: daysLeftText(info.daysLeft!) }
  if (info.status === 'locked') return { main: formatSmart(info.endedOn!, today), sub: daysAgoText(diffDays(info.endedOn!, today)) }
  if (info.status === 'future') return { main: formatSmart(info.startsOn!, today), sub: 'starts' }
  return { main: '—', sub: 'never paid' }
}

/** "1 month · logged 21 Sep" */
export function lastPaymentText(p: Period | null): string {
  if (!p) return 'None yet'
  return `${periodLabel(p.kind, p.qty)} · logged ${formatDayMonth(dateAtGym(p.loggedAt))}`
}

/** "logged by Zodwa, 8 Sep 07:12" */
export function loggedByText(p: Period): string {
  const first = p.loggedBy.name.split(' ')[0]
  const amount = typeof p.amountCents === 'number' ? `${formatRand(p.amountCents)} · ` : ''
  const method = p.method ? `${PAYMENT_METHOD_LABEL[p.method]} · ` : ''
  return `${amount}${method}logged by ${first}, ${formatDayMonth(dateAtGym(p.loggedAt))} ${timeAtGym(p.loggedAt)}`
}

export const longDate = formatFull
