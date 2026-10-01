/**
 * Calendar dates without a time, as "YYYY-MM-DD" strings.
 * All business dates are in Africa/Johannesburg (UTC+2, no daylight saving).
 */
export type LocalDate = string

export const GYM_TIME_ZONE = 'Africa/Johannesburg'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_MS = 86_400_000

export function parseDate(d: LocalDate): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (!match) throw new Error(`Not a date: ${d}`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

export function makeDate(y: number, m: number, d: number): LocalDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function isValidDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
  const { y, m, d: day } = parseDate(d)
  return m >= 1 && m <= 12 && day >= 1 && day <= daysInMonth(y, m)
}

/** Days since 1970-01-01. */
export function toDayNumber(d: LocalDate): number {
  const { y, m, d: day } = parseDate(d)
  return Math.round(Date.UTC(y, m - 1, day) / DAY_MS)
}

export function fromDayNumber(n: number): LocalDate {
  const dt = new Date(n * DAY_MS)
  return makeDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

export function addDays(d: LocalDate, n: number): LocalDate {
  return fromDayNumber(toDayNumber(d) + n)
}

/** Days from a to b (b − a). */
export function diffDays(a: LocalDate, b: LocalDate): number {
  return toDayNumber(b) - toDayNumber(a)
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Same day N months later; the day is clamped to the end of the month (31 Jan + 1 → 28/29 Feb). */
export function addMonthsClamped(d: LocalDate, n: number): LocalDate {
  const { y, m, d: day } = parseDate(d)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return makeDate(ny, nm, Math.min(day, daysInMonth(ny, nm)))
}

/** Today's date at the gym. */
export function todayAtGym(now: Date = new Date()): LocalDate {
  return dateAtGym(now)
}

export function dateAtGym(instant: Date | number): LocalDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: GYM_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(instant))
  return parts
}

/** "08:15" at the gym. */
export function timeAtGym(instant: Date | number): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: GYM_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(instant))
}

/** Day of week, 0 = Monday … 6 = Sunday. */
export function weekdayMon0(d: LocalDate): number {
  return (new Date(toDayNumber(d) * DAY_MS).getUTCDay() + 6) % 7
}

/** "8 Oct" */
export function formatDayMonth(d: LocalDate): string {
  const { m, d: day } = parseDate(d)
  return `${day} ${MONTHS[m - 1]}`
}

/** "8 Oct 2026" */
export function formatFull(d: LocalDate): string {
  const { y, m, d: day } = parseDate(d)
  return `${day} ${MONTHS[m - 1]} ${y}`
}

/** "8 Oct", or "9 Jan 2027" when the year differs from today's. */
export function formatSmart(d: LocalDate, today: LocalDate): string {
  return parseDate(d).y === parseDate(today).y ? formatDayMonth(d) : formatFull(d)
}

/** "Thu 1 Oct 2026" */
export function formatWeekdayFull(d: LocalDate): string {
  const dow = new Date(toDayNumber(d) * DAY_MS).getUTCDay()
  return `${WEEKDAYS[dow]} ${formatFull(d)}`
}

/** "October 2026" */
export function formatMonthYear(y: number, m: number): string {
  return `${MONTHS_LONG[m - 1]} ${y}`
}

/** "May 2026" */
export function formatMonthShortYear(d: LocalDate): string {
  const { y, m } = parseDate(d)
  return `${MONTHS[m - 1]} ${y}`
}
