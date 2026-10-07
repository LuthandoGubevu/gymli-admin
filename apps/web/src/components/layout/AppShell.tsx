import { Building2, Check, ChevronDown, House, LogOut, Plus, ScrollText, Search, Settings, Users, Wallet, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { logOut, useGym, useNow, useStaff } from '../../data/store'
import { isDeviceOnline, ROLE_LABEL } from '../../lib/types'
import { cx } from '../ui'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
}

const NAV: NavItem[] = [
  { to: '/', label: 'Today', icon: House, end: true },
  { to: '/members', label: 'Members', icon: Users },
  { to: '/door-log', label: 'Door log', icon: ScrollText },
]

/** Managers also get Accounts (money, reports, exports). */
function useNav(): NavItem[] {
  const staff = useStaff()
  return staff.role === 'manager' ? [...NAV, { to: '/accounts', label: 'Accounts', icon: Wallet }] : NAV
}

export function Logo({ size = 34 }: { size?: 34 | 44 }) {
  return (
    <span className={cx('font-extrabold leading-none tracking-tightest', size === 34 ? 'text-34 stretch-68' : 'text-44 stretch-66')}>
      gymli<span className="text-green-mark">.</span>
    </span>
  )
}

/** Design: GymRail — dark vertical rail on the left (desktop). */
function Rail() {
  const staff = useStaff()
  const nav = useNav()
  const railItem = (active: boolean) =>
    cx('flex size-48 items-center justify-center rounded-full transition-colors', active ? 'bg-white text-ink' : 'text-faint hover:text-white')
  return (
    <nav aria-label="Main" className="fixed top-28 left-24 z-30 flex w-76 flex-col items-center gap-10 rounded-rail bg-rail p-14 shadow-rail max-md:hidden">
      <Link to="/" aria-label="Gymli home" className="flex size-48 items-center justify-center rounded-full bg-green text-26 font-extrabold tracking-tighter text-ink stretch-68">
        G
      </Link>
      <div className="my-6 h-1 w-24 bg-rail-line" />
      {nav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} title={n.label} aria-label={n.label} className={({ isActive }) => railItem(isActive)}>
          <n.icon size={20} strokeWidth={2} />
        </NavLink>
      ))}
      <div className="h-72" />
      {staff.role === 'manager' && (
        <NavLink to="/settings" title="Settings" aria-label="Settings" className={({ isActive }) => railItem(isActive)}>
          <Settings size={20} strokeWidth={2} />
        </NavLink>
      )}
      <button type="button" onClick={() => logOut()} title="Sign out" aria-label="Sign out" className={railItem(false)}>
        <LogOut size={20} strokeWidth={2} />
      </button>
    </nav>
  )
}

export function TurnstileChip({ compact }: { compact?: boolean }) {
  const { devices } = useGym()
  const me = useStaff()
  const now = useNow()
  const device = devices.data[0]
  const online = isDeviceOnline(device, now)
  const label = devices.loading ? 'Checking turnstile' : !device ? 'No turnstile yet' : online ? 'Turnstile online' : 'Turnstile offline'
  const className = cx(
    'flex h-44 items-center gap-8 rounded-full border border-glass-edge bg-glass text-13 font-medium text-ink-2',
    compact ? 'px-14' : 'px-16',
  )
  const content = (
    <>
      <span className={cx('size-8 rounded-full', online ? 'bg-green-mark' : devices.loading ? 'bg-dot' : 'bg-red')} />
      <span className={cx(compact && 'max-md:sr-only')}>{label}</span>
    </>
  )
  // Managers can open the turnstile details in Settings
  return me.role === 'manager' ? (
    <Link to="/settings#turnstile" className={className} title={label}>
      {content}
    </Link>
  ) : (
    <span className={className} title={label}>
      {content}
    </span>
  )
}

/** Which branch the screens show. Managers switch; front desk sees their own branch only. */
export function BranchSwitcher() {
  const staff = useStaff()
  const { branches, branch, setBranch } = useGym()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  if (!branch) return null
  const chip = 'flex h-44 max-w-220 items-center gap-8 rounded-full border border-glass-edge bg-glass px-16 text-13 font-semibold text-ink'
  if (staff.role !== 'manager' || branches.data.length < 2)
    return (
      <div className={chip} title="Branch">
        <Building2 size={16} className="shrink-0" />
        <span className="truncate">{branch.name}</span>
      </div>
    )
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`Branch: ${branch.name}`} className={cx(chip, 'hover:bg-white')}>
        <Building2 size={16} className="shrink-0" />
        <span className="truncate">{branch.name}</span>
        <ChevronDown size={16} className="shrink-0 text-muted" />
      </button>
      {open && (
        <div className="absolute top-52 left-0 z-40 w-220 rounded-tile bg-white p-8 shadow-modal">
          <div className="px-12 py-8 text-13 text-muted">Show branch</div>
          {branches.data.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                setBranch(b.id)
                setOpen(false)
              }}
              className="flex h-44 w-full items-center gap-10 rounded-row px-12 text-left text-14 font-semibold hover:bg-field"
            >
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              {b.id === branch.id && <Check size={16} className="text-green-deep" />}
            </button>
          ))}
          <Link to="/settings" onClick={() => setOpen(false)} className="flex h-44 items-center gap-10 rounded-row px-12 text-14 font-medium text-muted hover:bg-field">
            <Plus size={16} /> Manage branches
          </Link>
        </div>
      )}
    </div>
  )
}

function UserMenu() {
  const staff = useStaff()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-44 items-center gap-10 rounded-full bg-white pr-16 pl-5 shadow-user max-md:pr-5"
      >
        <span className="flex size-34 items-center justify-center rounded-full bg-ink text-14 font-bold text-white">{staff.name.slice(0, 1).toUpperCase()}</span>
        <span className="text-14 font-semibold max-md:hidden">
          {staff.name.split(' ')[0]} <span className="font-normal text-muted">· {ROLE_LABEL[staff.role]}</span>
        </span>
        <ChevronDown size={16} className="text-muted max-md:hidden" />
      </button>
      {open && (
        <div className="absolute top-52 right-0 z-40 w-220 rounded-tile bg-white p-8 shadow-modal">
          <div className="px-12 py-8 text-13 text-muted">{staff.email}</div>
          {staff.role === 'manager' && (
            <>
              <Link to="/accounts" onClick={() => setOpen(false)} className="flex h-44 items-center gap-10 rounded-row px-12 text-14 font-semibold hover:bg-field">
                <Wallet size={16} /> Accounts
              </Link>
              <Link to="/settings" onClick={() => setOpen(false)} className="flex h-44 items-center gap-10 rounded-row px-12 text-14 font-semibold hover:bg-field">
                <Settings size={16} /> Settings
              </Link>
            </>
          )}
          <button type="button" onClick={() => logOut()} className="flex h-44 w-full items-center gap-10 rounded-row px-12 text-14 font-semibold hover:bg-field">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

/** Design: GymTopNav */
function TopNav() {
  const navigate = useNavigate()
  const nav = useNav()
  return (
    <div className="flex h-56 items-center gap-16 max-md:h-44 max-md:gap-8">
      <Link to="/" aria-label="Gymli home">
        <Logo />
      </Link>
      <nav aria-label="Sections" className="ml-16 flex gap-4 rounded-full border border-glass-edge bg-glass p-5 backdrop-blur-nav max-lg:hidden">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) =>
              cx('rounded-full px-22 py-11 text-14', isActive ? 'bg-ink font-semibold text-white' : 'font-medium text-ink-2 hover:bg-white')
            }
          >
            {n.label}
          </NavLink>
        ))}
      </nav>
      <BranchSwitcher />
      <div className="flex-1" />
      <TurnstileChip compact />
      <button
        type="button"
        aria-label="Search members"
        title="Search members"
        onClick={() => navigate('/members?search=1')}
        className="flex size-44 items-center justify-center rounded-full border border-glass-edge bg-glass hover:bg-white"
      >
        <Search size={18} />
      </button>
      <UserMenu />
    </div>
  )
}

/** Design 07: dark floating dock at the bottom (phone). */
function MobileDock() {
  const item = (active: boolean) =>
    cx('flex size-52 items-center justify-center rounded-full', active ? 'bg-white text-ink' : 'text-faint')
  return (
    <nav aria-label="Main" className="fixed bottom-20 left-1/2 z-30 flex -translate-x-1/2 gap-6 rounded-full bg-rail p-8 shadow-dock md:hidden">
      {NAV.slice(0, 3).map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} aria-label={n.label} className={({ isActive }) => item(isActive)}>
          <n.icon size={20} />
        </NavLink>
      ))}
      <Link to="/members/new" aria-label="Add member" className="flex size-52 items-center justify-center rounded-full bg-green text-ink">
        <Plus size={20} />
      </Link>
    </nav>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  // The member profile has its own phone header (design 07).
  const ownMobileHeader = /^\/members\/(?!new)[^/]+$/.test(pathname)
  return (
    <div className="min-h-screen bg-app max-md:bg-app-mobile">
      <Rail />
      <div className="mx-auto flex max-w-1440 flex-col gap-28 pt-28 pr-40 pb-48 pl-124 max-md:gap-14 max-md:px-16 max-md:pt-20 max-md:pb-112">
        <div className={cx(ownMobileHeader && 'max-md:hidden')}>
          <TopNav />
        </div>
        {children}
      </div>
      <MobileDock />
    </div>
  )
}
