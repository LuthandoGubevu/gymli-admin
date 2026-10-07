import { Wallet } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useGym, useStaff, useToday } from '../data/store'
import { formatRand, paymentRows, totals } from '../lib/accounts'
import { formatDayMonth } from '../lib/dates'
import { initials, memberCode, PAYMENT_METHOD_LABEL, PAYMENT_METHODS } from '../lib/types'
import { Avatar, Button, Card, CardTitle, CountBadge, EmptyState, SkeletonRows } from './ui'

/**
 * Today's payments: amount, how long, how they paid. Managers see the whole branch;
 * front desk see the payments they logged themselves (their till).
 */
export function PaymentsToday() {
  const staff = useStaff()
  const today = useToday()
  const { members } = useGym()
  const isManager = staff.role === 'manager'
  const rows = useMemo(
    () => paymentRows(members.data).filter((r) => r.date === today && (isManager || r.loggedBy.uid === staff.uid)),
    [members.data, today, isManager, staff.uid],
  )
  const t = totals(rows)

  return (
    <Card className="p-28 max-md:p-18">
      <div className="mb-16 flex flex-wrap items-center gap-14">
        <CardTitle>{isManager ? 'Payments today' : 'Your payments today'}</CardTitle>
        <CountBadge tone="green">{t.count}</CountBadge>
        <div className="flex-1" />
        {isManager && (
          <Button variant="ghost" to="/accounts" className="border-line-10 max-md:hidden">
            Open Accounts
          </Button>
        )}
      </div>
      {members.loading ? (
        <SkeletonRows rows={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon={Wallet} title="No payments yet today">
          Payments show here as soon as they are logged.
        </EmptyState>
      ) : (
        <div className="grid grid-cols-[minmax(0,280px)_minmax(0,1fr)] gap-28 max-lg:grid-cols-1 max-lg:gap-16">
          <div className="flex flex-col gap-12">
            <div>
              <div className="text-13 text-muted">Received today</div>
              <div className="text-48 leading-90 font-extrabold stretch-66 tabular" data-testid="today-total">{formatRand(t.cents)}</div>
              {t.withoutAmount > 0 && <div className="mt-4 text-12 text-muted">{t.withoutAmount} without an amount</div>}
            </div>
            <div className="grid grid-cols-2 gap-8">
              {PAYMENT_METHODS.map((m) => (
                <div key={m} className="rounded-tile bg-field px-14 py-10">
                  <div className="text-12 text-muted">{PAYMENT_METHOD_LABEL[m]}</div>
                  <div className="text-16 font-bold tabular">{formatRand(t.byMethod[m].cents)}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="max-h-360 overflow-auto">
            {rows.map((r) => (
              <Link key={r.id} to={`/members/${r.memberId}`} className="flex items-center gap-14 border-t border-line-6 py-12 first:border-t-0 hover:bg-white">
                <span className="w-48 shrink-0 text-14 font-semibold tabular">{r.time}</span>
                <Avatar text={initials(r.memberName)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-16 font-semibold">
                    {r.memberName} <span className="font-normal text-muted">· {memberCode(r.memberNumber)}</span>
                  </div>
                  <div className="mt-2 truncate text-13 text-muted tabular">
                    {r.length} · {formatDayMonth(r.start)} → {formatDayMonth(r.end)} · {r.method ? PAYMENT_METHOD_LABEL[r.method] : 'Method not recorded'}
                    {isManager && ` · ${r.loggedBy.name.split(' ')[0]}`}
                  </div>
                </div>
                <span className="text-17 font-bold tabular">{r.amountCents === null ? '—' : formatRand(r.amountCents)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
