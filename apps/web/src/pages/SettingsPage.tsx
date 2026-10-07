import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'
import { Building2, Check, Tag, FileUp, KeyRound, MonitorSmartphone, Pencil, Plus, Usb, UserPlus, WifiOff } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Avatar, Button, Card, CardTitle, cx, EmptyState, ErrorNote, PageHeader, Pill, SkeletonRows, TextField } from '../components/ui'
import { Modal } from '../components/ui/Modal'
import { useToast } from '../components/ui/Toast'
import { addBranch, addMember, authMessage, EMPTY_MEMBER_INPUT, createStaff, logPayment, renameBranch, setBranchPrices, setStaffActive, type NewStaffInput } from '../data/actions'
import { toAudit } from '../data/convert'
import { useGym, useNow, useStaff, useToday } from '../data/store'
import { importedPeriod, parseMemberCsv, type ImportRow } from '../lib/csvImport'
import { dateAtGym, formatDayMonth, formatSmart, timeAtGym } from '../lib/dates'
import { db } from '../lib/firebase'
import { formatRand, parseRand, PRICE_KEYS, PRICE_LABEL } from '../lib/accounts'
import { initials, isDeviceOnline, ROLE_LABEL, type AuditEntry, type Branch, type Prices, type Device, type Role, type Staff } from '../lib/types'

export function SettingsPage() {
  const me = useStaff()
  if (me.role !== 'manager')
    return (
      <Card className="p-28">
        <EmptyState title="Managers only">Ask a manager to change settings.</EmptyState>
      </Card>
    )
  return (
    <>
      <PageHeader eyebrow="Managers only" title="Settings" />
      <BranchesCard />
      <div className="grid grid-cols-2 items-start gap-16 max-lg:grid-cols-1">
        <StaffCard />
        <DevicesCard />
      </div>
      <ImportCard />
      <AuditCard />
    </>
  )
}

function BranchesCard() {
  const me = useStaff()
  const toast = useToast()
  const { branches } = useGym()
  const [editing, setEditing] = useState<Branch | 'new' | null>(null)
  const [pricing, setPricing] = useState<Branch | null>(null)
  return (
    <Card className="p-28 max-md:p-18">
      <div className="mb-10 flex items-center gap-14">
        <CardTitle size={32}>Branches</CardTitle>
        <div className="flex-1" />
        <Button size="sm" icon={Plus} onClick={() => setEditing('new')}>
          Add branch
        </Button>
      </div>
      {branches.loading ? (
        <SkeletonRows rows={2} />
      ) : (
        branches.data.map((b) => (
          <div key={b.id} className="flex items-center gap-14 border-t border-line-6 py-12">
            <span className="flex size-42 items-center justify-center rounded-full bg-chip">
              <Building2 size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-16 font-semibold">{b.name}</div>
              <div className="mt-2 truncate text-13 text-muted tabular">
                {PRICE_KEYS.some((k) => typeof b.prices[k] === 'number')
                  ? PRICE_KEYS.filter((k) => typeof b.prices[k] === 'number').map((k) => `${PRICE_LABEL[k]} ${formatRand(b.prices[k]!)}`).join(' · ')
                  : 'No prices set'}
              </div>
            </div>
            <Button variant="ghost" size="sm" icon={Tag} onClick={() => setPricing(b)}>
              Prices
            </Button>
            <Button variant="ghost" size="sm" icon={Pencil} onClick={() => setEditing(b)}>
              Rename
            </Button>
          </div>
        ))
      )}
      <PricesModal branch={pricing} onClose={() => setPricing(null)} />
      <BranchModal
        branch={editing}
        onClose={() => setEditing(null)}
        onSave={async (name) => {
          if (editing === 'new') {
            await addBranch(me, name)
            toast(`${name.trim()} added`)
          } else if (editing) {
            await renameBranch(me, editing.id, editing.name, name)
            toast('Branch renamed')
          }
          setEditing(null)
        }}
      />
    </Card>
  )
}

function PricesModal({ branch, onClose }: { branch: Branch | null; onClose: () => void }) {
  const me = useStaff()
  const toast = useToast()
  const [text, setText] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!branch) return
    setText(Object.fromEntries(PRICE_KEYS.map((k) => [k, typeof branch.prices[k] === 'number' ? String(branch.prices[k]! / 100) : ''])))
    setError(null)
    setBusy(false)
  }, [branch])

  async function save() {
    if (!branch) return
    const prices: Prices = {}
    for (const k of PRICE_KEYS) {
      const t = (text[k] ?? '').trim()
      if (!t) {
        prices[k] = null
        continue
      }
      const c = parseRand(t)
      if (c === null) return setError(`Check the price for ${PRICE_LABEL[k].toLowerCase()}`)
      prices[k] = c
    }
    setBusy(true)
    setError(null)
    try {
      await setBranchPrices(me, branch.id, branch.name, branch.prices, prices)
      toast('Prices saved')
      onClose()
    } catch (e) {
      setError(authMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal open={!!branch} onClose={onClose} locked={busy} width="md" eyebrow={branch?.name ?? 'Branch'} title="Prices">
      <div className="flex flex-col gap-16">
        <div className="text-15 text-ink-2">These fill in the amount when a payment is logged. Staff can still change it. Leave a price empty to type the amount each time.</div>
        <div className="grid grid-cols-2 gap-12 max-md:grid-cols-1">
          {PRICE_KEYS.map((k) => (
            <TextField key={k} label={PRICE_LABEL[k]} inputMode="decimal" placeholder="R" value={text[k] ?? ''} onChange={(e) => setText((t) => ({ ...t, [k]: e.target.value }))} />
          ))}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-10">
          <Button variant="ghost" size="xl" className="border-line-14 px-26" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="xl" icon={Check} loading={busy} onClick={save}>Save prices</Button>
        </div>
      </div>
    </Modal>
  )
}

export function BranchModal({ branch, onClose, onSave }: { branch: Branch | 'new' | null; onClose: () => void; onSave: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!branch) return
    setName(branch === 'new' ? '' : branch.name)
    setError(null)
    setBusy(false)
  }, [branch])

  async function save() {
    setBusy(true)
    setError(null)
    try {
      await onSave(name)
    } catch (e) {
      setError(authMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal open={!!branch} onClose={onClose} locked={busy} width="md" eyebrow="Branches" title={branch === 'new' ? 'Add branch' : 'Rename branch'}>
      <div className="flex flex-col gap-16">
        <TextField label="Branch name" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example Body Tone Soweto" />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-10">
          <Button variant="ghost" size="xl" className="border-line-14 px-26" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="xl" icon={Check} loading={busy} onClick={save}>{branch === 'new' ? 'Add branch' : 'Save'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function StaffCard() {
  const me = useStaff()
  const toast = useToast()
  const { staffList, branches } = useGym()
  const [adding, setAdding] = useState<Role | null>(null)
  const people = staffList.data.filter((s) => s.role !== 'device')
  const branchName = (s: Staff) => (s.role === 'manager' ? 'All branches' : (branches.data.find((b) => b.id === s.branchId)?.name ?? 'No branch'))
  return (
    <Card className="p-28 max-md:p-18">
      <div className="mb-10 flex items-center gap-14">
        <CardTitle size={32}>Staff logins</CardTitle>
        <div className="flex-1" />
        <Button size="sm" icon={UserPlus} onClick={() => setAdding('front_desk')}>
          Add staff
        </Button>
      </div>
      {staffList.loading ? (
        <SkeletonRows rows={3} />
      ) : (
        people.map((s) => (
          <div key={s.uid} className="flex items-center gap-14 border-t border-line-6 py-12">
            <Avatar text={initials(s.name)} tone={s.active ? 'ink' : 'neutral'} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-16 font-semibold">
                {s.name} {s.uid === me.uid && <span className="font-normal text-muted">· you</span>}
              </div>
              <div className="mt-2 truncate text-13 text-muted">
                {ROLE_LABEL[s.role]} · {branchName(s)} · {s.email}
              </div>
            </div>
            {!s.active && <Pill tone="neutral" size="sm">Switched off</Pill>}
            {s.uid !== me.uid && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setStaffActive(me, s, !s.active)
                    .then(() => toast(s.active ? `${s.name} switched off` : `${s.name} switched on`))
                    .catch((e) => toast(authMessage(e)))
                }
              >
                {s.active ? 'Switch off' : 'Switch on'}
              </Button>
            )}
          </div>
        ))
      )}
      <NewLoginModal role={adding} onClose={() => setAdding(null)} />
    </Card>
  )
}

function DevicesCard() {
  const { staffList, devices, branch } = useGym()
  const now = useNow()
  const [adding, setAdding] = useState(false)
  const logins = staffList.data.filter((s) => s.role === 'device' && s.branchId === branch?.id)
  const ref = useRef<HTMLDivElement>(null)
  const { hash } = useLocation()
  useEffect(() => {
    if (hash === '#turnstile') ref.current?.scrollIntoView({ block: 'start' })
  }, [hash])
  return (
    <div ref={ref} id="turnstile" className="scroll-mt-24">
    <Card className="p-28 max-md:p-18">
      <div className="mb-10 flex items-center gap-14">
        <CardTitle size={32}>Check-in PCs</CardTitle>
        {branch && <span className="text-14 text-muted">{branch.name}</span>}
        <div className="flex-1" />
        <Button size="sm" icon={Plus} variant="outline" onClick={() => setAdding(true)}>
          Add check-in login
        </Button>
      </div>
      {logins.length === 0 ? (
        <EmptyState icon={MonitorSmartphone} title="No check-in PC yet">
          Add a check-in login for this branch, then enter it in the check-in program on the reception PC.
        </EmptyState>
      ) : (
        logins.map((s) => {
          const d = devices.data.find((x) => x.id === s.uid)
          const online = isDeviceOnline(d, now)
          return (
            <div key={s.uid} className="border-t border-line-6">
              <div className="flex items-center gap-14 py-12">
              <span className={cx('flex size-42 items-center justify-center rounded-full', online ? 'bg-green-soft text-green-deep' : 'bg-chip')}>
                <MonitorSmartphone size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-16 font-semibold">{d?.name ?? s.name}</div>
                <div className="mt-2 truncate text-13 text-muted">
                  {s.email} · {d ? (online ? 'online' : `last seen ${formatDayMonth(dateAtGym(d.lastSeenAt))} ${timeAtGym(d.lastSeenAt)}`) : 'not signed in yet'}
                </div>
              </div>
              <Pill tone={online ? 'green' : 'neutral'} size="sm">{online ? 'Online' : 'Offline'}</Pill>
              </div>
              {d && <DeviceStatus device={d} />}
            </div>
          )
        })
      )}
      <NewLoginModal role={adding ? 'device' : null} onClose={() => setAdding(false)} />
    </Card>
    </div>
  )
}

/** Reader, relay and upload status reported by the check-in PC. */
function DeviceStatus({ device }: { device: Device }) {
  const sim = device.mode === 'simulation'
  return (
    <div className="mb-8 ml-56 max-md:ml-0">
      <StatusLine ok={device.readerConnected} label={device.readerConnected ? 'Fingerprint reader connected' : 'Fingerprint reader not found'} detail={sim ? 'Simulation mode' : 'DigitalPersona 4500'} />
      <StatusLine ok={device.relayConnected} label={device.relayConnected ? 'Turnstile relay connected' : 'Turnstile relay not found'} detail={sim ? 'Simulated pulses' : 'USB relay'} relay />
      <StatusLine ok={device.pendingLogs === 0} label={device.pendingLogs === 0 ? 'Door log up to date' : `${device.pendingLogs} scans waiting to upload`} detail={device.appVersion ? `App ${device.appVersion}` : ''} />
    </div>
  )
}

function StatusLine({ ok, label, detail, relay }: { ok: boolean; label: string; detail: string; relay?: boolean }) {
  return (
    <div className="flex items-center gap-12 py-8">
      <span className={cx('flex size-32 shrink-0 items-center justify-center rounded-full', ok ? 'bg-green-soft text-green-deep' : 'bg-red-soft text-red-deep')}>
        {ok ? <Check size={15} strokeWidth={2.5} /> : relay ? <Usb size={15} /> : <WifiOff size={15} />}
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-14 font-semibold">{label}</span>
        {detail && <span className="ml-8 text-13 text-muted">{detail}</span>}
      </div>
    </div>
  )
}

function randomPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

function NewLoginModal({ role, onClose }: { role: Role | null; onClose: () => void }) {
  const me = useStaff()
  const toast = useToast()
  const { branches, branch } = useGym()
  const isDevice = role === 'device'
  const [form, setForm] = useState<NewStaffInput>({ name: '', email: '', password: '', role: 'front_desk', branchId: null })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<NewStaffInput | null>(null)

  useEffect(() => {
    if (!role) return
    const branchId = branch?.id ?? null
    const slug = (branch?.name ?? 'branch').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    setForm(isDevice ? { name: 'Turnstile 1', email: `checkin-${slug}@gymli.local`, password: randomPassword(), role: 'device', branchId } : { name: '', email: '', password: '', role: 'front_desk', branchId })
    setError(null)
    setCreated(null)
    setBusy(false)
  }, [role, isDevice, branch?.id])

  async function save() {
    if (!form.name.trim() || !form.email.includes('@')) return setError('Enter a name and an email')
    if (form.password.length < 8) return setError('Use at least 8 characters for the password')
    if (form.role !== 'manager' && !form.branchId) return setError('Choose a branch')
    setBusy(true)
    setError(null)
    try {
      await createStaff(me, form)
      if (isDevice) setCreated(form)
      else {
        toast(`${form.name} can now sign in`)
        onClose()
      }
    } catch (e) {
      setError(authMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open={!!role} onClose={onClose} locked={busy} width="md" eyebrow={isDevice ? 'Reception PC' : 'New login'} title={isDevice ? 'Check-in login' : 'Add staff'}>
      {created ? (
        <div className="flex flex-col gap-16">
          <div className="text-16 text-ink-2">Enter these in the check-in program on the reception PC. The password is shown only once.</div>
          <div className="rounded-tile bg-field p-20 text-16 tabular">
            <div className="text-13 text-muted">Email</div>
            <div className="font-semibold select-all">{created.email}</div>
            <div className="mt-12 text-13 text-muted">Password</div>
            <div className="font-semibold select-all">{created.password}</div>
          </div>
          <Button size="xl" icon={Check} onClick={onClose}>Done</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-16">
          <TextField label={isDevice ? 'Name of this PC' : 'Name'} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <TextField label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} autoComplete="off" />
          <TextField label="Password" icon={KeyRound} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} hint="At least 8 characters. Give it to them in person." autoComplete="new-password" />
          {!isDevice && (
            <div>
              <div className="mb-8 text-13 font-medium text-muted">Role</div>
              <div role="radiogroup" className="flex gap-4 rounded-full bg-field p-5">
                {(['front_desk', 'manager'] as const).map((r) => (
                  <button key={r} type="button" role="radio" aria-checked={form.role === r} onClick={() => setForm({ ...form, role: r })} className={cx('flex-1 rounded-full px-22 py-11 text-14', form.role === r ? 'bg-ink font-semibold text-white' : 'font-medium text-ink-2')}>
                    {ROLE_LABEL[r]}
                  </button>
                ))}
              </div>
              <div className="mt-8 ml-20 text-12 text-muted">Managers see every branch, can change and delete payments, remove members and see the audit log.</div>
            </div>
          )}
          {form.role !== 'manager' && (
            <div>
              <div className="mb-8 text-13 font-medium text-muted">Branch</div>
              <div role="radiogroup" className="flex flex-wrap gap-4 rounded-tile bg-field p-5">
                {branches.data.map((b) => (
                  <button key={b.id} type="button" role="radio" aria-checked={form.branchId === b.id} onClick={() => setForm({ ...form, branchId: b.id })} className={cx('flex-1 rounded-full px-22 py-11 text-14 whitespace-nowrap', form.branchId === b.id ? 'bg-ink font-semibold text-white' : 'font-medium text-ink-2')}>
                    {b.name}
                  </button>
                ))}
              </div>
              <div className="mt-8 ml-20 text-12 text-muted">{isDevice ? 'This PC only lets in members of this branch.' : 'They will only see this branch.'}</div>
            </div>
          )}
          {error && <ErrorNote>{error}</ErrorNote>}
          <div className="flex justify-end gap-10">
            <Button variant="ghost" size="xl" className="border-line-14 px-26" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button size="xl" icon={Check} loading={busy} onClick={save}>Create login</Button>
          </div>
        </div>
      )}
    </Modal>
  )
}

function ImportCard() {
  const me = useStaff()
  const today = useToday()
  const toast = useToast()
  const { members, branch } = useGym()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null)
  const existing = useMemo(() => new Set(members.data.map((m) => m.cellphone)), [members.data])

  const ok = rows?.filter((r) => !r.error && !existing.has(r.cellphone)) ?? []
  const dupes = rows?.filter((r) => !r.error && existing.has(r.cellphone)) ?? []
  const bad = rows?.filter((r) => r.error) ?? []

  async function run() {
    if (!branch) return
    setProgress({ done: 0, total: ok.length, failed: 0 })
    let done = 0
    let failed = 0
    for (const r of ok) {
      try {
        const { id } = await addMember(
          me,
          {
            ...EMPTY_MEMBER_INPUT,
            firstName: r.firstName,
            lastName: r.lastName,
            cellphone: r.cellphone,
            email: r.email,
            idType: r.idType,
            idNumber: r.idNumber,
          },
          today,
          branch.id,
        )
        if (r.paidUntil) {
          const p = importedPeriod(r.paidUntil, today)
          await logPayment(me, id, { kind: 'days', qty: p.days, start: p.start })
        }
      } catch {
        failed++
      }
      done++
      setProgress({ done, total: ok.length, failed })
    }
    toast(`Imported ${done - failed} members`)
    setRows(null)
    setProgress(null)
  }

  return (
    <Card className="p-28 max-md:p-18">
      <div className="mb-10 flex flex-wrap items-center gap-14">
        <CardTitle size={32}>Import members</CardTitle>
        {branch && <span className="text-14 text-muted">into {branch.name}</span>}
        <div className="flex-1" />
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]
          if (f) setRows(parseMemberCsv(await f.text(), today))
          e.target.value = ''
        }} />
        <Button size="sm" variant="outline" icon={FileUp} onClick={() => fileRef.current?.click()} disabled={!!progress}>Choose CSV file</Button>
      </div>
      <div className="text-14 text-muted">
        Columns: name, cellphone, paid until, and optionally email and ID number (for example <span className="font-semibold text-ink">Thabo Nkosi, 082 123 4101, 31/10/2026</span>). Members without an ID number show “ID number missing” until staff add it. Members already on the list (same cellphone) are skipped.
      </div>
      {rows && (
        <div className="mt-16 flex flex-col gap-12">
          <div className="flex flex-wrap gap-8">
            <Pill tone="green">{ok.length} ready</Pill>
            {dupes.length > 0 && <Pill tone="neutral">{dupes.length} already on the list</Pill>}
            {bad.length > 0 && <Pill tone="red">{bad.length} with problems</Pill>}
          </div>
          <div className="max-h-320 overflow-auto rounded-tile border border-line-8">
            {[...bad, ...ok.slice(0, 50)].map((r) => (
              <div key={r.line} className="flex items-center gap-12 border-t border-line-6 px-16 py-10 text-14 first:border-t-0">
                <span className="w-40 text-muted tabular">{r.line}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{`${r.firstName} ${r.lastName}`.trim() || '—'}</span>
                <span className="w-110 text-muted tabular">{r.cellphone}</span>
                <span className="w-110 tabular">{r.paidUntil ? formatSmart(r.paidUntil, today) : 'No date'}</span>
                {r.error ? <span className="font-semibold text-red-deep">{r.error}</span> : <Check size={16} className="text-green-deep" />}
              </div>
            ))}
          </div>
          {progress ? (
            <div className="text-15 font-semibold" role="status">Importing {progress.done} of {progress.total}{progress.failed ? ` · ${progress.failed} failed` : ''}</div>
          ) : (
            <div className="flex justify-end gap-10">
              <Button variant="ghost" size="lg" onClick={() => setRows(null)}>Cancel</Button>
              <Button size="lg" icon={Check} onClick={run} disabled={ok.length === 0}>Import {ok.length} members</Button>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function AuditCard() {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState(false)
  useEffect(
    () =>
      onSnapshot(
        query(collection(db, 'audit'), orderBy('at', 'desc'), limit(30)),
        (snap) => setEntries(snap.docs.map((d) => toAudit(d.id, d.data()))),
        () => setError(true),
      ),
    [],
  )
  return (
    <Card className="p-28 max-md:p-18">
      <div className="mb-10 flex items-center gap-14">
        <CardTitle size={32}>Audit trail</CardTitle>
        <div className="flex-1" />
        <div className="text-14 text-muted">Latest 30 changes · cannot be edited</div>
      </div>
      {error && <ErrorNote>Could not load the audit trail.</ErrorNote>}
      {!entries ? (
        <SkeletonRows rows={4} />
      ) : entries.length === 0 ? (
        <EmptyState title="No changes yet" />
      ) : (
        entries.map((a) => <AuditRow key={a.id} a={a} />)
      )}
    </Card>
  )
}

function AuditRow({ a }: { a: AuditEntry }) {
  const tone = a.action.endsWith('delete') || a.action.endsWith('remove') ? 'red' : a.action.endsWith('update') ? 'yellow' : 'neutral'
  return (
    <div className="flex items-center gap-14 border-t border-line-6 py-12 max-md:flex-wrap">
      <div className="w-110 shrink-0 text-14 text-muted tabular">
        {a.at ? `${formatDayMonth(dateAtGym(a.at))} ${timeAtGym(a.at)}` : '…'}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-15 font-semibold">{a.summary}</div>
        <div className="mt-2 text-13 text-muted">
          {a.actor?.name} · {a.actor ? ROLE_LABEL[a.actor.role as Staff['role']] : ''}
        </div>
      </div>
      <Pill tone={tone} size="sm">{a.action.split('.')[1]}</Pill>
    </div>
  )
}
