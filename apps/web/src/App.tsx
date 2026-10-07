import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { BranchGate } from './components/BranchGate'
import { AppShell } from './components/layout/AppShell'
import { MemberFormModal } from './components/member/MemberFormModal'
import { Spinner } from './components/ui'
import { ToastProvider } from './components/ui/Toast'
import { AuthProvider, GymDataProvider, useAuth } from './data/store'
import { AccountsPage } from './pages/AccountsPage'
import { DoorLogPage } from './pages/DoorLogPage'
import { LoginPage } from './pages/LoginPage'
import { MemberProfilePage } from './pages/MemberProfilePage'
import { MembersPage } from './pages/MembersPage'
import { SettingsPage } from './pages/SettingsPage'
import { TodayPage } from './pages/TodayPage'

function AddMemberRoute() {
  const navigate = useNavigate()
  return (
    <>
      <MembersPage />
      <MemberFormModal open onClose={() => navigate('/members')} onAdded={(id) => navigate(`/members/${id}?enrol=1`, { replace: true })} />
    </>
  )
}

function Gate() {
  const { loading, user, staff, noAccess } = useAuth()
  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center bg-app">
        <Spinner label="Starting Gymli" />
      </div>
    )
  if (!user || !staff) return <LoginPage noAccess={!!user && noAccess} />
  return (
    <GymDataProvider>
      <AppShell>
        <BranchGate>
          <Routes>
            <Route path="/" element={<TodayPage />} />
            <Route path="/members" element={<MembersPage />} />
            <Route path="/members/new" element={<AddMemberRoute />} />
            <Route path="/members/:id" element={<MemberProfilePage />} />
            <Route path="/door-log" element={<DoorLogPage />} />
            <Route path="/check-in" element={<Navigate to="/" replace />} />
            <Route path="/accounts" element={<AccountsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BranchGate>
      </AppShell>
    </GymDataProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Gate />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
