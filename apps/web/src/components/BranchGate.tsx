import { Building2, Check } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { authMessage, setUpFirstBranch } from '../data/actions'
import { useGym, useStaff } from '../data/store'
import { Button, Card, EmptyState, ErrorNote, PageHeader, Spinner, TextField } from './ui'

/**
 * Screens need a branch. Managers name the first one (existing members and logins go in it);
 * front desk without a branch is asked to see a manager.
 */
export function BranchGate({ children }: { children: ReactNode }) {
  const staff = useStaff()
  const { branches, branch } = useGym()
  // Stay on the setup screen until the server has confirmed it (the branch shows up locally first)
  const [settingUp, setSettingUp] = useState(false)
  if (branches.loading)
    return (
      <div className="flex justify-center py-80">
        <Spinner label="Loading branches" />
      </div>
    )
  if (branch && !settingUp) return <>{children}</>
  if (staff.role === 'manager') return <FirstBranch onBusy={setSettingUp} />
  return (
    <Card className="p-28">
      <EmptyState icon={Building2} title="No branch yet">
        Your login is not in a branch. Ask a manager to put you in one.
      </EmptyState>
    </Card>
  )
}

function FirstBranch({ onBusy }: { onBusy: (busy: boolean) => void }) {
  const staff = useStaff()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    onBusy(true)
    setError(null)
    try {
      await setUpFirstBranch(staff, name)
    } catch (e) {
      setError(authMessage(e))
      setBusy(false)
    }
    onBusy(false)
  }

  return (
    <>
      <PageHeader eyebrow="Set up" title="Name your first branch" />
      <Card className="flex max-w-560 flex-col gap-16 p-28 max-md:p-18">
        <div className="text-16 text-ink-2">Members, front desk and check-in PCs belong to a branch. Everything already in Gymli goes into this one. You can add more branches in Settings.</div>
        <TextField label="Branch name" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example Body Tone Sandton" />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div>
          <Button size="xl" icon={Check} loading={busy} onClick={save}>
            Save branch
          </Button>
        </div>
      </Card>
    </>
  )
}
