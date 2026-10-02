import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { authMessage, readIdentity } from '../../data/actions'
import { useMemberDetails } from '../../data/details'
import { useStaff } from '../../data/store'
import { formatFull, isValidDate } from '../../lib/dates'
import { formatSaId, ID_TYPE_LABEL, maskId } from '../../lib/idNumber'
import { formatCellphone, type Member } from '../../lib/types'
import { Button, Card, CardTitle, Pill, SkeletonRows } from '../ui'

/** Personal details on the profile. Full ID number: managers only, on request. */
export function MemberDetailsCard({ member, onEdit }: { member: Member; onEdit: () => void }) {
  const staff = useStaff()
  const { details, loading } = useMemberDetails(member.id)
  const [fullId, setFullId] = useState<string | null>(null)
  const [idError, setIdError] = useState<string | null>(null)
  const isManager = staff.role === 'manager'

  // Hide the full number again when the member or their ID changes
  useEffect(() => {
    setFullId(null)
    setIdError(null)
  }, [member.id, details?.idLast3])

  async function show() {
    try {
      const id = await readIdentity(member.id)
      setFullId(id ? (id.idType === 'sa' ? formatSaId(id.idNumber) : id.idNumber) : null)
    } catch (e) {
      setIdError(authMessage(e))
    }
  }

  const row = (label: string, value: React.ReactNode, extra?: React.ReactNode) => (
    <div className="flex items-center gap-12 border-t border-line-6 py-12">
      <div className="w-120 shrink-0 text-13 text-muted">{label}</div>
      <div className="min-w-0 flex-1 text-15 font-semibold tabular break-words">{value}</div>
      {extra}
    </div>
  )
  const none = <span className="font-normal text-muted">—</span>

  return (
    <Card className="px-24 pt-20 pb-8 max-md:px-18">
      <div className="mb-6 flex items-center justify-between">
        <CardTitle size={26}>Details</CardTitle>
        <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit} className="px-16">
          Edit
        </Button>
      </div>
      {loading ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          {row(
            details?.idType ? ID_TYPE_LABEL[details.idType] : 'ID number',
            details?.idType ? (fullId ?? maskId(details.idType, details.idLast3)) : <Pill tone="red" size="sm">ID number missing</Pill>,
            details?.idType && isManager && !fullId ? (
              <button type="button" onClick={show} className="rounded-full bg-chip px-12 py-6 text-12 font-bold hover:bg-field">
                Show
              </button>
            ) : !details?.idType ? (
              <button type="button" onClick={onEdit} className="text-13 font-semibold underline">
                Add
              </button>
            ) : undefined,
          )}
          {idError && <div className="pb-8 text-13 font-semibold text-red-deep">{idError}</div>}
          {row('Date of birth', details?.dateOfBirth && isValidDate(details.dateOfBirth) ? formatFull(details.dateOfBirth) : none)}
          {row('Email', details?.email ? <a href={`mailto:${details.email}`} className="underline">{details.email}</a> : none)}
          {row(
            'Emergency contact',
            details?.emergencyName ? (
              <>
                {details.emergencyName}
                {details.emergencyPhone && (
                  <a href={`tel:${details.emergencyPhone}`} className="ml-8 font-normal text-ink-2 underline">
                    {formatCellphone(details.emergencyPhone)}
                  </a>
                )}
              </>
            ) : (
              none
            ),
          )}
          {row('Notes', details?.notes ? <span className="font-normal whitespace-pre-line">{details.notes}</span> : none)}
        </>
      )}
    </Card>
  )
}
