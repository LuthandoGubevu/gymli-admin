/**
 * Gymli component library. Every visual value comes from styles/tokens.css.
 * Built from design/gymli-design.html — see docs/design-deviations.md for anything added.
 */
import { Loader2, type LucideIcon } from 'lucide-react'
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/* ---------------- Buttons ---------------- */

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'glass' | 'green' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl'

const buttonVariant: Record<ButtonVariant, string> = {
  // black pill: "Log payment", "Add member"
  primary: 'bg-ink text-white border border-ink hover:bg-ink-2 disabled:bg-ink-past disabled:border-transparent',
  // 1.5px ink outline: "Log payment" on white cards and table rows
  outline: 'border-thick border-ink text-ink hover:bg-ink hover:text-white',
  // thin line: "Cancel", "Re-enrol", "View in Members"
  ghost: 'border border-line-12 text-ink hover:bg-line-6',
  // frosted: "Open check-in screen"
  glass: 'bg-glass border border-glass-edge text-ink backdrop-blur-nav hover:bg-white',
  green: 'bg-green text-ink border border-green hover:brightness-95',
  danger: 'bg-red text-ink border border-red hover:brightness-95',
}

const buttonSize: Record<ButtonSize, string> = {
  sm: 'h-40 px-18 text-14 gap-8',
  md: 'h-44 px-18 text-14 gap-8',
  lg: 'h-52 px-24 text-15 gap-8',
  xl: 'h-56 px-28 text-16 gap-10',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: LucideIcon
  iconRight?: LucideIcon
  loading?: boolean
  to?: string
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', icon: Icon, iconRight: IconRight, loading, className, children, to, disabled, ...rest },
  ref,
) {
  const cls = cx(
    'inline-flex shrink-0 items-center justify-center rounded-full font-semibold whitespace-nowrap transition-colors select-none',
    buttonVariant[variant],
    buttonSize[size],
    className,
  )
  const iconSize = size === 'sm' || size === 'md' ? 16 : 18
  const content = (
    <>
      {loading ? <Loader2 size={iconSize} className="animate-spin" /> : Icon && <Icon size={iconSize} strokeWidth={2} />}
      {children}
      {IconRight && <IconRight size={16} strokeWidth={2} />}
    </>
  )
  if (to) {
    return (
      <Link to={to} className={cls}>
        {content}
      </Link>
    )
  }
  return (
    <button ref={ref} className={cls} disabled={disabled || loading} {...rest}>
      {content}
    </button>
  )
})

type IconButtonSize = 34 | 40 | 44 | 48 | 52 | 56
const iconButtonSize: Record<IconButtonSize, string> = {
  34: 'size-34',
  40: 'size-40',
  44: 'size-44',
  48: 'size-48',
  52: 'size-52',
  56: 'size-56',
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon
  label: string
  size?: IconButtonSize
  iconSize?: number
  variant?: 'line' | 'glass' | 'ink' | 'soft' | 'green'
  to?: string
  href?: string
}

const iconButtonVariant = {
  line: 'border border-line-10 hover:bg-line-6',
  glass: 'bg-glass border border-glass-edge hover:bg-white',
  ink: 'bg-ink text-white hover:bg-ink-2',
  soft: 'bg-glass-kiosk border border-white hover:bg-white',
  green: 'bg-green text-ink hover:brightness-95',
}

export function IconButton({ icon: Icon, label, size = 44, iconSize, variant = 'line', className, to, href, ...rest }: IconButtonProps) {
  const cls = cx(
    'inline-flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40',
    iconButtonSize[size],
    iconButtonVariant[variant],
    className,
  )
  const glyph = <Icon size={iconSize ?? (size <= 40 ? 16 : 18)} strokeWidth={2} aria-hidden />
  if (to)
    return (
      <Link to={to} className={cls} aria-label={label} title={label}>
        {glyph}
      </Link>
    )
  if (href)
    return (
      <a href={href} className={cls} aria-label={label} title={label}>
        {glyph}
      </a>
    )
  return (
    <button type="button" className={cls} aria-label={label} title={label} {...rest}>
      {glyph}
    </button>
  )
}

/* ---------------- Surfaces ---------------- */

export function Card({ className, children, as: As = 'section' }: { className?: string; children: ReactNode; as?: 'section' | 'div' }) {
  return <As className={cx('glass-card', className)}>{children}</As>
}

export function CardTitle({ children, size = 40, className }: { children: ReactNode; size?: 26 | 32 | 40; className?: string }) {
  const s = { 26: 'text-26', 32: 'text-32', 40: 'text-40 max-md:text-30' }[size]
  return <h2 className={cx('m-0 font-extrabold stretch-68 leading-none tracking-tight', s, className)}>{children}</h2>
}

/* ---------------- Pills and badges ---------------- */

export type Tone = 'green' | 'yellow' | 'red' | 'ink' | 'neutral' | 'glass'

const pillTone: Record<Tone, string> = {
  green: 'bg-green text-ink',
  yellow: 'bg-yellow text-ink',
  red: 'bg-red text-ink',
  ink: 'bg-ink text-white',
  neutral: 'bg-chip text-ink',
  glass: 'bg-glass border border-glass-edge text-ink-2',
}

/** Status pill: "Paid up", "Ends in 3 days", "Locked out", "Current" */
export function Pill({ tone, children, size = 'md', className }: { tone: Tone; children: ReactNode; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = { sm: 'h-30 px-12 text-13', md: 'h-32 px-14 text-13', lg: 'h-34 px-16 text-14' }[size]
  return <span className={cx('inline-flex items-center rounded-full font-bold whitespace-nowrap', s, pillTone[tone], className)}>{children}</span>
}

/** Round count next to a section title */
export function CountBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cx('inline-flex h-32 min-w-32 items-center justify-center rounded-full px-12 text-16 font-bold tabular', pillTone[tone])}>
      {children}
    </span>
  )
}

export function Dot({ tone, size = 10 }: { tone: 'green' | 'green-mark' | 'yellow' | 'red' | 'dot' | 'ink'; size?: 8 | 9 | 10 }) {
  const bg = { green: 'bg-green', 'green-mark': 'bg-green-mark', yellow: 'bg-yellow', red: 'bg-red', dot: 'bg-dot', ink: 'bg-ink' }[tone]
  const s = { 8: 'size-8', 9: 'size-9', 10: 'size-10' }[size]
  return <span aria-hidden className={cx('inline-block shrink-0 rounded-full', bg, s)} />
}

/* ---------------- Avatar ---------------- */

type AvatarSize = 34 | 40 | 42 | 44 | 48 | 72 | 96
type AvatarTone = 'neutral' | 'ink' | 'red' | 'onYellow' | 'inkGreen' | 'inkRed'

const avatarSize: Record<AvatarSize, string> = {
  34: 'size-34 text-14 font-bold',
  40: 'size-40 text-14 font-semibold',
  42: 'size-42 text-14 font-bold',
  44: 'size-44 text-14 font-bold',
  48: 'size-48 text-16 font-bold',
  72: 'size-72 text-28 font-extrabold stretch-70',
  96: 'size-96 text-36 font-extrabold stretch-70',
}
const avatarTone: Record<AvatarTone, string> = {
  neutral: 'bg-chip text-ink',
  ink: 'bg-ink text-white',
  red: 'bg-red-soft text-red-deep',
  onYellow: 'bg-line-10 text-ink',
  inkGreen: 'bg-ink text-green',
  inkRed: 'bg-ink text-red',
}

export function Avatar({ text, size = 42, tone = 'neutral', className }: { text: string; size?: AvatarSize; tone?: AvatarTone; className?: string }) {
  return (
    <span aria-hidden className={cx('inline-flex shrink-0 items-center justify-center rounded-full', avatarSize[size], avatarTone[tone], className)}>
      {text}
    </span>
  )
}

/* ---------------- Page header ---------------- */

export function PageHeader({ eyebrow, title, actions }: { eyebrow?: ReactNode; title: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mt-12 flex flex-wrap items-end justify-between gap-24 max-md:mt-0 max-md:gap-16">
      <div className="min-w-0">
        {eyebrow && <div className="text-14 font-medium text-muted">{eyebrow}</div>}
        <h1 className="m-0 mt-10 text-96 leading-88 font-extrabold tracking-tighter stretch-66 max-md:text-56">{title}</h1>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-10">{actions}</div>}
    </header>
  )
}

/* ---------------- Form fields ---------------- */

export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-8 block text-13 font-medium text-muted">
      {children}
    </label>
  )
}

export function FieldError({ children, id }: { children?: ReactNode; id?: string }) {
  if (!children) return null
  return (
    <div id={id} role="alert" className="mt-8 ml-20 text-13 font-semibold text-red-deep">
      {children}
    </div>
  )
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  error?: string
  hint?: string
  icon?: LucideIcon
}

/** Input in the style of the Log payment fields (grey pill, 56px) */
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, error, hint, icon: Icon, id, className, ...rest },
  ref,
) {
  const fieldId = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`
  return (
    <div className={className}>
      <FieldLabel htmlFor={fieldId}>{label}</FieldLabel>
      <div
        className={cx(
          'flex h-56 items-center gap-10 rounded-full bg-field px-20 text-17 font-semibold',
          'focus-within:outline-3 focus-within:outline-offset-3 focus-within:outline-ink',
          error && 'outline-2 outline-red',
        )}
      >
        {Icon && <Icon size={18} aria-hidden />}
        <input
          ref={ref}
          id={fieldId}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-err` : undefined}
          className="min-w-0 flex-1 border-none bg-transparent font-semibold outline-none placeholder:font-normal placeholder:text-muted"
          {...rest}
        />
      </div>
      {error ? <FieldError id={`${fieldId}-err`}>{error}</FieldError> : hint && <div className="mt-8 ml-20 text-12 text-muted">{hint}</div>}
    </div>
  )
})

/* ---------------- States ---------------- */

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-10 p-28 text-14 text-muted">
      <Loader2 size={18} className="animate-spin" aria-hidden />
      {label}
    </div>
  )
}

/** Grey placeholder rows while loading */
export function SkeletonRows({ rows = 6, height = 'h-44' }: { rows?: number; height?: string }) {
  return (
    <div aria-hidden className="flex flex-col">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-14 border-t border-line-6 py-12 first:border-t-0">
          <div className="size-42 shrink-0 animate-pulse rounded-full bg-chip" />
          <div className="flex-1">
            <div className={cx('w-1/3 animate-pulse rounded-full bg-chip', height === 'h-44' ? 'h-14' : 'h-12')} />
            <div className="mt-8 h-10 w-1/5 animate-pulse rounded-full bg-chip" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }: { icon?: LucideIcon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-10 px-24 py-40 text-center">
      {Icon && (
        <span className="mb-4 inline-flex size-48 items-center justify-center rounded-full bg-chip">
          <Icon size={20} aria-hidden />
        </span>
      )}
      <div className="text-17 font-bold">{title}</div>
      {children && <div className="max-w-360 text-14 text-muted">{children}</div>}
      {action && <div className="mt-8">{action}</div>}
    </div>
  )
}

/** Inline error banner, in the red of "Locked out" */
export function ErrorNote({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-center gap-12 rounded-tile bg-red-soft px-18 py-12 text-14 font-semibold text-red-deep">
      <span className="flex-1">{children}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-semibold underline">
          Try again
        </button>
      )}
    </div>
  )
}

export function Divider() {
  return <div className="border-t border-line-6" />
}
