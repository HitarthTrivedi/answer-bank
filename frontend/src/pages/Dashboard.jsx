// Every question bank you've uploaded. A list, not a wall of cards — you come here to
// pick one and leave, so the only thing that needs to be obvious is which is which.

import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Paywall from '../components/Paywall'
import Wordmark from '../components/Wordmark'
import { Button, Eyebrow, Notice, Quiet, Text, fieldClass } from '../components/ui'
import { isInstalled } from '../extension'

export default function Dashboard() {
  const { user, logout, refreshMe } = useAuth()
  const [projects, setProjects] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [showBuy, setShowBuy] = useState(null)
  const [balance, setBalance] = useState(null)

  const load = () => api.get('/projects').then(setProjects).catch(() => setProjects([]))
  const loadBalance = () => api.get('/billing/me').then(setBalance).catch(() => {})
  useEffect(() => { load(); loadBalance(); refreshMe() }, [])

  const del = async (e, p) => {
    e.preventDefault()
    e.stopPropagation()
    if (!confirm(`Delete “${p.title}” and its answers?`)) return
    await api.del(`/projects/${p.id}`)
    load()
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between px-6">
          <Link to="/"><Wordmark size="sm" /></Link>
          <div className="flex items-center gap-5 text-[13px] text-neutral-500">
            <span title={isInstalled() ? 'Your AI answers the questions' : 'Install it to answer automatically'}
                  className="hidden items-center gap-1.5 sm:flex">
              <span className={`h-1.5 w-1.5 rounded-full ${isInstalled() ? 'bg-neutral-900' : 'bg-neutral-300'}`} />
              {isInstalled() ? 'Extension ready' : 'Extension off'}
            </span>
            {balance && (
              <button onClick={() => setShowBuy(balance)} className="hover:text-neutral-900">
                {balance.free_banks_left > 0
                  ? `${balance.free_banks_left} free`
                  : `${balance.credits} credit${balance.credits === 1 ? '' : 's'}`}
              </button>
            )}
            <button onClick={logout} className="hover:text-neutral-900" title={user?.email}>Sign out</button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-14 sm:py-20">
        <div className="mb-10 flex items-end justify-between gap-6">
          <h1 className="text-[26px] font-medium tracking-[-0.01em]">Question banks</h1>
          <Button onClick={() => setShowNew(true)}>New bank</Button>
        </div>

        {projects === null ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : projects.length === 0 ? (
          <div className="border-t border-neutral-200 py-20 text-center">
            <p className="text-[15px] text-neutral-600">Nothing here yet.</p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-neutral-400">
              Upload a question paper — PDF, Word, a photo, or pasted text. Graphs and
              diagrams inside it are fine.
            </p>
          </div>
        ) : (
          <ul className="border-t border-neutral-200">
            {projects.map((p) => (
              <li key={p.id} className="group flex items-center gap-6 border-b border-neutral-200">
                <Link to={`/app/p/${p.id}`} className="flex min-w-0 flex-1 items-center gap-6 py-5 transition hover:opacity-60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium text-neutral-900">{p.title}</span>
                    <span className="mt-1 block truncate text-[13px] text-neutral-400">
                      {p.source_filename} · {summarise(p)}
                    </span>
                  </span>
                  <span className="shrink-0 text-neutral-300">→</span>
                </Link>
                <button
                  onClick={(e) => del(e, p)}
                  aria-label={`Delete ${p.title}`}
                  className="hidden shrink-0 text-[13px] text-neutral-300 hover:text-neutral-900 group-hover:block"
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>

      {showNew && <NewBank onClose={() => setShowNew(false)} />}
      {showBuy && (
        <Paywall info={showBuy} onClose={() => setShowBuy(null)}
                 onPaid={() => { setShowBuy(null); loadBalance() }} />
      )}
    </div>
  )
}

function summarise(p) {
  if (p.status === 'extracting') return 'reading it now'
  if (p.status === 'error') return 'could not be read'
  if (p.status === 'review') return `${p.total} questions · needs a quick look`
  const done = p.counts.answered || 0
  if (done >= p.total && p.total) return `${p.total} questions · all answered`
  return `${done} of ${p.total} answered`
}

// ------------------------------------------------------------------------ upload

function NewBank({ onClose }) {
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [text, setText] = useState('')
  const [pasting, setPasting] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('title', title.trim() || (file ? file.name.replace(/\.[^.]+$/, '') : 'Question bank'))
      if (pasting) fd.append('text', text)
      else if (file) fd.append('file', file)
      else throw new Error('Choose a file first')
      const project = await api.postForm('/projects', fd)
      nav(`/app/p/${project.id}`)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-white/80 p-4 backdrop-blur-sm"
         onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-7 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)]">
        <Eyebrow>New question bank</Eyebrow>

        <input
          className={`${fieldClass} mt-4`} maxLength={200}
          placeholder="Name it — e.g. DBMS Unit 3"
          value={title} onChange={(e) => setTitle(e.target.value)}
        />

        {pasting ? (
          <textarea
            className={`${fieldClass} mt-3 h-44 resize-none`}
            placeholder={'1. Define normalization. (5 marks)\n2. Compare TCP and UDP. (10 marks)'}
            value={text} onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <label className="mt-3 block cursor-pointer rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center transition hover:border-neutral-900">
            <span className="block text-sm text-neutral-900">{file ? file.name : 'Choose your question paper'}</span>
            <span className="mt-1 block text-[12px] text-neutral-400">
              PDF, Word, or a photo — graphs and diagrams inside are fine
            </span>
            <input type="file" className="hidden" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"
                   onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>
        )}

        {error && <div className="mt-4"><Notice tone="loud">{error}</Notice></div>}

        <div className="mt-6 flex items-center justify-between">
          <Text type="button" onClick={() => { setPasting(!pasting); setError('') }}>
            {pasting ? 'Upload a file instead' : 'Paste text instead'}
          </Text>
          <div className="flex items-center gap-3">
            <Quiet type="button" size="sm" onClick={onClose}>Cancel</Quiet>
            <Button size="sm" disabled={busy}>{busy ? 'Reading…' : 'Continue'}</Button>
          </div>
        </div>
      </form>
    </div>
  )
}
