/**
 * Every change goes through here. Each write is a transaction that also creates an
 * audit entry; firestore.rules refuse member changes without a matching audit entry.
 */
import { deleteApp, initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, getAuth, signOut, connectAuthEmulator } from 'firebase/auth'
import {
  collection,
  doc,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Transaction,
} from 'firebase/firestore'
import { periodEnd, periodLabel, type PeriodKind } from '../lib/access'
import { formatDayMonth, isValidDate, type LocalDate } from '../lib/dates'
import { db, firebaseConfig, useEmulator } from '../lib/firebase'
import { memberCode, type Member, type Period, type Role, type Staff } from '../lib/types'
import { toMember } from './convert'

export class ActionError extends Error {}

const actorOf = (s: Staff) => ({ uid: s.uid, name: s.name })

function writeAudit(
  tx: Transaction,
  staff: Staff,
  entry: { action: string; entity: string; entityId: string; summary: string; before?: unknown; after?: unknown },
): string {
  const ref = doc(collection(db, 'audit'))
  tx.set(ref, {
    at: serverTimestamp(),
    actor: { uid: staff.uid, name: staff.name, role: staff.role },
    action: entry.action,
    entity: entry.entity,
    entityId: entry.entityId,
    summary: entry.summary,
    before: entry.before ?? null,
    after: entry.after ?? null,
  })
  return ref.id
}

/* ---------------- Members ---------------- */

export interface MemberInput {
  firstName: string
  lastName: string
  cellphone: string
}

export function cleanCellphone(raw: string): string {
  let d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+27')) d = '0' + d.slice(3)
  else if (d.startsWith('27') && d.length === 11) d = '0' + d.slice(2)
  return d.replace(/\D/g, '')
}

/** Returns an error message, or null when the details are fine. */
export function checkMemberInput(m: MemberInput): Partial<Record<keyof MemberInput, string>> {
  const errors: Partial<Record<keyof MemberInput, string>> = {}
  if (!m.firstName.trim()) errors.firstName = 'Enter a first name'
  if (!m.lastName.trim()) errors.lastName = 'Enter a surname'
  const c = cleanCellphone(m.cellphone)
  if (!c) errors.cellphone = 'Enter a cellphone number'
  else if (!/^0\d{9}$/.test(c)) errors.cellphone = 'Use a 10-digit number, like 082 123 4567'
  return errors
}

export async function addMember(staff: Staff, input: MemberInput): Promise<{ id: string; number: number }> {
  const counterRef = doc(db, 'counters', 'members')
  const memberRef = doc(collection(db, 'members'))
  return runTransaction(db, async (tx) => {
    const counter = await tx.get(counterRef)
    const number: number = counter.exists() ? counter.data().next : 1001
    tx.set(counterRef, { next: number + 1 })
    const data = {
      number,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      cellphone: cleanCellphone(input.cellphone),
    }
    const auditId = writeAudit(tx, staff, {
      action: 'member.create',
      entity: 'member',
      entityId: memberRef.id,
      summary: `Added ${data.firstName} ${data.lastName} (${memberCode(number)})`,
      after: { number, firstName: data.firstName, lastName: data.lastName },
    })
    tx.set(memberRef, {
      ...data,
      periods: [],
      fingerprint: null,
      deleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastAuditId: auditId,
    })
    return { id: memberRef.id, number }
  })
}

export async function updateMember(staff: Staff, memberId: string, input: MemberInput): Promise<void> {
  const ref = doc(db, 'members', memberId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ActionError('This member no longer exists')
    const before = toMember(snap.id, snap.data())
    const after = { firstName: input.firstName.trim(), lastName: input.lastName.trim(), cellphone: cleanCellphone(input.cellphone) }
    const auditId = writeAudit(tx, staff, {
      action: 'member.update',
      entity: 'member',
      entityId: memberId,
      summary: `Changed details of ${memberCode(before.number)}`,
      before: { firstName: before.firstName, lastName: before.lastName, cellphoneChanged: before.cellphone !== after.cellphone },
      after: { firstName: after.firstName, lastName: after.lastName },
    })
    tx.update(ref, { ...after, updatedAt: serverTimestamp(), lastAuditId: auditId })
  })
}

/**
 * Removes a member (manager only). Personal details and fingerprint are erased;
 * a blank record stays so the check-in PC also deletes its copy (POPIA).
 */
export async function removeMember(staff: Staff, memberId: string): Promise<void> {
  if (staff.role !== 'manager') throw new ActionError('Only a manager can remove a member')
  const ref = doc(db, 'members', memberId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) return
    const m = toMember(snap.id, snap.data())
    const auditId = writeAudit(tx, staff, {
      action: 'member.remove',
      entity: 'member',
      entityId: memberId,
      summary: `Removed ${memberCode(m.number)} and erased their details and fingerprint`,
      before: { number: m.number, periods: m.periods.length, fingerprint: !!m.fingerprint },
    })
    tx.set(ref, {
      number: m.number,
      firstName: '',
      lastName: '',
      cellphone: '',
      periods: [],
      fingerprint: null,
      deleted: true,
      createdAt: snap.data().createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastAuditId: auditId,
    })
    tx.delete(doc(db, 'templates', memberId))
  })
}

/* ---------------- Payments ---------------- */

export interface PaymentInput {
  kind: PeriodKind
  qty: number
  start: LocalDate
}

export function checkPayment(p: PaymentInput): string | null {
  if (!isValidDate(p.start)) return 'Choose a start date'
  if (!Number.isInteger(p.qty) || p.qty < 1) return 'Choose how long'
  if (p.kind === 'days' && p.qty > 366) return 'Up to 366 days'
  if (p.kind === 'months' && p.qty > 24) return 'Up to 24 months'
  return null
}

const periodSummary = (p: Pick<Period, 'kind' | 'qty' | 'start' | 'end'>) =>
  `${periodLabel(p.kind, p.qty)}, ${formatDayMonth(p.start)} → ${formatDayMonth(p.end)}`

export async function logPayment(staff: Staff, memberId: string, input: PaymentInput): Promise<Period> {
  const err = checkPayment(input)
  if (err) throw new ActionError(err)
  const ref = doc(db, 'members', memberId)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists() || snap.data().deleted) throw new ActionError('This member no longer exists')
    const m = toMember(snap.id, snap.data())
    const period: Period = {
      id: crypto.randomUUID(),
      kind: input.kind,
      qty: input.kind === 'day' ? 1 : input.qty,
      start: input.start,
      end: periodEnd(input.kind, input.kind === 'day' ? 1 : input.qty, input.start),
      loggedBy: actorOf(staff),
      loggedAt: Date.now(),
    }
    const auditId = writeAudit(tx, staff, {
      action: 'payment.create',
      entity: 'member',
      entityId: memberId,
      summary: `Logged ${periodSummary(period)} for ${memberCode(m.number)}`,
      after: period,
    })
    tx.update(ref, { periods: [...m.periods, period], updatedAt: serverTimestamp(), lastAuditId: auditId })
    return period
  })
}

/** Manager only. */
export async function editPayment(staff: Staff, memberId: string, periodId: string, input: PaymentInput): Promise<void> {
  if (staff.role !== 'manager') throw new ActionError('Only a manager can change a payment')
  const err = checkPayment(input)
  if (err) throw new ActionError(err)
  const ref = doc(db, 'members', memberId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ActionError('This member no longer exists')
    const m = toMember(snap.id, snap.data())
    const before = m.periods.find((p) => p.id === periodId)
    if (!before || before.deleted) throw new ActionError('This payment no longer exists')
    const qty = input.kind === 'day' ? 1 : input.qty
    const after: Period = {
      ...before,
      kind: input.kind,
      qty,
      start: input.start,
      end: periodEnd(input.kind, qty, input.start),
      changedBy: actorOf(staff),
      changedAt: Date.now(),
    }
    const auditId = writeAudit(tx, staff, {
      action: 'payment.update',
      entity: 'member',
      entityId: memberId,
      summary: `Changed payment for ${memberCode(m.number)}: ${periodSummary(before)} → ${periodSummary(after)}`,
      before,
      after,
    })
    tx.update(ref, {
      periods: m.periods.map((p) => (p.id === periodId ? after : p)),
      updatedAt: serverTimestamp(),
      lastAuditId: auditId,
    })
  })
}

/** Manager only. The payment is kept, marked as deleted. */
export async function deletePayment(staff: Staff, memberId: string, periodId: string): Promise<void> {
  if (staff.role !== 'manager') throw new ActionError('Only a manager can delete a payment')
  const ref = doc(db, 'members', memberId)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ActionError('This member no longer exists')
    const m = toMember(snap.id, snap.data())
    const before = m.periods.find((p) => p.id === periodId)
    if (!before || before.deleted) return
    const after: Period = { ...before, deleted: true, changedBy: actorOf(staff), changedAt: Date.now() }
    const auditId = writeAudit(tx, staff, {
      action: 'payment.delete',
      entity: 'member',
      entityId: memberId,
      summary: `Deleted payment for ${memberCode(m.number)}: ${periodSummary(before)}`,
      before,
      after,
    })
    tx.update(ref, {
      periods: m.periods.map((p) => (p.id === periodId ? after : p)),
      updatedAt: serverTimestamp(),
      lastAuditId: auditId,
    })
  })
}

/* ---------------- Fingerprint enrolment ---------------- */

/** Asks the check-in PC to start enrolling this member. */
export async function startEnrolment(staff: Staff, m: Member): Promise<string> {
  const ref = doc(collection(db, 'enrolRequests'))
  await setDoc(ref, {
    memberId: m.id,
    memberName: `${m.firstName} ${m.lastName}`,
    memberNumber: m.number,
    status: 'pending',
    step: 0,
    // the first press of "Capture scan" starts the request and asks for scan 1
    captureSeq: 1,
    message: '',
    requestedBy: actorOf(staff),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export const requestCapture = (requestId: string) =>
  updateDoc(doc(db, 'enrolRequests', requestId), { captureSeq: increment(1), updatedAt: serverTimestamp() })

export const cancelEnrolment = (requestId: string) =>
  updateDoc(doc(db, 'enrolRequests', requestId), { status: 'cancelled', updatedAt: serverTimestamp() })

/* ---------------- Staff ---------------- */

export interface NewStaffInput {
  name: string
  email: string
  password: string
  role: Role
}

/**
 * Creates a login without signing the manager out: a second Firebase app instance
 * is used for the sign-up, then thrown away.
 */
export async function createStaff(manager: Staff, input: NewStaffInput): Promise<string> {
  if (manager.role !== 'manager') throw new ActionError('Only a manager can add staff')
  const secondary = initializeApp(firebaseConfig, `staff-signup-${Date.now()}`)
  try {
    const secondaryAuth = getAuth(secondary)
    if (useEmulator) connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true })
    const cred = await createUserWithEmailAndPassword(secondaryAuth, input.email.trim(), input.password)
    await signOut(secondaryAuth)
    const uid = cred.user.uid
    await runTransaction(db, async (tx) => {
      writeAudit(tx, manager, {
        action: 'staff.create',
        entity: 'staff',
        entityId: uid,
        summary: `Added ${input.name.trim()} as ${input.role.replace('_', ' ')}`,
      })
      tx.set(doc(db, 'staff', uid), {
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: input.role,
        active: true,
        createdAt: serverTimestamp(),
      })
    })
    return uid
  } catch (e) {
    throw new ActionError(authMessage(e))
  } finally {
    await deleteApp(secondary)
  }
}

export async function setStaffActive(manager: Staff, target: Staff, active: boolean): Promise<void> {
  if (manager.role !== 'manager') throw new ActionError('Only a manager can change staff')
  if (target.uid === manager.uid) throw new ActionError('You cannot switch off your own login')
  await runTransaction(db, async (tx) => {
    writeAudit(tx, manager, {
      action: active ? 'staff.enable' : 'staff.disable',
      entity: 'staff',
      entityId: target.uid,
      summary: `${active ? 'Switched on' : 'Switched off'} login for ${target.name}`,
    })
    tx.update(doc(db, 'staff', target.uid), { active })
  })
}

export function authMessage(e: unknown): string {
  const code = (e as { code?: string })?.code ?? ''
  if (e instanceof ActionError) return e.message
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'Wrong email or password'
    case 'auth/too-many-requests':
      return 'Too many tries. Wait a minute and try again.'
    case 'auth/network-request-failed':
      return 'No internet connection'
    case 'auth/email-already-in-use':
      return 'This email already has a login'
    case 'auth/weak-password':
      return 'Use at least 8 characters'
    case 'permission-denied':
      return 'You do not have permission to do that'
    case 'unavailable':
      return 'No internet connection. Try again.'
    default:
      return 'Something went wrong. Try again.'
  }
}
