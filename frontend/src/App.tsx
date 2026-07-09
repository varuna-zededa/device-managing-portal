import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { UserProvider } from '@/context/UserContext'
import { ErrorBoundary } from '@/components/ui/error-boundary'

const LoginPage = lazy(() => import('@/pages/LoginPage'))
const DevicesPage = lazy(() => import('@/pages/DevicesPage'))
const UsersPage = lazy(() => import('@/pages/UsersPage'))
const ConfirmReservationPage = lazy(() => import('@/pages/ConfirmReservationPage'))

function AuthenticatedRoutes() {
  return (
    <UserProvider>
      <Routes>
        <Route path="/devices" element={<DevicesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="*" element={<Navigate to="/devices" replace />} />
      </Routes>
    </UserProvider>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/confirm/:token" element={<ConfirmReservationPage />} />
          <Route path="/" element={<Navigate to="/devices" replace />} />
          <Route path="/*" element={<AuthenticatedRoutes />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}
