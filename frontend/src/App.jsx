import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth'
import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Landing from './pages/Landing'
import Project from './pages/Project'

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) {
    return <div className="flex h-screen items-center justify-center text-sm text-neutral-400">Loading…</div>
  }
  return user ? children : <Navigate to="/auth" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/auth" element={<Auth />} />
      <Route path="/app" element={<Protected><Dashboard /></Protected>} />
      {/* the question number lives in the URL, so back/forward and a reload all land
          on the question you were reading */}
      <Route path="/app/p/:id" element={<Protected><Project /></Protected>} />
      <Route path="/app/p/:id/:n" element={<Protected><Project /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
