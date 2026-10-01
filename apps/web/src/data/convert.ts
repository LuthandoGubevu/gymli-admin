import { Timestamp, type DocumentData } from 'firebase/firestore'
import type { Device, DoorLog, EnrolRequest, Member, Period, Staff, AuditEntry } from '../lib/types'

export const ms = (v: unknown): number => {
  if (v instanceof Timestamp) return v.toMillis()
  if (typeof v === 'number') return v
  return 0
}

export function toMember(id: string, d: DocumentData): Member {
  return {
    id,
    number: d.number ?? 0,
    firstName: d.firstName ?? '',
    lastName: d.lastName ?? '',
    cellphone: d.cellphone ?? '',
    periods: ((d.periods ?? []) as Period[]).map((p) => ({ ...p })),
    fingerprint: d.fingerprint ? { finger: d.fingerprint.finger, enrolledAt: ms(d.fingerprint.enrolledAt) } : null,
    createdAt: ms(d.createdAt),
    deleted: !!d.deleted,
  }
}

export function toStaff(uid: string, d: DocumentData): Staff {
  return { uid, name: d.name ?? '', email: d.email ?? '', role: d.role, active: d.active !== false }
}

export function toDoorLog(id: string, d: DocumentData): DoorLog {
  return {
    id,
    deviceId: d.deviceId ?? '',
    memberId: d.memberId ?? null,
    memberName: d.memberName ?? null,
    memberNumber: d.memberNumber ?? null,
    result: d.result,
    reason: d.reason ?? null,
    text: d.text ?? '',
    paidUntil: d.paidUntil ?? null,
    at: ms(d.at),
    date: d.date,
    offline: !!d.offline,
  }
}

export function toDevice(id: string, d: DocumentData): Device {
  return {
    id,
    name: d.name ?? 'Turnstile 1',
    lastSeenAt: ms(d.lastSeenAt),
    mode: d.mode === 'hardware' ? 'hardware' : 'simulation',
    readerConnected: !!d.readerConnected,
    relayConnected: !!d.relayConnected,
    pendingLogs: d.pendingLogs ?? 0,
    appVersion: d.appVersion ?? '',
  }
}

export function toEnrol(id: string, d: DocumentData): EnrolRequest {
  return {
    id,
    memberId: d.memberId,
    memberName: d.memberName,
    memberNumber: d.memberNumber,
    status: d.status,
    step: d.step ?? 0,
    captureSeq: d.captureSeq ?? 0,
    message: d.message ?? '',
    requestedBy: d.requestedBy,
    createdAt: ms(d.createdAt),
  }
}

export function toAudit(id: string, d: DocumentData): AuditEntry {
  return {
    id,
    at: ms(d.at),
    actor: d.actor,
    action: d.action,
    entity: d.entity,
    entityId: d.entityId,
    summary: d.summary ?? '',
    before: d.before ?? null,
    after: d.after ?? null,
  }
}
