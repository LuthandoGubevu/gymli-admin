/** Runs the shared business-rule vectors (also run by the C# check-in app). */
import { describe, expect, it } from 'vitest'
import vectors from '../../../../shared/test-vectors/access-rules.json'
import { defaultStartDate, deniedText, evaluateAccess, periodEnd, type PeriodKind } from '../../src/lib/access'
import { dateAtGym } from '../../src/lib/dates'

type Raw = string[]
const toPeriods = (raw: Raw[]) => raw.map(([start, end, flag]) => ({ start, end, deleted: flag === 'deleted' }))

describe('periodEnd', () => {
  for (const v of vectors.periodEnd) {
    it(v.name, () => expect(periodEnd(v.kind as PeriodKind, v.qty, v.start)).toBe(v.end))
  }
})

describe('evaluateAccess', () => {
  for (const v of vectors.access) {
    it(v.name, () => {
      const d = evaluateAccess(toPeriods(v.periods as Raw[]), v.today)
      expect(d.allowed).toBe(v.allowed)
      if (d.allowed) {
        expect(d.paidUntil).toBe(v.paidUntil)
        expect(d.daysLeft).toBe(v.daysLeft)
      } else {
        expect(d.reason).toBe(v.reason)
        expect(d.date).toBe(v.date)
        expect(deniedText(d.reason, d.date, v.today)).toBe(v.text)
      }
    })
  }
})

describe('defaultStartDate', () => {
  for (const v of vectors.defaultStart) {
    it(v.name, () => expect(defaultStartDate(toPeriods(v.periods as Raw[]), v.today)).toBe(v.start))
  }
})

describe('date at the gym (Africa/Johannesburg)', () => {
  for (const v of vectors.gymDate) {
    it(v.name, () => expect(dateAtGym(new Date(v.instantUtc))).toBe(v.date))
  }
})
