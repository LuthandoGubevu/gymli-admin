import { diffDays, parseDate, toDayNumber, type LocalDate } from './dates'

/**
 * Account notice shown to every staff login (not to members or the check-in PC), again every
 * `everyHours` after it is closed. Switch it off with `active: false` and push to main.
 */
export const PAYMENT_NOTICE = {
  active: true,
  id: 'inv-2026-004',
  invoice: 'INV-2026-004',
  amount: 'R3 500.00',
  dueDate: '2026-11-15' as LocalDate,
  everyHours: 3,
  bank: [
    ['Bank', 'FNB Business'],
    ['Account type', 'Cheque'],
    ['Account name', 'Galaxy Ikonic'],
    ['Account number', '63200108602'],
    ['Reference', 'INV-2026-004'],
  ] as const,
  proofEmail: 'lgubevu@gmail.com',
  contact: 'Luthando, 069 596 1732',
}

const HOUR_MS = 3_600_000

/** Show it if it was never closed here, or was closed at least `everyHours` ago. */
export function shouldShow(now: number, lastSeenAt: number | null, everyHours: number): boolean {
  return lastSeenAt === null || now - lastSeenAt >= everyHours * HOUR_MS
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "Saturday 15 November 2026" */
export function formatLong(d: LocalDate): string {
  const { y, m, d: day } = parseDate(d)
  const dow = new Date(toDayNumber(d) * 86_400_000).getUTCDay()
  return `${WEEKDAYS[dow]} ${day} ${MONTHS[m - 1]} ${y}`
}

/** The heading and sentence for today (a calendar date at the gym). */
export function noticeText(today: LocalDate, dueDate: LocalDate = PAYMENT_NOTICE.dueDate, invoice = PAYMENT_NOTICE.invoice) {
  const { d, m } = parseDate(dueDate)
  if (diffDays(dueDate, today) > 0)
    return { label: 'Overdue', text: `Invoice ${invoice} is overdue. Payment was due by ${formatLong(dueDate)}. The Gymli system will be stopped.` }
  return {
    label: `Due ${WEEKDAYS[new Date(toDayNumber(dueDate) * 86_400_000).getUTCDay()]} ${d} ${MONTHS[m - 1]}`,
    text: `Invoice ${invoice} has not been paid. If payment is not received by ${formatLong(dueDate)}, the Gymli system will be stopped.`,
  }
}
