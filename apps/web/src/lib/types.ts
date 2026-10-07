import type { DeniedReason, PeriodKind } from './access'
import type { LocalDate } from './dates'
import type { IdType } from './idNumber'

export type Role = 'front_desk' | 'manager' | 'device'

export const ROLE_LABEL: Record<Role, string> = {
  front_desk: 'Front desk',
  manager: 'Manager',
  device: 'Check-in PC',
}

export interface Actor {
  uid: string
  name: string
}

export interface Staff {
  uid: string
  name: string
  email: string
  role: Role
  active: boolean
  /** Front desk and check-in PCs belong to one branch; managers see all (null). */
  branchId: string | null
}

export type PriceKey = 'day' | 'm1' | 'm3' | 'm6' | 'm12'
/** Price list per branch, in cents. A missing price means staff type the amount. */
export type Prices = Partial<Record<PriceKey, number | null>>

export interface Branch {
  id: string
  name: string
  prices: Prices
}

export interface Period {
  id: string
  kind: PeriodKind
  qty: number
  start: LocalDate
  end: LocalDate
  loggedBy: Actor
  /** ms since epoch */
  loggedAt: number
  deleted?: boolean
  changedBy?: Actor
  changedAt?: number
  /** How they paid. Missing on older or imported payments. */
  method?: PaymentMethod
  /** Amount paid in cents (R450 = 45000). Missing on older or imported payments. */
  amountCents?: number
}

export type PaymentMethod = 'cash' | 'card' | 'eft' | 'debit_order'
export const PAYMENT_METHODS: PaymentMethod[] = ['cash', 'card', 'eft', 'debit_order']
export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  cash: 'Cash',
  card: 'Card',
  eft: 'EFT',
  debit_order: 'Debit order',
}

/**
 * Personal details, kept in members/{id}/private/details: readable by staff only,
 * never synced to the check-in PC.
 */
export interface MemberDetails {
  email: string
  dateOfBirth: string
  idType: IdType | null
  /** Last 3 characters of the ID, for the masked display */
  idLast3: string
  emergencyName: string
  emergencyPhone: string
  notes: string
}

/** Full ID number, kept in members/{id}/private/identity: managers only. */
export interface MemberIdentity {
  idType: IdType
  idNumber: string
}

export const EMPTY_DETAILS: MemberDetails = {
  email: '',
  dateOfBirth: '',
  idType: null,
  idLast3: '',
  emergencyName: '',
  emergencyPhone: '',
  notes: '',
}

export interface Fingerprint {
  finger: string
  enrolledAt: number
}

export interface Member {
  id: string
  number: number
  firstName: string
  lastName: string
  cellphone: string
  periods: Period[]
  fingerprint: Fingerprint | null
  createdAt: number
  deleted: boolean
  /** Home branch. Missing only on records from before branches were set up. */
  branchId: string | null
}

export interface DoorLog {
  id: string
  deviceId: string
  branchId: string | null
  memberId: string | null
  memberName: string | null
  memberNumber: number | null
  result: 'allowed' | 'denied'
  reason: DeniedReason | null
  /** Text shown on the turnstile screen, e.g. "Membership ended 30 Sep" */
  text: string
  /** Paid until at the time of the scan (allowed scans) */
  paidUntil: LocalDate | null
  at: number
  date: LocalDate
  offline: boolean
}

export interface Device {
  id: string
  name: string
  branchId: string | null
  lastSeenAt: number
  mode: 'simulation' | 'hardware'
  readerConnected: boolean
  relayConnected: boolean
  pendingLogs: number
  appVersion: string
}

export type EnrolStatus = 'pending' | 'scanning' | 'done' | 'failed' | 'cancelled'

export interface EnrolRequest {
  id: string
  memberId: string
  memberName: string
  memberNumber: number
  status: EnrolStatus
  /** Scans captured so far (0–4) */
  step: number
  /** Raised by staff each time they press Capture scan */
  captureSeq: number
  message: string
  requestedBy: Actor
  createdAt: number
}

export interface AuditEntry {
  id: string
  at: number
  actor: Actor & { role: Role }
  action: string
  entity: string
  entityId: string
  summary: string
  before: unknown
  after: unknown
}

export const memberName = (m: Pick<Member, 'firstName' | 'lastName'>) => `${m.firstName} ${m.lastName}`.trim()
export const memberCode = (n: number) => `GY-${n}`
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p[0]!.toUpperCase())
    .filter((_, i, a) => i === 0 || i === a.length - 1)
    .join('')

/** "082 *** 4101" — personal data is masked in lists. */
export function maskCellphone(c: string): string {
  const digits = c.replace(/\D/g, '')
  if (digits.length < 7) return c
  return `${digits.slice(0, 3)} *** ${digits.slice(-4)}`
}

/** "082 123 4101" */
export function formatCellphone(c: string): string {
  const d = c.replace(/\D/g, '')
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`
  return c
}

export const DEVICE_ONLINE_MS = 30_000
export const isDeviceOnline = (d: Device | undefined, now: number) => !!d && now - d.lastSeenAt < DEVICE_ONLINE_MS
