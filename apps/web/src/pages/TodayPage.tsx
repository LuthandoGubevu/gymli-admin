import { ArrowUpRight, Check, Ellipsis, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { LogPaymentModal } from '../components/member/LogPaymentModal'
import { MemberPicker } from '../components/member/MemberPicker'
import { Avatar, Button, Card, CardTitle, CountBadge, cx, Dot, EmptyState, ErrorNote, IconButton, PageHeader, SkeletonRows } from '../components/ui'
import { useGym, useToday } from '../data/store'
import { URGENT_DAYS } from '../lib/access'
import { addDays, diffDays, formatDayMonth, formatWeekdayFull, timeAtGym } from '../lib/dates'
import { daysAgoText, viewMember, type MemberView } from '../lib/present'
import { initials, memberName, type DoorLog, type Member } from '../lib/types'

export function TodayPage() {
  const today = useToday()
  const navigate = useNavigate()
  const { members, todayLogs } = useGym()
  const [payFor, setPayFor] = useState<Member | null>(null)
  const [picking, setPicking] = useState(false)

  const views = useMemo(() => members.data.map((m) => viewMember(m, today)), [members.data, today])
  const canEnter = views.filter((v) => v.info.status === 'paid' || v.info.status === 'ending')
  const ending = views.filter((v) => v.info.status === 'ending').sort((a, b) => a.info.daysLeft! - b.info.daysLeft! || a.member.firstName.localeCompare(b.member.firstName))
  const urgent = ending.filter((v) => v.info.daysLeft! <= URGENT_DAYS)
  const locked = views.filter((v) => v.info.status === 'locked').sort((a, b) => (a.info.endedOn! > b.info.endedOn! ? -1 : 1))
  const yesterday = addDays(today, -1)
  const lockedSinceYesterday = locked.filter((v) => v.info.endedOn === yesterday).length

  const logs = todayLogs.data
  const letIn = logs.filter((l) => l.result === 'allowed')
  const denied = logs.filter((l) => l.result === 'denied')
  const notRecognised = denied.filter((l) => l.reason === 'not_recognised').length

  const stats = [
    { dot: 'green' as const, label: 'Can enter today', value: canEnter.length, sub: `of ${members.data.length} members`, to: '/members?filter=paid' },
    { dot: 'yellow' as const, label: 'Ending this week', value: ending.length, sub: `${urgent.length} within ${URGENT_DAYS} days`, to: '/members?filter=ending' },
    { dot: 'red' as const, label: 'Locked out', value: locked.length, sub: `${lockedSinceYesterday} since yesterday`, to: '/members?filter=locked' },
    { dot: 'green' as const, label: 'Let in today', value: letIn.length, sub: letIn[0] ? `Last at ${timeAtGym(letIn[0].at)}` : 'No one yet', to: '/door-log?result=allowed' },
    { dot: 'red' as const, label: 'Denied today', value: denied.length, sub: `${notRecognised} finger${notRecognised === 1 ? '' : 's'} not recognised`, to: '/door-log?result=denied' },
  ]

  const loading = members.loading

  return (
    <>
      <PageHeader
        eyebrow={formatWeekdayFull(today)}
        title="Today at the gym"
        actions={
          <>
            <Button variant="glass" size="lg" iconRight={ArrowUpRight} to="/check-in" className="max-md:hidden">
              Open check-in screen
            </Button>
            <Button size="lg" icon={Plus} onClick={() => setPicking(true)}>
              Log payment
            </Button>
          </>
        }
      />

      {members.error && <ErrorNote>{members.error}</ErrorNote>}

      <div className="grid grid-cols-5 gap-16 max-xl:grid-cols-3 max-md:grid-cols-2 max-md:gap-10">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="glass-card flex flex-col gap-6 px-22 pt-22 pb-24 transition-transform hover:-translate-y-1 max-md:px-16 max-md:pt-16 max-md:pb-18">
            <div className="flex items-center gap-8">
              <Dot tone={s.dot} />
              <span className="flex-1 text-14 font-medium text-ink-3 max-md:text-13">{s.label}</span>
              <span className="flex size-34 items-center justify-center rounded-full border border-line-8 max-md:hidden">
                <ArrowUpRight size={15} />
              </span>
            </div>
            <div className="text-84 leading-95 font-extrabold tracking-tighter stretch-66 tabular max-md:text-56" data-testid={`stat-${s.label}`}>
              {loading ? '–' : s.value}
            </div>
            <div className="text-13 text-muted">{loading ? ' ' : s.sub}</div>
          </Link>
        ))}
      </div>

      <Card className="p-28 max-md:p-18">
        <div className="mb-22 flex flex-wrap items-center gap-14 max-md:mb-16">
          <CardTitle>Ending this week</CardTitle>
          <CountBadge tone="yellow">{ending.length}</CountBadge>
          <div className="ml-6 text-14 text-muted max-md:hidden">Yellow = {URGENT_DAYS} days or less left</div>
          <div className="flex-1" />
          <Button variant="ghost" to="/members?filter=ending" className="border-line-10 max-md:hidden">
            View in Members
          </Button>
          <IconButton icon={Ellipsis} label="More" variant="line" onClick={() => navigate('/members?filter=ending')} />
        </div>
        {loading ? (
          <SkeletonRows rows={2} />
        ) : ending.length === 0 ? (
          <EmptyState title="No one ends this week">Everyone who can enter has more than a week left.</EmptyState>
        ) : (
          <div className="grid grid-cols-6 gap-14 max-xl:grid-cols-3 max-md:grid-cols-2 max-md:gap-10">
            {ending.slice(0, 6).map((v) => (
              <EndingCard key={v.member.id} view={v} onPay={() => setPayFor(v.member)} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 items-stretch gap-16 max-lg:grid-cols-1">
        <Card className="p-28 max-md:p-18">
          <div className="mb-10 flex items-center gap-14">
            <CardTitle>Locked out</CardTitle>
            <CountBadge tone="red">{locked.length}</CountBadge>
            <div className="flex-1" />
            <IconButton icon={Ellipsis} label="See all locked out" to="/members?filter=locked" />
          </div>
          {loading ? (
            <SkeletonRows rows={5} />
          ) : locked.length === 0 ? (
            <EmptyState title="No one is locked out">Every member with a past payment is still paid up.</EmptyState>
          ) : (
            <div>
              {locked.slice(0, 7).map((v) => (
                <div key={v.member.id} className="flex items-center gap-14 border-t border-line-6 py-12">
                  <Avatar text={initials(memberName(v.member))} tone="red" />
                  <Link to={`/members/${v.member.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-16 font-semibold">{memberName(v.member)}</div>
                    <div className="mt-2 text-13 text-muted tabular">
                      Ended {formatDayMonth(v.info.endedOn!)} · {daysAgoText(diffDays(v.info.endedOn!, today))}
                    </div>
                  </Link>
                  <Button size="sm" onClick={() => setPayFor(v.member)}>
                    Log payment
                  </Button>
                </div>
              ))}
              {locked.length > 7 && (
                <Link to="/members?filter=locked" className="block border-t border-line-6 pt-14 text-14 font-semibold underline">
                  See all {locked.length}
                </Link>
              )}
            </div>
          )}
        </Card>

        <Card className="flex flex-col p-28 max-md:p-18">
          <div className="mb-10 flex items-center gap-14">
            <CardTitle>At the turnstile today</CardTitle>
            <div className="flex-1" />
            <div className="text-14 text-muted max-md:hidden">
              {letIn.length} let in · {denied.length} denied
            </div>
            <IconButton icon={ArrowUpRight} label="Open door log" to="/door-log" />
          </div>
          {todayLogs.error && <ErrorNote>{todayLogs.error}</ErrorNote>}
          <div className="-mr-12 h-462 overflow-auto pr-12 max-md:h-auto max-md:max-h-462">
            {todayLogs.loading ? (
              <SkeletonRows rows={5} />
            ) : logs.length === 0 ? (
              <EmptyState title="No scans yet today">Scans at the turnstile show here as they happen.</EmptyState>
            ) : (
              logs.map((l) => <ScanRow key={l.id} log={l} views={views} />)
            )}
          </div>
        </Card>
      </div>

      {payFor && <LogPaymentModal member={payFor} open onClose={() => setPayFor(null)} />}
      <MemberPicker
        open={picking}
        onClose={() => setPicking(false)}
        title="Log payment"
        onPick={(m) => {
          setPicking(false)
          setPayFor(m)
        }}
      />
    </>
  )
}

function EndingCard({ view, onPay }: { view: MemberView; onPay: () => void }) {
  const { member, info } = view
  const urgent = info.daysLeft! <= URGENT_DAYS
  return (
    <div className={cx('flex min-h-262 flex-col rounded-tile border p-16', urgent ? 'border-yellow bg-yellow' : 'border-line-6 bg-white')} data-testid="ending-card">
      <div className="flex items-center justify-between">
        <Avatar text={initials(memberName(member))} tone={urgent ? 'onYellow' : 'neutral'} />
        <IconButton icon={ArrowUpRight} label={`Open ${memberName(member)}`} size={34} iconSize={15} to={`/members/${member.id}`} className="border-line-14" />
      </div>
      <div className="mt-16 text-17 leading-120 font-bold">{memberName(member)}</div>
      <div className={cx('mt-3 text-13', urgent ? 'text-yellow-ink' : 'text-muted')}>Paid until {formatDayMonth(info.paidUntil!)}</div>
      <div className="flex-1" />
      <div className="mt-10 mb-14 flex items-baseline gap-8">
        <div className="text-72 leading-85 font-extrabold stretch-66 tabular">{info.daysLeft}</div>
        <div className="text-14 leading-115 font-semibold">{info.daysLeft === 0 ? 'days left · last day' : info.daysLeft === 1 ? 'day left' : 'days left'}</div>
      </div>
      <Button variant={urgent ? 'primary' : 'outline'} className={cx('border-thick', !urgent && 'bg-transparent')} onClick={onPay}>
        Log payment
      </Button>
    </div>
  )
}

function ScanRow({ log, views }: { log: DoorLog; views: MemberView[] }) {
  const v = log.memberId ? views.find((x) => x.member.id === log.memberId) : undefined
  const name = log.memberName ?? (log.memberId ? 'Removed member' : 'Unknown finger')
  const allowed = log.result === 'allowed'
  const sub = allowed
    ? log.paidUntil
      ? log.paidUntil === log.date
        ? 'Last day today'
        : `Paid until ${formatDayMonth(log.paidUntil)}${diffDays(log.date, log.paidUntil) <= 6 ? ` · ${diffDays(log.date, log.paidUntil) === 1 ? '1 day' : `${diffDays(log.date, log.paidUntil)} days`} left` : ''}`
      : 'Let in'
    : log.reason === 'ended'
      ? log.text.replace('Membership ended', 'Ended')
      : log.text
  const content = (
    <>
      <div className="w-52 shrink-0 text-16 font-semibold text-ink-2 tabular">{timeAtGym(log.at)}</div>
      <Avatar text={log.memberId ? initials(name) : '?'} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-16 font-semibold">{name}</div>
        <div className="mt-2 truncate text-13 text-muted">
          {sub}
          {log.offline && ' · while offline'}
        </div>
      </div>
      <span className={cx('flex h-36 min-w-104 items-center justify-center gap-6 rounded-full px-14 text-14 font-bold max-md:min-w-0', allowed ? 'bg-green' : 'bg-red')}>
        {allowed ? <Check size={15} strokeWidth={2.5} /> : <X size={15} strokeWidth={2.5} />}
        {allowed ? 'Let in' : 'Denied'}
      </span>
    </>
  )
  const cls = 'flex items-center gap-14 border-t border-line-6 py-12 first:border-t-0 max-md:gap-10'
  return v ? (
    <Link to={`/members/${v.member.id}`} className={cls} data-testid="scan-row">
      {content}
    </Link>
  ) : (
    <div className={cls} data-testid="scan-row">
      {content}
    </div>
  )
}

export { ScanRow }
