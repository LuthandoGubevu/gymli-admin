/**
 * Seeds the Firebase EMULATOR with the 30 sample members from the design, relative to today.
 * Every write goes through firestore.rules (no admin access), as the real app does.
 *
 *   npm run emulators        (in another terminal)
 *   npm run seed
 *
 * Logins created (password for all: gymli-demo-2026):
 *   grace@gymli.co.za     Manager
 *   zodwa@gymli.co.za     Front desk
 *   sibusiso@gymli.co.za  Front desk
 *   turnstile1@gymli.local  Check-in PC
 */
import { initializeApp } from 'firebase/app'
import { connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getFirestore,
  runTransaction,
  serverTimestamp,
  setDoc,
  Timestamp,
  writeBatch,
} from 'firebase/firestore'
import { periodEnd, type PeriodKind } from '../src/lib/access'
import { addDays, addMonthsClamped, dateAtGym, todayAtGym, type LocalDate } from '../src/lib/dates'

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-gymli'
const PASSWORD = 'gymli-demo-2026'
const TODAY: LocalDate = process.env.SEED_TODAY ?? todayAtGym()

const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

/** Day offsets are relative to the design's "today", Thu 1 Oct 2026. */
const d = (offset: number) => addDays(TODAY, offset)
/** Time at the gym (UTC+2) on a date. */
const at = (date: LocalDate, hhmm: string) => Date.parse(`${date}T${hhmm}:00+02:00`)

interface Who {
  uid: string
  name: string
  role: 'manager' | 'front_desk' | 'device'
}

async function login(email: string, name: string): Promise<string> {
  try {
    return (await createUserWithEmailAndPassword(auth, email, PASSWORD)).user.uid
  } catch {
    return (await signInWithEmailAndPassword(auth, email, PASSWORD)).user.uid
  }
}

async function as(email: string) {
  await signOut(auth)
  await signInWithEmailAndPassword(auth, email, PASSWORD)
}

function audit(tx: { set: (ref: ReturnType<typeof doc>, data: object) => unknown }, who: Who, action: string, entityId: string, summary: string) {
  const ref = doc(collection(db, 'audit'))
  tx.set(ref, { at: serverTimestamp(), actor: { uid: who.uid, name: who.name, role: who.role }, action, entity: 'member', entityId, summary, before: null, after: null })
  return ref.id
}

/* ---------------- Sample members ---------------- */

interface PeriodSpec {
  kind: PeriodKind
  qty: number
  /** end of the period, as an offset from today; start is worked out from it */
  endOffset: number
  by: 'zodwa' | 'sibusiso'
  time: string
}

interface MemberSpec {
  number: number
  first: string
  last: string
  phone: string
  periods: PeriodSpec[]
  enrolled: boolean
  sinceOffset: number
}

const m1 = (endOffset: number, by: PeriodSpec['by'] = 'zodwa', time = '07:12'): PeriodSpec => ({ kind: 'months', qty: 1, endOffset, by, time })
const mN = (qty: number, endOffset: number, by: PeriodSpec['by'] = 'zodwa', time = '06:30'): PeriodSpec => ({ kind: 'months', qty, endOffset, by, time })

const MEMBERS: MemberSpec[] = [
  { number: 1001, first: 'Keabetswe', last: 'Tau', phone: '0812305547', periods: [m1(30, 'zodwa', '06:05')], enrolled: true, sinceOffset: -120 },
  { number: 1002, first: 'Lerato', last: 'Mokoena', phone: '0794411264', periods: [mN(3, -31, 'sibusiso', '05:58'), m1(-1, 'zodwa', '06:40')], enrolled: true, sinceOffset: -122 },
  { number: 1003, first: 'Themba', last: 'Khoza', phone: '0827718830', periods: [m1(24)], enrolled: true, sinceOffset: -200 },
  { number: 1004, first: 'Ayanda', last: 'Zulu', phone: '0613392045', periods: [mN(3, 3, 'zodwa', '17:20')], enrolled: true, sinceOffset: -90 },
  { number: 1005, first: 'Precious', last: 'Mahlaba', phone: '0725519902', periods: [mN(12, 210)], enrolled: true, sinceOffset: -155 },
  { number: 1006, first: 'Sipho', last: 'Dlamini', phone: '0836620019', periods: [m1(0, 'sibusiso', '06:12')], enrolled: true, sinceOffset: -60 },
  { number: 1007, first: 'Thabo', last: 'Nkosi', phone: '0825554101', periods: [m1(-121, 'zodwa', '06:15'), mN(3, -24, 'sibusiso', '17:40'), m1(6, 'zodwa', '07:12')], enrolled: true, sinceOffset: -151 },
  { number: 1008, first: 'Johan', last: 'Botha', phone: '0824406619', periods: [m1(-11)], enrolled: true, sinceOffset: -300 },
  { number: 1009, first: 'Lindiwe', last: 'Shabalala', phone: '0749021188', periods: [mN(6, 100)], enrolled: true, sinceOffset: -260 },
  { number: 1010, first: 'Bongani', last: 'Mthembu', phone: '0731278840', periods: [m1(-3, 'sibusiso')], enrolled: true, sinceOffset: -95 },
  { number: 1011, first: 'Andile', last: 'Ngcobo', phone: '0658843021', periods: [m1(19)], enrolled: true, sinceOffset: -45 },
  { number: 1012, first: 'Willem', last: 'Pretorius', phone: '0828870053', periods: [mN(3, 41)], enrolled: true, sinceOffset: -400 },
  { number: 1013, first: 'Chantelle', last: 'Jacobs', phone: '0841197756', periods: [mN(3, 33, 'sibusiso')], enrolled: true, sinceOffset: -58 },
  { number: 1014, first: 'Ayesha', last: 'Khan', phone: '0792234418', periods: [m1(12)], enrolled: true, sinceOffset: -80 },
  { number: 1015, first: 'Kagiso', last: 'Molefe', phone: '0763305582', periods: [mN(6, 6, 'zodwa', '05:50')], enrolled: true, sinceOffset: -176 },
  { number: 1016, first: 'Ruan', last: 'Steyn', phone: '0827730941', periods: [mN(3, 45)], enrolled: true, sinceOffset: -180 },
  { number: 1017, first: 'Riaan', last: 'Pillay', phone: '0846612207', periods: [mN(6, 91, 'sibusiso')], enrolled: true, sinceOffset: -190 },
  { number: 1018, first: 'Naledi', last: 'Khumalo', phone: '0718804432', periods: [m1(1)], enrolled: true, sinceOffset: -30 },
  { number: 1019, first: 'Pieter', last: 'van Wyk', phone: '0823349910', periods: [m1(4, 'sibusiso')], enrolled: true, sinceOffset: -70 },
  { number: 1020, first: 'Busisiwe', last: 'Nxumalo', phone: '0736652267', periods: [m1(21)], enrolled: true, sinceOffset: -40 },
  { number: 1021, first: 'Fatima', last: 'Patel', phone: '0847743307', periods: [mN(3, -6, 'sibusiso')], enrolled: true, sinceOffset: -100 },
  { number: 1022, first: 'Nomsa', last: 'Ndlovu', phone: '0762218875', periods: [m1(-17)], enrolled: true, sinceOffset: -130 },
  { number: 1023, first: 'Tshepo', last: 'Maseko', phone: '0815567734', periods: [m1(15, 'sibusiso')], enrolled: true, sinceOffset: -75 },
  { number: 1024, first: 'Mpho', last: 'Sithole', phone: '0728891120', periods: [m1(-29)], enrolled: true, sinceOffset: -88 },
  { number: 1025, first: 'Kabelo', last: 'Mabena', phone: '0619906678', periods: [m1(17)], enrolled: true, sinceOffset: -50 },
  { number: 1026, first: 'Nadia', last: 'Adams', phone: '0843301196', periods: [mN(12, 300)], enrolled: true, sinceOffset: -70 },
  { number: 1027, first: 'Zanele', last: 'Mahlangu', phone: '0794458823', periods: [m1(-44, 'sibusiso')], enrolled: true, sinceOffset: -110 },
  { number: 1028, first: 'Sizwe', last: 'Ntuli', phone: '0712267745', periods: [m1(27)], enrolled: true, sinceOffset: -33 },
  { number: 1029, first: 'Refilwe', last: 'Moloi', phone: '0830074419', periods: [mN(3, 62, 'sibusiso')], enrolled: true, sinceOffset: -29 },
  { number: 1030, first: 'Ntombi', last: 'Cele', phone: '0760043312', periods: [], enrolled: false, sinceOffset: 0 },
]

/** Turnstile scans for today (design 01) and a few earlier days for the calendars. */
const SCANS: { number: number | null; offset: number; time: string }[] = [
  { number: 1016, offset: 0, time: '08:15' },
  { number: 1017, offset: 0, time: '08:02' },
  { number: 1018, offset: 0, time: '07:20' },
  { number: 1006, offset: 0, time: '07:05' },
  { number: null, offset: 0, time: '06:47' },
  { number: 1011, offset: 0, time: '06:31' },
  { number: 1010, offset: 0, time: '06:22' },
  { number: 1004, offset: 0, time: '06:10' },
  { number: 1007, offset: 0, time: '06:03' },
  { number: 1002, offset: 0, time: '05:55' },
  { number: 1019, offset: 0, time: '05:48' },
  { number: 1015, offset: 0, time: '05:41' },
  { number: 1007, offset: -3, time: '06:10' },
  { number: 1007, offset: -2, time: '06:02' },
  { number: 1002, offset: -3, time: '05:50' },
  { number: 1002, offset: -1, time: '05:52' },
  { number: 1001, offset: -1, time: '06:20' },
]

/** A valid-looking SA ID for sample member n: born in the 1980s/90s, check digit computed. */
function sampleSaId(n: number): string {
  const yy = 80 + (n % 20)
  const mm = String((n % 12) + 1).padStart(2, '0')
  const dd = String((n % 28) + 1).padStart(2, '0')
  const base = `${yy}${mm}${dd}${String(5000 + (n % 4000)).padStart(4, '0')}08`
  let sum = 0
  for (let i = 0; i < 12; i++) {
    let d = Number(base[11 - i])
    if (i % 2 === 0) {
      d *= 2
      if (d > 9) d -= 9
    }
    sum += d
  }
  return base + String((10 - (sum % 10)) % 10)
}

async function main() {
  console.log(`Seeding emulator project ${PROJECT} for ${TODAY}`)

  // 1. First manager (bootstrap rule), then staff and the check-in PC
  const graceUid = await login('grace@gymli.co.za', 'Grace')
  const grace: Who = { uid: graceUid, name: 'Grace Venter', role: 'manager' }
  if (!(await getDoc(doc(db, 'config', 'bootstrap'))).exists()) {
    const b = writeBatch(db)
    b.set(doc(db, 'staff', graceUid), { name: grace.name, email: 'grace@gymli.co.za', role: 'manager', active: true, createdAt: serverTimestamp() })
    b.set(doc(db, 'config', 'bootstrap'), { uid: graceUid, at: serverTimestamp() })
    await b.commit()
  }
  const others: [string, string, Who['role']][] = [
    ['zodwa@gymli.co.za', 'Zodwa Ndaba', 'front_desk'],
    ['sibusiso@gymli.co.za', 'Sibusiso Dube', 'front_desk'],
    ['turnstile1@gymli.local', 'Turnstile 1', 'device'],
  ]
  const who: Record<string, Who> = {}
  for (const [email, name, role] of others) {
    const uid = await login(email, name)
    who[email.split('@')[0]] = { uid, name, role }
  }
  await as('grace@gymli.co.za')
  for (const [email, name, role] of others) {
    await setDoc(doc(db, 'staff', who[email.split('@')[0]].uid), { name, email, role, active: true, createdAt: serverTimestamp() })
  }

  // 2. Members, added and paid for by front desk staff
  const ids = new Map<number, string>()
  const staffFor = { zodwa: who.zodwa, sibusiso: who.sibusiso }
  for (const spec of MEMBERS) {
    const adder = spec.periods[0]?.by ?? 'zodwa'
    await as(`${adder}@gymli.co.za`)
    const memberRef = doc(collection(db, 'members'))
    ids.set(spec.number, memberRef.id)
    await runTransaction(db, async (tx) => {
      const counterRef = doc(db, 'counters', 'members')
      const c = await tx.get(counterRef)
      const next = c.exists() ? c.data().next : 1001
      if (next !== spec.number) throw new Error(`Counter is at ${next}, expected ${spec.number}. Seed into an empty emulator.`)
      tx.set(counterRef, { next: next + 1 })
      const auditId = audit(tx, staffFor[adder], 'member.create', memberRef.id, `Added ${spec.first} ${spec.last} (GY-${spec.number})`)
      tx.set(memberRef, {
        number: spec.number,
        firstName: spec.first,
        lastName: spec.last,
        cellphone: spec.phone,
        periods: [],
        fingerprint: null,
        deleted: false,
        createdAt: Timestamp.fromMillis(at(d(spec.sinceOffset), '06:00')),
        updatedAt: serverTimestamp(),
        lastAuditId: auditId,
      })
      // Personal details for every member except GY-1030 (shows "ID number missing")
      if (spec.number !== 1030) {
        const id = sampleSaId(spec.number)
        tx.set(doc(db, 'members', memberRef.id, 'private', 'details'), {
          email: `${spec.first}.${spec.last}`.toLowerCase().replace(/\s+/g, '') + '@example.co.za',
          dateOfBirth: `19${id.slice(0, 2)}-${id.slice(2, 4)}-${id.slice(4, 6)}`,
          idType: 'sa',
          idLast3: id.slice(-3),
          emergencyName: spec.number % 3 === 0 ? '' : `${['Nomvula', 'Sipho', 'Anele', 'Lindi'][spec.number % 4]} ${spec.last}`,
          emergencyPhone: spec.number % 3 === 0 ? '' : `083${String(spec.number * 7919).slice(-7)}`,
          notes: spec.number === 1007 ? 'Student. Pays on the 8th.' : '',
          lastAuditId: auditId,
        })
        tx.set(doc(db, 'members', memberRef.id, 'private', 'identity'), { idType: 'sa', idNumber: id, lastAuditId: auditId })
      }
    })

    const periods: object[] = []
    for (const p of spec.periods) {
      await as(`${p.by}@gymli.co.za`)
      const end = d(p.endOffset)
      const start = p.kind === 'months' ? addMonthsClamped(addDays(end, 1), -p.qty) : addDays(end, -(p.qty - 1))
      const period = {
        id: crypto.randomUUID(),
        kind: p.kind,
        qty: p.qty,
        start,
        end: periodEnd(p.kind, p.qty, start),
        loggedBy: { uid: staffFor[p.by].uid, name: staffFor[p.by].name },
        loggedAt: at(start, p.time),
        method: (['card', 'cash', 'eft', 'debit_order'] as const)[(spec.number + periods.length) % 4],
      }
      periods.push(period)
      await runTransaction(db, async (tx) => {
        const auditId = audit(tx, staffFor[p.by], 'payment.create', memberRef.id, `Logged ${p.qty} ${p.kind} for GY-${spec.number}`)
        tx.update(memberRef, { periods: [...periods], updatedAt: serverTimestamp(), lastAuditId: auditId })
      })
    }
    process.stdout.write('.')
  }
  console.log()

  // 3. The check-in PC: fingerprints enrolled, heartbeat, door log
  await as('turnstile1@gymli.local')
  const device = who.turnstile1
  for (const spec of MEMBERS.filter((m) => m.enrolled)) {
    const ref = doc(db, 'members', ids.get(spec.number)!)
    await runTransaction(db, async (tx) => {
      const auditId = audit(tx, device, 'fingerprint.enrol', ref.id, `Enrolled fingerprint for GY-${spec.number}`)
      tx.update(ref, { fingerprint: { finger: 'right_index', enrolledAt: at(d(spec.sinceOffset), '06:05') }, updatedAt: serverTimestamp(), lastAuditId: auditId })
    })
  }
  await setDoc(doc(db, 'devices', device.uid), {
    name: 'Turnstile 1',
    lastSeenAt: Date.now(),
    mode: 'simulation',
    readerConnected: true,
    relayConnected: true,
    pendingLogs: 0,
    appVersion: 'seed',
  })

  const { evaluateAccess, deniedText } = await import('../src/lib/access')
  for (const s of SCANS) {
    const date = d(s.offset)
    const spec = s.number ? MEMBERS.find((m) => m.number === s.number)! : null
    const periods = spec
      ? spec.periods.map((p) => {
          const end = d(p.endOffset)
          const start = p.kind === 'months' ? addMonthsClamped(addDays(end, 1), -p.qty) : addDays(end, -(p.qty - 1))
          return { start, end: periodEnd(p.kind, p.qty, start) }
        })
      : []
    const decision = spec ? evaluateAccess(periods, date) : null
    const allowed = !!decision?.allowed
    const time = at(date, s.time)
    await setDoc(doc(db, 'doorLogs', crypto.randomUUID()), {
      deviceId: device.uid,
      memberId: spec ? ids.get(spec.number)! : null,
      memberName: spec ? `${spec.first} ${spec.last}` : null,
      memberNumber: spec?.number ?? null,
      result: allowed ? 'allowed' : 'denied',
      reason: !spec ? 'not_recognised' : decision!.allowed ? null : decision!.reason,
      text: !spec ? 'Fingerprint not recognised' : decision!.allowed ? 'Welcome' : deniedText(decision!.reason, decision!.date, date),
      paidUntil: decision?.allowed ? decision.paidUntil : null,
      at: time,
      date: dateAtGym(time),
      offline: false,
    })
  }

  await signOut(auth)
  console.log(`Done: ${MEMBERS.length} members, ${SCANS.length} scans. Sign in as zodwa@gymli.co.za / ${PASSWORD}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
