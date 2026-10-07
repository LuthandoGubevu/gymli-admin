import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth'
import { KeyRound, LogIn, Mail } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Button, ErrorNote, TextField } from '../components/ui'
import { authMessage } from '../data/actions'
import { logOut } from '../data/store'
import { auth } from '../lib/firebase'

/** Not in the design: built from the modal and field styles. */
export function LoginPage({ noAccess }: { noAccess?: boolean }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!email || !password) return setError('Enter your email and password')
    setBusy(true)
    setError(null)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (err) {
      setError(authMessage(err))
      setBusy(false)
    }
  }

  async function reset() {
    if (!email.includes('@')) return setError('Enter your email first')
    try {
      await sendPasswordResetEmail(auth, email.trim())
      setNote('If this email has a login, a reset link is on its way.')
      setError(null)
    } catch (err) {
      setError(authMessage(err))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-app p-24 max-md:bg-app-mobile max-md:p-16">
      <div className="flex w-full max-w-480 flex-col gap-24 rounded-frame bg-white p-36 shadow-modal max-md:p-24">
        <div className="-mx-36 -mt-36 overflow-hidden rounded-t-frame bg-brand-ink max-md:-mx-24 max-md:-mt-24">
          <img src="/brand/body-tone-gym.jpg" alt="Body Tone Gym, est. 2024" className="block w-full" />
          <div className="pb-16 text-center text-13 font-semibold tracking-caps text-white uppercase">Management System</div>
        </div>
        {noAccess ? (
          <>
            <div>
              <h1 className="m-0 text-52 leading-95 font-extrabold tracking-tighter stretch-66">No access</h1>
              <p className="mt-10 text-16 text-ink-2">This login is not set up for the front desk, or it was switched off. Ask a manager.</p>
            </div>
            <Button size="xl" onClick={() => logOut()}>Sign out</Button>
          </>
        ) : (
          <form onSubmit={submit} noValidate className="flex flex-col gap-20">
            <div>
              <div className="text-14 font-medium text-muted">Front desk</div>
              <h1 className="m-0 mt-6 text-52 leading-95 font-extrabold tracking-tighter stretch-66">Sign in</h1>
            </div>
            <TextField label="Email" type="email" icon={Mail} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus />
            <TextField label="Password" type="password" icon={KeyRound} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {error && <ErrorNote>{error}</ErrorNote>}
            {note && <div className="rounded-tile bg-green-soft px-18 py-12 text-14 font-semibold text-green-deep">{note}</div>}
            <Button type="submit" size="xl" icon={LogIn} loading={busy}>Sign in</Button>
            <button type="button" onClick={reset} className="self-center text-14 font-semibold underline">Forgot password</button>
          </form>
        )}
      </div>
    </div>
  )
}
