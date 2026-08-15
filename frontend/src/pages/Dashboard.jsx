import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import Paywall from '../components/Paywall'
import { isInstalled } from '../extension'
import Wordmark from '../components/Wordmark'

const STATUS_STYLE = {
  extracting: 'bg-amber-500/15 text-amber-400',
  review: 'bg-sky-500/15 text-sky-400',
  processing: 'bg-indigo-500/15 text-indigo-400',
  done: 'bg-emerald-500/15 text-emerald-400',
  error: 'bg-red-500/15 text-red-400',
}

export default function Dashboard() {
  const { user, logout, refreshMe } = useAuth()
  const [projects, setProjects] = useState(null)
  const [showNew, setShowNew] = useState(false)
  const [showBuy, setShowBuy] = useState(null)
  const [balance, setBalance] = useState(null)

  const load = () => api.get('/projects').then(setProjects).catch(() => setProjects([]))
  const loadBalance = () => api.get('/billing/me').then(setBalance).catch(() => {})
  useEffect(() => { load(); loadBalance(); refreshMe() }, [])

  return (
    <div className="min-h-screen">
      <nav className="border-b border-slate-800">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link to="/"><Wordmark /></Link>
          <div className="flex items-center gap-4 text-sm">
            {balance && (
              <button
                onClick={() => setShowBuy(balance)}
                className="rounded-full bg-indigo-500/15 px-3 py-1 text-xs font-semibold text-indigo-300 hover:bg-indigo-500/25"
              >
                {balance.free_banks_left > 0
                  ? `${balance.free_banks_left} free bank${balance.free_banks_left === 1 ? '' : 's'}`
                  : `${balance.credits} credit${balance.credits === 1 ? '' : 's'}`}
              </button>
            )}
            <span
              className={isInstalled() ? 'text-xs text-emerald-400' : 'text-xs text-amber-400'}
              title={isInstalled() ? 'The extension will answer your questions' : 'Install it from chrome://extensions'}
            >
              {isInstalled() ? '● Extension ready' : '● Extension not installed'}
            </span>
            <span className="text-slate-300">{user?.name}</span>
            <button onClick={logout} className="text-slate-500 hover:text-slate-300">Sign out</button>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Your question banks</h1>
          <button
            onClick={() => setShowNew(true)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium hover:bg-indigo-500"
          >
            + New question bank
          </button>
        </div>

        {projects === null ? (
          <p className="text-slate-500">Loading…</p>
        ) : projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-700 p-12 text-center text-slate-400">
            <p className="mb-2 text-lg">No question banks yet</p>
            <p className="text-sm">Upload one — PDF, DOCX, image or pasted text — and get a full answer document.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <Link
                key={p.id}
                to={`/app/p/${p.id}`}
                className="rounded-xl border border-slate-800 bg-slate-900/50 p-5 transition hover:border-indigo-600/60"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <h3 className="font-medium leading-snug">{p.title}</h3>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[p.status] || ''}`}>
                    {p.status}
                  </span>
                </div>
                <p className="text-xs text-slate-500">{p.source_filename}</p>
                <p className="mt-3 text-sm text-slate-400">
                  {p.total} questions
                  {p.counts.answered ? ` · ${p.counts.answered} answered` : ''}
                  {p.counts.assist_waiting ? ` · ${p.counts.assist_waiting} need you` : ''}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>

      {showNew && <NewProject onClose={() => setShowNew(false)} />}
      {showBuy && (
        <Paywall
          info={showBuy}
          onClose={() => setShowBuy(null)}
          onPaid={() => { setShowBuy(null); loadBalance() }}
        />
      )}
    </div>
  )
}

function NewProject({ onClose }) {
  const [tab, setTab] = useState('file')
  const [title, setTitle] = useState('')
  const [file, setFile] = useState(null)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('title', title)
      if (tab === 'file') {
        if (!file) throw new Error('Choose a file first')
        fd.append('file', file)
      } else {
        fd.append('text', text)
      }
      const project = await api.postForm('/projects', fd)
      nav(`/app/p/${project.id}`)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6"
      >
        <h2 className="mb-4 text-lg font-semibold">New question bank</h2>
        <input
          className="mb-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
          placeholder="Title, e.g. 'DBMS Unit 3'"
          value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={200}
        />
        <div className="mb-3 grid grid-cols-2 rounded-lg bg-slate-800 p-1 text-sm">
          {['file', 'paste'].map((t) => (
            <button
              type="button" key={t} onClick={() => setTab(t)}
              className={`rounded-md py-1.5 ${tab === t ? 'bg-indigo-600 font-medium' : 'text-slate-400'}`}
            >
              {t === 'file' ? 'Upload file' : 'Paste text'}
            </button>
          ))}
        </div>
        {tab === 'file' ? (
          <label className="mb-3 block cursor-pointer rounded-lg border border-dashed border-slate-600 p-6 text-center text-sm text-slate-400 hover:border-indigo-500">
            {file ? file.name : 'PDF · DOCX · TXT · PNG/JPG — click to choose'}
            <input
              type="file" className="hidden" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </label>
        ) : (
          <textarea
            className="mb-3 h-40 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-indigo-500"
            placeholder={'Paste questions, e.g.\n1. Define X (5 marks)\n2. Calculate Y…'}
            value={text} onChange={(e) => setText(e.target.value)}
          />
        )}
        {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200">
            Cancel
          </button>
          <button disabled={busy} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50">
            {busy ? 'Uploading…' : 'Extract questions'}
          </button>
        </div>
      </form>
    </div>
  )
}
