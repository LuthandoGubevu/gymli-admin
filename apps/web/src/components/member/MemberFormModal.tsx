import { CalendarDays, Check, IdCard, Mail, Phone, User } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { addMember, authMessage, checkMemberInput, EMPTY_MEMBER_INPUT, updateMember, type MemberErrors, type MemberInput } from '../../data/actions'
import { useMemberDetails } from '../../data/details'
import { useGym, useStaff, useToday } from '../../data/store'
import { formatFull, isValidDate } from '../../lib/dates'
import { checkId, ID_TYPE_LABEL, maskId, type IdType } from '../../lib/idNumber'
import { formatCellphone, memberCode, type Member } from '../../lib/types'
import { Button, cx, ErrorNote, FieldError, FieldLabel, TextField } from '../ui'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

interface Props {
  open: boolean
  onClose: () => void
  /** Edit this member; add a new one when empty */
  member?: Member | null
  onAdded?: (id: string) => void
}

/** Add member / Edit details (docs/mockup-member-fields.png). Built from the Log payment modal style. */
export function MemberFormModal({ open, onClose, member, onAdded }: Props) {
  const staff = useStaff()
  const today = useToday()
  const toast = useToast()
  const { members, branch } = useGym()
  const { details, loading: detailsLoading } = useMemberDetails(member?.id)
  const [form, setForm] = useState<MemberInput>(EMPTY_MEMBER_INPUT)
  const [errors, setErrors] = useState<MemberErrors>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changingId, setChangingId] = useState(false)

  const isManager = staff.role === 'manager'
  const hasIdOnFile = !!details?.idType
  // The ID field is open for a new member, a member with no ID yet, or a manager who chose to change it.
  const idEditable = !member || !hasIdOnFile || changingId

  useEffect(() => {
    if (!open) return
    setErrors({})
    setError(null)
    setSaving(false)
    setChangingId(false)
    if (!member) {
      setForm(EMPTY_MEMBER_INPUT)
      return
    }
    setForm({
      ...EMPTY_MEMBER_INPUT,
      firstName: member.firstName,
      lastName: member.lastName,
      cellphone: formatCellphone(member.cellphone),
      email: details?.email ?? '',
      idType: details?.idType ?? 'sa',
      dateOfBirth: details?.dateOfBirth ?? '',
      emergencyName: details?.emergencyName ?? '',
      emergencyPhone: details?.emergencyPhone ? formatCellphone(details.emergencyPhone) : '',
      notes: details?.notes ?? '',
    })
    // details arrive a moment after opening; refill once they do
  }, [open, member, details, detailsLoading])

  const digits = form.cellphone.replace(/\D/g, '')
  const duplicate = digits.length >= 10 && members.data.find((m) => m.id !== member?.id && m.cellphone === digits)
  const idCheck = idEditable && form.idNumber.trim() ? checkId(form.idType, form.idNumber, today) : null
  const autoDob = form.idType === 'sa' ? (idCheck?.ok ? idCheck.dateOfBirth : idEditable ? undefined : details?.dateOfBirth) : undefined

  async function submit(e: FormEvent) {
    e.preventDefault()
    const input = idEditable ? form : { ...form, idNumber: '' }
    const errs = checkMemberInput(input, today, idEditable)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    setError(null)
    try {
      if (member) {
        await updateMember(staff, member.id, input, today, details)
        toast('Details saved')
        onClose()
      } else {
        if (!branch) throw new Error('No branch chosen')
        const { id, number } = await addMember(staff, input, today, branch.id)
        toast(`${form.firstName.trim()} added as ${memberCode(number)}`)
        onAdded?.(id)
      }
    } catch (err) {
      setError(authMessage(err))
      setSaving(false)
    }
  }

  const set = (k: keyof MemberInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }))
  }
  const setIdType = (t: IdType) => {
    setForm((f) => ({ ...f, idType: t, dateOfBirth: t === 'sa' ? '' : f.dateOfBirth }))
    setErrors((x) => ({ ...x, idNumber: undefined, dateOfBirth: undefined }))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      eyebrow={member ? `Edit details · ${memberCode(member.number)}` : 'New member'}
      title={member ? 'Edit details' : 'Add member'}
      subtitle={member ? undefined : 'They get the next GY-number. Enrol a fingerprint and log a payment next.'}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-22">
        <div className="grid grid-cols-2 gap-x-12 gap-y-14 max-md:grid-cols-1">
          <TextField label="First name" icon={User} value={form.firstName} onChange={set('firstName')} error={errors.firstName} autoComplete="off" data-autofocus />
          <TextField label="Surname" value={form.lastName} onChange={set('lastName')} error={errors.lastName} autoComplete="off" />

          {/* ID number with SA ID / Passport switch */}
          <div>
            <div className="mb-8 flex items-center gap-8">
              <label htmlFor="f-id-number" className="text-13 font-medium text-muted">
                ID number
              </label>
              {idEditable && (
                <div role="radiogroup" aria-label="ID type" className="flex gap-4 rounded-full bg-field p-4">
                  {(['sa', 'passport'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      role="radio"
                      aria-checked={form.idType === t}
                      onClick={() => setIdType(t)}
                      className={cx('rounded-full px-12 py-4 text-12 font-semibold', form.idType === t ? 'bg-ink text-white' : 'text-ink-2')}
                    >
                      {ID_TYPE_LABEL[t]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {idEditable ? (
              <div
                className={cx(
                  'flex h-56 items-center gap-10 rounded-full bg-field px-20 text-17 font-semibold focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-ink',
                  errors.idNumber && 'outline-2 outline-red',
                )}
              >
                <IdCard size={18} aria-hidden />
                <input
                  id="f-id-number"
                  inputMode={form.idType === 'sa' ? 'numeric' : 'text'}
                  placeholder={form.idType === 'sa' ? '13 digits' : 'Passport number'}
                  value={form.idNumber}
                  onChange={set('idNumber')}
                  autoComplete="off"
                  aria-invalid={!!errors.idNumber}
                  className="min-w-0 flex-1 border-none bg-transparent font-semibold outline-none tabular placeholder:font-normal placeholder:text-muted"
                />
              </div>
            ) : (
              <div className="flex h-56 items-center gap-10 rounded-full bg-field px-20 text-17 font-semibold tabular">
                <IdCard size={18} aria-hidden />
                <span className="flex-1">{maskId(details!.idType!, details!.idLast3)}</span>
                {isManager && (
                  <button type="button" onClick={() => setChangingId(true)} className="text-13 font-semibold underline">
                    Change
                  </button>
                )}
              </div>
            )}
            {errors.idNumber ? (
              <FieldError>{errors.idNumber}</FieldError>
            ) : idCheck?.ok ? (
              <div className="mt-8 ml-20 text-12 font-semibold text-green-deep">✓ Valid {form.idType === 'sa' ? 'ID' : 'passport number'}</div>
            ) : !idEditable ? (
              <div className="mt-8 ml-20 text-12 text-muted">{isManager ? `${ID_TYPE_LABEL[details!.idType!]} on file` : 'Only a manager can change the ID number'}</div>
            ) : member && !hasIdOnFile ? (
              <div className="mt-8 ml-20 text-12 font-semibold text-red-deep">ID number missing</div>
            ) : null}
          </div>

          {/* Date of birth: automatic for SA IDs, typed for passports */}
          <div>
            <FieldLabel htmlFor="f-dob">Date of birth</FieldLabel>
            {form.idType === 'passport' && idEditable ? (
              <div className={cx('flex h-56 items-center gap-10 rounded-full bg-field px-20 text-17 font-semibold', errors.dateOfBirth && 'outline-2 outline-red')}>
                <CalendarDays size={18} aria-hidden />
                <input id="f-dob" type="date" max={today} value={form.dateOfBirth} onChange={set('dateOfBirth')} className="min-w-0 flex-1 border-none bg-transparent font-semibold outline-none tabular" />
              </div>
            ) : (
              <div className={cx('flex h-56 items-center gap-10 rounded-full px-20 text-17 font-semibold tabular', autoDob || isValidDate(form.dateOfBirth) ? 'bg-green-soft text-green-deep' : 'bg-field text-muted')}>
                <CalendarDays size={18} aria-hidden />
                {autoDob ? formatFull(autoDob) : isValidDate(form.dateOfBirth) ? formatFull(form.dateOfBirth) : <span className="font-normal">From the ID number</span>}
              </div>
            )}
            {errors.dateOfBirth ? <FieldError>{errors.dateOfBirth}</FieldError> : form.idType === 'sa' && <div className="mt-8 ml-20 text-12 text-muted">Filled in from the ID number</div>}
          </div>

          <TextField
            label="Cellphone"
            icon={Phone}
            inputMode="tel"
            placeholder="082 123 4567"
            value={form.cellphone}
            onChange={set('cellphone')}
            error={errors.cellphone}
            hint={duplicate ? `Same number as ${duplicate.firstName} ${duplicate.lastName} (${memberCode(duplicate.number)})` : undefined}
            autoComplete="off"
          />
          <TextField label="Email · optional" icon={Mail} type="email" placeholder="name@example.com" value={form.email} onChange={set('email')} error={errors.email} autoComplete="off" />
        </div>

        <div className="border-t border-line-6 pt-18">
          <h3 className="m-0 mb-14 text-24 font-extrabold stretch-70">Emergency contact</h3>
          <div className="grid grid-cols-2 gap-12 max-md:grid-cols-1">
            <TextField label="Name" value={form.emergencyName} onChange={set('emergencyName')} error={errors.emergencyName} autoComplete="off" />
            <TextField label="Cellphone" icon={Phone} inputMode="tel" value={form.emergencyPhone} onChange={set('emergencyPhone')} error={errors.emergencyPhone} autoComplete="off" />
          </div>
        </div>

        <div>
          <FieldLabel htmlFor="f-notes">Notes · optional, staff only</FieldLabel>
          <textarea
            id="f-notes"
            rows={3}
            value={form.notes}
            onChange={set('notes')}
            placeholder="For example: student, pays on the 25th"
            className="w-full resize-none rounded-tile border-none bg-field px-20 py-16 text-15 outline-none placeholder:text-muted focus:outline-3 focus:outline-offset-3 focus:outline-ink"
          />
          <FieldError>{errors.notes}</FieldError>
        </div>

        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-10">
          <Button type="button" variant="ghost" size="xl" className="border-line-14 px-26" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="xl" icon={Check} loading={saving}>
            {member ? 'Save details' : 'Add member'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
