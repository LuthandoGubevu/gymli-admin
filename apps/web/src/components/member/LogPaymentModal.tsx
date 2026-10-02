import { CalendarDays, Check, Minus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { defaultStartDate, paidUntil, periodEnd, periodLength, type PeriodKind } from '../../lib/access'
import { formatFull, formatSmart, isValidDate, type LocalDate } from '../../lib/dates'
import { memberCode, memberName, PAYMENT_METHOD_LABEL, PAYMENT_METHODS, ROLE_LABEL, type Member, type PaymentMethod, type Period } from '../../lib/types'
import { ActionError, authMessage, deletePayment, editPayment, logPayment } from '../../data/actions'
import { useStaff, useToday } from '../../data/store'
import { Button, cx, ErrorNote, FieldLabel } from '../ui'
import { Modal } from '../ui/Modal'
import { useToast } from '../ui/Toast'

type Choice = 'day' | 'm1' | 'm3' | 'm6' | 'm12' | 'custom'

const CHOICES: { id: Choice; big: string; unit: string; kind: PeriodKind; qty: number }[] = [
  { id: 'day', big: '1', unit: 'Day pass', kind: 'day', qty: 1 },
  { id: 'm1', big: '1', unit: 'month', kind: 'months', qty: 1 },
  { id: 'm3', big: '3', unit: 'months', kind: 'months', qty: 3 },
  { id: 'm6', big: '6', unit: 'months', kind: 'months', qty: 6 },
  { id: 'm12', big: '12', unit: 'months', kind: 'months', qty: 12 },
]

function choiceFor(p: Period): Choice {
  if (p.kind === 'day') return 'day'
  if (p.kind === 'months' && [1, 3, 6, 12].includes(p.qty)) return `m${p.qty}` as Choice
  return 'custom'
}

interface Props {
  member: Member
  open: boolean
  onClose: () => void
  /** Manager: change an existing payment */
  editing?: Period | null
}

export function LogPaymentModal({ member, open, onClose, editing }: Props) {
  const staff = useStaff()
  const today = useToday()
  const toast = useToast()
  const name = memberName(member)

  const otherPeriods = useMemo(() => member.periods.filter((p) => p.id !== editing?.id), [member.periods, editing])
  const currentUntil = paidUntil(otherPeriods, today)
  const suggestedStart = defaultStartDate(otherPeriods, today)

  const [choice, setChoice] = useState<Choice>('m1')
  const [customKind, setCustomKind] = useState<'days' | 'months'>('days')
  const [customQty, setCustomQty] = useState(10)
  const [start, setStart] = useState<LocalDate>(suggestedStart)
  const [changingStart, setChangingStart] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const dateInput = useRef<HTMLInputElement>(null)

  // Reset every time the modal opens
  useEffect(() => {
    if (!open) return
    setError(null)
    setSaving(false)
    setConfirmDelete(false)
    setChangingStart(false)
    setMethod(editing?.method ?? null)
    if (editing) {
      const c = choiceFor(editing)
      setChoice(c)
      if (c === 'custom') {
        setCustomKind(editing.kind === 'months' ? 'months' : 'days')
        setCustomQty(editing.qty)
      }
      setStart(editing.start)
    } else {
      setChoice('m1')
      setStart(suggestedStart)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing?.id])

  useEffect(() => {
    if (changingStart) dateInput.current?.focus()
  }, [changingStart])

  const selected = choice === 'custom' ? { kind: customKind as PeriodKind, qty: customQty } : CHOICES.find((c) => c.id === choice)!
  const startOk = isValidDate(start)
  const end = startOk && selected.qty >= 1 ? periodEnd(selected.kind, selected.qty, start) : null
  const length = end ? periodLength(start, end) : 0

  const startHint = editing
    ? 'Start date of this payment'
    : start === suggestedStart
      ? currentUntil
        ? 'Day after current access ends'
        : 'Today'
      : start < today
        ? 'Starts in the past'
        : currentUntil && start > suggestedStart
          ? `Leaves a gap after ${formatSmart(currentUntil, today)}`
          : 'Changed by you'

  async function save() {
    if (!end) return
    if (!method) {
      setError('Choose how they paid')
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) {
        await editPayment(staff, member.id, editing.id, { kind: selected.kind, qty: selected.qty, start, method })
        toast('Payment changed')
      } else {
        await logPayment(staff, member.id, { kind: selected.kind, qty: selected.qty, start, method })
        const until = paidUntil([...member.periods, { start, end }], today)
        toast(until ? `Saved · ${member.firstName} can enter until ${formatSmart(until, today)}` : 'Payment saved')
      }
      onClose()
    } catch (e) {
      setError(e instanceof ActionError ? e.message : authMessage(e))
      setSaving(false)
    }
  }

  async function remove() {
    if (!editing) return
    setSaving(true)
    try {
      await deletePayment(staff, member.id, editing.id)
      toast('Payment deleted')
      onClose()
    } catch (e) {
      setError(authMessage(e))
      setSaving(false)
    }
  }

  const tile = (active: boolean) =>
    cx(
      'flex h-116 flex-col justify-between rounded-tile border-thick px-18 py-16 text-left transition-colors max-md:h-96 max-md:px-14',
      active ? 'border-ink bg-ink text-white' : 'border-line-10 bg-white text-ink hover:border-ink',
    )

  return (
    <Modal
      open={open}
      onClose={onClose}
      locked={saving}
      eyebrow={editing ? 'Change payment for' : 'Log payment for'}
      title={name}
      subtitle={`${memberCode(member.number)} · ${currentUntil ? `can enter until ${formatFull(currentUntil)}` : 'cannot enter now'}`}
    >
      <div>
        <div className="mb-10 text-13 font-medium text-muted">How long</div>
        <div role="radiogroup" aria-label="How long" className="grid grid-cols-3 gap-10 max-md:grid-cols-2">
          {CHOICES.map((c) => {
            const active = choice === c.id
            const until = startOk ? periodEnd(c.kind, c.qty, start) : null
            return (
              <button key={c.id} type="button" role="radio" aria-checked={active} onClick={() => setChoice(c.id)} className={tile(active)}>
                <span className="flex items-baseline gap-8">
                  <span className="text-48 leading-90 font-extrabold stretch-66 tabular">{c.big}</span>
                  <span className="text-16 font-semibold">{c.unit}</span>
                </span>
                <span className={cx('text-13 tabular', active ? 'text-on-ink-soft' : 'text-muted')}>{until ? `until ${formatSmart(until, today)}` : ' '}</span>
              </button>
            )
          })}
          <button type="button" role="radio" aria-checked={choice === 'custom'} onClick={() => setChoice('custom')} className={tile(choice === 'custom')}>
            <span className="flex items-baseline gap-8">
              <span className="text-48 leading-90 font-extrabold stretch-66 tabular">{choice === 'custom' ? customQty : '—'}</span>
              <span className="text-16 font-semibold">{choice === 'custom' ? (customKind === 'days' ? (customQty === 1 ? 'day' : 'days') : customQty === 1 ? 'month' : 'months') : 'Custom'}</span>
            </span>
            <span className={cx('text-13 tabular', choice === 'custom' ? 'text-on-ink-soft' : 'text-muted')}>
              {choice === 'custom' && end ? `until ${formatSmart(end, today)}` : 'days or months'}
            </span>
          </button>
        </div>

        {choice === 'custom' && (
          <div className="mt-12 flex flex-wrap items-center gap-10">
            <div role="radiogroup" aria-label="Days or months" className="flex gap-4 rounded-full bg-field p-5">
              {(['days', 'months'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={customKind === k}
                  onClick={() => setCustomKind(k)}
                  className={cx('rounded-full px-22 py-11 text-14', customKind === k ? 'bg-ink font-semibold text-white' : 'font-medium text-ink-2')}
                >
                  {k === 'days' ? 'Days' : 'Months'}
                </button>
              ))}
            </div>
            <div className="flex h-56 items-center gap-6 rounded-full bg-field p-6">
              <button type="button" aria-label="Fewer" onClick={() => setCustomQty((q) => Math.max(1, q - 1))} className="flex size-44 items-center justify-center rounded-full bg-white hover:bg-chip">
                <Minus size={18} />
              </button>
              <input
                aria-label={customKind === 'days' ? 'Number of days' : 'Number of months'}
                inputMode="numeric"
                value={customQty}
                onChange={(e) => {
                  const n = parseInt(e.target.value.replace(/\D/g, ''), 10)
                  setCustomQty(Number.isFinite(n) ? Math.min(n, customKind === 'days' ? 366 : 24) : 1)
                }}
                className="w-56 border-none bg-transparent text-center text-20 font-bold outline-none tabular"
              />
              <button type="button" aria-label="More" onClick={() => setCustomQty((q) => Math.min(customKind === 'days' ? 366 : 24, q + 1))} className="flex size-44 items-center justify-center rounded-full bg-white hover:bg-chip">
                <Plus size={18} />
              </button>
            </div>
          </div>
        )}
      </div>

      <div>
        <div className="mb-10 text-13 font-medium text-muted">Paid by</div>
        <div role="radiogroup" aria-label="Paid by" className="grid grid-cols-4 gap-10 max-md:grid-cols-2">
          {PAYMENT_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={method === m}
              onClick={() => {
                setMethod(m)
                if (error === 'Choose how they paid') setError(null)
              }}
              className={cx(
                'flex h-64 items-center rounded-tile border-thick px-18 text-left text-24 leading-none font-extrabold stretch-66 transition-colors',
                method === m ? 'border-ink bg-ink text-white' : 'border-line-10 bg-white text-ink hover:border-ink',
              )}
            >
              {PAYMENT_METHOD_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-12 max-md:grid-cols-1">
        <div>
          <FieldLabel htmlFor="start-date">Start date</FieldLabel>
          {changingStart ? (
            <div className="flex h-56 items-center gap-10 rounded-full bg-field px-20 text-17 font-semibold focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-ink">
              <CalendarDays size={18} aria-hidden />
              <input
                ref={dateInput}
                id="start-date"
                type="date"
                value={start}
                onChange={(e) => e.target.value && setStart(e.target.value)}
                onBlur={() => setChangingStart(false)}
                className="min-w-0 flex-1 border-none bg-transparent font-semibold outline-none tabular"
              />
            </div>
          ) : (
            <button
              type="button"
              id="start-date"
              onClick={() => setChangingStart(true)}
              className="flex h-56 w-full items-center gap-10 rounded-full bg-field px-20 text-left text-17 font-semibold tabular"
            >
              <CalendarDays size={18} aria-hidden />
              <span className="flex-1">{startOk ? formatFull(start) : 'Choose a date'}</span>
              <span className="text-13 font-semibold underline">Change</span>
            </button>
          )}
          <div className="mt-8 ml-20 text-12 text-muted">{startHint}</div>
        </div>
        <div>
          <FieldLabel>Logged by</FieldLabel>
          <div className="flex h-56 items-center gap-10 rounded-full bg-field pr-20 pl-8 text-17 font-semibold">
            <span className="flex size-40 items-center justify-center rounded-full bg-ink text-14 text-white">{staff.name.slice(0, 1).toUpperCase()}</span>
            <span className="min-w-0 flex-1 truncate">
              {staff.name.split(' ')[0]} · {ROLE_LABEL[staff.role]}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-end gap-20 rounded-card bg-green px-28 py-24 max-md:flex-col max-md:items-start max-md:gap-12 max-md:px-20">
        <div className="min-w-0 flex-1">
          <div className="text-13 font-bold tracking-caps uppercase">Access open</div>
          <div className="mt-10 text-48 leading-95 font-extrabold tracking-tight stretch-66 tabular max-md:text-32" data-testid="access-range">
            {end ? `${formatFull(start)} → ${formatFull(end)}` : '—'}
          </div>
        </div>
        <div className="flex items-baseline gap-6 border-l border-line-18 pl-20 max-md:border-l-0 max-md:pl-0">
          <span className="text-72 leading-82 font-extrabold stretch-66 tabular">{length}</span>
          <span className="text-16 font-bold">{length === 1 ? 'day' : 'days'}</span>
        </div>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-wrap justify-end gap-10">
        {editing && !confirmDelete && (
          <Button variant="ghost" size="xl" icon={Trash2} onClick={() => setConfirmDelete(true)} disabled={saving} className="mr-auto">
            Delete payment
          </Button>
        )}
        {editing && confirmDelete && (
          <Button variant="danger" size="xl" icon={Trash2} onClick={remove} loading={saving} className="mr-auto">
            Yes, delete it
          </Button>
        )}
        <Button variant="ghost" size="xl" onClick={onClose} disabled={saving} className="border-line-14 px-26">
          Cancel
        </Button>
        <Button size="xl" icon={Check} onClick={save} loading={saving} disabled={!end}>
          {editing ? 'Save change' : 'Save and update access'}
        </Button>
      </div>
    </Modal>
  )
}
