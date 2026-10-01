import { Check, Fingerprint, Lock, LockOpen, MonitorSmartphone, Usb, WifiOff } from 'lucide-react'
import { Logo } from '../components/layout/AppShell'
import { Card, CardTitle, cx, EmptyState, PageHeader, Pill } from '../components/ui'
import { useGym, useNow } from '../data/store'
import { formatDayMonth, timeAtGym } from '../lib/dates'
import { initials, isDeviceOnline, type Device, type DoorLog } from '../lib/types'
import { ScanRow } from './TodayPage'
import { viewMember } from '../lib/present'
import { useToday } from '../data/store'

/**
 * Web view of the turnstile. The real check-in screen is the Gymli Check-in app on the
 * reception PC; this page mirrors what it last showed and whether it is online.
 */
export function CheckinPage() {
  const { devices, todayLogs, members } = useGym()
  const now = useNow(2_000)
  const today = useToday()
  const views = members.data.map((m) => viewMember(m, today))
  const device = devices.data[0]
  const online = isDeviceOnline(device, now)
  const last = todayLogs.data[0]
  const showLast = last && now - last.at < 4_000 * 3

  return (
    <>
      <PageHeader eyebrow={device ? device.name : 'Reception'} title="Check-in screen" />

      <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-16 max-lg:grid-cols-1">
        <KioskPreview device={device} online={online} last={showLast ? last : undefined} />
        <Card className="p-28 max-md:p-18">
          <CardTitle size={32}>Turnstile</CardTitle>
          {!device ? (
            <EmptyState icon={MonitorSmartphone} title="No check-in PC yet">
              Install Gymli Check-in on the reception PC and sign it in with a check-in login from Settings.
            </EmptyState>
          ) : (
            <div className="mt-16 flex flex-col">
              <StatusLine ok={online} label={online ? 'Online · synced' : 'Offline'} detail={online ? `Seen ${timeAtGym(device.lastSeenAt)}` : device.lastSeenAt ? `Last seen ${formatDayMonth(new Date(device.lastSeenAt).toISOString().slice(0, 10))} ${timeAtGym(device.lastSeenAt)}` : 'Never seen'} />
              <StatusLine ok={device.readerConnected} label={device.readerConnected ? 'Fingerprint reader connected' : 'Fingerprint reader not found'} detail={device.mode === 'simulation' ? 'Simulation mode' : 'DigitalPersona 4500'} />
              <StatusLine ok={device.relayConnected} label={device.relayConnected ? 'Turnstile relay connected' : 'Turnstile relay not found'} detail={device.mode === 'simulation' ? 'Pulses shown on screen' : 'USB relay'} />
              <StatusLine ok={device.pendingLogs === 0} label={device.pendingLogs === 0 ? 'Door log up to date' : `${device.pendingLogs} scans waiting to upload`} detail={device.appVersion ? `App ${device.appVersion}` : ''} />
            </div>
          )}
        </Card>
      </div>

      <Card className="p-28 max-md:p-18">
        <div className="mb-10 flex items-center gap-14">
          <CardTitle>Latest scans</CardTitle>
        </div>
        {todayLogs.data.length === 0 ? (
          <EmptyState title="No scans yet today">Scans at the turnstile show here as they happen.</EmptyState>
        ) : (
          todayLogs.data.slice(0, 8).map((l) => <ScanRow key={l.id} log={l} views={views} />)
        )}
      </Card>
    </>
  )
}

function StatusLine({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-14 border-t border-line-6 py-14 first:border-t-0">
      <span className={cx('flex size-42 items-center justify-center rounded-full', ok ? 'bg-green-soft text-green-deep' : 'bg-red-soft text-red-deep')}>
        {ok ? <Check size={18} strokeWidth={2.5} /> : label.includes('relay') ? <Usb size={18} /> : <WifiOff size={18} />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-16 font-semibold">{label}</div>
        {detail && <div className="mt-2 text-13 text-muted">{detail}</div>}
      </div>
    </div>
  )
}

/** Small copy of the kiosk screen (designs 05a–c). */
function KioskPreview({ device, online, last }: { device?: Device; online: boolean; last?: DoorLog }) {
  const allowed = last?.result === 'allowed'
  const bg = !last ? 'bg-kiosk-idle' : allowed ? 'bg-green' : 'bg-red'
  return (
    <div className={cx('flex min-h-420 flex-col overflow-hidden rounded-frame p-28 shadow-card', bg)} data-testid="kiosk-preview">
      <div className="flex items-center justify-between gap-12">
        <div className="flex items-baseline gap-12">
          <Logo size={34} />
          <span className="text-13 font-medium text-muted max-md:hidden">Reception · {device?.name ?? 'Turnstile 1'}</span>
        </div>
        <Pill tone={online ? 'glass' : 'yellow'}>{online ? 'Online · synced' : 'Offline · using saved list'}</Pill>
      </div>
      <div className="flex flex-1 flex-col justify-center">
        {!last ? (
          <div className="flex flex-col items-center gap-20 text-center">
            <span className="flex size-140 items-center justify-center rounded-full border border-white bg-glass-orb shadow-orb">
              <Fingerprint size={72} strokeWidth={1.6} />
            </span>
            <div className="text-44 leading-90 font-extrabold tracking-tighter stretch-64 max-md:text-32">Place your finger on the scanner</div>
          </div>
        ) : (
          <div>
            <div className="text-96 leading-80 font-black tracking-tightest stretch-62 max-md:text-72">{allowed ? 'WELCOME' : 'DENIED'}</div>
            <div className="mt-20 flex items-center gap-14">
              <span className={cx('flex size-56 shrink-0 items-center justify-center rounded-full bg-ink text-20 font-extrabold stretch-70', allowed ? 'text-green' : 'text-red')}>
                {last.memberName ? initials(last.memberName) : '?'}
              </span>
              <div className="min-w-0">
                <div className="truncate text-32 leading-95 font-extrabold stretch-68">{allowed ? last.memberName : last.text}</div>
                <div className="mt-6 inline-flex h-32 items-center rounded-full bg-ink px-14 text-14 font-semibold text-white">
                  {allowed ? `Paid until ${last.paidUntil ? formatDayMonth(last.paidUntil) : ''}` : last.memberName ? `${last.memberName} · Please see reception` : 'Please see reception'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center gap-10 text-16 font-bold">
        <span className="flex size-40 items-center justify-center rounded-full bg-ink text-white">
          {allowed ? <LockOpen size={18} className="text-green" /> : <Lock size={18} className={last ? 'text-red' : 'text-white'} />}
        </span>
        {allowed ? 'Arm unlocked' : 'Arm locked'}
      </div>
    </div>
  )
}
