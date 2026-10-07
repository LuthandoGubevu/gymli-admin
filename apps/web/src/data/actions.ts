/**
 * Every change goes through here. Each write is a transaction that also creates an
 * audit entry; firestore.rules refuse member changes without a matching audit entry.
 */
import { deleteApp, initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, getAuth, signOut, connectAuthEmulator } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
  type DocumentReference,
} from 'firebase/firestore'
import { periodEnd, periodLabel, type PeriodKind } from '../lib/access'
import { formatDayMonth, isValidDate, type LocalDate } from '../lib/dates'
import { db, firebaseConfig, useEmulator } from '../lib/firebase'
import { checkId, checkSaId, cleanId, type IdType } from '../lib/idNumber'
import { formatRand } from '../lib/accounts'
import { memberCode, PAYMENT_METHOD_LABEL, type Prices, type Member, type MemberDetails, type MemberIdentity, type PaymentMethod, type Period, type Role, type Staff } from '../lib/types'
import { toMember } from './convert'

export class ActionError extends Error {}

const actorOf = (s: Staff) => ({ uid: s.uid, name: s.name })

/** A transaction or a write batch */
interface Writer {
  set(ref: DocumentReference, data: DocumentData): unknown
}

function writeAudit(
  tx: Writer,
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
  email: string
  idType: IdType
  /** Empty when the ID is not being set or changed */
  idNumber: string
  /** Typed in for passports; worked out from the number for SA IDs */
  dateOfBirth: string
  emergencyName: string
  emergencyPhone: string
  notes: string
}

export const EMPTY_MEMBER_INPUT: MemberInput = {
  firstName: '',
  lastName: '',
  cellphone: '',
  email: '',
  idType: 'sa',
  idNumber: '',
  dateOfBirth: '',
  emergencyName: '',
  emergencyPhone: '',
  notes: '',
}

export function cleanCellphone(raw: string): string {
  let d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+27')) d = '0' + d.slice(3)
  else if (d.startsWith('27') && d.length === 11) d = '0' + d.slice(2)
  return d.replace(/\D/g, '')
}

export type MemberErrors = Partial<Record<keyof MemberInput, string>>

/**
 * Checks the form. `idRequired`: a new member, or one with no ID on file yet.
 * Returns an empty object when everything is fine.
 */
export function checkMemberInput(m: MemberInput, today: LocalDate, idRequired: boolean): MemberErrors {
  const errors: MemberErrors = {}
  if (!m.firstName.trim()) errors.firstName = 'Enter a first name'
  if (!m.lastName.trim()) errors.lastName = 'Enter a surname'
  const c = cleanCellphone(m.cellphone)
  if (!c) errors.cellphone = 'Enter a cellphone number'
  else if (!/^0\d{9}$/.test(c)) errors.cellphone = 'Use a 10-digit number, like 082 123 4567'
  if (m.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m.email.trim())) errors.email = 'Check the email address'
  if (m.idNumber.trim() || idRequired) {
    if (!m.idNumber.trim()) errors.idNumber = m.idType === 'sa' ? 'Enter the SA ID number' : 'Enter the passport number'
    else {
      const id = checkId(m.idType, m.idNumber, today)
      if (!id.ok) errors.idNumber = id.error
    }
    if (m.idType === 'passport' && !isValidDate(m.dateOfBirth)) errors.dateOfBirth = 'Enter the date of birth'
  }
  const ec = cleanCellphone(m.emergencyPhone)
  if (m.emergencyPhone.trim() && !/^0\d{9}$/.test(ec)) errors.emergencyPhone = 'Use a 10-digit number'
  if (m.emergencyPhone.trim() && !m.emergencyName.trim()) errors.emergencyName = 'Enter their name'
  if (m.notes.length > 500) errors.notes = 'Keep notes under 500 characters'
  return errors
}

const detailsRef = (memberId: string) => doc(db, 'members', memberId, 'private', 'details')
const identityRef = (memberId: string) => doc(db, 'members', memberId, 'private', 'identity')

/** The fields of the private details document. The ID part is only included when the ID is set. */
function detailsData(input: MemberInput, today: LocalDate, keep?: MemberDetails | null) {
  const idNumber = cleanId(input.idNumber)
  const setsId = idNumber.length > 0
  const dob = setsId
    ? input.idType === 'sa'
      ? checkSaId(idNumber, today).dateOfBirth ?? ''
      : input.dateOfBirth
    : (keep?.dateOfBirth ?? input.dateOfBirth)
  return {
    email: input.email.trim().toLowerCase(),
    dateOfBirth: dob,
    idType: setsId ? input.idType : (keep?.idType ?? null),
    idLast3: setsId ? idNumber.slice(-3) : (keep?.idLast3 ?? ''),
    emergencyName: input.emergencyName.trim(),
    emergencyPhone: cleanCellphone(input.emergencyPhone),
    notes: input.notes.trim(),
  }
}

export async function addMember(staff: Staff, input: MemberInput, today: LocalDate, branchId: string): Promise<{ id: string; number: number }> {
  const counterRef = doc(db, 'counters', 'members')
  const memberRef = doc(collection(db, 'members'))
  const idNumber = cleanId(input.idNumber)
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
      // never the ID number itself in the audit trail
      summary: `Added ${data.firstName} ${data.lastName} (${memberCode(number)})${idNumber ? '' : ' without an ID number'}`,
      after: { number, firstName: data.firstName, lastName: data.lastName, idType: idNumber ? input.idType : null },
    })
    tx.set(memberRef, {
      ...data,
      branchId,
      periods: [],
      fingerprint: null,
      deleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastAuditId: auditId,
    })
    tx.set(detailsRef(memberRef.id), { ...detailsData(input, today), lastAuditId: auditId })
    if (idNumber) tx.set(identityRef(memberRef.id), { idType: input.idType, idNumber, lastAuditId: auditId })
    return { id: memberRef.id, number }
  })
}

/**
 * Saves changed details. The ID number is written only when `input.idNumber` is filled in:
 * managers can change it; front desk can only add one when none is on file.
 */
export async function updateMember(staff: Staff, memberId: string, input: MemberInput, today: LocalDate, current: MemberDetails | null): Promise<void> {
  const ref = doc(db, 'members', memberId)
  const idNumber = cleanId(input.idNumber)
  const hadId = !!current?.idType
  if (idNumber && hadId && staff.role !== 'manager') throw new ActionError('Only a manager can change the ID number')
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new ActionError('This member no longer exists')
    const before = toMember(snap.id, snap.data())
    const after = { firstName: input.firstName.trim(), lastName: input.lastName.trim(), cellphone: cleanCellphone(input.cellphone) }
    const changed = [
      before.firstName !== after.firstName || before.lastName !== after.lastName ? 'name' : '',
      before.cellphone !== after.cellphone ? 'cellphone' : '',
      idNumber ? (hadId ? 'ID number' : 'ID number added') : '',
    ].filter(Boolean)
    const auditId = writeAudit(tx, staff, {
      action: 'member.update',
      entity: 'member',
      entityId: memberId,
      summary: `Changed details of ${memberCode(before.number)}${changed.length ? ` (${changed.join(', ')})` : ''}`,
      before: { firstName: before.firstName, lastName: before.lastName },
      after: { firstName: after.firstName, lastName: after.lastName },
    })
    tx.update(ref, { ...after, updatedAt: serverTimestamp(), lastAuditId: auditId })
    tx.set(detailsRef(memberId), { ...detailsData(input, today, current), lastAuditId: auditId })
    if (idNumber) tx.set(identityRef(memberId), { idType: input.idType, idNumber, lastAuditId: auditId })
  })
}

/** Managers only (enforced by the rules): the full ID number. */
export async function readIdentity(memberId: string): Promise<MemberIdentity | null> {
  const snap = await getDoc(identityRef(memberId))
  return snap.exists() ? { idType: snap.data().idType, idNumber: snap.data().idNumber } : null
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
      summary: `Removed ${memberCode(m.number)} and erased their details, ID number and fingerprint`,
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
      // kept so the branch's check-in PC sees the removal and deletes its copy
      branchId: snap.data().branchId ?? null,
      createdAt: snap.data().createdAt ?? serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastAuditId: auditId,
    })
    tx.delete(doc(db, 'templates', memberId))
    tx.delete(detailsRef(memberId))
    tx.delete(identityRef(memberId))
  })
}

/* ---------------- Payments ---------------- */

export interface PaymentInput {
  kind: PeriodKind
  qty: number
  start: LocalDate
  /** How they paid. Optional only for imports. */
  method?: PaymentMethod
  /** Amount paid, in cents. Optional only for imports. */
  amountCents?: number
}

export function checkPayment(p: PaymentInput): string | null {
  if (!isValidDate(p.start)) return 'Choose a start date'
  if (!Number.isInteger(p.qty) || p.qty < 1) return 'Choose how long'
  if (p.kind === 'days' && p.qty > 366) return 'Up to 366 days'
  if (p.kind === 'months' && p.qty > 24) return 'Up to 24 months'
  if (p.amountCents !== undefined && (!Number.isInteger(p.amountCents) || p.amountCents < 0 || p.amountCents > 10_000_000)) return 'Enter the amount paid'
  return null
}

const periodSummary = (p: Pick<Period, 'kind' | 'qty' | 'start' | 'end' | 'method' | 'amountCents'>) =>
  [
    `${periodLabel(p.kind, p.qty)}, ${formatDayMonth(p.start)} → ${formatDayMonth(p.end)}`,
    p.method ? PAYMENT_METHOD_LABEL[p.method] : null,
    typeof p.amountCents === 'number' ? formatRand(p.amountCents) : null,
  ]
    .filter(Boolean)
    .join(', ')

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
      ...(input.method ? { method: input.method } : {}),
      ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
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
      ...(input.method ? { method: input.method } : {}),
      ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
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
    branchId: m.branchId,
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
  /** Required for front desk and check-in PCs; managers see every branch */
  branchId: string | null
}

/**
 * Creates a login without signing the manager out: a second Firebase app instance
 * is used for the sign-up, then thrown away.
 */
export async function createStaff(manager: Staff, input: NewStaffInput): Promise<string> {
  if (manager.role !== 'manager') throw new ActionError('Only a manager can add staff')
  if (input.role !== 'manager' && !input.branchId) throw new ActionError('Choose a branch')
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
        branchId: input.role === 'manager' ? null : input.branchId,
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

/* ---------------- Branches ---------------- */

function checkBranchName(name: string): string {
  const n = name.trim()
  if (!n) throw new ActionError('Enter a branch name')
  if (n.length > 60) throw new ActionError('Keep the name under 60 characters')
  return n
}

export async function addBranch(manager: Staff, name: string): Promise<string> {
  if (manager.role !== 'manager') throw new ActionError('Only a manager can add a branch')
  const n = checkBranchName(name)
  const ref = doc(collection(db, 'branches'))
  await runTransaction(db, async (tx) => {
    const auditId = writeAudit(tx, manager, { action: 'branch.create', entity: 'branch', entityId: ref.id, summary: `Added branch ${n}` })
    tx.set(ref, { name: n, createdAt: serverTimestamp(), lastAuditId: auditId })
  })
  return ref.id
}

export async function renameBranch(manager: Staff, id: string, from: string, name: string): Promise<void> {
  if (manager.role !== 'manager') throw new ActionError('Only a manager can rename a branch')
  const n = checkBranchName(name)
  const ref = doc(db, 'branches', id)
  await runTransaction(db, async (tx) => {
    const auditId = writeAudit(tx, manager, { action: 'branch.rename', entity: 'branch', entityId: id, summary: `Renamed branch ${from} to ${n}`, before: { name: from }, after: { name: n } })
    tx.update(ref, { name: n, lastAuditId: auditId })
  })
}

/** Saves a branch's price list (cents; null = no fixed price). */
export async function setBranchPrices(manager: Staff, branchId: string, branchName: string, before: Prices, prices: Prices): Promise<void> {
  if (manager.role !== 'manager') throw new ActionError('Only a manager can change prices')
  for (const v of Object.values(prices)) if (v !== null && v !== undefined && (!Number.isInteger(v) || v < 0 || v > 10_000_000)) throw new ActionError('Check the prices')
  const ref = doc(db, 'branches', branchId)
  await runTransaction(db, async (tx) => {
    const auditId = writeAudit(tx, manager, { action: 'branch.prices', entity: 'branch', entityId: branchId, summary: `Changed prices for ${branchName}`, before, after: prices })
    tx.update(ref, { prices, lastAuditId: auditId })
  })
}

/**
 * First-time setup: creates the first branch and puts every existing member and
 * front-desk / check-in login in it. The branch, the logins and the first members are
 * saved together, so a gym of normal size is set up in one go; very large lists continue
 * in further batches.
 */
export async function setUpFirstBranch(manager: Staff, name: string): Promise<string> {
  if (manager.role !== 'manager') throw new ActionError('Only a manager can add a branch')
  const n = checkBranchName(name)
  const branchRef = doc(collection(db, 'branches'))
  const branchId = branchRef.id
  const members = (await getDocs(collection(db, 'members'))).docs.filter((d) => !d.data().branchId)
  const logins = (await getDocs(collection(db, 'staff'))).docs.filter((d) => d.data().role !== 'manager' && !d.data().branchId)
  const FIRST = Math.max(0, 450 - logins.length)
  const chunks = [members.slice(0, FIRST)]
  for (let i = FIRST; i < members.length; i += 450) chunks.push(members.slice(i, i + 450))

  for (const [i, chunk] of chunks.entries()) {
    const batch = writeBatch(db)
    const auditId = writeAudit(batch, manager, {
      action: i === 0 ? 'branch.create' : 'branch.assign',
      entity: 'branch',
      entityId: branchId,
      summary: i === 0 ? `Added branch ${n}; put ${members.length} existing members and ${logins.length} logins in it` : `Put ${chunk.length} more existing members in ${n}`,
    })
    if (i === 0) {
      batch.set(branchRef, { name: n, createdAt: serverTimestamp(), lastAuditId: auditId })
      for (const d of logins) batch.update(d.ref, { branchId })
    }
    for (const d of chunk) batch.update(d.ref, { branchId, updatedAt: serverTimestamp(), lastAuditId: auditId })
    await batch.commit()
  }
  return branchId
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
