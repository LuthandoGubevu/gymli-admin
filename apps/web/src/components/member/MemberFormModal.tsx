import { Check, Phone, User } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { addMember, authMessage, checkMemberInput, updateMember, type MemberInput } from '../../data/actions'
import { useGym, useStaff } from '../../data/store'
import { formatCellphone, memberCode, type Member } from '../../lib/types'
import { Button, ErrorNote, TextField } from '../ui'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

interface Props {
  open: boolean
  onClose: () => void
  /** Edit this member; add a new one when empty */
  member?: Member | null
  onAdded?: (id: string) => void
}

/** Add member / Edit details. Not in the design: built from the Log payment modal style. */
export function MemberFormModal({ open, onClose, member, onAdded }: Props) {
  const staff = useStaff()
  const toast = useToast()
  const { members } = useGym()
  const [form, setForm] = useState<MemberInput>({ firstName: '', lastName: '', cellphone: '' })
  const [errors, setErrors] = useState<Partial<Record<keyof MemberInput, string>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(member ? { firstName: member.firstName, lastName: member.lastName, cellphone: formatCellphone(member.cellphone) } : { firstName: '', lastName: '', cellphone: '' })
    setErrors({})
    setError(null)
    setSaving(false)
  }, [open, member])

  const digits = form.cellphone.replace(/\D/g, '')
  const duplicate = digits.length >= 10 && members.data.find((m) => m.id !== member?.id && m.cellphone === digits)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const errs = checkMemberInput(form)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setSaving(true)
    setError(null)
    try {
      if (member) {
        await updateMember(staff, member.id, form)
        toast('Details saved')
        onClose()
      } else {
        const { id, number } = await addMember(staff, form)
        toast(`${form.firstName.trim()} added as ${memberCode(number)}`)
        onAdded?.(id)
      }
    } catch (err) {
      setError(authMessage(err))
      setSaving(false)
    }
  }

  const set = (k: keyof MemberInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    if (errors[k]) setErrors((x) => ({ ...x, [k]: undefined }))
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
      <form onSubmit={submit} noValidate className="flex flex-col gap-24">
        <div className="grid grid-cols-2 gap-12 max-md:grid-cols-1">
          <TextField label="First name" icon={User} value={form.firstName} onChange={set('firstName')} error={errors.firstName} autoComplete="off" data-autofocus />
          <TextField label="Surname" value={form.lastName} onChange={set('lastName')} error={errors.lastName} autoComplete="off" />
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
