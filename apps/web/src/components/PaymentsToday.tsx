import { Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useGym, useStaff, useToday } from '../data/store'
import { formatRand, paymentRows, totals } from '../lib/accounts'
import { formatDayMonth } from '../lib/dates'
import { initials, memberCode, PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from '../lib/types'
import { Avatar, Button, Card, CardTitle, EmptyState, SkeletonRows } from './ui'

const LATEST = 20

/**
 * Account summary: today's takings by method, then the latest payments.
 * Managers see the whole branch; front desk see the payments they logged themselves today (their till).
 */
export function PaymentsToday() {
  const staff = useStaff()
  const today = useToday()
  const { members } = useGym()
  const isManager = staff.role === 'manager'
  const all = useMemo(() => paymentRows(members.data), [members.data])
  const todays = useMemo(() => all.filter((r) => r.date === today && (isManager || r.loggedBy.uid === staff.uid)), [all, today, isManager, staff.uid])
  const latest = (isManager ? all : todays).slice(0, LATEST)
  const t = totals(todays)

  return (
    <Card className="p-28 max-md:p-18">
      <div className="mb-16 flex flex-wrap items-center gap-14">
        <CardTitle>Account summary</CardTitle>
        <div className="flex-1" />
        {isManager && (
          <Button variant="ghost" to="/accounts" className="border-line-10 max-md:hidden">
            Open Accounts
          </Button>
        )}
      </div>
      {members.loading ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          <div className="grid grid-cols-5 gap-8 max-lg:grid-cols-3 max-md:grid-cols-2">
            <div className="rounded-tile bg-ink px-16 py-12 text-white max-lg:col-span-3 max-md:col-span-2">
              <div className="flex items-center gap-8 text-12 text-on-ink-soft">
                {isManager ? 'Received today' : 'You took today'} · {t.count} payment{t.count === 1 ? '' : 's'}
              </div>
              <div className="text-32 leading-none font-extrabold stretch-66 tabular" data-testid="today-total">
                {formatRand(t.cents)}
              </div>
              {t.withoutAmount > 0 && <div className="mt-2 text-12 text-on-ink-soft">{t.withoutAmount} without an amount</div>}
            </div>
            {PAYMENT_METHODS.map((m) => (
              <div key={m} className="rounded-tile bg-field px-16 py-12">
                <div className="text-12 text-muted">{PAYMENT_METHOD_LABEL[m]}</div>
                <div className="text-20 font-bold tabular">{formatRand(t.byMethod[m].cents)}</div>
              </div>
            ))}
          </div>

          <div className="mt-22 mb-4 text-14 font-semibold text-ink-2">{isManager ? 'Latest payments' : 'Your payments today'}</div>
          {latest.length === 0 ? (
            <EmptyState icon={Wallet} title="No payments yet today">
              Payments show here as soon as they are logged.
            </EmptyState>
          ) : (
            <div>
              {latest.map((r) => (
                <Link key={r.id} to={`/members/${r.memberId}`} className="flex items-center gap-14 border-t border-line-6 py-10 hover:bg-white max-md:gap-10">
                  <span className="w-56 shrink-0 text-14 font-semibold tabular max-md:w-48 max-md:text-13">{r.date === today ? r.time : formatDayMonth(r.date)}</span>
                  <Avatar text={initials(r.memberName)} size={40} className="max-md:hidden" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-15 font-semibold">
                      {r.memberName} <span className="font-normal text-muted">· {memberCode(r.memberNumber)}</span>
                    </div>
                    <div className="mt-2 truncate text-13 text-muted tabular">
                      {r.length} · {formatDayMonth(r.start)} → {formatDayMonth(r.end)} · {r.method ? PAYMENT_METHOD_LABEL[r.method] : 'Method not recorded'}
                      {isManager && ` · ${r.loggedBy.name.split(' ')[0]}`}
                    </div>
                  </div>
                  <span className="text-16 font-bold tabular">{r.amountCents === null ? '—' : formatRand(r.amountCents)}</span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  )
}
