import { describe, expect, it } from 'vitest'
import { branchSummary, cashUp, formatRand, hourHeatmap, inRange, parseRand, paymentRows, priceFor, renewalsDue, totals } from '../../src/lib/accounts'
import type { DoorLog, Member, Period } from '../../src/lib/types'

const at = (date: string, hhmm: string) => Date.parse(`${date}T${hhmm}:00+02:00`)
const zodwa = { uid: 'z', name: 'Zodwa' }
const sipho = { uid: 's', name: 'Sipho' }
const pay = (id: string, date: string, extra: Partial<Period> = {}): Period => ({
  id, kind: 'months', qty: 1, start: date, end: date, loggedBy: zodwa, loggedAt: at(date, '09:00'), method: 'cash', amountCents: 45000, ...extra,
})
const member = (id: string, branchId: string, periods: Period[]): Member => ({
  id, number: 1000 + Number(id.replace(/\D/g, '') || 0), firstName: id, lastName: 'X', cellphone: '', periods, fingerprint: null, createdAt: 0, deleted: false, branchId,
})

describe('formatRand / parseRand', () => {
  it('formats cents the South African way', () => {
    expect(formatRand(45000)).toBe('R450')
    expect(formatRand(123450)).toBe('R1 234,50')
    expect(formatRand(0)).toBe('R0')
  })
  it('reads what staff type', () => {
    expect(parseRand('450')).toBe(45000)
    expect(parseRand('R 1 200,50')).toBe(120050)
    expect(parseRand('99.9')).toBe(9990)
    expect(parseRand('')).toBeNull()
    expect(parseRand('abc')).toBeNull()
    expect(parseRand('1.234')).toBeNull()
  })
})

describe('price list', () => {
  const prices = { day: 8000, m1: 45000, m12: 400000 }
  it('finds the price for standard lengths only', () => {
    expect(priceFor(prices, 'day', 1)).toBe(8000)
    expect(priceFor(prices, 'months', 12)).toBe(400000)
    expect(priceFor(prices, 'months', 3)).toBeNull()
    expect(priceFor(prices, 'days', 10)).toBeNull()
    expect(priceFor(prices, 'months', 2)).toBeNull()
  })
})

describe('payments and totals', () => {
  const members = [
    member('m1', 'b1', [pay('a', '2026-09-01'), pay('b', '2026-10-01', { method: 'card', amountCents: 50000 })]),
    member('m2', 'b1', [pay('c', '2026-10-02', { method: 'eft' }), pay('d', '2026-10-03', { deleted: true })]),
    member('m3', 'b2', [pay('e', '2026-10-05', { amountCents: undefined, method: undefined, loggedBy: sipho })]),
  ]

  it('lists payments newest first, without deleted ones, and marks first payments as new', () => {
    const rows = paymentRows(members)
    expect(rows.map((r) => r.id)).toEqual(['e', 'c', 'b', 'a'])
    expect(rows.find((r) => r.id === 'a')!.isNew).toBe(true)
    expect(rows.find((r) => r.id === 'b')!.isNew).toBe(false)
  })

  it('filters by the day the payment was logged, both ends included', () => {
    const rows = paymentRows(members)
    expect(inRange(rows, '2026-10-01', '2026-10-02').map((r) => r.id)).toEqual(['c', 'b'])
  })

  it('uses the gym day: 23:30 on the 1st is the 1st, not the 2nd', () => {
    const late = paymentRows([member('m9', 'b1', [pay('x', '2026-10-01', { loggedAt: at('2026-10-01', '23:30') })])])
    expect(late[0].date).toBe('2026-10-01')
  })

  it('totals by method; payments without an amount are counted but not summed', () => {
    const t = totals(inRange(paymentRows(members), '2026-10-01', '2026-10-31'))
    expect(t.count).toBe(3)
    expect(t.cents).toBe(50000 + 45000)
    expect(t.withoutAmount).toBe(1)
    expect(t.byMethod.card.cents).toBe(50000)
    expect(t.byMethod.eft.count).toBe(1)
    expect(t.byMethod.unknown.count).toBe(1)
    expect(t.newMembers).toBe(2)
    expect(t.renewals).toBe(1)
  })

  it('cash-up groups by day and staff member', () => {
    const rows = cashUp(paymentRows(members))
    expect(rows[0]).toMatchObject({ date: '2026-10-05', staff: sipho, total: 0, count: 1 })
    const oct1 = rows.find((r) => r.date === '2026-10-01')!
    expect(oct1.byMethod.card).toBe(50000)
    expect(oct1.total).toBe(50000)
  })

  it('compares branches over the range', () => {
    const branches = [{ id: 'b1', name: 'Sandton', prices: {} }, { id: 'b2', name: 'Soweto', prices: {} }]
    const s = branchSummary(members, branches, '2026-10-01', '2026-10-31', '2026-10-15')
    expect(s[0]).toMatchObject({ cents: 95000, payments: 2, members: 2 })
    expect(s[1]).toMatchObject({ cents: 0, payments: 1, members: 1 })
  })
})

describe('renewals due', () => {
  it('lists members whose access ends within the window, with the expected amount', () => {
    const today = '2026-10-10'
    const ms = [
      member('m1', 'b1', [pay('a', '2026-10-01', { start: '2026-10-01', end: '2026-10-12' })]),
      member('m2', 'b1', [pay('b', '2026-10-01', { start: '2026-10-01', end: '2026-12-31' })]),
      member('m3', 'b1', [pay('c', '2026-09-01', { start: '2026-09-01', end: '2026-10-05' })]),
      member('m4', 'b1', [pay('d', '2026-10-01', { kind: 'months', qty: 3, start: '2026-10-01', end: '2026-10-15', amountCents: 99000 })]),
    ]
    const due = renewalsDue(ms, today, 7, { b1: { m1: 47000 } })
    expect(due.map((d) => d.member.id)).toEqual(['m1', 'm4'])
    expect(due[0]).toMatchObject({ paidUntil: '2026-10-12', daysLeft: 2, expectedCents: 47000 })
    // no list price for 3 months: falls back to what they paid last time
    expect(due[1].expectedCents).toBe(99000)
  })
})

describe('busiest hours', () => {
  it('counts allowed scans by weekday and hour at the gym', () => {
    const log = (date: string, hhmm: string, result: 'allowed' | 'denied' = 'allowed') => ({ at: at(date, hhmm), date, result }) as DoorLog
    // 2026-10-05 is a Monday
    const grid = hourHeatmap([log('2026-10-05', '06:10'), log('2026-10-05', '06:50'), log('2026-10-05', '06:20', 'denied'), log('2026-10-11', '17:05')])
    expect(grid[0][6]).toBe(2)
    expect(grid[6][17]).toBe(1)
  })
})
