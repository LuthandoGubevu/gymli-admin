import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { ArrowLeft, Check, Ellipsis, Fingerprint, Lock, MessageSquare, Pencil, Phone, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AccessCalendar } from '../components/member/AccessCalendar'
import { EnrolModal } from '../components/member/EnrolModal'
import { LogPaymentModal } from '../components/member/LogPaymentModal'
import { MemberDetailsCard } from '../components/member/MemberDetailsCard'
import { MemberFormModal } from '../components/member/MemberFormModal'
import { Avatar, Button, Card, CardTitle, cx, EmptyState, ErrorNote, IconButton, Pill, Spinner } from '../components/ui'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { authMessage, removeMember } from '../data/actions'
import { toDoorLog } from '../data/convert'
import { useMember, useStaff, useToday } from '../data/store'
import { isCurrent, periodLabel, type StatusInfo } from '../lib/access'
import { dateAtGym, diffDays, formatDayMonth, formatFull, formatMonthShortYear, formatSmart, timeAtGym, type LocalDate } from '../lib/dates'
import { db } from '../lib/firebase'
import { daysAgoText, loggedByText, profilePill, viewMember } from '../lib/present'
import { initials, maskCellphone, memberCode, memberName, type DoorLog, type Member, type Period } from '../lib/types'

function useMemberLogs(memberId: string | undefined) {
  const [logs, setLogs] = useState<DoorLog[]>([])
  useEffect(() => {
    if (!memberId) return
    return onSnapshot(
      query(collection(db, 'doorLogs'), where('memberId', '==', memberId), orderBy('at', 'desc'), limit(300)),
      (snap) => setLogs(snap.docs.map((d) => toDoorLog(d.id, d.data()))),
      () => setLogs([]),
    )
  }, [memberId])
  return logs
}

export function MemberProfilePage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const staff = useStaff()
  const today = useToday()
  const { member, loading } = useMember(id)
  const logs = useMemberLogs(id)
  const [paying, setPaying] = useState(false)
  const [editingPeriod, setEditingPeriod] = useState<Period | null>(null)
  const [enrolling, setEnrolling] = useState(false)
  const [editing, setEditing] = useState(false)
  const [removing, setRemoving] = useState(false)

  // Coming from "Add member": go straight to fingerprint enrolment.
  useEffect(() => {
    if (member && params.get('enrol')) {
      setEnrolling(true)
      params.delete('enrol')
      setParams(params, { replace: true })
    }
  }, [member, params, setParams])

  if (loading) return <Spinner label="Loading member" />
  if (!member)
    return (
      <Card className="p-28">
        <EmptyState title="Member not found" action={<Button to="/members">Back to Members</Button>}>
          This member may have been removed.
        </EmptyState>
      </Card>
    )

  const { info } = viewMember(member, today)
  const name = memberName(member)
  const pill = profilePill(info)
  const deniedToday = logs.find((l) => l.date === today && l.result === 'denied')
  const periods = [...member.periods].filter((p) => !p.deleted).sort((a, b) => (a.start > b.start ? -1 : 1))
  const deletedPeriods = member.periods.filter((p) => p.deleted)
  const isManager = staff.role === 'manager'

  return (
    <>
      {/* Phone header (design 07) */}
      <div className="flex items-center justify-between md:hidden">
        <IconButton icon={ArrowLeft} label="Back" variant="soft" onClick={() => navigate(-1)} />
        <div className="text-16 font-semibold">Member</div>
        <MoreMenu onEdit={() => setEditing(true)} onEnrol={() => setEnrolling(true)} onRemove={isManager ? () => setRemoving(true) : undefined} variant="soft" />
      </div>

      <div className="mt-4 flex items-center gap-12 max-md:hidden">
        <IconButton icon={ArrowLeft} label="Back to Members" variant="glass" to="/members" />
        <div className="text-14 text-muted">
          <Link to="/members" className="hover:text-ink">Members</Link>
          <span className="mx-6">/</span>
          <span className="font-semibold text-ink">{name}</span>
        </div>
      </div>

      <div className="grid grid-profile items-start gap-20 max-lg:grid-cols-1 max-md:gap-14">
        <div className="flex flex-col gap-16 max-md:gap-14">
          {/* Identity card */}
          <Card className="p-28 max-md:border-0 max-md:bg-transparent max-md:p-4 max-md:shadow-none max-md:backdrop-blur-none">
            <div className="flex items-start justify-between max-md:items-center max-md:justify-start max-md:gap-14">
              <Avatar text={initials(name)} size={96} tone="ink" className="max-md:size-72 max-md:text-28" />
              <span className="max-md:hidden">
                <Pill tone={pill.tone} size="lg">{pill.text}</Pill>
              </span>
              <div className="min-w-0 md:hidden">
                <div className="text-40 leading-92 font-extrabold tracking-tighter stretch-66">{name}</div>
                <div className="mt-6 text-13 text-ink-2 tabular">
                  {memberCode(member.number)} · {maskCellphone(member.cellphone)}
                </div>
              </div>
            </div>
            <h1 className="m-0 mt-20 text-60 leading-92 font-extrabold tracking-tighter stretch-66 max-md:hidden">{name}</h1>
            <div className="mt-20 grid grid-cols-2 gap-12 max-md:hidden">
              <div>
                <div className="text-12 text-muted">Member number</div>
                <div className="mt-3 text-18 font-semibold tabular">{memberCode(member.number)}</div>
              </div>
              <div>
                <div className="text-12 text-muted">Cellphone</div>
                <div className="mt-3 text-18 font-semibold tabular">{maskCellphone(member.cellphone)}</div>
              </div>
            </div>
            <div className="mt-24 flex items-center gap-8 max-md:hidden">
              <IconButton icon={Phone} label="Call" size={52} iconSize={19} href={`tel:${member.cellphone}`} />
              <IconButton icon={MessageSquare} label="Send SMS" size={52} iconSize={19} href={`sms:${member.cellphone}`} />
              <IconButton icon={Pencil} label="Edit details" size={52} iconSize={19} onClick={() => setEditing(true)} />
              <Button size="lg" icon={Plus} className="flex-1" onClick={() => setPaying(true)}>
                Log payment
              </Button>
            </div>
          </Card>

          <AccessCard info={info} today={today} deniedToday={deniedToday} />

          {/* Phone actions (design 07) */}
          <div className="flex gap-8 md:hidden">
            <IconButton icon={Phone} label="Call" size={56} iconSize={20} variant="soft" href={`tel:${member.cellphone}`} />
            <IconButton icon={MessageSquare} label="Send SMS" size={56} iconSize={20} variant="soft" href={`sms:${member.cellphone}`} />
            <Button size="xl" icon={Plus} className="flex-1" onClick={() => setPaying(true)}>
              Log payment
            </Button>
          </div>

          <Card className="flex items-center gap-14 py-20 pr-20 pl-24 max-md:hidden">
            <span className={cx('flex size-48 items-center justify-center rounded-full', member.fingerprint ? 'bg-green-soft text-green-deep' : 'bg-chip text-ink')}>
              <Fingerprint size={22} />
            </span>
            <div className="flex-1">
              <div className="text-16 font-semibold">{member.fingerprint ? fingerLabel(member.fingerprint.finger) : 'No fingerprint yet'}</div>
              <div className="mt-2 text-13 text-muted">
                {member.fingerprint ? `Enrolled ${formatFull(dateAtGym(member.fingerprint.enrolledAt))}` : 'Enrol one so they can use the turnstile'}
              </div>
            </div>
            <Button variant={member.fingerprint ? 'ghost' : 'primary'} size="sm" className={cx(member.fingerprint && 'px-16')} onClick={() => setEnrolling(true)}>
              {member.fingerprint ? 'Re-enrol' : 'Enrol'}
            </Button>
          </Card>

          <MemberDetailsCard member={member} onEdit={() => setEditing(true)} />
        </div>

        <div className="flex min-w-0 flex-col gap-16 max-md:gap-14">
          <Card className="p-28 max-md:p-18">
            <div className="max-md:hidden">
              <AccessCalendar periods={member.periods} logs={logs} today={today} />
            </div>
            <div className="md:hidden">
              <AccessCalendar periods={member.periods} logs={logs} today={today} compact />
            </div>
          </Card>

          <Card className="px-28 pt-24 pb-12 max-md:px-18 max-md:pt-18 max-md:pb-6">
            <div className="mb-6 flex items-center justify-between">
              <CardTitle size={32} className="max-md:text-26">Paid periods</CardTitle>
              <div className="text-14 text-muted max-md:hidden">Member since {formatMonthShortYear(dateAtGym(member.createdAt || Date.now()))}</div>
            </div>
            {periods.length === 0 ? (
              <EmptyState title="No payments yet" action={<Button icon={Plus} onClick={() => setPaying(true)}>Log payment</Button>}>
                Log what {member.firstName} paid for and the turnstile opens for them.
              </EmptyState>
            ) : (
              periods.map((p) => (
                <PeriodRow key={p.id} period={p} today={today} canEdit={isManager} onEdit={() => setEditingPeriod(p)} />
              ))
            )}
            {deletedPeriods.length > 0 && (
              <div className="border-t border-line-6 py-12 text-13 text-muted">
                {deletedPeriods.length} deleted payment{deletedPeriods.length === 1 ? '' : 's'} kept in the audit log
              </div>
            )}
          </Card>

          <Card className="flex items-center justify-between gap-12 p-20 md:hidden">
            <div className="flex items-center gap-12">
              <span className={cx('flex size-44 items-center justify-center rounded-full', member.fingerprint ? 'bg-green-soft text-green-deep' : 'bg-chip')}>
                <Fingerprint size={20} />
              </span>
              <div className="text-14 font-semibold">{member.fingerprint ? 'Fingerprint enrolled' : 'No fingerprint yet'}</div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEnrolling(true)}>
              {member.fingerprint ? 'Re-enrol' : 'Enrol'}
            </Button>
          </Card>

          {isManager && (
            <div className="flex justify-end max-md:hidden">
              <Button variant="ghost" size="sm" icon={Trash2} onClick={() => setRemoving(true)} className="text-muted">
                Remove member
              </Button>
            </div>
          )}
        </div>
      </div>

      <LogPaymentModal member={member} open={paying} onClose={() => setPaying(false)} />
      {editingPeriod && <LogPaymentModal member={member} open editing={editingPeriod} onClose={() => setEditingPeriod(null)} />}
      <EnrolModal member={member} open={enrolling} onClose={() => setEnrolling(false)} onLogPayment={() => { setEnrolling(false); setPaying(true) }} />
      <MemberFormModal open={editing} member={member} onClose={() => setEditing(false)} />
      <RemoveMemberModal member={member} open={removing} onClose={() => setRemoving(false)} />
    </>
  )
}

export function fingerLabel(f: string): string {
  const map: Record<string, string> = {
    right_index: 'Right index finger',
    left_index: 'Left index finger',
    right_thumb: 'Right thumb',
    left_thumb: 'Left thumb',
    right_middle: 'Right middle finger',
    left_middle: 'Left middle finger',
  }
  return map[f] ?? 'Fingerprint'
}

function AccessCard({ info, today, deniedToday }: { info: StatusInfo; today: LocalDate; deniedToday?: DoorLog }) {
  if (info.paidUntil) {
    return (
      <div className="rounded-card bg-green p-28 shadow-green max-md:p-22" data-testid="access-card">
        <div className="flex items-center gap-10 text-14 font-bold tracking-caps uppercase max-md:text-13">
          <span className="flex size-32 items-center justify-center rounded-full bg-ink text-green max-md:size-28">
            <Check size={16} strokeWidth={3} />
          </span>
          Can enter
        </div>
        <div className="mt-18 text-64 leading-92 font-extrabold tracking-tighter stretch-66 tabular max-md:mt-14 max-md:text-52">until {formatFull(info.paidUntil)}</div>
        <div className="mt-20 flex items-center justify-between border-t border-line-15 pt-16 max-md:mt-12 max-md:pt-12">
          <div className="text-24 font-bold tabular max-md:text-15 max-md:font-semibold">{info.daysLeft === 0 ? 'Last day today' : info.daysLeft === 1 ? '1 day left' : `${info.daysLeft} days left`}</div>
          <div className="text-14 font-medium max-md:hidden">Next access needs a payment</div>
        </div>
      </div>
    )
  }
  const title = info.status === 'future' ? 'Not yet' : info.status === 'none' ? 'No payment yet' : 'Locked out'
  const big = info.status === 'future' ? `starts ${formatSmart(info.startsOn!, today)}` : info.status === 'none' ? 'never paid' : `ended ${formatSmart(info.endedOn!, today)}`
  const sub =
    info.status === 'locked'
      ? `${daysAgoText(diffDays(info.endedOn!, today))}${deniedToday ? ` · denied today ${timeAtGym(deniedToday.at)}` : ''}`
      : info.status === 'future'
        ? `in ${diffDays(today, info.startsOn!)} days · denied until then`
        : 'Log a payment to open the turnstile'
  return (
    <div className={cx('rounded-card p-28 max-md:p-22', info.status === 'future' ? 'bg-yellow' : 'bg-red')} data-testid="access-card">
      <div className="flex items-center gap-10 text-14 font-bold tracking-caps uppercase max-md:text-13">
        <span className={cx('flex size-32 items-center justify-center rounded-full bg-ink max-md:size-28', info.status === 'future' ? 'text-yellow' : 'text-red')}>
          <Lock size={16} strokeWidth={2.5} />
        </span>
        {title}
      </div>
      <div className="mt-18 text-64 leading-92 font-extrabold tracking-tighter stretch-66 tabular max-md:mt-14 max-md:text-52">{big}</div>
      <div className="mt-20 border-t border-line-18 pt-16 text-15 font-semibold max-md:mt-12 max-md:pt-12">{sub}</div>
    </div>
  )
}

function PeriodRow({ period, today, canEdit, onEdit }: { period: Period; today: LocalDate; canEdit: boolean; onEdit: () => void }) {
  const current = isCurrent(period, today)
  const future = period.start > today
  return (
    <div className="grid grid-periods items-center gap-16 border-t border-line-6 py-16 max-md:flex max-md:flex-wrap max-md:items-baseline max-md:gap-x-10 max-md:gap-y-3 max-md:py-12" data-testid="period-row">
      <div className="text-24 font-extrabold stretch-70 max-md:text-20">{periodLabel(period.kind, period.qty)}</div>
      <div className="text-18 font-semibold tabular max-md:text-15">
        {formatDayMonth(period.start)} → {formatSmart(period.end, today)}
      </div>
      <div className="text-14 text-muted max-lg:hidden max-md:block max-md:w-full max-md:text-13">
        {loggedByText(period)}
        {period.changedBy && ` · changed by ${period.changedBy.name.split(' ')[0]}`}
      </div>
      <div className="flex items-center justify-end gap-8 max-md:hidden">
        {current && <Pill tone="green" size="sm">Current</Pill>}
        {future && <Pill tone="neutral" size="sm">Next</Pill>}
        {canEdit && <IconButton icon={Pencil} label="Change payment" size={34} iconSize={15} onClick={onEdit} />}
      </div>
    </div>
  )
}

function MoreMenu({ onEdit, onEnrol, onRemove, variant }: { onEdit: () => void; onEnrol: () => void; onRemove?: () => void; variant: 'soft' | 'line' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  const item = 'flex h-44 w-full items-center gap-10 rounded-row px-12 text-left text-14 font-semibold hover:bg-field'
  return (
    <div ref={ref} className="relative">
      <IconButton icon={Ellipsis} label="More" variant={variant} onClick={() => setOpen((o) => !o)} />
      {open && (
        <div className="absolute top-52 right-0 z-20 w-220 rounded-tile bg-white p-8 shadow-modal">
          <button type="button" className={item} onClick={() => { setOpen(false); onEdit() }}><Pencil size={16} /> Edit details</button>
          <button type="button" className={item} onClick={() => { setOpen(false); onEnrol() }}><Fingerprint size={16} /> Enrol fingerprint</button>
          {onRemove && <button type="button" className={item} onClick={() => { setOpen(false); onRemove() }}><Trash2 size={16} /> Remove member</button>}
        </div>
      )}
    </div>
  )
}

function RemoveMemberModal({ member, open, onClose }: { member: Member; open: boolean; onClose: () => void }) {
  const staff = useStaff()
  const navigate = useNavigate()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function go() {
    setBusy(true)
    setError(null)
    try {
      await removeMember(staff, member.id)
      toast(`${memberCode(member.number)} removed`)
      navigate('/members')
    } catch (e) {
      setError(authMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={onClose} locked={busy} width="md" eyebrow={memberCode(member.number)} title={`Remove ${member.firstName}?`}>
      <div className="text-16 text-ink-2">
        Their name, cellphone, payments and fingerprint are erased, also from the check-in PC. The turnstile will not recognise them. This cannot be undone.
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-10">
        <Button variant="ghost" size="xl" className="border-line-14 px-26" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="danger" size="xl" icon={Trash2} loading={busy} onClick={go}>Remove member</Button>
      </div>
    </Modal>
  )
}
