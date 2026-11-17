import { useState } from 'react'
import { logOut } from '../data/store'
import { lockText, PAYMENT_NOTICE } from '../lib/notice'
import { Button } from './ui'

/**
 * Full-screen "service paused" lock for gym staff while an invoice is unpaid (see isLocked in
 * lib/notice). It replaces the whole app, so the website cannot be used. "I understand" only
 * acknowledges it; access is not restored. ApexDev's own logins never reach this screen.
 */
export function SystemLock() {
  const [acknowledged, setAcknowledged] = useState(false)

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-24 max-md:bg-app-mobile max-md:p-16">
      <div className="flex w-full max-w-580 flex-col gap-24 rounded-frame bg-white p-36 shadow-modal max-md:p-24">
        <div>
          <div className="text-14 font-medium text-muted">Account notice</div>
          <h1 className="m-0 mt-6 text-52 leading-95 font-extrabold tracking-tighter stretch-66 max-md:text-40">Service paused</h1>
        </div>

        {acknowledged ? (
          <>
            <div className="rounded-row bg-red-soft px-18 py-16">
              <p className="m-0 text-16 leading-140">
                Account suspended. Please contact ApexDev to restore access.
              </p>
            </div>
            <button type="button" onClick={() => setAcknowledged(false)} className="text-left text-14 font-semibold text-ink-2 underline underline-offset-2 hover:text-ink">
              View invoice details
            </button>
          </>
        ) : (
          <>
            <div className="rounded-row bg-red-soft px-18 py-16">
              <div className="text-13 font-bold tracking-caps text-red-deep uppercase">Payment overdue</div>
              <p className="m-0 mt-4 text-16 leading-140">{lockText()}</p>
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
            <Button size="xl" onClick={() => setAcknowledged(true)} className="w-full">
              I understand
            </Button>
          </>
        )}

        <button type="button" onClick={() => logOut()} className="text-14 font-semibold text-muted underline underline-offset-2 hover:text-ink">
          Sign out
        </button>
      </div>
    </div>
  )
}
