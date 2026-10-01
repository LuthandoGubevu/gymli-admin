/**
 * Firestore security rules. Run with `npm run test:rules` (starts the emulator).
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, updateDoc, deleteDoc, collection, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let env: RulesTestEnvironment

const STAFF = {
  mgr: { name: 'Grace', role: 'manager' },
  desk: { name: 'Zodwa', role: 'front_desk' },
  pc: { name: 'Turnstile 1', role: 'device' },
  off: { name: 'Old', role: 'front_desk', active: false },
}

const db = (uid: keyof typeof STAFF | 'stranger') => env.authenticatedContext(uid).firestore() as unknown as Firestore
const period = (uid: string, id = 'p1', start = '2026-10-01', end = '2026-10-31') => ({
  id, kind: 'months', qty: 1, start, end, loggedBy: { uid, name: 'x' }, loggedAt: 1,
})

/** Writes an audit entry and a member change in one transaction, as the app does. */
async function withAudit(f: Firestore, uid: string, role: string, write: (auditId: string, tx: Parameters<Parameters<typeof runTransaction>[1]>[0]) => void) {
  return runTransaction(f, async (tx) => {
    const a = doc(collection(f, 'audit'))
    tx.set(a, { at: serverTimestamp(), actor: { uid, name: 'x', role }, action: 't', entity: 'member', entityId: 'm1', summary: '', before: null, after: null })
    write(a.id, tx)
  })
}

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-gymli-rules',
    firestore: { rules: readFileSync(resolve(__dirname, '../../../../firestore.rules'), 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})
afterAll(() => env.cleanup())

beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const f = ctx.firestore()
    for (const [uid, s] of Object.entries(STAFF)) await setDoc(doc(f, 'staff', uid), { email: `${uid}@x`, active: true, ...s })
    await setDoc(doc(f, 'counters', 'members'), { next: 1002 })
    await setDoc(doc(f, 'members', 'm1'), {
      number: 1001, firstName: 'Thabo', lastName: 'Nkosi', cellphone: '0825554101',
      periods: [period('desk')], fingerprint: null, deleted: false, updatedAt: new Date(), lastAuditId: 'old',
    })
  })
})

describe('members', () => {
  it('front desk can add a payment with an audit entry', async () => {
    const f = db('desk')
    await assertSucceeds(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [period('desk'), period('desk', 'p2', '2026-11-01', '2026-11-30')], updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('a payment without an audit entry is refused', async () => {
    const f = db('desk')
    await assertFails(updateDoc(doc(f, 'members', 'm1'), { periods: [period('desk'), period('desk', 'p2')], updatedAt: serverTimestamp(), lastAuditId: 'made-up' }))
  })

  it('front desk cannot change an existing payment', async () => {
    const f = db('desk')
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [period('desk', 'p1', '2026-10-01', '2027-10-31')], updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('front desk cannot delete a payment', async () => {
    const f = db('desk')
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [{ ...period('desk'), deleted: true }], updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('front desk cannot log a payment in someone else’s name', async () => {
    const f = db('desk')
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [period('desk'), period('mgr', 'p2')], updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('manager can change and delete a payment', async () => {
    const f = db('mgr')
    await assertSucceeds(withAudit(f, 'mgr', 'manager', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [{ ...period('desk'), deleted: true }], updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('front desk cannot remove a member', async () => {
    const f = db('desk')
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { deleted: true, firstName: '', lastName: '', cellphone: '', periods: [], updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('nobody can hard-delete a member', async () => {
    await assertFails(deleteDoc(doc(db('mgr'), 'members', 'm1')))
  })

  it('a switched-off login cannot read members', async () => {
    await assertFails(getDoc(doc(db('off'), 'members', 'm1')))
  })

  it('a signed-in stranger cannot read members', async () => {
    await assertFails(getDoc(doc(db('stranger'), 'members', 'm1')))
  })

  it('new members take the next number from the counter', async () => {
    const f = db('desk')
    const ok = runTransaction(f, async (tx) => {
      const a = doc(collection(f, 'audit'))
      tx.set(a, { at: serverTimestamp(), actor: { uid: 'desk', name: 'x', role: 'front_desk' }, action: 'member.create', entity: 'member', entityId: 'm2', summary: '' })
      tx.set(doc(f, 'counters', 'members'), { next: 1003 })
      tx.set(doc(f, 'members', 'm2'), { number: 1002, firstName: 'A', lastName: 'B', cellphone: '0820000000', periods: [], fingerprint: null, deleted: false, updatedAt: serverTimestamp(), lastAuditId: a.id })
    })
    await assertSucceeds(ok)
    const clash = runTransaction(f, async (tx) => {
      const a = doc(collection(f, 'audit'))
      tx.set(a, { at: serverTimestamp(), actor: { uid: 'desk', name: 'x', role: 'front_desk' }, action: 'member.create', entity: 'member', entityId: 'm3', summary: '' })
      tx.set(doc(f, 'members', 'm3'), { number: 1001, firstName: 'A', lastName: 'B', cellphone: '0820000000', periods: [], fingerprint: null, deleted: false, updatedAt: serverTimestamp(), lastAuditId: a.id })
    })
    await assertFails(clash)
  })

  it('check-in PC may only record the fingerprint', async () => {
    const f = db('pc')
    await assertSucceeds(withAudit(f, 'pc', 'device', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { fingerprint: { finger: 'right_index', enrolledAt: 1 }, updatedAt: serverTimestamp(), lastAuditId: id })))
    await assertFails(withAudit(f, 'pc', 'device', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [], updatedAt: serverTimestamp(), lastAuditId: id })))
  })
})

describe('audit trail', () => {
  it('cannot be edited or deleted, even by a manager', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'audit', 'a1'), { summary: 'x' }))
    await assertFails(updateDoc(doc(db('mgr'), 'audit', 'a1'), { summary: 'changed' }))
    await assertFails(deleteDoc(doc(db('mgr'), 'audit', 'a1')))
  })
  it('only managers can read it', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'audit', 'a1'), { summary: 'x' }))
    await assertSucceeds(getDoc(doc(db('mgr'), 'audit', 'a1')))
    await assertFails(getDoc(doc(db('desk'), 'audit', 'a1')))
  })
  it('entries cannot pretend to be someone else', async () => {
    await assertFails(setDoc(doc(db('desk'), 'audit', 'a2'), { at: serverTimestamp(), actor: { uid: 'mgr', name: 'x', role: 'manager' } }))
  })
})

describe('door log and templates', () => {
  const log = { deviceId: 'pc', memberId: 'm1', result: 'allowed', at: 1, date: '2026-10-01', text: 'Welcome' }
  it('only the check-in PC writes door logs, and they cannot be changed', async () => {
    await assertSucceeds(setDoc(doc(db('pc'), 'doorLogs', 'l1'), log))
    await assertFails(setDoc(doc(db('desk'), 'doorLogs', 'l2'), { ...log, deviceId: 'desk' }))
    await assertFails(updateDoc(doc(db('pc'), 'doorLogs', 'l1'), { result: 'denied' }))
    await assertSucceeds(getDoc(doc(db('desk'), 'doorLogs', 'l1')))
  })
  it('fingerprint templates are readable only by the check-in PC', async () => {
    await assertSucceeds(setDoc(doc(db('pc'), 'templates', 'm1'), { cipher: 'abc', finger: 'right_index' }))
    await assertFails(getDoc(doc(db('desk'), 'templates', 'm1')))
    await assertFails(getDoc(doc(db('mgr'), 'templates', 'm1')))
    await assertSucceeds(deleteDoc(doc(db('mgr'), 'templates', 'm1')))
  })
})

describe('staff logins', () => {
  it('only a manager can add staff', async () => {
    await assertSucceeds(setDoc(doc(db('mgr'), 'staff', 'new'), { name: 'N', email: 'n@x', role: 'front_desk', active: true }))
    await assertFails(setDoc(doc(db('desk'), 'staff', 'new2'), { name: 'N', email: 'n@x', role: 'manager', active: true }))
  })
  it('front desk cannot make themselves manager', async () => {
    await assertFails(updateDoc(doc(db('desk'), 'staff', 'desk'), { role: 'manager' }))
  })
  it('first manager can be created once only', async () => {
    await env.clearFirestore()
    const f = env.authenticatedContext('first').firestore() as unknown as Firestore
    await assertSucceeds(runTransaction(f, async (tx) => {
      tx.set(doc(f, 'staff', 'first'), { name: 'F', email: 'f@x', role: 'manager', active: true })
      tx.set(doc(f, 'config', 'bootstrap'), { uid: 'first' })
    }))
    const g = env.authenticatedContext('second').firestore() as unknown as Firestore
    await assertFails(runTransaction(g, async (tx) => {
      tx.set(doc(g, 'staff', 'second'), { name: 'S', email: 's@x', role: 'manager', active: true })
      tx.set(doc(g, 'config', 'bootstrap'), { uid: 'second' })
    }))
  })
})
