import { doc, onSnapshot } from 'firebase/firestore'
import { Check, Fingerprint, ScanLine, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { authMessage, cancelEnrolment, requestCapture, startEnrolment } from '../../data/actions'
import { toEnrol } from '../../data/convert'
import { useGym, useNow, useStaff } from '../../data/store'
import { db } from '../../lib/firebase'
import { isDeviceOnline, memberCode, memberName, type EnrolRequest, type Member } from '../../lib/types'
import { Button, cx, ErrorNote } from '../ui'
import { Modal } from '../ui/Modal'

const SCANS = 4

interface Props {
  member: Member
  open: boolean
  onClose: () => void
  onLogPayment?: () => void
}

/**
 * Design 06a/06b. The reader is plugged into the check-in PC, so this modal sends an
 * enrol request through Firestore; the check-in app does the scans and reports back.
 */
export function EnrolModal({ member, open, onClose, onLogPayment }: Props) {
  const staff = useStaff()
  const { devices } = useGym()
  const now = useNow(2_000)
  const online = devices.data.some((d) => isDeviceOnline(d, now))
  const [requestId, setRequestId] = useState<string | null>(null)
  const [req, setReq] = useState<EnrolRequest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) {
      setRequestId(null)
      setReq(null)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!requestId) return
    return onSnapshot(doc(db, 'enrolRequests', requestId), (s) => s.exists() && setReq(toEnrol(s.id, s.data())))
  }, [requestId])

  async function begin() {
    setBusy(true)
    setError(null)
    try {
      setRequestId(await startEnrolment(staff, member))
    } catch (e) {
      setError(authMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function capture() {
    if (!requestId) return begin()
    setBusy(true)
    try {
      await requestCapture(requestId)
    } catch (e) {
      setError(authMessage(e))
    } finally {
      setBusy(false)
    }
  }

  function close() {
    if (requestId && req && (req.status === 'pending' || req.status === 'scanning')) cancelEnrolment(requestId).catch(() => {})
    onClose()
  }

  const done = req?.status === 'done'
  const failed = req?.status === 'failed'
  const step = req?.step ?? 0
  const waitingForPc = !!req && req.status === 'pending'
  const progress = done ? 100 : (step / SCANS) * 100

  let headline = `Scan ${Math.min(step + 1, SCANS)} of ${SCANS}`
  let hint = step === 0 ? 'Place the finger flat on the scanner' : 'Lift, then place the same finger flat on the scanner'
  if (!online && !done) {
    headline = 'Check-in PC offline'
    hint = 'Enrolment needs the check-in PC switched on and online'
  } else if (waitingForPc) hint = 'Waiting for the check-in PC'
  else if (req?.message && req.status === 'scanning') hint = req.message
  if (failed) {
    headline = 'Try again'
    hint = req?.message || 'The scans did not match. Start again.'
  }
  if (done) {
    headline = 'Fingerprint enrolled'
    hint = `${member.firstName} can use the turnstile once a payment is logged`
  }

  return (
    <Modal open={open} onClose={close} width="md" title="Enrol fingerprint" subtitle={`${memberName(member)} · ${memberCode(member.number)}`}>
      <div className="flex flex-col items-center gap-24">
        {done ? (
          <div className="flex size-260 items-center justify-center rounded-full bg-green max-md:size-200">
            <Check size={120} strokeWidth={2} className="max-md:size-96" />
          </div>
        ) : (
          <div
            className="flex size-260 items-center justify-center rounded-full max-md:size-200"
            style={{ background: `conic-gradient(var(--color-green) ${progress}%, var(--color-chip) 0deg)` }}
            data-testid="enrol-ring"
          >
            <div className="flex size-232 items-center justify-center rounded-full bg-white max-md:size-176">
              {online ? <Fingerprint size={128} strokeWidth={1.6} className="max-md:size-96" /> : <WifiOff size={96} strokeWidth={1.6} />}
            </div>
          </div>
        )}
        <div className="text-center">
          <div className="text-56 leading-95 font-extrabold stretch-66 tabular max-md:text-44" data-testid="enrol-headline">
            {headline}
          </div>
          <div className="mt-10 text-16 text-ink-2">{hint}</div>
        </div>
        <div className="flex gap-12" aria-label={`${done ? SCANS : step} of ${SCANS} scans done`}>
          {Array.from({ length: SCANS }, (_, i) => (
            <span
              key={i}
              className={cx(
                'size-18 rounded-full border-3',
                done || i < step ? 'border-transparent bg-green' : i === step && !failed ? 'border-ink bg-white' : 'border-transparent bg-step',
              )}
            />
          ))}
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex gap-10 self-stretch">
          {done ? (
            <>
              {onLogPayment && (
                <Button variant="ghost" size="xl" className="border-line-14 px-26" onClick={onLogPayment}>
                  Log payment
                </Button>
              )}
              <Button size="xl" className="flex-1" onClick={onClose} data-autofocus>
                Done
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="xl" className="border-line-14 px-26" onClick={close}>
                Cancel
              </Button>
              <Button
                size="xl"
                className="flex-1"
                icon={ScanLine}
                loading={busy}
                disabled={!online || waitingForPc}
                onClick={failed ? begin : capture}
                data-autofocus
              >
                {failed ? 'Start again' : 'Capture scan'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
