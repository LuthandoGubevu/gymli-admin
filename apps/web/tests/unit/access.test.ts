import { describe, expect, it } from 'vitest'
import { deniedText, memberStatus, periodEnd, periodLabel, periodLength } from '../../src/lib/access'
import { addMonthsClamped, formatSmart, weekdayMon0 } from '../../src/lib/dates'

describe('periodEnd input checks', () => {
  it('rejects zero or negative quantities', () => {
    expect(() => periodEnd('months', 0, '2026-10-01')).toThrow()
    expect(() => periodEnd('days', -3, '2026-10-01')).toThrow()
    expect(() => periodEnd('days', 1.5, '2026-10-01')).toThrow()
  })
})

describe('periodLength', () => {
  it('counts both ends', () => {
    expect(periodLength('2026-10-08', '2027-01-07')).toBe(92) // design: 92 days
    expect(periodLength('2026-10-08', '2026-10-08')).toBe(1)
  })
})

describe('memberStatus', () => {
  const today = '2026-10-01'
  it('paid up with more than 6 days left', () => {
    expect(memberStatus([{ start: '2026-09-21', end: '2026-10-20' }], today).status).toBe('paid')
  })
  it('ending this week with 6 days or less', () => {
    expect(memberStatus([{ start: '2026-09-08', end: '2026-10-07' }], today).status).toBe('ending')
    expect(memberStatus([{ start: '2026-09-02', end: '2026-10-01' }], today)).toMatchObject({ status: 'ending', daysLeft: 0 })
  })
  it('locked out after the end date', () => {
    expect(memberStatus([{ start: '2026-09-01', end: '2026-09-30' }], today)).toMatchObject({ status: 'locked', endedOn: '2026-09-30' })
  })
  it('future when only a later period exists', () => {
    expect(memberStatus([{ start: '2026-10-05', end: '2026-11-04' }], today)).toMatchObject({ status: 'future', startsOn: '2026-10-05' })
  })
  it('none when never paid', () => {
    expect(memberStatus([], today).status).toBe('none')
  })
})

describe('labels', () => {
  it('period labels', () => {
    expect(periodLabel('day', 1)).toBe('Day pass')
    expect(periodLabel('months', 1)).toBe('1 month')
    expect(periodLabel('months', 3)).toBe('3 months')
    expect(periodLabel('days', 10)).toBe('10 days')
  })
  it('fingerprint not recognised', () => {
    expect(deniedText('not_recognised', null, '2026-10-01')).toBe('Fingerprint not recognised')
  })
})

describe('date helpers', () => {
  it('clamps months', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonthsClamped('2026-12-15', 1)).toBe('2027-01-15')
  })
  it('weekday, Monday first', () => {
    expect(weekdayMon0('2026-10-01')).toBe(3) // Thursday
    expect(weekdayMon0('2026-09-28')).toBe(0) // Monday
  })
  it('shows the year only when it differs', () => {
    expect(formatSmart('2026-10-20', '2026-10-01')).toBe('20 Oct')
    expect(formatSmart('2027-01-09', '2026-10-01')).toBe('9 Jan 2027')
  })
})
