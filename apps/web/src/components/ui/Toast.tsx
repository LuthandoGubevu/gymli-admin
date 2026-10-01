import { Check } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

const ToastContext = createContext<(msg: string) => void>(() => {})

/** Short confirmation at the bottom of the screen ("Payment saved"). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; key: number } | null>(null)
  const show = useCallback((text: string) => {
    const key = Date.now()
    setMsg({ text, key })
    setTimeout(() => setMsg((m) => (m?.key === key ? null : m)), 3500)
  }, [])
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-28 z-60 flex justify-center max-md:bottom-104">
        {msg && (
          <div key={msg.key} className="flex h-52 items-center gap-10 rounded-full bg-ink px-24 text-15 font-semibold text-white shadow-dock">
            <span className="inline-flex size-24 items-center justify-center rounded-full bg-green text-ink">
              <Check size={14} strokeWidth={3} />
            </span>
            {msg.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  )
}

export const useToast = () => useContext(ToastContext)
