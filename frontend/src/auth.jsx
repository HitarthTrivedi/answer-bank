import { createContext, useContext, useEffect, useState } from 'react'
import { api, tokens } from './api'

const AuthCtx = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(!!tokens.access)

  useEffect(() => {
    if (!tokens.access && !tokens.refresh) return
    api.get('/auth/me')
      .then(setUser)
      .catch(() => tokens.clear())
      .finally(() => setLoading(false))
  }, [])

  const login = async (email, password) => {
    const data = await api.post('/auth/login', { email, password })
    tokens.set(data)
    setUser(data.user)
  }

  const register = async (name, email, password) => {
    const data = await api.post('/auth/register', { name, email, password })
    tokens.set(data)
    setUser(data.user)
  }

  const logout = async () => {
    try { await api.post('/auth/logout', { refresh_token: tokens.refresh }) } catch { /* best effort */ }
    tokens.clear()
    setUser(null)
  }

  const refreshMe = () => api.get('/auth/me').then(setUser).catch(() => {})

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, refreshMe }}>
      {children}
    </AuthCtx.Provider>
  )
}

export const useAuth = () => useContext(AuthCtx)
