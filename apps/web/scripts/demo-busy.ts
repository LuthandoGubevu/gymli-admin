/**
 * Makes the REAL Firebase project look like a busy gym, for a presentation.
 * Every write goes through firestore.rules, signed in as you (a manager).
 *
 *   npm run demo:busy -- you@yourgym.co.za 'your-password' [--members 150] [--days 28] [--no-live]
 *
 * For every branch already in the app (no branches are added):
 * - adds sample members (150 by default) with up to 14 months of payment history,
 *   tagged demo: 'busy' so they are not added twice;
 * - adds a check-in login "Turnstile 1" for the branch (saved on this PC in scripts/.demo-busy.json)
 *   and marks most fingerprints as enrolled;
 * - writes the last 28 days of turnstile scans, busiest early morning and after work.
 *
 * Then, while this window stays open (Ctrl+C to stop), the turnstiles show online and new scans
 * and renewals keep arriving. Run it again later to fill in the hours since the last run.
 * Note: door log and audit entries cannot be deleted from the app (by design).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, Timestamp, where, writeBatch, type Firestore } from 'firebase/firestore'
import { defaultStartDate, deniedText, evaluateAccess, paidUntil, periodEnd, type PeriodKind } from '../src/lib/access'
import { addDays, dateAtGym, diffDays, todayAtGym, weekdayMon0, type LocalDate } from '../src/lib/dates'
import { priceFor } from '../src/lib/accounts'
import type { Actor, Period, PaymentMethod, Prices } from '../src/lib/types'
import { sampleSaId } from './sampleData'
import { audit, config, connect, databaseId, DEMO_PRICES, type Who } from './demoShared'

const STATE_FILE = new URL('./.demo-busy.json', import.meta.url)
const OLD_DEVICE_FILE = new URL('./.demo-device.json', import.meta.url)
const BATCH = 400
const HOUR = 3_600_000

/* ---------------- Options ---------------- */

const argv = process.argv.slice(2)
const flag = (name: string, fallback: number) => {
  const i = argv.indexOf(`--${name}`)
  const n = i >= 0 ? Number(argv[i + 1]) : fallback
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}
const [email, password] = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.match(/^--(members|days)$/))
const PER_BRANCH = Math.min(flag('members', 150), 2000)
const DAYS = Math.min(flag('days', 28), 90)
const LIVE = !argv.includes('--no-live') && process.env.GYMLI_DEMO_NO_WAIT !== '1'

/* ---------------- Random but repeatable ---------------- */

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
type Rand = () => number
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const pick = <T,>(r: Rand, xs: readonly T[]) => xs[Math.floor(r() * xs.length)]
function weighted<T>(r: Rand, xs: readonly (readonly [T, number])[]): T {
  let n = r() * xs.reduce((s, [, w]) => s + w, 0)
  for (const [x, w] of xs) if ((n -= w) < 0) return x
  return xs[xs.length - 1][0]
}
function poisson(r: Rand, mean: number) {
  if (mean > 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * (r() + r() + r() - 1.5) * 2))
  const l = Math.exp(-mean)
  let k = 0
  let p = 1
  while ((p *= r()) > l) k++
  return k
}
const live = rng(Date.now() % 2 ** 31)

/* ---------------- Names ---------------- */

const FIRST = ['Sibusiso', 'Nomsa', 'Thandeka', 'Lungelo', 'Mpho', 'Kagiso', 'Lerato', 'Nandi', 'Bongani', 'Zanele', 'Tshepo', 'Ayanda', 'Sizwe', 'Palesa', 'Karabo', 'Neo', 'Lindiwe', 'Sello', 'Refilwe', 'Thulani', 'Nokuthula', 'Mandla', 'Busisiwe', 'Kabelo', 'Dineo', 'Andile', 'Zinhle', 'Tumelo', 'Naledi', 'Musa', 'Precious', 'Themba', 'Lwazi', 'Boitumelo', 'Sipho', 'Khanyisile', 'Vusi', 'Ntombi', 'Lebo', 'Siyabonga', 'Ruan', 'Chantelle', 'Pieter', 'Megan', 'Johan', 'Liezl', 'Riaan', 'Annika', 'Fatima', 'Yusuf', 'Aisha', 'Priya', 'Kevin', 'Nadia', 'Ashwin', 'Shireen', 'Tariq', 'Michelle', 'David', 'Jessica', 'Kamogelo', 'Onalenna', 'Unathi', 'Siphesihle', 'Asanda', 'Mbali', 'Kgothatso', 'Rethabile', 'Hlengiwe', 'Xolani']
const LAST = ['Dlamini', 'Nkosi', 'Ndlovu', 'Khumalo', 'Mokoena', 'Mahlangu', 'Zulu', 'Mthembu', 'Molefe', 'Sithole', 'Ngcobo', 'Tau', 'Mabena', 'Shabalala', 'Radebe', 'Nxumalo', 'Khoza', 'Mkhize', 'Cele', 'Buthelezi', 'Mazibuko', 'Mofokeng', 'Masilela', 'Maseko', 'Ntuli', 'Hadebe', 'Gumede', 'Zwane', 'Mabaso', 'Mohlala', 'Baloyi', 'Maluleke', 'Chauke', 'Mathebula', 'Nemutanzhela', 'Ramaphosa', 'Botha', 'van Wyk', 'Pretorius', 'Nel', 'du Plessis', 'Venter', 'Smit', 'Jacobs', 'Pillay', 'Naidoo', 'Govender', 'Patel', 'Moodley', 'Khan', 'Adams', 'Petersen', 'Hendricks', 'Williams', 'Daniels']
const DESK = [
  ['Zanele Mokoena', 'Kyle Petersen'],
  ['Thandi Mahlangu', 'Ruan Nel'],
  ['Palesa Nkosi', 'Imran Patel'],
  ['Nokwanda Zulu', 'Jaco Venter'],
]

/* ---------------- Gym rhythm ---------------- */

/** Share of a day's visits in each hour (index 0–23), weekdays and weekends. */
const WEEKDAY = [0, 0, 0, 0, 0, 8, 13, 10, 6, 4, 3, 3, 4, 4, 3, 3, 5, 11, 13, 9, 5, 2, 0, 0]
const SATURDAY = [0, 0, 0, 0, 0, 0, 4, 9, 13, 13, 11, 8, 5, 3, 2, 2, 2, 1, 0, 0, 0, 0, 0, 0]
const SUNDAY = [0, 0, 0, 0, 0, 0, 0, 5, 9, 10, 9, 6, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
/** Visits per day per member who may enter, by weekday (Mon first) */
const DAY_RATE = [0.52, 0.48, 0.46, 0.44, 0.36, 0.3, 0.17]
/** Renewals per day per branch member, roughly one a month each */
const RENEW_RATE = 1 / 30

const hourShares = (day: LocalDate) => {
  const w = weekdayMon0(day)
  const row = w === 5 ? SATURDAY : w === 6 ? SUNDAY : WEEKDAY
  const total = row.reduce((s, n) => s + n, 0)
  return row.map((n) => n / total)
}
const at = (day: LocalDate, hour: number, minute = 0) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+02:00`)
const hourOf = (ms: number) => new Date(ms + 2 * HOUR).getUTCHours()

/* ---------------- Members and payments ---------------- */

type Plan = 'day' | 'm1' | 'm3' | 'm6' | 'm12'
const PLAN: Record<Plan, { kind: PeriodKind; qty: number }> = {
  day: { kind: 'day', qty: 1 },
  m1: { kind: 'months', qty: 1 },
  m3: { kind: 'months', qty: 3 },
  m6: { kind: 'months', qty: 6 },
  m12: { kind: 'months', qty: 12 },
}

interface DemoMember {
  id: string
  number: number
  name: string
  branchId: string
  plan: Plan
  method: PaymentMethod
  enrolled: boolean
  periods: Period[]
}

interface BranchCtx {
  id: string
  name: string
  prices: Prices
  desk: Actor[]
  device: Who
  db: Firestore
  members: DemoMember[]
}

function paymentAt(r: Rand, day: LocalDate, now: number) {
  const shares = hourShares(day)
  const hour = weighted(r, shares.map((s, h) => [h, s] as const))
  const ms = at(day, hour, int(r, 0, 59))
  return ms <= now ? ms : now - int(r, 1, 50) * 60_000
}

function payment(r: Rand, b: BranchCtx, m: Pick<DemoMember, 'plan' | 'method'>, start: LocalDate, loggedAt: number): Period {
  const { kind, qty } = PLAN[m.plan]
  const by = b.desk[hourOf(loggedAt) < 13 ? 0 : b.desk.length - 1]
  return {
    id: crypto.randomUUID(),
    kind,
    qty,
    start,
    end: periodEnd(kind, qty, start),
    loggedBy: by,
    loggedAt,
    // day passes are paid at the desk
    method: m.plan === 'day' ? (r() < 0.6 ? 'cash' : 'card') : r() < 0.85 ? m.method : pick(r, ['cash', 'card'] as const),
    amountCents: priceFor(b.prices, kind, qty) ?? 45000,
  }
}

/** Up to 14 months of payments ending today: renewals, gaps, members who stopped. */
function history(r: Rand, b: BranchCtx, m: Pick<DemoMember, 'plan' | 'method'>, today: LocalDate, now: number): { since: LocalDate; periods: Period[] } {
  const ago = weighted(r, [[[0, 30], 14], [[31, 120], 30], [[121, 270], 32], [[271, 420], 24]] as const)
  const since = addDays(today, -int(r, ago[0], ago[1]))
  const periods: Period[] = []

  if (m.plan === 'day') {
    const days = new Set<LocalDate>()
    const n = int(r, 1, 8)
    for (let i = 0; i < n; i++) days.add(addDays(since, int(r, 0, diffDays(since, today))))
    for (const day of [...days].sort()) periods.push(payment(r, b, m, day, paymentAt(r, day, now)))
    return { since, periods }
  }

  // about 1 in 5 stopped coming; a few paid ahead for a period that has not started
  const stops = diffDays(since, today) > 40 && r() < 0.2 ? addDays(since, int(r, 30, diffDays(since, today) - 1)) : null
  let start = since
  while (start <= today && (!stops || start <= stops)) {
    const renewal = periods.length > 0
    // renewals are often paid a day or two early
    const payDay = renewal && r() < 0.35 ? addDays(start, -int(r, 1, 3)) : start
    const p = payment(r, b, m, start, paymentAt(r, payDay, now))
    periods.push(p)
    start = addDays(p.end, 1)
    if (r() < 0.1) start = addDays(start, int(r, 3, 35))
  }
  if (!stops && start > today && diffDays(today, start) <= 3 && r() < 0.15) {
    periods.push(payment(r, b, m, start, paymentAt(r, today, now)))
  }
  return { since, periods }
}

/* ---------------- Writes ---------------- */

async function inBatches<T>(db: Firestore, items: readonly T[], write: (batch: ReturnType<typeof writeBatch>, chunk: readonly T[]) => void) {
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = writeBatch(db)
    write(batch, items.slice(i, i + BATCH))
    await batch.commit()
  }
}

function doorLog(b: BranchCtx, m: DemoMember | null, time: number) {
  const date = dateAtGym(time)
  const decision = m ? evaluateAccess(m.periods, date) : null
  return {
    deviceId: b.device.uid,
    branchId: b.id,
    memberId: m?.id ?? null,
    memberName: m?.name ?? null,
    memberNumber: m?.number ?? null,
    result: decision?.allowed ? 'allowed' : 'denied',
    reason: !m ? 'not_recognised' : decision!.allowed ? null : decision!.reason,
    text: !m ? 'Fingerprint not recognised' : decision!.allowed ? 'Welcome' : deniedText(decision!.reason, decision!.date, date),
    paidUntil: decision?.allowed ? decision.paidUntil : null,
    at: time,
    date,
    offline: false,
  }
}

/** Turnstile scans from `from` to `to`, hour by hour. */
async function scans(b: BranchCtx, from: number, to: number) {
  const logs: ReturnType<typeof doorLog>[] = []
  const enrolled = b.members.filter((m) => m.enrolled)
  let day = ''
  let inside: DemoMember[] = []
  let outside: DemoMember[] = []
  for (let t = from; t < to; ) {
    const end = Math.min(to, Math.floor(t / HOUR) * HOUR + HOUR)
    if (dateAtGym(t) !== day) {
      day = dateAtGym(t)
      inside = enrolled.filter((m) => paidUntil(m.periods, day))
      outside = enrolled.filter((m) => !paidUntil(m.periods, day) && m.periods.length > 0)
    }
    const share = hourShares(day)[hourOf(t)] * ((end - t) / HOUR)
    const n = poisson(live, inside.length * DAY_RATE[weekdayMon0(day)] * share)
    for (let i = 0; i < n; i++) {
      const time = t + Math.floor(live() * (end - t))
      const roll = live()
      const m = roll < 0.03 ? null : roll < 0.07 && outside.length ? pick(live, outside) : inside.length ? pick(live, inside) : null
      logs.push(doorLog(b, m, time))
    }
    t = end
  }
  await inBatches(b.db, logs, (batch, chunk) => {
    for (const log of chunk) batch.set(doc(collection(b.db, 'doorLogs')), log)
  })
  return logs
}

/** Renewals from `from` to `to`: members whose time is up (or nearly) pay at the desk. */
async function renewals(mgrDb: Firestore, me: Who, b: BranchCtx, from: number, to: number) {
  const changed = new Map<DemoMember, Period>()
  for (let t = from; t < to; ) {
    const end = Math.min(to, Math.floor(t / HOUR) * HOUR + HOUR)
    const day = dateAtGym(t)
    const n = poisson(live, b.members.length * RENEW_RATE * hourShares(day)[hourOf(t)] * ((end - t) / HOUR))
    const due = b.members.filter((m) => {
      if (changed.has(m) || m.plan === 'day' || m.periods.length === 0) return false
      const until = paidUntil(m.periods, day)
      const last = m.periods.reduce((x, p) => (p.end > x ? p.end : x), '')
      // nearly out, or out for up to three weeks (not someone whose paid period starts later)
      return until ? diffDays(day, until) <= 3 : last < day && diffDays(last, day) <= 21
    })
    for (let i = 0; i < n && due.length; i++) {
      const m = due.splice(Math.floor(live() * due.length), 1)[0]
      const p = payment(live, b, m, defaultStartDate(m.periods, day), t + Math.floor(live() * (end - t)))
      m.periods.push(p)
      changed.set(m, p)
    }
    t = end
  }
  if (changed.size === 0) return 0
  const batch = writeBatch(mgrDb)
  const auditId = audit(mgrDb, batch, me, 'payment.create', 'branch', b.id, `Logged ${changed.size} renewal${changed.size > 1 ? 's' : ''} at ${b.name} (demo)`)
  for (const m of changed.keys()) batch.update(doc(mgrDb, 'members', m.id), { periods: m.periods, updatedAt: serverTimestamp(), lastAuditId: auditId })
  await batch.commit()
  return changed.size
}

/* ---------------- Main ---------------- */

interface State {
  devices: Record<string, { email: string; password: string }>
  scansUntil: Record<string, number>
  paymentsUntil: Record<string, number>
}

async function main() {
  if (!email || !password) {
    console.error("Usage: npm run demo:busy -- you@yourgym.co.za 'your-password' [--members 150] [--days 28] [--no-live]   (a manager login)")
    process.exit(1)
  }
  const state: State = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : { devices: {}, scansUntil: {}, paymentsUntil: {} }
  const save = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))

  // 1. You, as manager
  const mgr = connect('manager')
  try {
    await signInWithEmailAndPassword(mgr.auth, email, password)
  } catch {
    console.error('Could not sign in with that email and password.')
    process.exit(1)
  }
  const meSnap = await getDoc(doc(mgr.db, 'staff', mgr.auth.currentUser!.uid))
  if (!meSnap.exists() || meSnap.data().role !== 'manager' || meSnap.data().active !== true) {
    console.error('That login is not an active manager.')
    process.exit(1)
  }
  const me: Who = { uid: mgr.auth.currentUser!.uid, name: meSnap.data().name, role: 'manager' }

  // 2. Branches already in the app, front desk names, a turnstile login each
  const branchDocs = (await getDocs(collection(mgr.db, 'branches'))).docs.sort((a, b) => String(a.data().name).localeCompare(String(b.data().name)))
  if (branchDocs.length === 0) {
    console.error('There are no branches yet. Sign in to the app once and add your branch first.')
    process.exit(1)
  }
  const staff = (await getDocs(collection(mgr.db, 'staff'))).docs.map((d) => ({ uid: d.id, ...(d.data() as { name: string; role: string; branchId?: string; active: boolean }) }))
  const oldDevice = existsSync(OLD_DEVICE_FILE) ? (JSON.parse(readFileSync(OLD_DEVICE_FILE, 'utf8')) as { email: string; password: string }) : null

  console.log(`${config.projectId} / ${databaseId}: ${branchDocs.length} branch${branchDocs.length > 1 ? 'es' : ''}, ${PER_BRANCH} busy members each, ${DAYS} days of scans`)
  const branches: BranchCtx[] = []
  for (const [i, bd] of branchDocs.entries()) {
    const name = String(bd.data().name)
    let prices = (bd.data().prices ?? {}) as Prices
    if (!Object.values(prices).some((v) => typeof v === 'number')) {
      prices = DEMO_PRICES
      const batch = writeBatch(mgr.db)
      const auditId = audit(mgr.db, batch, me, 'branch.prices', 'branch', bd.id, `Set prices for ${name} (demo)`)
      batch.update(bd.ref, { prices, lastAuditId: auditId })
      await batch.commit()
    }
    const realDesk = staff.filter((s) => s.role === 'front_desk' && s.active && s.branchId === bd.id).map((s) => ({ uid: s.uid, name: s.name }))
    const desk = realDesk.length ? realDesk : DESK[i % DESK.length].map((n) => ({ uid: `demo-${bd.id}-${n.split(' ')[0].toLowerCase()}`, name: n }))

    // the turnstile login for this branch
    const dev = connect(`device-${i}`)
    let login = state.devices[bd.id]
    if (!login && oldDevice) {
      await signInWithEmailAndPassword(dev.auth, oldDevice.email, oldDevice.password).catch(() => null)
      const uid = dev.auth.currentUser?.uid
      if (uid && staff.find((s) => s.uid === uid)?.branchId === bd.id) login = oldDevice
    }
    if (login) {
      if (!dev.auth.currentUser) await signInWithEmailAndPassword(dev.auth, login.email, login.password)
    } else {
      login = { email: `turnstile-${randomBytes(3).toString('hex')}@gymli.local`, password: randomBytes(15).toString('base64url') }
      const uid = (await createUserWithEmailAndPassword(dev.auth, login.email, login.password)).user.uid
      const batch = writeBatch(mgr.db)
      audit(mgr.db, batch, me, 'staff.create', 'staff', uid, `Added Turnstile 1 at ${name} as device`)
      batch.set(doc(mgr.db, 'staff', uid), { name: 'Turnstile 1', email: login.email, role: 'device', branchId: bd.id, active: true, createdAt: serverTimestamp() })
      await batch.commit()
    }
    state.devices[bd.id] = login
    save()
    const device: Who = { uid: dev.auth.currentUser!.uid, name: 'Turnstile 1', role: 'device' }
    branches.push({ id: bd.id, name, prices, desk, device, db: dev.db, members: [] })
  }

  // 3. Busy members already added on an earlier run
  for (const d of (await getDocs(query(collection(mgr.db, 'members'), where('demo', '==', 'busy')))).docs) {
    const data = d.data()
    const b = branches.find((x) => x.id === data.branchId)
    if (!b || data.deleted) continue
    const periods = (data.periods as Period[]).filter((p) => !p.deleted)
    const last = periods[periods.length - 1]
    b.members.push({
      id: d.id,
      number: data.number,
      name: `${data.firstName} ${data.lastName}`,
      branchId: b.id,
      plan: last ? ((Object.entries(PLAN).find(([, v]) => v.kind === last.kind && v.qty === last.qty)?.[0] as Plan) ?? 'm1') : 'm1',
      method: last?.method ?? 'card',
      enrolled: data.fingerprint != null,
      periods,
    })
  }

  // 4. New members, their payments and fingerprints
  const today = todayAtGym()
  const now = Date.now()
  const counterRef = doc(mgr.db, 'counters', 'members')
  const phones = new Set<string>()
  for (const [bi, b] of branches.entries()) {
    const missing = PER_BRANCH - b.members.length
    if (missing <= 0) continue
    process.stdout.write(`${b.name}: adding ${missing} members `)
    const r = rng(9_973 * (bi + 1) + b.members.length)
    const added: DemoMember[] = []
    for (let i = 0; i < missing; i++) {
      const first = pick(r, FIRST)
      const last = pick(r, LAST)
      let phone = ''
      do phone = '0' + pick(r, ['60', '61', '62', '63', '71', '72', '73', '74', '76', '78', '79', '81', '82', '83', '84']) + String(int(r, 0, 9_999_999)).padStart(7, '0')
      while (phones.has(phone))
      phones.add(phone)
      const plan = weighted(r, [['m1', 62], ['m3', 13], ['m6', 7], ['m12', 8], ['day', 10]] as const)
      const method = weighted(r, [['debit_order', 38], ['card', 30], ['cash', 18], ['eft', 14]] as const)
      const { since, periods } = history(r, b, { plan, method }, today, now)

      // one member per write: the GY number counter must go up by exactly one
      const memberRef = doc(collection(mgr.db, 'members'))
      let number = 0
      for (let attempt = 0; ; attempt++) {
        const c = await getDoc(counterRef)
        number = c.exists() ? c.data().next : 1001
        const batch = writeBatch(mgr.db)
        if (c.exists()) batch.update(counterRef, { next: number + 1 })
        else batch.set(counterRef, { next: number + 1 })
        const auditId = audit(mgr.db, batch, me, 'member.create', 'member', memberRef.id, `Added ${first} ${last} (GY-${number})`)
        batch.set(memberRef, {
          branchId: b.id,
          number,
          firstName: first,
          lastName: last,
          cellphone: phone,
          periods: [],
          fingerprint: null,
          deleted: false,
          demo: 'busy',
          createdAt: Timestamp.fromMillis(Math.min(now, at(since, 6))),
          updatedAt: serverTimestamp(),
          lastAuditId: auditId,
        })
        const id = sampleSaId(number)
        batch.set(doc(mgr.db, 'members', memberRef.id, 'private', 'details'), {
          email: r() < 0.7 ? `${first}.${last}`.toLowerCase().replace(/\s+/g, '') + `${number % 100}@example.co.za` : '',
          dateOfBirth: `19${id.slice(0, 2)}-${id.slice(2, 4)}-${id.slice(4, 6)}`,
          idType: 'sa',
          idLast3: id.slice(-3),
          emergencyName: r() < 0.6 ? `${pick(r, FIRST)} ${last}` : '',
          emergencyPhone: '',
          notes: '',
          lastAuditId: auditId,
        })
        batch.set(doc(mgr.db, 'members', memberRef.id, 'private', 'identity'), { idType: 'sa', idNumber: id, lastAuditId: auditId })
        try {
          await batch.commit()
          break
        } catch (e) {
          if (attempt >= 2) throw e // someone else added a member at the same moment; try again
        }
      }
      added.push({ id: memberRef.id, number, name: `${first} ${last}`, branchId: b.id, plan, method, enrolled: r() < 0.95, periods })
      if (i % 10 === 9) process.stdout.write('.')
    }

    await inBatches(mgr.db, added.filter((m) => m.periods.length), (batch, chunk) => {
      const auditId = audit(mgr.db, batch, me, 'payment.create', 'branch', b.id, `Logged payments for ${chunk.length} members at ${b.name} (demo)`)
      for (const m of chunk) batch.update(doc(mgr.db, 'members', m.id), { periods: m.periods, updatedAt: serverTimestamp(), lastAuditId: auditId })
    })
    await inBatches(b.db, added.filter((m) => m.enrolled), (batch, chunk) => {
      const auditId = audit(b.db, batch, b.device, 'fingerprint.enrol', 'branch', b.id, `Enrolled ${chunk.length} fingerprints (demo)`)
      for (const m of chunk) batch.update(doc(b.db, 'members', m.id), { fingerprint: { finger: 'right_index', enrolledAt: m.periods[0]?.loggedAt ?? now }, updatedAt: serverTimestamp(), lastAuditId: auditId })
    })
    b.members.push(...added)
    state.paymentsUntil[b.id] = now
    save()
    console.log(' done')
  }

  // 5. Scans and renewals up to now, then keep going while the window is open
  const catchUp = async (quiet = false) => {
    const t = Date.now()
    for (const b of branches) {
      const fromScans = Math.max(state.scansUntil[b.id] ?? 0, at(addDays(today, -(DAYS - 1)), 0))
      const fromPay = Math.max(state.paymentsUntil[b.id] ?? t, at(addDays(today, -(DAYS - 1)), 0))
      const paid = await renewals(mgr.db, me, b, fromPay, t)
      state.paymentsUntil[b.id] = t
      const logs = await scans(b, fromScans, t)
      state.scansUntil[b.id] = t
      save()
      if (!quiet || logs.length || paid) {
        const allowed = logs.filter((l) => l.result === 'allowed').length
        console.log(`${b.name}: ${logs.length} scans (${allowed} let in)${paid ? `, ${paid} renewals` : ''}`)
      }
    }
  }
  await catchUp()

  const beat = () =>
    Promise.all(
      branches.map((b) =>
        setDoc(doc(b.db, 'devices', b.device.uid), {
          name: 'Turnstile 1',
          branchId: b.id,
          lastSeenAt: Date.now(),
          mode: 'simulation',
          readerConnected: true,
          relayConnected: true,
          pendingLogs: 0,
          appVersion: 'demo',
        }),
      ),
    ).catch((e) => console.error('Heartbeat failed:', (e as Error).message))
  await beat()
  if (!LIVE) process.exit(0)
  setInterval(beat, 10_000)
  setInterval(() => catchUp(true).catch((e) => console.error('Could not add scans:', (e as Error).message)), 20_000)
  console.log('Turnstiles show online and new scans keep coming while this window stays open. Press Ctrl+C to stop.')
}

main().catch((e) => {
  console.error((e as Error).message ?? e)
  process.exit(1)
})
