/**
 * Loads sample members, payments and turnstile scans into the REAL Firebase project,
 * for a presentation. Every write goes through firestore.rules, signed in as you (a manager).
 *
 *   npm run demo -- you@yourgym.co.za 'your-password'
 *
 * - Uses the first branch (or creates "Body Tone Sandton" if there is none yet).
 * - Adds the 30 sample members from the design to it, with payments relative to today.
 * - Adds a check-in login "Turnstile 1" (saved in scripts/.demo-device.json on this PC),
 *   marks fingerprints as enrolled and writes today's scans to the door log.
 * - Then keeps the turnstile showing "online" while this window stays open (Ctrl+C to stop).
 *
 * Run it again later to only keep the turnstile online (members are not added twice).
 * Note: door log and audit entries cannot be deleted from the app (by design).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, limit, query, runTransaction, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore'
import { evaluateAccess, deniedText, periodEnd } from '../src/lib/access'
import { addDays, addMonthsClamped, dateAtGym, todayAtGym, type LocalDate } from '../src/lib/dates'
import { MEMBERS, SCANS, sampleSaId } from './sampleData'
import { priceFor } from '../src/lib/accounts'
import { audit, config, connect, databaseId, DEMO_PRICES, type Who } from './demoShared'

const DEVICE_FILE = new URL('./.demo-device.json', import.meta.url)
const TODAY: LocalDate = todayAtGym()
const d = (offset: number) => addDays(TODAY, offset)
const at = (date: LocalDate, hhmm: string) => Date.parse(`${date}T${hhmm}:00+02:00`)

/** Start and end of a sample period, worked out from its end offset. */
function datesOf(p: (typeof MEMBERS)[number]['periods'][number]) {
  const end = d(p.endOffset)
  const start = p.kind === 'months' ? addMonthsClamped(addDays(end, 1), -p.qty) : addDays(end, -(p.qty - 1))
  return { start, end: periodEnd(p.kind, p.qty, start) }
}

async function main() {
  const [email, password] = process.argv.slice(2)
  if (!email || !password) {
    console.error("Usage: npm run demo -- you@yourgym.co.za 'your-password'   (a manager login)")
    process.exit(1)
  }

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

  // The branch the demo goes into
  const branches = (await getDocs(collection(mgr.db, 'branches'))).docs.sort((a, b) => String(a.data().name).localeCompare(String(b.data().name)))
  let branchId = branches[0]?.id
  if (!branchId) {
    const ref = doc(collection(mgr.db, 'branches'))
    await runTransaction(mgr.db, async (tx) => {
      const auditId = audit(mgr.db, tx, me, 'branch.create', 'branch', ref.id, 'Added branch Body Tone Sandton')
      tx.set(ref, { name: 'Body Tone Sandton', prices: DEMO_PRICES, createdAt: serverTimestamp(), lastAuditId: auditId })
    })
    branchId = ref.id
  }

  const already = await getDocs(query(collection(mgr.db, 'members'), where('cellphone', '==', MEMBERS[0].phone), limit(1)))
  const dev = connect('device')
  let device: Who
  let deviceBranch = branchId

  if (!already.empty) {
    console.log('Demo members are already loaded. Keeping the turnstile online only.')
    if (!existsSync(DEVICE_FILE)) {
      console.error('No demo check-in login saved on this PC (scripts/.demo-device.json). Nothing more to do.')
      process.exit(0)
    }
    const saved = JSON.parse(readFileSync(DEVICE_FILE, 'utf8')) as { email: string; password: string }
    await signInWithEmailAndPassword(dev.auth, saved.email, saved.password)
    device = { uid: dev.auth.currentUser!.uid, name: 'Turnstile 1', role: 'device' }
    deviceBranch = (await getDoc(doc(dev.db, 'staff', device.uid))).data()?.branchId ?? branchId
  } else {
    console.log(`Loading demo data into ${config.projectId} / ${databaseId} for ${TODAY}, as ${me.name}`)

    // 2. Members with personal details, then their payments
    const ids = new Map<number, { id: string; number: number }>()
    for (const spec of MEMBERS) {
      const memberRef = doc(collection(mgr.db, 'members'))
      const number = await runTransaction(mgr.db, async (tx) => {
        const counterRef = doc(mgr.db, 'counters', 'members')
        const c = await tx.get(counterRef)
        const next: number = c.exists() ? c.data().next : 1001
        tx.set(counterRef, { next: next + 1 })
        const auditId = audit(mgr.db, tx, me, 'member.create', 'member', memberRef.id, `Added ${spec.first} ${spec.last} (GY-${next})`)
        tx.set(memberRef, {
          branchId,
          number: next,
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
        // Every member except the last shows a full profile; the last shows "ID number missing"
        if (spec.number !== 1030) {
          const id = sampleSaId(spec.number)
          tx.set(doc(mgr.db, 'members', memberRef.id, 'private', 'details'), {
            email: `${spec.first}.${spec.last}`.toLowerCase().replace(/\s+/g, '') + '@example.co.za',
            dateOfBirth: `19${id.slice(0, 2)}-${id.slice(2, 4)}-${id.slice(4, 6)}`,
            idType: 'sa',
            idLast3: id.slice(-3),
            emergencyName: spec.number % 3 === 0 ? '' : `${['Nomvula', 'Sipho', 'Anele', 'Lindi'][spec.number % 4]} ${spec.last}`,
            emergencyPhone: spec.number % 3 === 0 ? '' : `083${String(spec.number * 7919).slice(-7)}`,
            notes: spec.number === 1007 ? 'Student. Pays on the 8th.' : '',
            lastAuditId: auditId,
          })
          tx.set(doc(mgr.db, 'members', memberRef.id, 'private', 'identity'), { idType: 'sa', idNumber: id, lastAuditId: auditId })
        }
        return next
      })
      ids.set(spec.number, { id: memberRef.id, number })

      if (spec.periods.length > 0) {
        const periods = spec.periods.map((p, i) => {
          const { start, end } = datesOf(p)
          return {
            id: crypto.randomUUID(),
            kind: p.kind,
            qty: p.qty,
            start,
            end,
            loggedBy: { uid: me.uid, name: me.name },
            loggedAt: at(start, p.time),
            method: (['card', 'cash', 'eft', 'debit_order'] as const)[(spec.number + i) % 4],
            amountCents: priceFor(DEMO_PRICES, p.kind, p.qty) ?? 45000,
          }
        })
        await runTransaction(mgr.db, async (tx) => {
          const auditId = audit(mgr.db, tx, me, 'payment.create', 'member', memberRef.id, `Logged ${periods.length} payment${periods.length > 1 ? 's' : ''} for GY-${number}`)
          tx.update(memberRef, { periods, updatedAt: serverTimestamp(), lastAuditId: auditId })
        })
      }
      process.stdout.write('.')
    }
    console.log()

    // 3. A check-in login for the demo turnstile
    const deviceEmail = `turnstile-demo-${randomBytes(3).toString('hex')}@gymli.local`
    const devicePassword = randomBytes(15).toString('base64url')
    const uid = (await createUserWithEmailAndPassword(dev.auth, deviceEmail, devicePassword)).user.uid
    await runTransaction(mgr.db, async (tx) => {
      audit(mgr.db, tx, me, 'staff.create', 'staff', uid, 'Added Turnstile 1 as device')
      tx.set(doc(mgr.db, 'staff', uid), { name: 'Turnstile 1', email: deviceEmail, role: 'device', branchId, active: true, createdAt: serverTimestamp() })
    })
    writeFileSync(DEVICE_FILE, JSON.stringify({ email: deviceEmail, password: devicePassword }, null, 2))
    device = { uid, name: 'Turnstile 1', role: 'device' }

    // 4. As the turnstile: fingerprints enrolled, today's scans
    for (const spec of MEMBERS.filter((m) => m.enrolled)) {
      const ref = doc(dev.db, 'members', ids.get(spec.number)!.id)
      await runTransaction(dev.db, async (tx) => {
        const auditId = audit(dev.db, tx, device, 'fingerprint.enrol', 'member', ref.id, `Enrolled fingerprint for GY-${ids.get(spec.number)!.number}`)
        tx.update(ref, { fingerprint: { finger: 'right_index', enrolledAt: at(d(spec.sinceOffset), '06:05') }, updatedAt: serverTimestamp(), lastAuditId: auditId })
      })
    }
    for (const s of SCANS) {
      const date = d(s.offset)
      const spec = s.number ? MEMBERS.find((m) => m.number === s.number)! : null
      const decision = spec ? evaluateAccess(spec.periods.map(datesOf), date) : null
      const time = at(date, s.time)
      await setDoc(doc(dev.db, 'doorLogs', crypto.randomUUID()), {
        deviceId: device.uid,
        branchId,
        memberId: spec ? ids.get(spec.number)!.id : null,
        memberName: spec ? `${spec.first} ${spec.last}` : null,
        memberNumber: spec ? ids.get(spec.number)!.number : null,
        result: decision?.allowed ? 'allowed' : 'denied',
        reason: !spec ? 'not_recognised' : decision!.allowed ? null : decision!.reason,
        text: !spec ? 'Fingerprint not recognised' : decision!.allowed ? 'Welcome' : deniedText(decision!.reason, decision!.date, date),
        paidUntil: decision?.allowed ? decision.paidUntil : null,
        at: time,
        date: dateAtGym(time),
        offline: false,
      })
    }
    console.log(`Done: ${MEMBERS.length} members, ${SCANS.length} scans.`)
    console.log(`Check-in login (saved in scripts/.demo-device.json): ${deviceEmail} / ${devicePassword}`)
  }

  // 5. Keep the turnstile "online" while this window is open
  const beat = () =>
    setDoc(doc(dev.db, 'devices', device.uid), {
      name: 'Turnstile 1',
      branchId: deviceBranch,
      lastSeenAt: Date.now(),
      mode: 'simulation',
      readerConnected: true,
      relayConnected: true,
      pendingLogs: 0,
      appVersion: 'demo',
    }).catch((e) => console.error('Heartbeat failed:', (e as Error).message))
  await beat()
  if (process.env.GYMLI_DEMO_NO_WAIT === '1') process.exit(0)
  setInterval(beat, 10_000)
  console.log('Turnstile shows online while this window stays open. Press Ctrl+C to stop.')
}

main().catch((e) => {
  console.error((e as Error).message ?? e)
  process.exit(1)
})
