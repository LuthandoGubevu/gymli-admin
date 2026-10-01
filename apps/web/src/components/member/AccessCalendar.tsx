import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { livePeriods } from '../../lib/access'
import { addDays, formatMonthYear, makeDate, parseDate, weekdayMon0, daysInMonth, type LocalDate } from '../../lib/dates'
import type { DoorLog, Period } from '../../lib/types'
import { Button, cx, IconButton } from '../ui'

interface Props {
  periods: Period[]
  logs: DoorLog[]
  today: LocalDate
  compact?: boolean
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Design 03 / 07: month grid with paid days, today, let-in and denied scans. */
export function AccessCalendar({ periods, logs, today, compact }: Props) {
  const t = parseDate(today)
  const [month, setMonth] = useState({ y: t.y, m: t.m })

  const live = useMemo(() => livePeriods(periods), [periods])
  const scansByDay = useMemo(() => {
    const map = new Map<LocalDate, DoorLog[]>()
    for (const l of logs) map.set(l.date, [...(map.get(l.date) ?? []), l])
    return map
  }, [logs])

  const first = makeDate(month.y, month.m, 1)
  const last = makeDate(month.y, month.m, daysInMonth(month.y, month.m))
  const gridStart = addDays(first, -weekdayMon0(first))
  const gridEnd = addDays(last, 6 - weekdayMon0(last))
  const days: LocalDate[] = []
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d)

  const shift = (n: number) => setMonth(({ y, m }) => {
    const total = y * 12 + (m - 1) + n
    return { y: Math.floor(total / 12), m: (total % 12) + 1 }
  })
  const isThisMonth = month.y === t.y && month.m === t.m

  return (
    <div>
      <div className={cx('flex gap-12', compact ? 'items-center gap-8' : 'items-end')}>
        <div className="min-w-0 flex-1">
          <div className={cx('font-medium text-muted', compact ? 'text-12' : 'text-14')}>Access calendar</div>
          <div className={cx('font-extrabold stretch-66', compact ? 'mt-4 text-30 leading-none' : 'mt-6 text-56 leading-95 tracking-tighter max-md:text-30')}>
            {formatMonthYear(month.y, month.m)}
          </div>
        </div>
        {!compact && (
          <Button variant="ghost" size="md" onClick={() => setMonth({ y: t.y, m: t.m })} disabled={isThisMonth} className="disabled:opacity-60">
            Today
          </Button>
        )}
        <IconButton icon={ChevronLeft} label="Previous month" size={44} className="border-line-12" onClick={() => shift(-1)} />
        <IconButton icon={ChevronRight} label="Next month" size={44} variant="ink" onClick={() => shift(1)} />
      </div>

      {!compact && <Legend />}

      <div className={cx('grid grid-cols-7', compact ? 'mt-14 gap-5' : 'gap-10')}>
        {WEEK.map((w) => (
          <div key={w} className={cx('text-muted', compact ? 'text-center text-11' : 'pl-6 text-13 font-medium')}>
            {compact ? w[0] : w}
          </div>
        ))}
        {days.map((d) => {
          const inMonth = d >= first && d <= last
          const paid = live.some((p) => p.start <= d && d <= p.end)
          const isToday = d === today
          const past = d < today
          const scans = scansByDay.get(d) ?? []
          const allowed = scans.filter((s) => s.result === 'allowed').length
          const denied = scans.length - allowed
          const state = paid ? (past ? 'paid-past' : 'paid') : inMonth ? 'open' : 'outside'
          return (
            <div
              key={d}
              data-day={d}
              data-state={state}
              aria-label={`${d}${paid ? ', paid' : ''}${allowed ? `, ${allowed} let in` : ''}${denied ? `, ${denied} denied` : ''}`}
              className={cx(
                'flex flex-col justify-between border',
                compact ? 'h-46 rounded-day-sm px-6 py-5' : 'h-92 rounded-day px-14 py-12 max-lg:h-72 max-lg:px-10',
                state === 'paid' && 'border-transparent bg-green text-ink',
                state === 'paid-past' && 'border-transparent bg-green-past text-ink-past',
                state === 'open' && 'border-line-7 bg-glass-day text-ink',
                state === 'outside' && 'border-transparent text-faint-2',
                isToday && (compact ? 'outline-3 outline-offset-2 outline-ink' : 'outline-3 outline-offset-3 outline-ink'),
              )}
            >
              <div className={cx('leading-none font-extrabold tabular', compact ? 'text-15 stretch-72' : 'text-26 stretch-70')}>{parseDate(d).d}</div>
              <div className={cx('flex', compact ? 'h-8 gap-2' : 'h-12 gap-4')}>
                {scans.slice(0, compact ? 2 : 4).map((s) => (
                  <span
                    key={s.id}
                    className={cx(
                      'rounded-full border-white',
                      compact ? 'size-8 border-thick' : 'size-12 border-2',
                      s.result === 'allowed' ? 'bg-green-deep' : 'bg-red-dot',
                    )}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {compact && (
        <div className="mt-14 flex flex-wrap gap-14 text-12 text-ink-2">
          <span className="flex items-center gap-6"><span className="size-12 rounded-legend-sm bg-green" />Paid</span>
          <span className="flex items-center gap-6"><span className="size-8 rounded-full bg-green-deep" />Let in</span>
          <span className="flex items-center gap-6"><span className="size-8 rounded-full bg-red-dot" />Denied</span>
        </div>
      )}
    </div>
  )
}

function Legend() {
  return (
    <div className="mt-18 mb-20 flex flex-wrap gap-20 text-13 font-medium text-ink-2">
      <span className="flex items-center gap-8"><span className="size-18 rounded-legend bg-green" />Paid</span>
      <span className="flex items-center gap-8"><span className="size-14 rounded-legend-md outline-legend" />Today</span>
      <span className="flex items-center gap-8"><span className="size-10 rounded-full border-2 border-white bg-green-deep shadow-ring" />Let in</span>
      <span className="flex items-center gap-8"><span className="size-10 rounded-full border-2 border-white bg-red-dot shadow-ring" />Denied</span>
    </div>
  )
}
