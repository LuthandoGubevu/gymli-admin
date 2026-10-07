/**
 * Firestore security rules. Run with `npm run test:rules` (starts the emulator).
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { doc, getDoc, getDocs, query, where, runTransaction, serverTimestamp, setDoc, updateDoc, deleteDoc, collection, type Firestore } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

let env: RulesTestEnvironment

// Branch b1 (Sandton) and b2 (Soweto). Managers see both; everyone else one.
const STAFF = {
  mgr: { name: 'Grace', role: 'manager' },
  desk: { name: 'Zodwa', role: 'front_desk', branchId: 'b1' },
  desk2: { name: 'Sipho', role: 'front_desk', branchId: 'b2' },
  pc: { name: 'Turnstile 1', role: 'device', branchId: 'b1' },
  pc2: { name: 'Turnstile 2', role: 'device', branchId: 'b2' },
  off: { name: 'Old', role: 'front_desk', active: false, branchId: 'b1' },
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
    await setDoc(doc(f, 'branches', 'b1'), { name: 'Sandton' })
    await setDoc(doc(f, 'branches', 'b2'), { name: 'Soweto' })
    await setDoc(doc(f, 'counters', 'members'), { next: 1003 })
    await setDoc(doc(f, 'members', 'm1'), {
      number: 1001, firstName: 'Thabo', lastName: 'Nkosi', cellphone: '0825554101', branchId: 'b1',
      periods: [period('desk')], fingerprint: null, deleted: false, updatedAt: new Date(), lastAuditId: 'old',
    })
    await setDoc(doc(f, 'members', 'm2'), {
      number: 1002, firstName: 'Lerato', lastName: 'Mokoena', cellphone: '0794411264', branchId: 'b2',
      periods: [], fingerprint: null, deleted: false, updatedAt: new Date(), lastAuditId: 'old',
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
      tx.set(doc(f, 'counters', 'members'), { next: 1004 })
      tx.set(doc(f, 'members', 'm9'), { number: 1003, firstName: 'A', lastName: 'B', cellphone: '0820000000', branchId: 'b1', periods: [], fingerprint: null, deleted: false, updatedAt: serverTimestamp(), lastAuditId: a.id })
    })
    await assertSucceeds(ok)
    const clash = runTransaction(f, async (tx) => {
      const a = doc(collection(f, 'audit'))
      tx.set(a, { at: serverTimestamp(), actor: { uid: 'desk', name: 'x', role: 'front_desk' }, action: 'member.create', entity: 'member', entityId: 'm3', summary: '' })
      tx.set(doc(f, 'members', 'm3'), { number: 1001, firstName: 'A', lastName: 'B', cellphone: '0820000000', branchId: 'b1', periods: [], fingerprint: null, deleted: false, updatedAt: serverTimestamp(), lastAuditId: a.id })
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

describe('personal details and ID numbers', () => {
  const details = (auditId: string, extra = {}) => ({
    email: 't@x.co.za', dateOfBirth: '1992-03-15', idType: 'sa', idLast3: '088',
    emergencyName: 'N', emergencyPhone: '0832107788', notes: '', lastAuditId: auditId, ...extra,
  })
  const identity = (auditId: string, idNumber = '9203155108088') => ({ idType: 'sa', idNumber, lastAuditId: auditId })
  const dRef = (f: Firestore) => doc(f, 'members', 'm1', 'private', 'details')
  const iRef = (f: Firestore) => doc(f, 'members', 'm1', 'private', 'identity')

  it('front desk can save details and add an ID when none is on file, with an audit entry', async () => {
    const f = db('desk')
    await assertSucceeds(withAudit(f, 'desk', 'front_desk', (id, tx) => {
      tx.set(dRef(f), details(id))
      tx.set(iRef(f), identity(id))
    }))
  })

  it('without an audit entry the details are refused', async () => {
    await assertFails(setDoc(dRef(db('desk')), details('made-up')))
  })

  it('front desk can read details but not the full ID number', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'm1', 'private', 'details'), details('a'))
      await setDoc(doc(ctx.firestore(), 'members', 'm1', 'private', 'identity'), identity('a'))
    })
    await assertSucceeds(getDoc(dRef(db('desk'))))
    await assertFails(getDoc(iRef(db('desk'))))
    await assertSucceeds(getDoc(iRef(db('mgr'))))
  })

  it('the check-in PC cannot read details or ID numbers', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'm1', 'private', 'details'), details('a'))
      await setDoc(doc(ctx.firestore(), 'members', 'm1', 'private', 'identity'), identity('a'))
    })
    await assertFails(getDoc(dRef(db('pc'))))
    await assertFails(getDoc(iRef(db('pc'))))
  })

  it('only a manager can change an ID that is on file', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'members', 'm1', 'private', 'details'), details('a'))
      await setDoc(doc(ctx.firestore(), 'members', 'm1', 'private', 'identity'), identity('a'))
    })
    const f = db('desk')
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) => tx.set(iRef(f), identity(id, '0501015123083'))))
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) => tx.set(dRef(f), details(id, { idLast3: '083' }))))
    // front desk may still change other details
    await assertSucceeds(withAudit(f, 'desk', 'front_desk', (id, tx) => tx.set(dRef(f), details(id, { email: 'new@x.co.za' }))))
    const m = db('mgr')
    await assertSucceeds(withAudit(m, 'mgr', 'manager', (id, tx) => {
      tx.set(iRef(m), identity(id, '0501015123083'))
      tx.set(dRef(m), details(id, { idLast3: '083' }))
    }))
  })

  it('unknown fields are refused', async () => {
    const f = db('desk')
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) => tx.set(dRef(f), details(id, { medical: 'asthma' }))))
  })
})

describe('payment method', () => {
  it('is checked against the list when given', async () => {
    const f = db('desk')
    await assertSucceeds(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [period('desk'), { ...period('desk', 'p2', '2026-11-01', '2026-11-30'), method: 'card' }], updatedAt: serverTimestamp(), lastAuditId: id })))
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [period('desk'), { ...period('desk', 'p3'), method: 'bitcoin' }], updatedAt: serverTimestamp(), lastAuditId: id })))
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
  const log = { deviceId: 'pc', branchId: 'b1', memberId: 'm1', result: 'allowed', at: 1, date: '2026-10-01', text: 'Welcome' }
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
    await assertSucceeds(setDoc(doc(db('mgr'), 'staff', 'new'), { name: 'N', email: 'n@x', role: 'front_desk', branchId: 'b1', active: true }))
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

describe('branches', () => {
  const addBranch = (who: 'mgr' | 'desk', id: string) => {
    const f = db(who)
    return withAudit(f, who, who === 'mgr' ? 'manager' : 'front_desk', (a, tx) => tx.set(doc(f, 'branches', id), { name: 'Midrand', createdAt: serverTimestamp(), lastAuditId: a }))
  }

  it('only a manager can add a branch', async () => {
    await assertSucceeds(addBranch('mgr', 'b3'))
    await assertFails(addBranch('desk', 'b4'))
  })

  it('front desk and check-in logins must belong to a branch that exists', async () => {
    await assertFails(setDoc(doc(db('mgr'), 'staff', 'n1'), { name: 'N', email: 'n@x', role: 'front_desk', active: true }))
    await assertFails(setDoc(doc(db('mgr'), 'staff', 'n2'), { name: 'N', email: 'n@x', role: 'device', branchId: 'nope', active: true }))
    await assertSucceeds(setDoc(doc(db('mgr'), 'staff', 'n3'), { name: 'N', email: 'n@x', role: 'device', branchId: 'b2', active: true }))
    await assertFails(setDoc(doc(db('mgr'), 'staff', 'n4'), { name: 'N', email: 'n@x', role: 'manager', branchId: 'b1', active: true }))
  })

  it('front desk sees only their own branch’s members', async () => {
    const f = db('desk')
    await assertSucceeds(getDocs(query(collection(f, 'members'), where('branchId', '==', 'b1'), where('deleted', '==', false))))
    await assertFails(getDocs(query(collection(f, 'members'), where('branchId', '==', 'b2'))))
    await assertFails(getDocs(collection(f, 'members')))
    await assertSucceeds(getDoc(doc(f, 'members', 'm1')))
    await assertFails(getDoc(doc(f, 'members', 'm2')))
  })

  it('a manager sees every branch', async () => {
    const f = db('mgr')
    await assertSucceeds(getDocs(query(collection(f, 'members'), where('branchId', '==', 'b2'))))
    await assertSucceeds(getDocs(collection(f, 'members')))
    await assertSucceeds(getDoc(doc(f, 'members', 'm2')))
  })

  it('front desk cannot add, pay for or move members of another branch', async () => {
    const f = db('desk')
    await assertFails(runTransaction(f, async (tx) => {
      const a = doc(collection(f, 'audit'))
      tx.set(a, { at: serverTimestamp(), actor: { uid: 'desk', name: 'x', role: 'front_desk' }, action: 'member.create', entity: 'member', entityId: 'm9', summary: '' })
      tx.set(doc(f, 'counters', 'members'), { next: 1004 })
      tx.set(doc(f, 'members', 'm9'), { number: 1003, firstName: 'A', lastName: 'B', cellphone: '0820000000', branchId: 'b2', periods: [], fingerprint: null, deleted: false, updatedAt: serverTimestamp(), lastAuditId: a.id })
    }))
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm2'), { periods: [period('desk')], updatedAt: serverTimestamp(), lastAuditId: id })))
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { branchId: 'b2', updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('a manager can move a member to another branch', async () => {
    const f = db('mgr')
    await assertSucceeds(withAudit(f, 'mgr', 'manager', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { branchId: 'b2', updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('front desk cannot read another branch’s personal details', async () => {
    await env.withSecurityRulesDisabled((ctx) =>
      setDoc(doc(ctx.firestore(), 'members', 'm2', 'private', 'details'), { email: '', dateOfBirth: '', idType: null, idLast3: '', emergencyName: '', emergencyPhone: '', notes: '', lastAuditId: 'a' }))
    await assertFails(getDoc(doc(db('desk'), 'members', 'm2', 'private', 'details')))
    await assertSucceeds(getDoc(doc(db('desk2'), 'members', 'm2', 'private', 'details')))
  })

  it('door logs and check-in PCs are split by branch', async () => {
    await assertFails(setDoc(doc(db('pc'), 'doorLogs', 'x1'), { deviceId: 'pc', branchId: 'b2', memberId: 'm2', result: 'allowed', at: 1, date: '2026-10-01' }))
    await assertSucceeds(setDoc(doc(db('pc2'), 'doorLogs', 'x2'), { deviceId: 'pc2', branchId: 'b2', memberId: 'm2', result: 'allowed', at: 1, date: '2026-10-01' }))
    await assertFails(getDocs(query(collection(db('desk'), 'doorLogs'), where('branchId', '==', 'b2'))))
    await assertSucceeds(getDocs(query(collection(db('desk2'), 'doorLogs'), where('branchId', '==', 'b2'), where('date', '==', '2026-10-01'))))
    await assertFails(setDoc(doc(db('pc'), 'devices', 'pc'), { name: 'T', branchId: 'b2', lastSeenAt: 1 }))
    await assertSucceeds(setDoc(doc(db('pc'), 'devices', 'pc'), { name: 'T', branchId: 'b1', lastSeenAt: 1 }))
    await assertSucceeds(getDocs(query(collection(db('desk'), 'devices'), where('branchId', '==', 'b1'))))
    await assertFails(getDocs(query(collection(db('desk2'), 'devices'), where('branchId', '==', 'b1'))))
  })

  it('a check-in PC only gets its own branch’s members and fingerprints', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'templates', 'm2'), { cipher: 'abc' }))
    await assertSucceeds(getDocs(query(collection(db('pc'), 'members'), where('branchId', '==', 'b1'))))
    await assertFails(getDocs(query(collection(db('pc'), 'members'), where('branchId', '==', 'b2'))))
    await assertFails(getDoc(doc(db('pc'), 'templates', 'm2')))
    await assertSucceeds(getDoc(doc(db('pc2'), 'templates', 'm2')))
  })

  it('enrolment requests stay in the member’s branch', async () => {
    const req = (memberId: string, branchId: string, uid: string) => ({ memberId, branchId, status: 'pending', step: 0, captureSeq: 1, requestedBy: { uid, name: 'x' } })
    await assertFails(setDoc(doc(db('desk'), 'enrolRequests', 'e1'), req('m2', 'b2', 'desk')))
    await assertFails(setDoc(doc(db('desk'), 'enrolRequests', 'e2'), req('m1', 'b2', 'desk')))
    await assertSucceeds(setDoc(doc(db('desk'), 'enrolRequests', 'e3'), req('m1', 'b1', 'desk')))
    await assertSucceeds(getDocs(query(collection(db('pc'), 'enrolRequests'), where('branchId', '==', 'b1'), where('status', '==', 'pending'))))
    await assertFails(getDocs(query(collection(db('pc2'), 'enrolRequests'), where('branchId', '==', 'b1'))))
  })

  it('front desk only reads their own login', async () => {
    await assertSucceeds(getDoc(doc(db('desk'), 'staff', 'desk')))
    await assertFails(getDoc(doc(db('desk'), 'staff', 'desk2')))
    await assertSucceeds(getDocs(collection(db('mgr'), 'staff')))
  })

  it('members without a branch (before setup) are hidden from front desk but a manager can assign them', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'members', 'old'), {
      number: 999, firstName: 'O', lastName: 'D', cellphone: '0820000001', periods: [], fingerprint: null, deleted: false, updatedAt: new Date(), lastAuditId: 'x',
    }))
    await assertFails(getDoc(doc(db('desk'), 'members', 'old')))
    const f = db('mgr')
    await assertSucceeds(getDoc(doc(f, 'members', 'old')))
    await assertSucceeds(withAudit(f, 'mgr', 'manager', (id, tx) =>
      tx.update(doc(f, 'members', 'old'), { branchId: 'b1', updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('first-time setup can create the branch and move old members into it in one go', async () => {
    await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), 'members', 'old'), {
      number: 999, firstName: 'O', lastName: 'D', cellphone: '0820000001', periods: [], fingerprint: null, deleted: false, updatedAt: new Date(), lastAuditId: 'x',
    }))
    const f = db('mgr')
    await assertSucceeds(withAudit(f, 'mgr', 'manager', (id, tx) => {
      tx.set(doc(f, 'branches', 'b9'), { name: 'New', createdAt: serverTimestamp(), lastAuditId: id })
      tx.update(doc(f, 'members', 'old'), { branchId: 'b9', updatedAt: serverTimestamp(), lastAuditId: id })
      tx.update(doc(f, 'staff', 'desk'), { branchId: 'b9' })
    }))
  })
})

describe('amounts and prices', () => {
  it('front desk can log a payment with an amount in cents', async () => {
    const f = db('desk')
    await assertSucceeds(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [period('desk'), { ...period('desk', 'p2', '2026-11-01', '2026-11-30'), method: 'eft', amountCents: 45000 }], updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('amounts must be whole cents and not negative', async () => {
    const f = db('desk')
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [period('desk'), { ...period('desk', 'p2'), amountCents: -100 }], updatedAt: serverTimestamp(), lastAuditId: id })))
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [period('desk'), { ...period('desk', 'p3'), amountCents: 450.5 }], updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('front desk cannot change the amount of an existing payment', async () => {
    const f = db('desk')
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) =>
      tx.update(doc(f, 'members', 'm1'), { periods: [{ ...period('desk'), amountCents: 1 }], updatedAt: serverTimestamp(), lastAuditId: id })))
  })

  it('only managers set prices', async () => {
    const prices = { day: 8000, m1: 45000, m3: 120000, m6: null, m12: 400000 }
    const m = db('mgr')
    await assertSucceeds(withAudit(m, 'mgr', 'manager', (id, tx) => tx.update(doc(m, 'branches', 'b1'), { prices, lastAuditId: id })))
    const f = db('desk')
    await assertFails(withAudit(f, 'desk', 'front_desk', (id, tx) => tx.update(doc(f, 'branches', 'b1'), { prices, lastAuditId: id })))
    await assertFails(withAudit(m, 'mgr', 'manager', (id, tx) => tx.update(doc(m, 'branches', 'b1'), { prices: { m1: 'cheap' }, lastAuditId: id })))
  })
})
