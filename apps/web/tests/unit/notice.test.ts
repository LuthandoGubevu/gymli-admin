import { describe, expect, it } from 'vitest'
import { formatLong, noticeText, PAYMENT_NOTICE, shouldShow } from '../../src/lib/notice'
import { todayAtGym } from '../../src/lib/dates'

const H = 3_600_000

describe('payment notice', () => {
  it('shows when never closed, and again only after the set hours', () => {
    const now = Date.UTC(2026, 10, 10, 10)
    expect(shouldShow(now, null, 3)).toBe(true)
    expect(shouldShow(now, now - (3 * H - 60_000), 3)).toBe(false) // closed 2 h 59 min ago
    expect(shouldShow(now, now - 3 * H, 3)).toBe(true)
  })

  it('says the due date in full', () => {
    expect(formatLong('2026-11-15')).toBe('Sunday 15 November 2026')
  })

  it('warns before and on the due date, says overdue after it', () => {
    expect(noticeText('2026-11-10', '2026-11-15', 'INV-2026-004')).toEqual({
      label: 'Due Sunday 15 November',
      text: 'Invoice INV-2026-004 has not been paid. If payment is not received by Sunday 15 November 2026, the Gymli system will be stopped.',
    })
    expect(noticeText('2026-11-15', '2026-11-15').label).toBe('Due Sunday 15 November')
    expect(noticeText('2026-11-16', '2026-11-15')).toEqual({
      label: 'Overdue',
      text: 'Invoice INV-2026-004 is overdue. Payment was due by Sunday 15 November 2026. The Gymli system will be stopped.',
    })
  })

  it('turns overdue at midnight in Johannesburg, not UTC', () => {
    // 22:30 UTC on 15 Nov is already 00:30 on 16 Nov in Johannesburg
    expect(noticeText(todayAtGym(new Date(Date.UTC(2026, 10, 15, 22, 30))), PAYMENT_NOTICE.dueDate).label).toBe('Overdue')
    expect(noticeText(todayAtGym(new Date(Date.UTC(2026, 10, 15, 21, 30))), PAYMENT_NOTICE.dueDate).label).toBe('Due Sunday 15 November')
  })
})
