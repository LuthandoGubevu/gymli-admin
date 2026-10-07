/**
 * Live data for the staff app. One listener per collection for the whole session,
 * so moving between screens costs no extra reads.
 */
import { onAuthStateChanged, signOut, type User } from 'firebase/auth'
import { collection, doc, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { auth, db } from '../lib/firebase'
import { todayAtGym, type LocalDate } from '../lib/dates'
import type { Branch, Device, DoorLog, Member, Staff } from '../lib/types'
import { pickBranch } from '../lib/branch'
import { toBranch, toDevice, toDoorLog, toMember, toStaff } from './convert'

/* ---------------- Clock ---------------- */

const FIXED_TODAY = import.meta.env.VITE_FIXED_TODAY

/** Today at the gym; updates itself after midnight. */
export function useToday(): LocalDate {
  const [today, setToday] = useState(() => FIXED_TODAY || todayAtGym())
  useEffect(() => {
    if (FIXED_TODAY) return
    const t = setInterval(() => setToday(todayAtGym()), 30_000)
    return () => clearInterval(t)
  }, [])
  return today
}

/** Current time in ms; ticks every few seconds (for "online" indicators). */
export function useNow(intervalMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

/* ---------------- Auth ---------------- */

interface AuthState {
  loading: boolean
  user: User | null
  staff: Staff | null
  /** Signed in, but not set up as staff (or switched off) */
  noAccess: boolean
}

const AuthContext = createContext<AuthState>({ loading: true, user: null, staff: null, noAccess: false })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ loading: true, user: null, staff: null, noAccess: false })

  useEffect(() => {
    let unsubStaff: (() => void) | undefined
    const unsub = onAuthStateChanged(auth, (user) => {
      unsubStaff?.()
      if (!user) {
        setState({ loading: false, user: null, staff: null, noAccess: false })
        return
      }
      setState((s) => ({ ...s, loading: true, user }))
      unsubStaff = onSnapshot(
        doc(db, 'staff', user.uid),
        (snap) => {
          const staff = snap.exists() ? toStaff(snap.id, snap.data()) : null
          const ok = !!staff && staff.active && staff.role !== 'device'
          setState({ loading: false, user, staff: ok ? staff : null, noAccess: !ok })
        },
        () => setState({ loading: false, user, staff: null, noAccess: true }),
      )
    })
    return () => {
      unsub()
      unsubStaff?.()
    }
  }, [])

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
export const useStaff = (): Staff => {
  const s = useContext(AuthContext).staff
  if (!s) throw new Error('useStaff outside a signed-in screen')
  return s
}
export const logOut = () => signOut(auth)

/* ---------------- Gym data ---------------- */

export interface Loadable<T> {
  data: T
  loading: boolean
  error: string | null
}

interface GymData {
  /** All branches (managers switch between them; front desk sees only theirs). */
  branches: Loadable<Branch[]>
  /** The branch everything below is for; null until branches are set up. */
  branch: Branch | null
  setBranch: (id: string) => void
  members: Loadable<Member[]>
  todayLogs: Loadable<DoorLog[]>
  devices: Loadable<Device[]>
  staffList: Loadable<Staff[]>
}

const empty = <T,>(data: T): Loadable<T> => ({ data, loading: true, error: null })
const GymContext = createContext<GymData | null>(null)

const LOAD_ERROR = 'Could not load. Check the internet connection.'

const BRANCH_KEY = 'gymli.branch'

function readChoice(): string | null {
  try {
    return localStorage.getItem(BRANCH_KEY)
  } catch {
    return null
  }
}

export function GymDataProvider({ children }: { children: ReactNode }) {
  const today = useToday()
  const staff = useStaff()
  const isManager = staff.role === 'manager'
  const [branches, setBranches] = useState(empty<Branch[]>([]))
  const [chosen, setChosen] = useState<string | null>(readChoice)
  const [members, setMembers] = useState(empty<Member[]>([]))
  const [todayLogs, setTodayLogs] = useState(empty<DoorLog[]>([]))
  const [devices, setDevices] = useState(empty<Device[]>([]))
  const [staffList, setStaffList] = useState(empty<Staff[]>([]))

  useEffect(
    () =>
      onSnapshot(
        collection(db, 'branches'),
        (snap) => {
          const list = snap.docs.map((d) => toBranch(d.id, d.data()))
          list.sort((a, b) => a.name.localeCompare(b.name))
          setBranches({ data: list, loading: false, error: null })
        },
        () => setBranches((s) => ({ ...s, loading: false, error: LOAD_ERROR })),
      ),
    [],
  )

  const branch = useMemo(() => pickBranch(staff, branches.data, chosen), [staff, branches.data, chosen])
  const branchId = branch?.id ?? null
  const setBranch = useMemo(
    () => (id: string) => {
      setChosen(id)
      try {
        localStorage.setItem(BRANCH_KEY, id)
      } catch {
        /* remembering the choice is a convenience only */
      }
    },
    [],
  )

  useEffect(() => {
    if (!branchId) {
      setMembers({ data: [], loading: false, error: null })
      return
    }
    setMembers(empty<Member[]>([]))
    return onSnapshot(
      query(collection(db, 'members'), where('branchId', '==', branchId), where('deleted', '==', false)),
      (snap) => {
        const list = snap.docs.map((d) => toMember(d.id, d.data()))
        list.sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName))
        setMembers({ data: list, loading: false, error: null })
      },
      () => setMembers((s) => ({ ...s, loading: false, error: LOAD_ERROR })),
    )
  }, [branchId])

  useEffect(() => {
    if (!branchId) {
      setTodayLogs({ data: [], loading: false, error: null })
      return
    }
    setTodayLogs(empty<DoorLog[]>([]))
    return onSnapshot(
      query(collection(db, 'doorLogs'), where('branchId', '==', branchId), where('date', '==', today), orderBy('at', 'desc'), limit(500)),
      (snap) => setTodayLogs({ data: snap.docs.map((d) => toDoorLog(d.id, d.data())), loading: false, error: null }),
      () => setTodayLogs((s) => ({ ...s, loading: false, error: LOAD_ERROR })),
    )
  }, [today, branchId])

  useEffect(() => {
    if (!branchId) {
      setDevices({ data: [], loading: false, error: null })
      return
    }
    setDevices(empty<Device[]>([]))
    return onSnapshot(
      query(collection(db, 'devices'), where('branchId', '==', branchId)),
      (snap) => setDevices({ data: snap.docs.map((d) => toDevice(d.id, d.data())), loading: false, error: null }),
      () => setDevices((s) => ({ ...s, loading: false, error: LOAD_ERROR })),
    )
  }, [branchId])

  // Only managers see the list of logins (Settings)
  useEffect(() => {
    if (!isManager) {
      setStaffList({ data: [], loading: false, error: null })
      return
    }
    return onSnapshot(
      collection(db, 'staff'),
      (snap) => {
        const list = snap.docs.map((d) => toStaff(d.id, d.data()))
        list.sort((a, b) => a.name.localeCompare(b.name))
        setStaffList({ data: list, loading: false, error: null })
      },
      () => setStaffList((s) => ({ ...s, loading: false, error: LOAD_ERROR })),
    )
  }, [isManager])

  const value = useMemo(
    () => ({ branches, branch, setBranch, members, todayLogs, devices, staffList }),
    [branches, branch, setBranch, members, todayLogs, devices, staffList],
  )
  return <GymContext.Provider value={value}>{children}</GymContext.Provider>
}

export function useGym(): GymData {
  const v = useContext(GymContext)
  if (!v) throw new Error('useGym outside GymDataProvider')
  return v
}

export function useMember(id: string | undefined): { member: Member | null; loading: boolean } {
  const { members } = useGym()
  return { member: members.data.find((m) => m.id === id) ?? null, loading: members.loading }
}
