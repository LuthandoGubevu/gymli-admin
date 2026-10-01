import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { cx, IconButton } from '.'

interface ModalProps {
  open: boolean
  onClose: () => void
  /** Small grey line above the title, e.g. "Log payment for" */
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  width?: 'md' | 'lg'
  /** Stops closing on backdrop click / Escape while saving */
  locked?: boolean
}

/** Design 04 / 06: white sheet, 36px radius, blurred dark backdrop. */
export function Modal({ open, onClose, eyebrow, title, subtitle, children, width = 'lg', locked }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLElement>('[data-autofocus], input, button:not([aria-label="Close"])')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !locked) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      prev?.focus?.()
    }
  }, [open, locked, onClose])

  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-overlay p-24 backdrop-blur-overlay max-md:items-end max-md:p-0"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !locked) onClose()
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        className={cx(
          'my-auto flex w-full flex-col gap-24 rounded-frame bg-white p-36 shadow-modal max-md:rounded-b-none max-md:p-20 max-md:pb-28',
          width === 'lg' ? 'max-w-760' : 'max-w-580',
        )}
      >
        <div className="flex items-start gap-16">
          <div className="min-w-0 flex-1">
            {eyebrow && <div className="text-14 font-medium text-muted">{eyebrow}</div>}
            <h2 className={cx('m-0 leading-95 font-extrabold tracking-tighter stretch-66', eyebrow ? 'mt-6 text-52 max-md:text-40' : 'text-44 max-md:text-36')}>
              {title}
            </h2>
            {subtitle && <div className="mt-8 text-14 text-ink-2 tabular">{subtitle}</div>}
          </div>
          <IconButton icon={X} label="Close" size={48} variant="line" onClick={onClose} disabled={locked} className="border-line-12" />
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
