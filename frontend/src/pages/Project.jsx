import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import AnswerCard from '../components/AnswerCard'
import Paywall from '../components/Paywall'
import ReviewQuestions from '../components/ReviewQuestions'

export default function Project() {
  const { id } = useParams()
  const nav = useNavigate()
  const [project, setProject] = useState(null)
  const [error, setError] = useState('')
  const [paywall, setPaywall] = useState(null)
  const pollRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const p = await api.get(`/projects/${id}`)
      setProject(p)
      return p
    } catch (e) {
      setError(e.message)
      return null
    }
  }, [id])

  // poll while the backend is busy (extracting/processing); stop otherwise
  useEffect(() => {
    load()
    pollRef.current = setInterval(async () => {
      const p = await load()
      if (p && !['extracting', 'processing'].includes(p.status)) {
        // keep a slow heartbeat during review/done in case assist submissions land elsewhere
      }
    }, 2500)
    return () => clearInterval(pollRef.current)
  }, [load])

  const exportDocx = async () => {
    try {
      const blob = await api.blob(`/projects/${id}/export`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.title.replace(/[^\w\- ]/g, '')}.docx`
      a.click()
      URL.revokeObjectURL(url)
      load()  // the first export consumes the free bank / a credit
    } catch (e) {
      if (e.status === 402) setPaywall(e.payload)
      else alert(e.message)
    }
  }

  const del = async () => {
    if (!confirm('Delete this question bank and all its answers?')) return
    await api.del(`/projects/${id}`)
    nav('/app')
  }

  if (error) {
    return (
      <Shell>
        <p className="text-red-400">{error}</p>
      </Shell>
    )
  }
  if (!project) {
    return (
      <Shell>
        <p className="text-slate-500">Loading…</p>
      </Shell>
    )
  }

  const answered = project.counts.answered || 0
  const needYou = project.counts.assist_waiting || 0
  const pct = project.total ? Math.round((answered / project.total) * 100) : 0

  return (
    <Shell>
      <div className="mb-6">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-xl font-semibold">{project.title}</h1>
          <div className="flex items-center gap-2">
            {answered > 0 && (
              <button
                onClick={exportDocx}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold hover:bg-emerald-500"
              >
                {project.unlocked ? '⬇ Export DOCX' : '⬇ Export DOCX · 1 credit'}
              </button>
            )}
            <button onClick={del} className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400 hover:border-red-500 hover:text-red-400">
              Delete
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-500">
          {project.source_filename} · {project.total} questions
          {needYou > 0 && <span className="text-amber-400"> · {needYou} waiting on you</span>}
        </p>

        {['processing', 'done'].includes(project.status) && project.total > 0 && (
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-slate-400">
              <span>
                {project.status === 'processing' ? 'Answering one question at a time…' : 'All done'}
              </span>
              <span>{answered}/{project.total}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-800">
              <div
                className={`h-full rounded-full transition-all duration-700 ${project.status === 'done' ? 'bg-emerald-500' : 'bg-indigo-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {project.status === 'extracting' && (
        <Working text="Reading your file and extracting questions…" />
      )}

      {project.status === 'error' && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-5 text-sm text-red-300">
          {project.error || 'Something went wrong.'}
        </div>
      )}

      {project.status === 'review' && <ReviewQuestions project={project} onStarted={load} />}

      {project.engine_mode === 'extension' && needYou > 0 && (
        <div className="mb-4 rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-4 text-sm text-indigo-200">
          <span className="font-semibold">Extension mode:</span> {needYou} question
          {needYou === 1 ? '' : 's'} waiting for your own AI. Open the AnswerBank extension
          and hit <span className="font-medium">Start answering</span> — or answer any of them
          by hand below.
        </div>
      )}

      {['processing', 'done'].includes(project.status) && (
        <div className="space-y-4">
          {project.questions.map((q) => (
            <AnswerCard key={q.id} q={q} onChanged={load} />
          ))}
        </div>
      )}

      {paywall && (
        <Paywall
          info={paywall}
          onClose={() => setPaywall(null)}
          onPaid={() => { setPaywall(null); exportDocx() }}
        />
      )}
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <div className="min-h-screen">
      <nav className="border-b border-slate-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/app" className="text-sm text-slate-400 hover:text-slate-200">← All question banks</Link>
          <Link to="/" className="font-bold">Answer<span className="text-indigo-400">Bank</span></Link>
        </div>
      </nav>
      <main className="mx-auto max-w-4xl px-6 py-8">{children}</main>
    </div>
  )
}

function Working({ text }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-6 text-sm text-slate-300">
      <span className="h-3 w-3 animate-ping rounded-full bg-indigo-500" />
      {text}
    </div>
  )
}
