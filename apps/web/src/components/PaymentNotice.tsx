import { useCallback, useEffect, useState } from 'react'
import { todayAtGym } from '../lib/dates'
import { useEmulator } from '../lib/firebase'
import { noticeText, PAYMENT_NOTICE, shouldShow } from '../lib/notice'
import { Button } from './ui'
import { Modal } from './ui/Modal'

const KEY = `gymli.notice.${PAYMENT_NOTICE.id}.seenAt`
const CHECK_MS = 60_000

function lastSeen(): number | null {
  try {
    const v = Number(localStorage.getItem(KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null // storage blocked: show on every load
  }
}

function markSeen() {
  try {
    localStorage.setItem(KEY, String(Date.now()))
  } catch {
    // storage blocked: nothing to remember
  }
}

/** True when the notice should run: on, not the emulator (tests), or forced with ?notice=preview. */
function enabled(): boolean {
  if (new URLSearchParams(window.location.search).get('notice') === 'preview') return true
  return PAYMENT_NOTICE.active && !useEmulator
}

/** Payment notice for every staff login, shown again every few hours after it is closed. */
export function PaymentNotice() {
  const due = () => enabled() && shouldShow(Date.now(), lastSeen(), PAYMENT_NOTICE.everyHours)
  const [open, setOpen] = useState(due)

  const check = useCallback(() => {
    if (enabled() && shouldShow(Date.now(), lastSeen(), PAYMENT_NOTICE.everyHours)) setOpen(true)
  }, [])

  useEffect(() => {
    if (!enabled()) return
    const timer = window.setInterval(check, CHECK_MS)
    window.addEventListener('focus', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [check])

  const close = () => {
    markSeen()
    setOpen(false)
  }

  const { label, text } = noticeText(todayAtGym())
  return (
    <Modal open={open} onClose={close} eyebrow="Account notice" title="Payment due" width="md">
      <div className="rounded-row bg-red-soft px-18 py-16">
        <div className="text-13 font-bold tracking-caps text-red-deep uppercase">{label}</div>
        <p className="m-0 mt-4 text-16 leading-140">{text}</p>
      </div>
      <div className="flex items-baseline justify-between gap-12 border-b border-line-8 pb-14">
        <span className="text-14 text-muted">Invoice {PAYMENT_NOTICE.invoice}</span>
        <strong className="text-36 font-extrabold tracking-tight stretch-66 tabular">{PAYMENT_NOTICE.amount}</strong>
      </div>
      <dl className="m-0 grid grid-cols-[130px_1fr] gap-x-12 gap-y-6 rounded-row bg-field px-18 py-16 text-14">
        {PAYMENT_NOTICE.bank.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="m-0 font-semibold tabular">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="m-0 text-14 text-ink-2">
        Send proof of payment to {PAYMENT_NOTICE.proofEmail}. Questions: <span className="whitespace-nowrap">{PAYMENT_NOTICE.contact}</span>.
      </p>
      <Button size="xl" onClick={close} className="w-full">
        I understand
      </Button>
    </Modal>
  )
}
