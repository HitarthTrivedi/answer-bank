import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'
import Wordmark from '../components/Wordmark'
import { Button, Field, Notice, Text } from '../components/ui'

export default function Auth() {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const { login, register } = useAuth()
  const nav = useNavigate()

  const registering = mode === 'register'

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      if (registering) await register(form.name, form.email, form.password)
      else await login(form.email, form.password)
      nav('/app')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6">
      <Link to="/" className="mb-12"><Wordmark size="lg" /></Link>

      <form onSubmit={submit} className="w-full max-w-[320px] space-y-3">
        {registering && (
          <Field placeholder="Your name" value={form.name} required maxLength={120}
                 onChange={(e) => setForm({ ...form, name: e.target.value })} />
        )}
        <Field type="email" placeholder="Email" value={form.email} required autoComplete="email"
               onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Field type="password" placeholder="Password" value={form.password} required minLength={8}
               autoComplete={registering ? 'new-password' : 'current-password'}
               onChange={(e) => setForm({ ...form, password: e.target.value })} />

        {error && <Notice tone="loud">{error}</Notice>}

        <Button className="w-full" disabled={busy}>
          {busy ? 'One moment…' : registering ? 'Create account' : 'Sign in'}
        </Button>
      </form>

      <div className="mt-8">
        <Text type="button" onClick={() => { setMode(registering ? 'login' : 'register'); setError('') }}>
          {registering ? 'I already have an account' : 'Create an account'}
        </Text>
      </div>
    </div>
  )
}
