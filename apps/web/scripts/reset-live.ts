/**
 * Clears the test and demo data from the REAL Firebase project before go-live.
 * Keeps: staff logins (except the demo turnstile logins), branches and config/bootstrap.
 * Deletes: members (with their private details and ID numbers), payments, fingerprints,
 * the door log, the audit trail, enrolment requests, check-in PC status and the GY-number
 * counter (new members start again at GY-1001). Demo prices are cleared.
 *
 *   npx firebase login                                   (once: your Firebase owner account)
 *   npm run reset:live -- you@yourgym.co.za 'your-password'   (a manager login)
 *
 * Nothing changes until you type the project name to confirm. This cannot be undone.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { collection, doc, getCountFromServer, getDoc, getDocs, query, where, writeBatch, type Query } from 'firebase/firestore'
import { audit, config, connect, databaseId, DEMO_PRICES, emulator, type Who } from './demoShared'

/** Collections cleared completely (sub-collections too). */
const CLEAR = ['members', 'templates', 'doorLogs', 'enrolRequests', 'devices', 'audit', 'counters']
/** Check-in logins made by the demo scripts (logins made in Settings are checkin-…@gymli.local and are kept). */
const DEMO_DEVICE = /^turnstile(-demo)?-[0-9a-f]{6}@gymli\.local$/i
const LOCAL_FILES = ['./.demo-device.json', './.demo-busy.json'].map((f) => new URL(f, import.meta.url))

function firebase(args: string[]): boolean {
  const all = [...args, '--project', config.projectId, '--database', databaseId]
  const env = emulator ? { ...process.env, FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' } : process.env
  const r = spawnSync('npx', ['firebase', ...all], { stdio: 'inherit', shell: process.platform === 'win32', env })
  return r.status === 0
}

async function count(q: Query): Promise<string> {
  try {
    return String((await getCountFromServer(q)).data().count)
  } catch {
    return '?'
  }
}

const samePrices = (p: unknown) =>
  !!p && typeof p === 'object' && Object.entries(DEMO_PRICES).every(([k, v]) => (p as Record<string, unknown>)[k] === v) && Object.keys(p).length === Object.keys(DEMO_PRICES).length

async function main() {
  const [email, password] = process.argv.slice(2)
  if (!email || !password) {
    console.error("Usage: npm run reset:live -- you@yourgym.co.za 'your-password'   (a manager login)")
    process.exit(1)
  }

  // 1. Who you are, and what is there now (nothing changes yet)
  const { auth, db } = connect('reset')
  try {
    await signInWithEmailAndPassword(auth, email, password)
  } catch {
    console.error('Could not sign in with that email and password.')
    process.exit(1)
  }
  const meSnap = await getDoc(doc(db, 'staff', auth.currentUser!.uid))
  if (!meSnap.exists() || meSnap.data().role !== 'manager' || meSnap.data().active !== true) {
    console.error('That login is not an active manager.')
    process.exit(1)
  }
  const me: Who = { uid: auth.currentUser!.uid, name: meSnap.data().name, role: 'manager' }

  const branches = (await getDocs(collection(db, 'branches'))).docs
  const staff = (await getDocs(collection(db, 'staff'))).docs
  const demoDevices = staff.filter((s) => s.data().role === 'device' && DEMO_DEVICE.test(String(s.data().email ?? '')))
  const kept = staff.filter((s) => !demoDevices.includes(s))

  console.log(`\nProject ${config.projectId} / database ${databaseId}${emulator ? ' (EMULATOR)' : ''} — signed in as ${me.name}\n`)
  console.log('Will be DELETED:')
  console.log(`  members ................ ${await count(collection(db, 'members'))} (with details, ID numbers and payments)`)
  console.log(`  with a fingerprint ..... ${await count(query(collection(db, 'members'), where('fingerprint', '!=', null)))}`)
  console.log(`  door log entries ....... ${await count(collection(db, 'doorLogs'))}`)
  console.log(`  audit trail entries .... ${await count(collection(db, 'audit'))}`)
  console.log(`  check-in PC status ..... ${await count(collection(db, 'devices'))}`)
  console.log(`  demo turnstile logins .. ${demoDevices.length}${demoDevices.map((d) => `\n      ${d.data().email}`).join('')}`)
  console.log('  GY-number counter (new members start at GY-1001)')
  const demoPriced = branches.filter((b) => samePrices(b.data().prices))
  if (demoPriced.length) console.log(`  demo prices on ......... ${demoPriced.map((b) => b.data().name).join(', ')}`)
  console.log('\nWill be KEPT:')
  console.log(`  branches ............... ${branches.map((b) => b.data().name).join(', ') || 'none'}`)
  console.log(`  logins ................. ${kept.length}`)
  for (const s of kept) console.log(`      ${s.data().name} · ${s.data().role === 'device' ? 'check-in PC' : s.data().role} · ${s.data().email ?? ''}${s.data().active ? '' : ' (switched off)'}`)

  // 2. Confirm
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await rl.question(`\nThis cannot be undone. Type the project name (${config.projectId}) to continue: `)).trim()
  rl.close()
  if (answer !== config.projectId) {
    console.log('Stopped. Nothing was changed.')
    process.exit(0)
  }

  // 3. Demo prices off (before the audit trail is cleared)
  for (const b of demoPriced) {
    const batch = writeBatch(db)
    const auditId = audit(db, batch, me, 'branch.prices', 'branch', b.id, `Cleared demo prices for ${b.data().name}`)
    const { prices: _drop, ...rest } = b.data()
    batch.set(b.ref, { ...rest, lastAuditId: auditId })
    await batch.commit()
    console.log(`Cleared demo prices: ${b.data().name}`)
  }

  // 4. Data (owner access through the Firebase CLI; app users cannot delete these)
  let ok = true
  for (const c of CLEAR) {
    console.log(`\nDeleting ${c}…`)
    ok = firebase(['firestore:delete', c, '--recursive', '--force']) && ok
  }
  // 5. Demo turnstile logins
  for (const d of demoDevices) {
    console.log(`\nDeleting login ${d.data().email}…`)
    ok = firebase(['firestore:delete', `staff/${d.id}`, '--force']) && ok
  }
  // 6. This PC's demo files
  for (const f of LOCAL_FILES) if (existsSync(f)) rmSync(f)

  console.log(`\n${ok ? 'Done.' : 'Finished with errors (see above). If it says you are not logged in, run "npx firebase login" and run this again.'}`)
  console.log('Next:')
  console.log('  • Set each branch\'s prices: Settings → Branches → Prices.')
  console.log('  • Any PC that already ran Gymli Check-in: close it and delete C:\\ProgramData\\Gymli\\gymli.db (keep template.key).')
  if (demoDevices.length) console.log('  • Optional: delete the demo turnstile accounts in the Firebase console → Authentication (emails listed above).')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error((e as Error).message ?? e)
  process.exit(1)
})
