import { Check, ChevronLeft, ChevronRight, Ellipsis, Fingerprint, Pencil, Plus, Search, UserRound, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { EnrolModal } from '../components/member/EnrolModal'
import { LogPaymentModal } from '../components/member/LogPaymentModal'
import { MemberFormModal } from '../components/member/MemberFormModal'
import { matchesSearch } from '../components/member/search'
import { Avatar, Button, Card, cx, EmptyState, ErrorNote, IconButton, PageHeader, Pill, SkeletonRows } from '../components/ui'
import { useGym, useToday } from '../data/store'
import { lastPaymentText, paidUntilCell, statusPill, viewMember, type MemberView } from '../lib/present'
import { initials, maskCellphone, memberCode, memberName, type Member } from '../lib/types'

type Filter = 'all' | 'paid' | 'ending' | 'locked' | 'not_enrolled'

const FILTERS: { id: Filter; label: string; dot: string }[] = [
  { id: 'all', label: 'All', dot: 'bg-dot' },
  { id: 'paid', label: 'Paid up', dot: 'bg-green' },
  { id: 'ending', label: 'Ending this week', dot: 'bg-yellow' },
  { id: 'locked', label: 'Locked out', dot: 'bg-red' },
  { id: 'not_enrolled', label: 'Not enrolled', dot: 'bg-dot' },
]

const PAGE_SIZE = 12

const inFilter = (v: MemberView, f: Filter) => {
  switch (f) {
    case 'all':
      return true
    case 'paid':
      return v.info.status === 'paid'
    case 'ending':
      return v.info.status === 'ending'
    case 'locked':
      return v.info.status === 'locked'
    case 'not_enrolled':
      return !v.member.fingerprint
  }
}

const COLS = 'grid grid-members gap-16'

export function MembersPage() {
  const today = useToday()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { members } = useGym()
  const filter = (params.get('filter') as Filter) || 'all'
  const [q, setQ] = useState(params.get('q') ?? '')
  const [page, setPage] = useState(0)
  const [payFor, setPayFor] = useState<Member | null>(null)
  const [enrolFor, setEnrolFor] = useState<Member | null>(null)
  const [editFor, setEditFor] = useState<Member | null>(null)
  const [adding, setAdding] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (params.get('search')) {
      searchRef.current?.focus()
      params.delete('search')
      setParams(params, { replace: true })
    }
  }, [params, setParams])

  const views = useMemo(() => members.data.map((m) => viewMember(m, today)), [members.data, today])
  const searched = useMemo(() => views.filter((v) => matchesSearch(v.member, q)), [views, q])
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.id, searched.filter((v) => inFilter(v, f.id)).length])) as Record<Filter, number>, [searched])
  const shown = useMemo(() => searched.filter((v) => inFilter(v, filter)), [searched, filter])
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const rows = shown.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE)
  const enrolled = members.data.filter((m) => m.fingerprint).length

  const setFilter = (f: Filter) => {
    setPage(0)
    if (f === 'all') params.delete('filter')
    else params.set('filter', f)
    setParams(params, { replace: true })
  }

  return (
    <>
      <PageHeader
        eyebrow={members.loading ? 'Loading members' : `${members.data.length} members · ${enrolled} with a fingerprint`}
        title="Members"
        actions={
          <Button size="lg" icon={Plus} onClick={() => setAdding(true)}>
            Add member
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-12 max-md:gap-8">
        <div className="flex h-52 w-380 items-center gap-10 rounded-full bg-white px-20 shadow-search focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-ink max-md:w-full">
          <Search size={18} className="text-muted" aria-hidden />
          <input
            ref={searchRef}
            aria-label="Search members"
            placeholder="Search name, cellphone or GY-number"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(0)
            }}
            className="min-w-0 flex-1 border-none bg-transparent text-15 text-ink outline-none placeholder:text-muted"
          />
        </div>
        <div className="flex flex-wrap gap-12 max-md:-mx-16 max-md:flex-nowrap max-md:gap-8 max-md:overflow-x-auto max-md:px-16">
          {FILTERS.map((f) => {
            const active = filter === f.id
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(f.id)}
                className={cx(
                  'flex h-48 shrink-0 items-center gap-10 rounded-full border pr-8 pl-18 text-15 font-semibold',
                  active ? 'border-ink bg-ink text-white' : 'border-glass-edge bg-glass text-ink hover:bg-white',
                )}
              >
                <span className={cx('size-9 rounded-full', f.dot)} />
                {f.label}
                <span className={cx('flex h-32 min-w-32 items-center justify-center rounded-full px-8 text-14 font-bold tabular', active ? 'bg-on-ink-chip' : 'bg-line-6')}>
                  {counts[f.id]}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {members.error && <ErrorNote>{members.error}</ErrorNote>}

      <Card className="px-12 pt-12 pb-8 max-md:px-8">
        <div className={cx(COLS, 'px-16 py-12 text-13 font-medium text-muted max-md:hidden')}>
          <div>Member</div>
          <div>Status</div>
          <div>Paid until</div>
          <div className="max-xl:hidden">Last payment</div>
          <div className="max-lg:hidden">Fingerprint</div>
          <div className="max-xl:hidden" />
        </div>

        {members.loading ? (
          <div className="px-16">
            <SkeletonRows rows={8} />
          </div>
        ) : rows.length === 0 ? (
          members.data.length === 0 ? (
            <EmptyState icon={Users} title="No members yet" action={<Button icon={Plus} onClick={() => setAdding(true)}>Add member</Button>}>
              Add your first member, or import the gym’s list in Settings.
            </EmptyState>
          ) : (
            <EmptyState icon={Search} title="No members found">
              {q ? 'Check the spelling, or search by cellphone or GY-number.' : 'No members match this filter.'}
            </EmptyState>
          )
        ) : (
          rows.map((v) => (
            <MemberRow
              key={v.member.id}
              view={v}
              onOpen={() => navigate(`/members/${v.member.id}`)}
              onPay={() => setPayFor(v.member)}
              onEnrol={() => setEnrolFor(v.member)}
              onEdit={() => setEditFor(v.member)}
            />
          ))
        )}

        {!members.loading && shown.length > 0 && (
          <div className="flex items-center justify-between border-t border-line-5 px-16 pt-16 pb-10">
            <div className="text-14 text-muted">
              Showing {current * PAGE_SIZE + rows.length} of {shown.length}
            </div>
            <div className="flex gap-8">
              <IconButton icon={ChevronLeft} label="Previous page" size={40} disabled={current === 0} onClick={() => setPage(current - 1)} />
              <IconButton icon={ChevronRight} label="Next page" size={40} variant="ink" disabled={current >= pages - 1} onClick={() => setPage(current + 1)} />
            </div>
          </div>
        )}
      </Card>

      {payFor && <LogPaymentModal member={payFor} open onClose={() => setPayFor(null)} />}
      {enrolFor && <EnrolModal member={enrolFor} open onClose={() => setEnrolFor(null)} onLogPayment={() => { setPayFor(enrolFor); setEnrolFor(null) }} />}
      <MemberFormModal open={!!editFor} member={editFor} onClose={() => setEditFor(null)} />
      <MemberFormModal open={adding} onClose={() => setAdding(false)} onAdded={(id) => navigate(`/members/${id}?enrol=1`)} />
    </>
  )
}

function MemberRow({ view, onOpen, onPay, onEnrol, onEdit }: { view: MemberView; onOpen: () => void; onPay: () => void; onEnrol: () => void; onEdit: () => void }) {
  const today = useToday()
  const { member, info, lastPayment } = view
  const pill = statusPill(info)
  const until = paidUntilCell(info, today)
  const name = memberName(member)
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && onOpen()}
      className={cx(COLS, 'cursor-pointer items-center rounded-row border-t border-line-5 px-16 py-12 hover:bg-glass-day max-md:flex max-md:flex-wrap max-md:gap-x-12 max-md:gap-y-8 max-md:px-8')}
      data-testid="member-row"
    >
      <div className="flex min-w-0 items-center gap-14 max-md:flex-1 max-md:gap-12">
        <Avatar text={initials(name)} size={44} />
        <div className="min-w-0">
          <Link to={`/members/${member.id}`} onClick={(e) => e.stopPropagation()} className="block truncate text-16 font-semibold">
            {name}
          </Link>
          <div className="mt-2 text-13 text-muted tabular">
            {memberCode(member.number)} · {maskCellphone(member.cellphone)}
          </div>
        </div>
      </div>
      <div className="max-md:order-first max-md:hidden">
        <Pill tone={pill.tone}>{pill.text}</Pill>
      </div>
      <div className="max-md:text-right">
        <div className="text-20 font-bold stretch-80 tabular max-md:text-17">{until.main}</div>
        <div className="mt-1 text-12 text-muted">{until.sub}</div>
      </div>
      <div className="text-14 text-ink-2 max-xl:hidden">{lastPaymentText(lastPayment)}</div>
      <div className="max-lg:hidden">
        {member.fingerprint ? (
          <div className="flex items-center gap-8 text-14 font-medium">
            <span className="flex size-26 items-center justify-center rounded-full bg-green-soft text-green-deep">
              <Check size={14} strokeWidth={2.5} />
            </span>
            Enrolled
          </div>
        ) : (
          <button type="button" onClick={(e) => { e.stopPropagation(); onEnrol() }} className="flex items-center gap-8 text-14 font-medium text-muted hover:text-ink">
            <span className="flex size-26 items-center justify-center rounded-full bg-chip">
              <Fingerprint size={14} />
            </span>
            Not enrolled
          </button>
        )}
      </div>
      <div className="flex justify-end gap-8 max-xl:hidden max-md:flex max-md:w-full" onClick={(e) => e.stopPropagation()}>
        <span className="mr-auto hidden max-md:inline-flex">
          <Pill tone={pill.tone}>{pill.text}</Pill>
        </span>
        <Button variant="outline" size="sm" onClick={onPay}>
          Log payment
        </Button>
        <RowMenu member={member} onEnrol={onEnrol} onEdit={onEdit} />
      </div>
    </div>
  )
}

function RowMenu({ member, onEnrol, onEdit }: { member: Member; onEnrol: () => void; onEdit: () => void }) {
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
      <IconButton icon={Ellipsis} label="More" size={40} onClick={() => setOpen((o) => !o)} aria-expanded={open} />
      {open && (
        <div className="absolute top-48 right-0 z-20 w-220 rounded-tile bg-white p-8 shadow-modal">
          <Link to={`/members/${member.id}`} className={item}>
            <UserRound size={16} /> Open profile
          </Link>
          <button type="button" className={item} onClick={() => { setOpen(false); onEnrol() }}>
            <Fingerprint size={16} /> {member.fingerprint ? 'Re-enrol fingerprint' : 'Enrol fingerprint'}
          </button>
          <button type="button" className={item} onClick={() => { setOpen(false); onEdit() }}>
            <Pencil size={16} /> Edit details
          </button>
        </div>
      )}
    </div>
  )
}
