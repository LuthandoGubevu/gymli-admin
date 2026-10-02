import { doc, onSnapshot } from 'firebase/firestore'
import { useEffect, useState } from 'react'
import { db } from '../lib/firebase'
import { EMPTY_DETAILS, type MemberDetails } from '../lib/types'

export function toDetails(d: Record<string, unknown> | undefined): MemberDetails | null {
  if (!d) return null
  return {
    email: (d.email as string) ?? '',
    dateOfBirth: (d.dateOfBirth as string) ?? '',
    idType: (d.idType as MemberDetails['idType']) ?? null,
    idLast3: (d.idLast3 as string) ?? '',
    emergencyName: (d.emergencyName as string) ?? '',
    emergencyPhone: (d.emergencyPhone as string) ?? '',
    notes: (d.notes as string) ?? '',
  }
}

/** Live personal details of one member (staff only). Null while loading or when none are on file. */
export function useMemberDetails(memberId: string | undefined): { details: MemberDetails | null; loading: boolean } {
  const [state, setState] = useState<{ details: MemberDetails | null; loading: boolean }>({ details: null, loading: true })
  useEffect(() => {
    if (!memberId) return
    return onSnapshot(
      doc(db, 'members', memberId, 'private', 'details'),
      (snap) => setState({ details: snap.exists() ? toDetails(snap.data()) : null, loading: false }),
      () => setState({ details: null, loading: false }),
    )
  }, [memberId])
  return state
}

export { EMPTY_DETAILS }
