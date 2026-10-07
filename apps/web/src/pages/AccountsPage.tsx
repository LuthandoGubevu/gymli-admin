import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { ArrowDown, ArrowUp, CalendarDays, FileSpreadsheet, FileText, Phone, Search, Wallet } from 'lucide-react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardTitle, cx, EmptyState, ErrorNote, PageHeader, SkeletonRows } from '../components/ui'
import { useToast } from '../components/ui/Toast'
import { toDoorLog, toMember } from '../data/convert'
import { useGym, useStaff, useToday } from '../data/store'
import {
  branchSummary,
  cashUp,
  formatRand,
  hourHeatmap,
  inRange,
  paymentRows,
  renewalsDue,
  totals,
  type CashUpRow,
  type PaymentRow,
  type RenewalDue,
} from '../lib/accounts'
import { addDays, diffDays, formatDayMonth, formatFull, makeDate, parseDate, weekdayMon0, type LocalDate } from '../lib/dates'
import { exportExcel, exportPdf, type ExportColumn, type ExportSpec } from '../lib/export'
import { db } from '../lib/firebase'
import { formatCellphone, memberCode, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, type Branch, type DoorLog, type Member } from '../lib/types'

type Preset = 'today' | 'week' | 'month' | 'lastMonth' | 'custom'
type Tab = 'payments' | 'cashup' | 'branches' | 'renewals' | 'hours'

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: 'lastMonth', label: 'Last month' },
  { id: 'custom', label: 'Custom' },
]

const TABS: { id: Tab; label: string }[] = [
  { id: 'payments', label: 'Payments' },
  { id: 'cashup', label: 'Daily cash-up' },
  { id: 'branches', label: 'Branches' },
  { id: 'renewals', label: 'Renewals due' },
  { id: 'hours', label: 'Busiest hours' },
]

function rangeFor(p: Preset, today: LocalDate): [LocalDate, LocalDate] {
  const { y, m } = parseDate(today)
  switch (p) {
    case 'today':
      return [today, today]
    case 'week':
      return [addDays(today, -weekdayMon0(today)), today]
    case 'month':
      return [makeDate(y, m, 1), today]
    case 'lastMonth': {
      const first = m === 1 ? makeDate(y - 1, 12, 1) : makeDate(y, m - 1, 1)
      return [first, addDays(makeDate(y, m, 1), -1)]
    }
    default:
      return [makeDate(y, m, 1), today]
  }
}

/** Every member of every branch (managers only; this page only). */
function useAllMembers() {
  const [state, setState] = useState<{ data: Member[]; loading: boolean; error: string | null }>({ data: [], loading: true, error: null })
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'members'), where('deleted', '==', false)),
        (snap) => setState({ data: snap.docs.map((d) => toMember(d.id, d.data())), loading: false, error: null }),
        () => setState({ data: [], loading: false, error: 'Could not load payments. Check the internet connection.' }),
      ),
    [],
  )
  return state
}

const rangeText = (from: LocalDate, to: LocalDate) => (from === to ? formatFull(from) : `${formatFull(from)} – ${formatFull(to)}`)

export function AccountsPage() {
  const staff = useStaff()
  const today = useToday()
  const toast = useToast()
  const { branch, branches } = useGym()
  const all = useAllMembers()
  const [preset, setPreset] = useState<Preset>('month')
  const [custom, setCustom] = useState<[LocalDate, LocalDate]>(() => rangeFor('month', today))
  const [scope, setScope] = useState<'branch' | 'all'>('branch')
  const [tab, setTab] = useState<Tab>('payments')

  const [from, to] = preset === 'custom' ? (custom[0] <= custom[1] ? custom : [custom[1], custom[0]]) : rangeFor(preset, today)
  const scopeName = scope === 'all' ? 'All branches' : (branch?.name ?? '')
  const branchName = useMemo(() => Object.fromEntries(branches.data.map((b) => [b.id, b.name])), [branches.data])
  const scoped = useMemo(() => (scope === 'all' ? all.data : all.data.filter((m) => m.branchId === branch?.id)), [all.data, scope, branch?.id])
  const rows = useMemo(() => inRange(paymentRows(scoped), from, to), [scoped, from, to])
  const t = totals(rows)

  if (staff.role !== 'manager')
    return (
      <Card className="p-28">
        <EmptyState title="Managers only">Ask a manager for the accounts.</EmptyState>
      </Card>
    )

  const subtitle = `${scopeName} · ${rangeText(from, to)}`
  async function run<T>(kind: 'xlsx' | 'pdf', spec: ExportSpec<T>) {
    try {
      await (kind === 'xlsx' ? exportExcel(spec) : exportPdf(spec))
    } catch {
      toast('Could not create the file. Try again.')
    }
  }

  return (
    <>
      <PageHeader eyebrow="Managers only" title="Accounts" />

      <div className="flex flex-wrap items-center gap-8">
        {PRESETS.map((p) => (
          <FilterPill key={p.id} active={preset === p.id} onClick={() => setPreset(p.id)}>
            {p.label}
          </FilterPill>
        ))}
        {preset === 'custom' && (
          <div className="flex h-48 items-center gap-8 rounded-full bg-white px-16 text-15 font-semibold shadow-search tabular">
            <CalendarDays size={18} aria-hidden />
            <input aria-label="From" type="date" value={custom[0]} max={today} onChange={(e) => e.target.value && setCustom([e.target.value, custom[1]])} className="border-none bg-transparent font-semibold outline-none" />
            <span className="text-muted">to</span>
            <input aria-label="To" type="date" value={custom[1]} max={today} onChange={(e) => e.target.value && setCustom([custom[0], e.target.value])} className="border-none bg-transparent font-semibold outline-none" />
          </div>
        )}
        <div className="flex-1" />
        <div role="radiogroup" aria-label="Branches" className="flex gap-4 rounded-full bg-glass p-5">
          {(['branch', 'all'] as const).map((s) => (
            <button key={s} type="button" role="radio" aria-checked={scope === s} onClick={() => setScope(s)} className={cx('rounded-full px-18 py-10 text-14', scope === s ? 'bg-ink font-semibold text-white' : 'font-medium text-ink-2')}>
              {s === 'all' ? 'All branches' : (branch?.name ?? 'This branch')}
            </button>
          ))}
        </div>
      </div>

      {all.error && <ErrorNote>{all.error}</ErrorNote>}

      <div className="grid grid-cols-6 gap-16 max-xl:grid-cols-3 max-md:grid-cols-2 max-md:gap-10">
        <Tile label="Received" value={formatRand(t.cents)} sub={t.withoutAmount ? `${t.withoutAmount} without an amount` : rangeText(from, to)} strong />
        <Tile label="Payments" value={String(t.count)} sub={`${t.newMembers} new · ${t.renewals} renewals`} />
        {PAYMENT_METHODS.map((m) => (
          <Tile key={m} label={PAYMENT_METHOD_LABEL[m]} value={formatRand(t.byMethod[m].cents)} sub={`${t.byMethod[m].count} payment${t.byMethod[m].count === 1 ? '' : 's'}`} />
        ))}
      </div>

      <div role="tablist" aria-label="Reports" className="flex flex-wrap gap-4 self-start rounded-full border border-glass-edge bg-glass p-5">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={tab === x.id} onClick={() => setTab(x.id)} className={cx('rounded-full px-20 py-11 text-14', tab === x.id ? 'bg-ink font-semibold text-white' : 'font-medium text-ink-2 hover:bg-white')}>
            {x.label}
          </button>
        ))}
      </div>

      {all.loading ? (
        <Card className="p-28">
          <SkeletonRows rows={6} />
        </Card>
      ) : tab === 'payments' ? (
        <PaymentsTable rows={rows} showBranch={scope === 'all'} branchName={branchName} subtitle={subtitle} from={from} to={to} totalsCents={t.cents} onExport={run} />
      ) : tab === 'cashup' ? (
        <CashUpTable rows={cashUp(rows)} subtitle={subtitle} from={from} to={to} onExport={run} />
      ) : tab === 'branches' ? (
        <BranchesReport members={all.data} branches={branches.data} from={from} to={to} today={today} subtitle={rangeText(from, to)} onExport={run} />
      ) : tab === 'renewals' ? (
        <RenewalsReport members={scoped} branches={branches.data} today={today} scopeName={scopeName} branchName={branchName} showBranch={scope === 'all'} onExport={run} />
      ) : (
        <BusiestHours branch={branch} from={from} to={to} />
      )}
    </>
  )
}

/* ---------------- Pieces ---------------- */

type Exporter = <T>(kind: 'xlsx' | 'pdf', spec: ExportSpec<T>) => Promise<void>

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cx('flex h-48 items-center rounded-full border px-18 text-15 font-semibold', active ? 'border-ink bg-ink text-white' : 'border-glass-edge bg-glass hover:bg-white')}>
      {children}
    </button>
  )
}

function Tile({ label, value, sub, strong }: { label: string; value: string; sub: string; strong?: boolean }) {
  return (
    <Card className={cx('flex flex-col gap-6 p-22 max-md:p-16', strong && 'bg-ink text-white')}>
      <div className={cx('text-14', strong ? 'text-on-ink-soft' : 'text-ink-3')}>{label}</div>
      <div className="truncate text-40 leading-90 font-extrabold stretch-66 tabular max-md:text-32">{value}</div>
      <div className={cx('truncate text-13', strong ? 'text-on-ink-soft' : 'text-muted')}>{sub}</div>
    </Card>
  )
}

function ExportButtons({ onExcel, onPdf, disabled }: { onExcel: () => void; onPdf: () => void; disabled?: boolean }) {
  const b = 'flex h-40 items-center gap-8 rounded-full border border-line-10 bg-white px-16 text-14 font-semibold hover:border-ink disabled:opacity-40'
  return (
    <div className="flex gap-8">
      <button type="button" className={b} onClick={onExcel} disabled={disabled}>
        <FileSpreadsheet size={16} /> Excel
      </button>
      <button type="button" className={b} onClick={onPdf} disabled={disabled}>
        <FileText size={16} /> PDF
      </button>
    </div>
  )
}

function ReportHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-14 flex flex-wrap items-center gap-14">
      <CardTitle size={32}>{title}</CardTitle>
      <div className="flex-1" />
      {children}
    </div>
  )
}

const th = 'px-10 py-10 text-left text-12 font-semibold text-muted whitespace-nowrap'
const td = 'px-10 py-11 border-t border-line-6 text-14 whitespace-nowrap'

/* ---------------- Payments ---------------- */

type SortKey = 'date' | 'member' | 'amount'

function PaymentsTable(props: {
  rows: PaymentRow[]
  showBranch: boolean
  branchName: Record<string, string>
  subtitle: string
  from: LocalDate
  to: LocalDate
  totalsCents: number
  onExport: Exporter
}) {
  const { rows, showBranch, branchName, subtitle, from, to, totalsCents, onExport } = props
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true })
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = q ? rows.filter((r) => r.memberName.toLowerCase().includes(q) || memberCode(r.memberNumber).toLowerCase().includes(q)) : [...rows]
    const dir = sort.desc ? -1 : 1
    list.sort((a, b) =>
      sort.key === 'amount' ? ((a.amountCents ?? -1) - (b.amountCents ?? -1)) * dir : sort.key === 'member' ? a.memberName.localeCompare(b.memberName) * dir : (a.loggedAt - b.loggedAt) * dir,
    )
    return list
  }, [rows, search, sort])

  const columns: ExportColumn<PaymentRow>[] = [
    { header: 'Date', value: (r) => r.date, width: 12 },
    { header: 'Time', value: (r) => r.time, width: 8 },
    { header: 'Member', value: (r) => r.memberName, width: 24 },
    { header: 'Number', value: (r) => memberCode(r.memberNumber), width: 10 },
    ...(showBranch ? [{ header: 'Branch', value: (r: PaymentRow) => branchName[r.branchId ?? ''] ?? '', width: 20 }] : []),
    { header: 'How long', value: (r) => r.length, width: 12 },
    { header: 'Access', value: (r) => `${r.start} – ${r.end}`, width: 24 },
    { header: 'Paid by', value: (r) => (r.method ? PAYMENT_METHOD_LABEL[r.method] : ''), width: 12 },
    { header: 'Amount', value: (r) => r.amountCents, type: 'money' },
    { header: 'Logged by', value: (r) => r.loggedBy.name, width: 18 },
  ]
  const spec: ExportSpec<PaymentRow> = {
    file: `gymli-payments-${from}-to-${to}`,
    title: 'Payments',
    subtitle,
    columns,
    rows: shown,
    totals: columns.map((c, i) => (i === 0 ? `Total · ${shown.length} payments` : c.header === 'Amount' ? shown.reduce((s, r) => s + (r.amountCents ?? 0), 0) : undefined)),
  }
  const sortBtn = (key: SortKey, label: string, right?: boolean) => (
    <button type="button" onClick={() => setSort((s) => ({ key, desc: s.key === key ? !s.desc : key !== 'member' }))} className={cx('inline-flex items-center gap-4 hover:text-ink', right && 'ml-auto')}>
      {label}
      {sort.key === key && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
    </button>
  )

  return (
    <Card className="p-28 max-md:p-18">
      <ReportHead title="Payments">
        <label className="flex h-40 items-center gap-8 rounded-full bg-field px-14 text-14">
          <Search size={16} aria-hidden />
          <span className="sr-only">Search payments</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or GY-number" className="w-160 border-none bg-transparent outline-none" />
        </label>
        <ExportButtons disabled={shown.length === 0} onExcel={() => onExport('xlsx', spec)} onPdf={() => onExport('pdf', spec)} />
      </ReportHead>
      {shown.length === 0 ? (
        <EmptyState icon={Wallet} title="No payments in this period">Choose another date range or branch.</EmptyState>
      ) : (
        <div className="-mx-10 overflow-x-auto">
          <table className="w-full tabular">
            <thead>
              <tr>
                <th className={th}>{sortBtn('date', 'Date')}</th>
                <th className={th}>{sortBtn('member', 'Member')}</th>
                {showBranch && <th className={th}>Branch</th>}
                <th className={th}>How long</th>
                <th className={th}>Access</th>
                <th className={th}>Paid by</th>
                <th className={cx(th, 'text-right')}>{sortBtn('amount', 'Amount', true)}</th>
                <th className={th}>Logged by</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className="hover:bg-white">
                  <td className={td}>
                    {formatDayMonth(r.date)} <span className="text-muted">{r.time}</span>
                  </td>
                  <td className={td}>
                    <Link to={`/members/${r.memberId}`} className="font-semibold hover:underline">
                      {r.memberName}
                    </Link>{' '}
                    <span className="text-muted">{memberCode(r.memberNumber)}</span>
                    {r.isNew && <span className="ml-8 rounded-full bg-green-soft px-8 py-2 text-12 font-semibold text-green-deep">New</span>}
                  </td>
                  {showBranch && <td className={td}>{branchName[r.branchId ?? ''] ?? '—'}</td>}
                  <td className={td}>{r.length}</td>
                  <td className={cx(td, 'text-muted')}>
                    {formatDayMonth(r.start)} → {formatDayMonth(r.end)}
                  </td>
                  <td className={td}>{r.method ? PAYMENT_METHOD_LABEL[r.method] : <span className="text-muted">—</span>}</td>
                  <td className={cx(td, 'text-right font-bold')}>{r.amountCents === null ? <span className="font-normal text-muted">No amount</span> : formatRand(r.amountCents)}</td>
                  <td className={cx(td, 'text-muted')}>{r.loggedBy.name}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={cx(td, 'font-semibold')} colSpan={showBranch ? 6 : 5}>
                  {shown.length} payments{search ? ' (filtered)' : ''}
                </td>
                <td className={cx(td, 'text-right text-16 font-extrabold')}>{formatRand(search ? shown.reduce((s, r) => s + (r.amountCents ?? 0), 0) : totalsCents)}</td>
                <td className={td} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ---------------- Daily cash-up ---------------- */

function CashUpTable({ rows, subtitle, from, to, onExport }: { rows: CashUpRow[]; subtitle: string; from: LocalDate; to: LocalDate; onExport: Exporter }) {
  const columns: ExportColumn<CashUpRow>[] = [
    { header: 'Date', value: (r) => r.date, width: 12 },
    { header: 'Staff', value: (r) => r.staff.name, width: 22 },
    ...PAYMENT_METHODS.map((m) => ({ header: PAYMENT_METHOD_LABEL[m], value: (r: CashUpRow) => r.byMethod[m], type: 'money' as const })),
    { header: 'Total', value: (r) => r.total, type: 'money' },
    { header: 'Payments', value: (r) => r.count, type: 'number', width: 10 },
  ]
  const sum = (f: (r: CashUpRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  const foot = ['Total', '', ...PAYMENT_METHODS.map((m) => sum((r) => r.byMethod[m])), sum((r) => r.total), sum((r) => r.count)]
  const spec: ExportSpec<CashUpRow> = { file: `gymli-cash-up-${from}-to-${to}`, title: 'Daily cash-up', subtitle, columns, rows, totals: foot }
  return (
    <Card className="p-28 max-md:p-18">
      <ReportHead title="Daily cash-up">
        <ExportButtons disabled={rows.length === 0} onExcel={() => onExport('xlsx', spec)} onPdf={() => onExport('pdf', spec)} />
      </ReportHead>
      <p className="mb-12 text-14 text-muted">What each staff member took per day, by how it was paid. Check the cash column against the till.</p>
      {rows.length === 0 ? (
        <EmptyState icon={Wallet} title="Nothing to cash up">No payments in this period.</EmptyState>
      ) : (
        <div className="-mx-10 overflow-x-auto">
          <table className="w-full tabular">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Staff</th>
                {PAYMENT_METHODS.map((m) => (
                  <th key={m} className={cx(th, 'text-right')}>
                    {PAYMENT_METHOD_LABEL[m]}
                  </th>
                ))}
                <th className={cx(th, 'text-right')}>Total</th>
                <th className={cx(th, 'text-right')}>Payments</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.date}-${r.staff.uid}`} className="hover:bg-white">
                  <td className={td}>{formatDayMonth(r.date)}</td>
                  <td className={cx(td, 'font-semibold')}>{r.staff.name}</td>
                  {PAYMENT_METHODS.map((m) => (
                    <td key={m} className={cx(td, 'text-right', r.byMethod[m] === 0 && 'text-faint')}>
                      {formatRand(r.byMethod[m])}
                    </td>
                  ))}
                  <td className={cx(td, 'text-right font-bold')}>{formatRand(r.total)}</td>
                  <td className={cx(td, 'text-right text-muted')}>{r.count}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-extrabold">
                <td className={td} colSpan={2}>
                  Total
                </td>
                {PAYMENT_METHODS.map((m) => (
                  <td key={m} className={cx(td, 'text-right')}>
                    {formatRand(sum((r) => r.byMethod[m]))}
                  </td>
                ))}
                <td className={cx(td, 'text-right text-16')}>{formatRand(sum((r) => r.total))}</td>
                <td className={cx(td, 'text-right')}>{sum((r) => r.count)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  )
}

/* ---------------- Branch comparison ---------------- */

function BranchesReport(props: { members: Member[]; branches: Branch[]; from: LocalDate; to: LocalDate; today: LocalDate; subtitle: string; onExport: Exporter }) {
  const { members, branches, from, to, today, subtitle, onExport } = props
  const rows = useMemo(() => branchSummary(members, branches, from, to, today), [members, branches, from, to, today])
  const max = Math.max(1, ...rows.map((r) => r.cents))
  type Row = (typeof rows)[number]
  const columns: ExportColumn<Row>[] = [
    { header: 'Branch', value: (r) => r.branch.name, width: 24 },
    { header: 'Received', value: (r) => r.cents, type: 'money' },
    { header: 'Payments', value: (r) => r.payments, type: 'number', width: 10 },
    { header: 'New members', value: (r) => r.newMembers, type: 'number', width: 13 },
    { header: 'Renewals', value: (r) => r.renewals, type: 'number', width: 10 },
    { header: 'Can enter today', value: (r) => r.active, type: 'number', width: 15 },
    { header: 'Members', value: (r) => r.members, type: 'number', width: 10 },
  ]
  const sum = (f: (r: Row) => number) => rows.reduce((s, r) => s + f(r), 0)
  const spec: ExportSpec<Row> = {
    file: `gymli-branches-${from}-to-${to}`,
    title: 'Branch comparison',
    subtitle,
    columns,
    rows,
    totals: ['All branches', sum((r) => r.cents), sum((r) => r.payments), sum((r) => r.newMembers), sum((r) => r.renewals), sum((r) => r.active), sum((r) => r.members)],
  }
  return (
    <Card className="p-28 max-md:p-18">
      <ReportHead title="Branches">
        <ExportButtons onExcel={() => onExport('xlsx', spec)} onPdf={() => onExport('pdf', spec)} />
      </ReportHead>
      <p className="mb-16 text-14 text-muted">Money received per branch, {subtitle}.</p>
      <div className="mb-20 flex flex-col gap-10" role="img" aria-label={`Money received per branch: ${rows.map((r) => `${r.branch.name} ${formatRand(r.cents)}`).join(', ')}`}>
        {rows.map((r) => (
          <div key={r.branch.id} className="group grid grid-cols-[160px_minmax(0,1fr)_110px] items-center gap-12 max-md:grid-cols-[100px_minmax(0,1fr)_90px]" title={`${r.branch.name}: ${formatRand(r.cents)} from ${r.payments} payments`}>
            <div className="truncate text-14 font-semibold">{r.branch.name}</div>
            <div className="h-12 rounded-legend-sm bg-field">
              <div className="h-full rounded-legend-sm bg-ink transition-[width] group-hover:bg-ink-2" style={{ width: `${Math.max(r.cents > 0 ? 2 : 0, (r.cents / max) * 100)}%` }} />
            </div>
            <div className="text-right text-15 font-bold tabular">{formatRand(r.cents)}</div>
          </div>
        ))}
      </div>
      <div className="-mx-10 overflow-x-auto">
        <table className="w-full tabular">
          <thead>
            <tr>
              {columns.map((c, i) => (
                <th key={c.header} className={cx(th, i > 0 && 'text-right')}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.branch.id} className="hover:bg-white">
                <td className={cx(td, 'font-semibold')}>{r.branch.name}</td>
                <td className={cx(td, 'text-right font-bold')}>{formatRand(r.cents)}</td>
                <td className={cx(td, 'text-right')}>{r.payments}</td>
                <td className={cx(td, 'text-right')}>{r.newMembers}</td>
                <td className={cx(td, 'text-right')}>{r.renewals}</td>
                <td className={cx(td, 'text-right')}>{r.active}</td>
                <td className={cx(td, 'text-right text-muted')}>{r.members}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

/* ---------------- Renewals due ---------------- */

function RenewalsReport(props: { members: Member[]; branches: Branch[]; today: LocalDate; scopeName: string; branchName: Record<string, string>; showBranch: boolean; onExport: Exporter }) {
  const { members, branches, today, scopeName, branchName, showBranch, onExport } = props
  const [days, setDays] = useState<7 | 30>(7)
  const prices = useMemo(() => Object.fromEntries(branches.map((b) => [b.id, b.prices])), [branches])
  const rows = useMemo(() => renewalsDue(members, today, days, prices), [members, today, days, prices])
  const atStake = rows.reduce((s, r) => s + (r.expectedCents ?? 0), 0)
  const columns: ExportColumn<RenewalDue>[] = [
    { header: 'Member', value: (r) => `${r.member.firstName} ${r.member.lastName}`, width: 24 },
    { header: 'Number', value: (r) => memberCode(r.member.number), width: 10 },
    ...(showBranch ? [{ header: 'Branch', value: (r: RenewalDue) => branchName[r.member.branchId ?? ''] ?? '', width: 20 }] : []),
    { header: 'Cellphone', value: (r) => formatCellphone(r.member.cellphone), width: 14 },
    { header: 'Paid until', value: (r) => r.paidUntil, width: 12 },
    { header: 'Days left', value: (r) => r.daysLeft, type: 'number', width: 10 },
    { header: 'Last paid for', value: (r) => (r.last ? `${r.last.qty} ${r.last.kind === 'months' ? (r.last.qty === 1 ? 'month' : 'months') : r.last.qty === 1 ? 'day' : 'days'}` : ''), width: 14 },
    { header: 'Expected', value: (r) => r.expectedCents, type: 'money' },
  ]
  const spec: ExportSpec<RenewalDue> = {
    file: `gymli-renewals-${today}-next-${days}-days`,
    title: `Renewals due in the next ${days} days`,
    subtitle: `${scopeName} · from ${formatFull(today)}`,
    columns,
    rows,
    totals: columns.map((c, i) => (i === 0 ? `${rows.length} members` : c.header === 'Expected' ? atStake : undefined)),
  }
  return (
    <Card className="p-28 max-md:p-18">
      <ReportHead title="Renewals due">
        <div role="radiogroup" aria-label="Within" className="flex gap-4 rounded-full bg-field p-5">
          {([7, 30] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={days === d} onClick={() => setDays(d)} className={cx('rounded-full px-16 py-8 text-14', days === d ? 'bg-ink font-semibold text-white' : 'font-medium text-ink-2')}>
              Next {d} days
            </button>
          ))}
        </div>
        <ExportButtons disabled={rows.length === 0} onExcel={() => onExport('xlsx', spec)} onPdf={() => onExport('pdf', spec)} />
      </ReportHead>
      <p className="mb-12 text-14 text-muted">
        {rows.length} member{rows.length === 1 ? '' : 's'} · about <span className="font-bold text-ink">{formatRand(atStake)}</span> at stake if they renew the same way. Phone them before their access ends.
      </p>
      {rows.length === 0 ? (
        <EmptyState title="No renewals due">No one's access ends in the next {days} days.</EmptyState>
      ) : (
        rows.map((r) => (
          <div key={r.member.id} className="flex items-center gap-14 border-t border-line-6 py-12">
            <span className={cx('flex h-32 min-w-48 items-center justify-center rounded-full px-10 text-13 font-bold tabular', r.daysLeft <= 3 ? 'bg-yellow' : 'bg-chip')}>{r.daysLeft === 0 ? 'Today' : `${r.daysLeft}d`}</span>
            <Link to={`/members/${r.member.id}`} className="min-w-0 flex-1">
              <div className="truncate text-16 font-semibold">
                {r.member.firstName} {r.member.lastName} <span className="font-normal text-muted">· {memberCode(r.member.number)}</span>
              </div>
              <div className="mt-2 truncate text-13 text-muted tabular">
                Paid until {formatDayMonth(r.paidUntil)}
                {showBranch && ` · ${branchName[r.member.branchId ?? ''] ?? ''}`}
              </div>
            </Link>
            <a href={`tel:${r.member.cellphone}`} className="flex h-40 items-center gap-6 rounded-full border border-line-10 px-14 text-14 font-semibold tabular hover:border-ink max-md:hidden">
              <Phone size={14} /> {formatCellphone(r.member.cellphone)}
            </a>
            <span className="w-100 text-right text-16 font-bold tabular">{r.expectedCents === null ? '—' : formatRand(r.expectedCents)}</span>
          </div>
        ))
      )}
    </Card>
  )
}

/* ---------------- Busiest hours ---------------- */

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HEAT = ['bg-heat-0', 'bg-heat-1', 'bg-heat-2', 'bg-heat-3', 'bg-heat-4', 'bg-heat-5']
const MAX_DAYS = 90

function BusiestHours({ branch, from, to }: { branch: Branch | null; from: LocalDate; to: LocalDate }) {
  const capped = diffDays(from, to) > MAX_DAYS - 1
  const start = capped ? addDays(to, -(MAX_DAYS - 1)) : from
  const [state, setState] = useState<{ logs: DoorLog[]; loading: boolean; error: string | null }>({ logs: [], loading: true, error: null })
  useEffect(() => {
    if (!branch) return
    let live = true
    setState((s) => ({ ...s, loading: true }))
    getDocs(query(collection(db, 'doorLogs'), where('branchId', '==', branch.id), where('date', '>=', start), where('date', '<=', to), orderBy('date'), limit(50_000)))
      .then((snap) => live && setState({ logs: snap.docs.map((d) => toDoorLog(d.id, d.data())), loading: false, error: null }))
      .catch(() => live && setState({ logs: [], loading: false, error: 'Could not load the door log. Check the internet connection.' }))
    return () => {
      live = false
    }
  }, [branch, start, to])

  const grid = useMemo(() => hourHeatmap(state.logs), [state.logs])
  const max = Math.max(0, ...grid.flat())
  const used = grid[0].map((_, h) => h).filter((h) => grid.some((row) => row[h] > 0))
  const hours = used.length ? Array.from({ length: Math.max(...used) - Math.min(...used) + 1 }, (_, i) => Math.min(...used) + i) : []
  const step = (n: number) => (n === 0 ? 0 : Math.min(5, Math.ceil((n / max) * 5)))
  const busiest = max > 0 ? grid.flatMap((row, d) => row.map((n, h) => ({ d, h, n }))).sort((a, b) => b.n - a.n)[0] : null

  return (
    <Card className="p-28 max-md:p-18">
      <ReportHead title="Busiest hours" />
      <p className="mb-16 text-14 text-muted">
        Check-ins at {branch?.name ?? 'this branch'} by day and hour, {rangeText(start, to)}
        {capped && ` (last ${MAX_DAYS} days of the range)`}.
        {busiest && (
          <>
            {' '}
            Busiest: <span className="font-bold text-ink">{DAYS[busiest.d]} {String(busiest.h).padStart(2, '0')}:00</span> ({busiest.n} check-ins).
          </>
        )}
      </p>
      {state.error && <ErrorNote>{state.error}</ErrorNote>}
      {state.loading ? (
        <SkeletonRows rows={5} />
      ) : max === 0 ? (
        <EmptyState title="No check-ins in this period">Busy times show here once members scan in.</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-2 tabular" aria-label="Check-ins by weekday and hour">
              <thead>
                <tr>
                  <th />
                  {hours.map((h) => (
                    <th key={h} scope="col" className="w-36 text-center text-11 font-medium text-muted">
                      {String(h).padStart(2, '0')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, d) => (
                  <tr key={d}>
                    <th scope="row" className="pr-8 text-left text-13 font-semibold">
                      {DAYS[d]}
                    </th>
                    {hours.map((h) => {
                      const n = row[h]
                      const s = step(n)
                      return (
                        <td key={h} title={`${DAYS[d]} ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00 · ${n} check-in${n === 1 ? '' : 's'}`} className={cx('h-32 w-36 rounded-legend-sm text-center text-11 font-semibold', HEAT[s], s >= 4 ? 'text-white' : 'text-ink-2')}>
                          {n > 0 && s >= 3 ? n : ''}
                          <span className="sr-only">{n}</span>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-14 flex items-center gap-8 text-12 text-muted" aria-hidden>
            Fewer
            {HEAT.slice(1).map((c) => (
              <span key={c} className={cx('size-14 rounded-legend-sm', c)} />
            ))}
            More
          </div>
        </>
      )}
    </Card>
  )
}
