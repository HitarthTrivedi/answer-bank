// A question bank, one question per screen.
//
// The deck is the product's whole shape: a rail at the top telling you where you are, a
// single question filling the page, and the arrow keys moving between them. The URL
// carries the position (/app/p/:id/7), so browser back works, a link is shareable, and a
// reload puts you back where you were.

import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import Paywall from '../components/Paywall'
import QuestionScreen from '../components/QuestionScreen'
import Rail from '../components/Rail'
import Wordmark from '../components/Wordmark'
import { Button, Notice, Pulse, Text } from '../components/ui'
import { isInstalled, onProgress, startRun, stopRun } from '../extension'

const BUSY = ['extracting', 'processing']

export default function Project() {
  const { id, n } = useParams()
  const nav = useNavigate()

  const [project, setProject] = useState(null)
  const [error, setError] = useState('')
  const [paywall, setPaywall] = useState(null)
  const [run, setRun] = useState(null)      // live state pushed by the extension
  const [draft, setDraft] = useState(null)  // review-mode edits, before they're committed
  const [starting, setStarting] = useState(false)

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

  useEffect(() => { load() }, [load])

  // Poll only while the server is actually doing something. During review the page is
  // the student's to edit, and a background refetch would fight their typing.
  const busy = project && BUSY.includes(project.status)
  useEffect(() => {
    if (!busy) return
    const t = setInterval(load, 2500)
    return () => clearInterval(t)
  }, [busy, load])

  // the extension pushes progress straight to this page while it works
  useEffect(() => onProgress(setRun), [])

  // review mode edits live here until the run starts
  useEffect(() => {
    if (project?.status === 'review') setDraft((d) => d ?? project.questions.map((q) => ({ ...q })))
    else setDraft(null)
  }, [project])

  const reviewing = project?.status === 'review'
  const questions = (reviewing ? draft : project?.questions) || []
  const total = questions.length

  // ------------------------------------------------------------------ navigation
  const current = Math.min(Math.max(parseInt(n, 10) || 1, 1), Math.max(total, 1)) - 1

  const goTo = useCallback((i) => {
    const clamped = Math.min(Math.max(i, 0), Math.max(total - 1, 0))
    nav(`/app/p/${id}/${clamped + 1}`, { replace: false })
  }, [id, nav, total])

  // keep the URL honest: out-of-range or missing index snaps back without a history entry
  useEffect(() => {
    if (!total) return
    if (String(current + 1) !== n) nav(`/app/p/${id}/${current + 1}`, { replace: true })
  }, [current, n, id, nav, total])

  const modalOpen = !!paywall
  useEffect(() => {
    if (!total || modalOpen) return
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = e.target
      const editable = el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      if (e.key === 'Escape' && editable) return el.blur()
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return

      // Inside a text field the arrows belong to the caret — until it hits the edge,
      // at which point moving on is exactly what you meant.
      if (editable) {
        if (el.selectionStart == null) return
        if (el.selectionStart !== el.selectionEnd) return
        if (e.key === 'ArrowRight' && el.selectionStart !== el.value.length) return
        if (e.key === 'ArrowLeft' && el.selectionStart !== 0) return
      }
      e.preventDefault()
      goTo(current + (e.key === 'ArrowRight' ? 1 : -1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [current, total, goTo, modalOpen])

  // ------------------------------------------------------------------ actions
  const patch = (i, p) => setDraft(draft.map((q, j) => (j === i ? { ...q, ...p } : q)))

  const remove = (i) => {
    if (draft.length <= 1) return   // a bank with no questions has nothing to do
    const next = draft.filter((_, j) => j !== i)
    setDraft(next)
    if (current >= next.length) goTo(next.length - 1)
  }

  /** Extraction can miss one. A blank screen right after this question is the cheapest
   *  possible fix, and the student is already looking at the gap. */
  const add = (i) => {
    const next = [...draft]
    next.splice(i + 1, 0, { id: null, text: '', marks: null, figures: [], status: 'pending' })
    setDraft(next)
    goTo(i + 1)
  }

  const start = async () => {
    setStarting(true)
    setError('')
    try {
      // `id` matters: it's what keeps the question's figures and its number in the
      // original paper attached through the save. Without it the server can only
      // delete and recreate, and the paper questions lose the pictures they refer to.
      const clean = draft
        .map((q) => ({ id: q.id, text: q.text.trim(), marks: q.marks || null, number: q.source_number }))
        .filter((q) => q.text.length >= 5)
      if (!clean.length) throw new Error('Add at least one question first')
      await api.put(`/projects/${id}/questions`, { questions: clean })
      await api.post(`/projects/${id}/start`)
      setDraft(null)
      if (isInstalled()) await startRun(id).catch((e) => setError(e.message))
      await load()
      goTo(0)
    } catch (e) {
      setError(e.message)
    } finally {
      setStarting(false)
    }
  }

  const exportDocx = async () => {
    try {
      const blob = await api.blob(`/projects/${id}/export`)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${project.title.replace(/[^\w\- ]/g, '')}.docx`
      a.click()
      URL.revokeObjectURL(url)
      load()
    } catch (e) {
      if (e.status === 402) setPaywall(e.payload)
      else setError(e.message)
    }
  }

  // ------------------------------------------------------------------ render
  if (error && !project) return <Centered><Notice tone="loud">{error}</Notice></Centered>
  if (!project) return <Centered><Pulse>Loading</Pulse></Centered>

  if (project.status === 'extracting') {
    return (
      <Frame project={project}>
        <Centered>
          <Pulse>Reading your paper and finding the questions</Pulse>
          <p className="mt-4 text-sm text-neutral-400">
            Figures, tables and scans included — this takes a few seconds.
          </p>
        </Centered>
      </Frame>
    )
  }

  if (project.status === 'error') {
    return (
      <Frame project={project}>
        <Centered><Notice tone="loud">{project.error || 'Something went wrong reading that file.'}</Notice></Centered>
      </Frame>
    )
  }

  if (!total) {
    return (
      <Frame project={project}>
        <Centered><p className="text-sm text-neutral-500">No questions in this bank.</p></Centered>
      </Frame>
    )
  }

  const answered = project.counts.answered || 0

  return (
    <Frame
      project={project}
      rail={<Rail questions={questions} current={current} active={run?.active} onJump={goTo} />}
      status={<RunStatus run={run} answered={answered} total={project.total} reviewing={reviewing} />}
      action={
        reviewing ? (
          <Button size="sm" onClick={start} disabled={starting}>
            {starting ? 'Starting…' : `Answer all ${total}`}
          </Button>
        ) : answered > 0 ? (
          <Button size="sm" onClick={exportDocx}>
            {project.unlocked ? 'Export' : 'Export · ₹20'}
          </Button>
        ) : null
      }
    >
      <QuestionScreen
        key={questions[current]?.id ?? current}
        q={questions[current]}
        index={current}
        total={total}
        project={project}
        mode={reviewing ? 'review' : 'answer'}
        run={run}
        onChanged={load}
        onPatch={(p) => patch(current, p)}
        onRemove={() => remove(current)}
        onAdd={() => add(current)}
      />

      {error && <div className="mt-8"><Notice tone="loud">{error}</Notice></div>}

      <Nav current={current} total={total} onGo={goTo} />

      {run?.running && (
        <p className="mt-10 text-center text-[13px] text-neutral-400">
          Leave this browser open — you can keep reading while it works.{' '}
          <Text onClick={() => stopRun().catch(() => {})}>Stop</Text>
        </p>
      )}

      {paywall && (
        <Paywall info={paywall} onClose={() => setPaywall(null)}
                 onPaid={() => { setPaywall(null); exportDocx() }} />
      )}
    </Frame>
  )
}

// ---------------------------------------------------------------------- chrome

function Frame({ project, rail, status, action, children }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-4 px-6">
          <Link to="/app" aria-label="All question banks"
                className="text-neutral-400 transition hover:text-neutral-900">
            <Wordmark size="sm" />
          </Link>
          <span className="h-4 w-px bg-neutral-200" />
          <h2 className="min-w-0 flex-1 truncate text-sm text-neutral-600">{project.title}</h2>
          {status}
          {action}
        </div>
        {rail && <div className="mx-auto w-full max-w-3xl px-6 pb-2">{rail}</div>}
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-14 sm:py-20">{children}</main>
    </div>
  )
}

function RunStatus({ run, answered, total, reviewing }) {
  if (reviewing) return null
  if (run?.running) {
    return <span className="hidden shrink-0 sm:block"><Pulse>{answered} of {total}</Pulse></span>
  }
  return (
    <span className="hidden shrink-0 text-[13px] tabular-nums text-neutral-400 sm:block">
      {answered} of {total} answered
    </span>
  )
}

/** Two ways to move, one action. Chevrons hug the viewport edges where there's room;
 *  everywhere else the pair sits under the question. */
function Nav({ current, total, onGo }) {
  const first = current === 0
  const last = current === total - 1

  return (
    <>
      <div className="pointer-events-none fixed inset-y-0 left-0 right-0 z-0 hidden items-center justify-between px-4 lg:flex">
        <Chevron dir="left" disabled={first} onClick={() => onGo(current - 1)} />
        <Chevron dir="right" disabled={last} onClick={() => onGo(current + 1)} />
      </div>

      <div className="mt-16 flex items-center justify-between border-t border-neutral-200 pt-5 lg:justify-center">
        <Text onClick={() => onGo(current - 1)} disabled={first} className="lg:hidden">
          ← Previous
        </Text>
        <span className="hidden text-[12px] text-neutral-300 lg:block">
          ← → to move between questions
        </span>
        <Text onClick={() => onGo(current + 1)} disabled={last} className="lg:hidden">
          Next →
        </Text>
      </div>
    </>
  )
}

function Chevron({ dir, disabled, onClick }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'left' ? 'Previous question' : 'Next question'}
      className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full text-neutral-300
                 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:pointer-events-none disabled:opacity-0"
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === 'left' ? 'M15 5 L8 12 L15 19' : 'M9 5 L16 12 L9 19'} />
      </svg>
    </button>
  )
}

function Centered({ children }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
      {children}
    </div>
  )
}
