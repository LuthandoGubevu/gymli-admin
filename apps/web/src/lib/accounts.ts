/**
 * Money and reports for the Accounts section. Pure functions over members (payments live
 * in each member's periods) and door logs, so they are easy to test.
 */
import { paidUntil, periodLabel, type PeriodKind } from './access'
import { addDays, dateAtGym, diffDays, timeAtGym, weekdayMon0, type LocalDate } from './dates'
import { PAYMENT_METHODS, type Actor, type Branch, type DoorLog, type Member, type PaymentMethod, type Period, type PriceKey, type Prices } from './types'

/* ---------------- Rands ---------------- */

/** Cents → "R1 234" or "R1 234,50" (South African style: space for thousands, comma for cents). */
export function formatRand(cents: number): string {
  const neg = cents < 0
  const abs = Math.abs(Math.round(cents))
  const rands = Math.floor(abs / 100)
  const c = abs % 100
  const whole = String(rands).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return `${neg ? '−' : ''}R${whole}${c ? ',' + String(c).padStart(2, '0') : ''}`
}

/** "450", "450.50", "R 1 200,00" → cents; null when empty or not a number. */
export function parseRand(text: string): number | null {
  const t = text.replace(/[R\s ]/gi, '').replace(',', '.')
  if (!t) return null
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null
  return Math.round(parseFloat(t) * 100)
}

/** Which price-list entry a payment length uses; custom lengths have none. */
export function priceKey(kind: PeriodKind, qty: number): PriceKey | null {
  if (kind === 'day') return 'day'
  if (kind === 'months' && [1, 3, 6, 12].includes(qty)) return `m${qty}` as PriceKey
  return null
}

export function priceFor(prices: Prices | undefined, kind: PeriodKind, qty: number): number | null {
  const k = priceKey(kind, qty)
  return k ? (prices?.[k] ?? null) : null
}

export const PRICE_LABEL: Record<PriceKey, string> = { day: 'Day pass', m1: '1 month', m3: '3 months', m6: '6 months', m12: '12 months' }
export const PRICE_KEYS: PriceKey[] = ['day', 'm1', 'm3', 'm6', 'm12']

/* ---------------- Payments ---------------- */

export interface PaymentRow {
  id: string
  memberId: string
  memberName: string
  memberNumber: number
  branchId: string | null
  /** Day the payment was logged, at the gym */
  date: LocalDate
  time: string
  loggedAt: number
  loggedBy: Actor
  kind: PeriodKind
  qty: number
  length: string
  start: LocalDate
  end: LocalDate
  method: PaymentMethod | null
  amountCents: number | null
  /** The member's first payment (a new member), else a renewal */
  isNew: boolean
}

/** Every payment (not deleted) of these members, newest first. */
export function paymentRows(members: readonly Member[]): PaymentRow[] {
  const rows: PaymentRow[] = []
  for (const m of members) {
    const live = m.periods.filter((p) => !p.deleted)
    const firstAt = Math.min(...live.map((p) => p.loggedAt))
    for (const p of live) rows.push(toRow(m, p, p.loggedAt === firstAt))
  }
  return rows.sort((a, b) => b.loggedAt - a.loggedAt)
}

function toRow(m: Member, p: Period, isNew: boolean): PaymentRow {
  return {
    id: p.id,
    memberId: m.id,
    memberName: `${m.firstName} ${m.lastName}`.trim(),
    memberNumber: m.number,
    branchId: m.branchId,
    date: dateAtGym(p.loggedAt),
    time: timeAtGym(p.loggedAt),
    loggedAt: p.loggedAt,
    loggedBy: p.loggedBy,
    kind: p.kind,
    qty: p.qty,
    length: periodLabel(p.kind, p.qty),
    start: p.start,
    end: p.end,
    method: p.method ?? null,
    amountCents: typeof p.amountCents === 'number' ? p.amountCents : null,
    isNew,
  }
}

/** Payments logged from `from` to `to` (both included, gym dates). */
export const inRange = (rows: readonly PaymentRow[], from: LocalDate, to: LocalDate) => rows.filter((r) => r.date >= from && r.date <= to)

export type MethodKey = PaymentMethod | 'unknown'
export interface Totals {
  count: number
  cents: number
  /** Payments with no amount recorded (older or imported) */
  withoutAmount: number
  byMethod: Record<MethodKey, { count: number; cents: number }>
  newMembers: number
  renewals: number
}

const emptyByMethod = (): Totals['byMethod'] =>
  Object.fromEntries([...PAYMENT_METHODS, 'unknown'].map((k) => [k, { count: 0, cents: 0 }])) as Totals['byMethod']

export function totals(rows: readonly PaymentRow[]): Totals {
  const t: Totals = { count: 0, cents: 0, withoutAmount: 0, byMethod: emptyByMethod(), newMembers: 0, renewals: 0 }
  for (const r of rows) {
    const k: MethodKey = r.method ?? 'unknown'
    t.count++
    t.byMethod[k].count++
    if (r.amountCents === null) t.withoutAmount++
    else {
      t.cents += r.amountCents
      t.byMethod[k].cents += r.amountCents
    }
    if (r.isNew) t.newMembers++
    else t.renewals++
  }
  return t
}

/* ---------------- Daily cash-up ---------------- */

export interface CashUpRow {
  date: LocalDate
  staff: Actor
  byMethod: Record<MethodKey, number>
  count: number
  total: number
}

/** One row per day and staff member: what they took, by method. Newest day first. */
export function cashUp(rows: readonly PaymentRow[]): CashUpRow[] {
  const map = new Map<string, CashUpRow>()
  for (const r of rows) {
    const key = `${r.date}|${r.loggedBy.uid}`
    let row = map.get(key)
    if (!row) {
      row = { date: r.date, staff: r.loggedBy, byMethod: { cash: 0, card: 0, eft: 0, debit_order: 0, unknown: 0 }, count: 0, total: 0 }
      map.set(key, row)
    }
    row.count++
    const c = r.amountCents ?? 0
    row.byMethod[r.method ?? 'unknown'] += c
    row.total += c
  }
  return [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.staff.name.localeCompare(b.staff.name))
}

/* ---------------- Branch comparison ---------------- */

export interface BranchSummary {
  branch: Branch
  cents: number
  payments: number
  newMembers: number
  renewals: number
  /** Members who may enter today */
  active: number
  members: number
}

export function branchSummary(members: readonly Member[], branches: readonly Branch[], from: LocalDate, to: LocalDate, today: LocalDate): BranchSummary[] {
  return branches.map((branch) => {
    const mine = members.filter((m) => m.branchId === branch.id && !m.deleted)
    const t = totals(inRange(paymentRows(mine), from, to))
    return {
      branch,
      cents: t.cents,
      payments: t.count,
      newMembers: t.newMembers,
      renewals: t.renewals,
      active: mine.filter((m) => paidUntil(m.periods, today) !== null).length,
      members: mine.length,
    }
  })
}

/* ---------------- Renewals due ---------------- */

export interface RenewalDue {
  member: Member
  paidUntil: LocalDate
  daysLeft: number
  /** Their most recent payment, used to guess the renewal */
  last: Period | null
  expectedCents: number | null
}

/** Members with access today whose paid-until falls within the next `days` days, soonest first. */
export function renewalsDue(members: readonly Member[], today: LocalDate, days: number, pricesByBranch: Record<string, Prices>): RenewalDue[] {
  const until = addDays(today, days)
  const out: RenewalDue[] = []
  for (const m of members) {
    if (m.deleted) continue
    const end = paidUntil(m.periods, today)
    if (!end || end > until) continue
    const live = m.periods.filter((p) => !p.deleted).sort((a, b) => b.loggedAt - a.loggedAt)
    const last = live[0] ?? null
    const listed = last ? priceFor(pricesByBranch[m.branchId ?? ''], last.kind, last.qty) : null
    out.push({ member: m, paidUntil: end, daysLeft: diffDays(today, end), last, expectedCents: listed ?? last?.amountCents ?? null })
  }
  return out.sort((a, b) => a.paidUntil.localeCompare(b.paidUntil) || a.member.firstName.localeCompare(b.member.firstName))
}

/* ---------------- Busiest hours ---------------- */

/** Check-ins (allowed scans) by weekday (0 = Monday) × hour (0–23). */
export function hourHeatmap(logs: readonly DoorLog[]): number[][] {
  const grid = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  for (const l of logs) {
    if (l.result !== 'allowed') continue
    const hour = Number(timeAtGym(l.at).slice(0, 2))
    grid[weekdayMon0(l.date)][hour]++
  }
  return grid
}
