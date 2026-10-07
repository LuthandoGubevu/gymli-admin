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
 *   turnstile1@gymli.local  Check-in PC (Sandton)
 *   lindiwe@gymli.co.za   Front desk (Soweto)
 *   turnstile2@gymli.local  Check-in PC (Soweto)
 *
 * Branches: Body Tone Sandton (the 30 members from the design) and Body Tone Soweto (5 more).
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
import { MEMBERS, SCANS, sampleSaId } from './sampleData'
import { priceFor } from '../src/lib/accounts'
import type { Prices } from '../src/lib/types'

const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-gymli'
const PASSWORD = 'gymli-demo-2026'
const TODAY: LocalDate = process.env.SEED_TODAY ?? todayAtGym()

const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, authDomain: `${PROJECT}.firebaseapp.com` })
const auth = getAuth(app)
const db = getFirestore(app)
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })
connectFirestoreEmulator(db, '127.0.0.1', 8080)

const SANDTON = 'sandton'
const SOWETO = 'soweto'

/** Sample price lists (cents) */
const PRICES: Record<string, Prices> = {
  [SANDTON]: { day: 8000, m1: 45000, m3: 125000, m6: 240000, m12: 450000 },
  [SOWETO]: { day: 6000, m1: 35000, m3: 99000, m6: 190000, m12: 360000 },
}

/** Soweto members: first, last, cellphone, months paid, end of payment (days from today). */
const SOWETO_MEMBERS: [string, string, string, number, number][] = [
  ['Mandla', 'Khumalo', '0715550101', 1, 12],
  ['Palesa', 'Mofokeng', '0725550102', 3, 40],
  ['Sbu', 'Mthethwa', '0735550103', 1, -5],
  ['Nokuthula', 'Dlamini', '0745550104', 6, 120],
  ['Thando', 'Radebe', '0765550105', 1, 2],
]

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
  const others: [string, string, Who['role'], string][] = [
    ['zodwa@gymli.co.za', 'Zodwa Ndaba', 'front_desk', SANDTON],
    ['sibusiso@gymli.co.za', 'Sibusiso Dube', 'front_desk', SANDTON],
    ['turnstile1@gymli.local', 'Turnstile 1', 'device', SANDTON],
    ['lindiwe@gymli.co.za', 'Lindiwe Zulu', 'front_desk', SOWETO],
    ['turnstile2@gymli.local', 'Turnstile 2', 'device', SOWETO],
  ]
  const who: Record<string, Who> = {}
  for (const [email, name, role] of others) {
    const uid = await login(email, name)
    who[email.split('@')[0]] = { uid, name, role }
  }
  await as('grace@gymli.co.za')
  // Branches first: front desk and check-in logins must belong to one
  for (const [id, name] of [[SANDTON, 'Body Tone Sandton'], [SOWETO, 'Body Tone Soweto']]) {
    await runTransaction(db, async (tx) => {
      const auditId = audit(tx, grace, 'branch.create', id, `Added branch ${name}`)
      tx.set(doc(db, 'branches', id), { name, prices: PRICES[id], createdAt: serverTimestamp(), lastAuditId: auditId })
    })
  }
  for (const [email, name, role, branchId] of others) {
    await setDoc(doc(db, 'staff', who[email.split('@')[0]].uid), { name, email, role, branchId, active: true, createdAt: serverTimestamp() })
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
        branchId: SANDTON,
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
        amountCents: priceFor(PRICES[SANDTON], p.kind, p.qty) ?? 45000,
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
    branchId: SANDTON,
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
      branchId: SANDTON,
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

  // 4. Soweto: a few members of its own, added by its front desk and enrolled on its turnstile
  await as('lindiwe@gymli.co.za')
  const soweto: string[] = []
  for (const [first, last, phone, months, endOffset] of SOWETO_MEMBERS) {
    const memberRef = doc(collection(db, 'members'))
    soweto.push(memberRef.id)
    await runTransaction(db, async (tx) => {
      const counterRef = doc(db, 'counters', 'members')
      const number: number = (await tx.get(counterRef)).data()!.next
      tx.set(counterRef, { next: number + 1 })
      const auditId = audit(tx, who.lindiwe, 'member.create', memberRef.id, `Added ${first} ${last} (GY-${number})`)
      tx.set(memberRef, { branchId: SOWETO, number, firstName: first, lastName: last, cellphone: phone, periods: [], fingerprint: null, deleted: false, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastAuditId: auditId })
    })
    const end = d(endOffset)
    const start = addMonthsClamped(addDays(end, 1), -months)
    const period = { id: crypto.randomUUID(), kind: 'months', qty: months, start, end: periodEnd('months', months, start), loggedBy: { uid: who.lindiwe.uid, name: who.lindiwe.name }, loggedAt: at(start, '07:00'), method: 'card', amountCents: priceFor(PRICES[SOWETO], 'months', months) }
    await runTransaction(db, async (tx) => {
      const auditId = audit(tx, who.lindiwe, 'payment.create', memberRef.id, `Logged ${months} months`)
      tx.update(memberRef, { periods: [period], updatedAt: serverTimestamp(), lastAuditId: auditId })
    })
  }
  await as('turnstile2@gymli.local')
  for (const id of soweto) {
    await runTransaction(db, async (tx) => {
      const auditId = audit(tx, who.turnstile2, 'fingerprint.enrol', id, 'Enrolled fingerprint')
      tx.update(doc(db, 'members', id), { fingerprint: { finger: 'right_index', enrolledAt: at(d(-20), '06:05') }, updatedAt: serverTimestamp(), lastAuditId: auditId })
    })
  }
  await setDoc(doc(db, 'devices', who.turnstile2.uid), { name: 'Turnstile 2', branchId: SOWETO, lastSeenAt: Date.now(), mode: 'simulation', readerConnected: true, relayConnected: true, pendingLogs: 0, appVersion: 'seed' })

  await signOut(auth)
  console.log(`Done: ${MEMBERS.length + SOWETO_MEMBERS.length} members in 2 branches, ${SCANS.length} scans. Sign in as zodwa@gymli.co.za / ${PASSWORD}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
