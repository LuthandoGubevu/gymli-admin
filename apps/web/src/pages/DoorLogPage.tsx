import { collection, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { CalendarDays, ChevronLeft, ChevronRight, Download, ScrollText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, Card, cx, EmptyState, ErrorNote, IconButton, PageHeader, SkeletonRows } from '../components/ui'
import { toDoorLog } from '../data/convert'
import { useGym, useToday } from '../data/store'
import { addDays, formatWeekdayFull, timeAtGym, type LocalDate } from '../lib/dates'
import { db } from '../lib/firebase'
import { viewMember } from '../lib/present'
import { memberCode, type DoorLog } from '../lib/types'
import { ScanRow } from './TodayPage'

type ResultFilter = 'all' | 'allowed' | 'denied'

function useDayLogs(day: LocalDate) {
  const [state, setState] = useState<{ logs: DoorLog[]; loading: boolean; error: string | null }>({ logs: [], loading: true, error: null })
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }))
    return onSnapshot(
      query(collection(db, 'doorLogs'), where('date', '==', day), orderBy('at', 'desc'), limit(2000)),
      (snap) => setState({ logs: snap.docs.map((d) => toDoorLog(d.id, d.data())), loading: false, error: null }),
      () => setState({ logs: [], loading: false, error: 'Could not load the door log. Check the internet connection.' }),
    )
  }, [day])
  return state
}

export function DoorLogPage() {
  const today = useToday()
  const [params, setParams] = useSearchParams()
  const day = params.get('date') || today
  const result = (params.get('result') as ResultFilter) || 'all'
  const { logs, loading, error } = useDayLogs(day)
  const { members } = useGym()
  const views = useMemo(() => members.data.map((m) => viewMember(m, today)), [members.data, today])

  const shown = logs.filter((l) => result === 'all' || l.result === result)
  const allowed = logs.filter((l) => l.result === 'allowed').length
  const denied = logs.length - allowed

  const set = (k: string, v: string | null) => {
    if (v === null) params.delete(k)
    else params.set(k, v)
    setParams(params, { replace: true })
  }

  function exportCsv() {
    const rows = [['Time', 'Result', 'Member number', 'Name', 'Reason', 'While offline']]
    for (const l of shown) rows.push([timeAtGym(l.at), l.result === 'allowed' ? 'Let in' : 'Denied', l.memberNumber ? memberCode(l.memberNumber) : '', l.memberName ?? 'Unknown finger', l.result === 'denied' ? l.text : '', l.offline ? 'yes' : ''])
    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `gymli-door-log-${day}.csv`
    a.click()
  }

  const tabs: { id: ResultFilter; label: string; count: number; dot: string }[] = [
    { id: 'all', label: 'All scans', count: logs.length, dot: 'bg-dot' },
    { id: 'allowed', label: 'Let in', count: allowed, dot: 'bg-green' },
    { id: 'denied', label: 'Denied', count: denied, dot: 'bg-red' },
  ]

  return (
    <>
      <PageHeader
        eyebrow={day === today ? `Today · ${formatWeekdayFull(day)}` : formatWeekdayFull(day)}
        title="Door log"
        actions={
          <Button variant="glass" size="lg" icon={Download} onClick={exportCsv} disabled={shown.length === 0}>
            Download CSV
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-12 max-md:gap-8">
        <div className="flex h-52 items-center gap-6 rounded-full bg-white p-6 shadow-search">
          <IconButton icon={ChevronLeft} label="Day before" size={40} onClick={() => set('date', addDays(day, -1))} />
          <label className="flex items-center gap-8 px-8 text-15 font-semibold tabular">
            <CalendarDays size={18} aria-hidden />
            <span className="sr-only">Date</span>
            <input type="date" value={day} max={today} onChange={(e) => e.target.value && set('date', e.target.value === today ? null : e.target.value)} className="border-none bg-transparent font-semibold outline-none" />
          </label>
          <IconButton icon={ChevronRight} label="Day after" size={40} variant="ink" disabled={day >= today} onClick={() => set('date', addDays(day, 1) >= today ? null : addDays(day, 1))} />
        </div>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={result === t.id}
            onClick={() => set('result', t.id === 'all' ? null : t.id)}
            className={cx(
              'flex h-48 items-center gap-10 rounded-full border pr-8 pl-18 text-15 font-semibold',
              result === t.id ? 'border-ink bg-ink text-white' : 'border-glass-edge bg-glass hover:bg-white',
            )}
          >
            <span className={cx('size-9 rounded-full', t.dot)} />
            {t.label}
            <span className={cx('flex h-32 min-w-32 items-center justify-center rounded-full px-8 text-14 font-bold tabular', result === t.id ? 'bg-on-ink-chip' : 'bg-line-6')}>{t.count}</span>
          </button>
        ))}
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <Card className="p-28 max-md:p-18">
        {loading ? (
          <SkeletonRows rows={8} />
        ) : shown.length === 0 ? (
          <EmptyState icon={ScrollText} title={logs.length === 0 ? 'No scans on this day' : 'Nothing here'}>
            {logs.length === 0 ? 'Every scan at the turnstile is kept here, let in or denied.' : 'Try another filter.'}
          </EmptyState>
        ) : (
          shown.map((l) => <ScanRow key={l.id} log={l} views={views} />)
        )}
      </Card>
    </>
  )
}
