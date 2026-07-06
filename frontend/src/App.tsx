import { Routes, Route, Navigate } from 'react-router-dom'
import { UserProvider } from '@/context/UserContext'
import LoginPage from '@/pages/LoginPage'
import DevicesPage from '@/pages/DevicesPage'
import UsersPage from '@/pages/UsersPage'
import ConfirmReservationPage from '@/pages/ConfirmReservationPage'

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
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/confirm/:token" element={<ConfirmReservationPage />} />
      <Route path="/" element={<Navigate to="/devices" replace />} />
      <Route path="/*" element={<AuthenticatedRoutes />} />
    </Routes>
  )
}
