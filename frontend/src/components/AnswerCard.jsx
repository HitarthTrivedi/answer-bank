import { useState } from 'react'
import { api } from '../api'
import Markdown from './Markdown'

const TYPE_META = {
  numerical: ['🔢', 'text-cyan-400'],
  code: ['⌨️', 'text-emerald-400'],
  graph: ['📈', 'text-fuchsia-400'],
  diagram: ['📐', 'text-amber-400'],
  theory: ['📖', 'text-sky-400'],
}

const ENGINE_LABEL = {
  api: (a) => a.model,
  assist: () => 'your own AI (assist)',
  cache: () => 'class cache ⚡',
}

export default function AnswerCard({ q, onChanged }) {
  return (
    <div id={`q-${q.idx}`} className="rounded-xl border border-slate-800 bg-slate-900/50">
      <QuestionHeader q={q} />
      {q.status === 'answered' && q.answer && <AnswerBody q={q} onChanged={onChanged} />}
      {q.status === 'assist_waiting' && <AssistBody q={q} onChanged={onChanged} />}
      {(q.status === 'pending' || q.status === 'answering') && (
        <div className="flex items-center gap-2 px-5 pb-5 text-sm text-slate-500">
          {q.status === 'answering' ? (
            <><span className="h-2 w-2 animate-pulse rounded-full bg-indigo-400" /> answering now…</>
          ) : (
            <><span className="h-2 w-2 rounded-full bg-slate-600" /> queued</>
          )}
        </div>
      )}
      {q.status === 'error' && (
        <div className="px-5 pb-5">
          <p className="mb-2 text-sm text-red-400">{q.error || 'Something went wrong'}</p>
          <RegenerateButton q={q} onChanged={onChanged} label="Retry" />
        </div>
      )}
    </div>
  )
}

function QuestionHeader({ q }) {
  const [icon, color] = TYPE_META[q.qtype] || ['❓', 'text-slate-400']
  return (
    <div className="px-5 pb-3 pt-4">
      <div className="mb-1.5 flex flex-wrap items-center gap-2 text-xs">
        <span className="font-semibold text-slate-400">Q{q.idx + 1}</span>
        {q.marks && <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">{q.marks} marks</span>}
        {q.qtype && (
          <span className={`rounded bg-slate-800 px-1.5 py-0.5 ${color}`} title={q.route_reason}>
            {icon} {q.qtype}
          </span>
        )}
        {q.answer && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-400">
            via {(ENGINE_LABEL[q.answer.engine] || (() => q.answer.engine))(q.answer)}
          </span>
        )}
        {q.answer?.verified === true && (
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-emerald-400" title={q.answer.verify_note}>
            ✓ verified
          </span>
        )}
        {q.answer?.verified === false && (
          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-400" title={q.answer.verify_note}>
            ⚠ check working
          </span>
        )}
      </div>
      <p className="font-medium leading-snug text-slate-100">{q.text}</p>
    </div>
  )
}

function AnswerBody({ q, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await api.put(`/answers/${q.answer.id}`, { content_md: draft })
      setEditing(false)
      onChanged()
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  return (
    <div className="border-t border-slate-800 px-5 py-4">
      {editing ? (
        <div>
          <textarea
            className="h-64 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-[13px] outline-none focus:border-indigo-500"
            value={draft} onChange={(e) => setDraft(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button onClick={save} disabled={busy}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="px-3 py-1.5 text-sm text-slate-400 hover:text-slate-200">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <Markdown content={q.answer.content_md} answerId={q.answer.id} />
      )}

      {!editing && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800/60 pt-3">
          <ExplainMe q={q} />
          <RegenerateButton q={q} onChanged={onChanged} label="↻ Regenerate" />
          <button
            onClick={() => { setDraft(q.answer.content_md); setEditing(true) }}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500"
          >
            ✎ Edit
          </button>
        </div>
      )}
    </div>
  )
}

function RegenerateButton({ q, onChanged, label }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { await api.post(`/questions/${q.id}/regenerate`); onChanged() }
    catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }
  return (
    <button onClick={go} disabled={busy}
      className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-500 disabled:opacity-50">
      {busy ? '…' : label}
    </button>
  )
}

function ExplainMe({ q }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState(q.answer.explain_md ? 'ready' : 'idle')
  const [explain, setExplain] = useState(q.answer.explain_md || '')
  const [assistPrompt, setAssistPrompt] = useState('')
  const [paste, setPaste] = useState('')

  const toggle = async () => {
    setOpen(!open)
    if (open || state === 'ready' || state === 'assist') return
    setState('loading')
    try {
      const r = await api.post(`/questions/${q.id}/explain`)
      if (r.explain_md) { setExplain(r.explain_md); setState('ready') }
      else { setAssistPrompt(r.assist_prompt); setState('assist') }
    } catch { setState('error') }
  }

  const submitPaste = async () => {
    try {
      const r = await api.post(`/questions/${q.id}/explain/assist`, { explain_md: paste })
      setExplain(r.explain_md)
      setState('ready')
    } catch (e) { alert(e.message) }
  }

  return (
    <div className="w-full">
      <button onClick={toggle}
        className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-1.5 text-xs font-medium text-indigo-300 hover:bg-indigo-500/20">
        💡 Explain me {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="mt-3 rounded-lg border border-indigo-500/25 bg-indigo-500/5 p-4">
          {state === 'loading' && <p className="text-sm text-slate-400">Writing the beginner version…</p>}
          {state === 'error' && <p className="text-sm text-red-400">Could not generate the explanation. Try again.</p>}
          {state === 'ready' && <Markdown content={explain} answerId={q.answer.id} />}
          {state === 'assist' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-300">
                No API configured — copy this prompt into your own AI tab, then paste its reply back:
              </p>
              <CopyBox text={assistPrompt} />
              <textarea
                className="h-28 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none focus:border-indigo-500"
                placeholder="Paste the explanation here…"
                value={paste} onChange={(e) => setPaste(e.target.value)}
              />
              <button onClick={submitPaste} disabled={paste.trim().length < 10}
                className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50">
                Save explanation
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const AI_TABS = [
  ['ChatGPT', 'https://chatgpt.com'],
  ['Claude', 'https://claude.ai'],
  ['Kimi', 'https://kimi.com'],
  ['Gemini', 'https://gemini.google.com'],
]

function AssistBody({ q, onChanged }) {
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try { await api.post(`/questions/${q.id}/assist`, { content_md: paste }); onChanged() }
    catch (e) { alert(e.message) }
    finally { setBusy(false) }
  }

  return (
    <div className="border-t border-amber-500/20 bg-amber-500/[0.04] px-5 py-4">
      <p className="mb-3 text-sm text-amber-300/90">
        <span className="font-semibold">Your turn:</span> this question is routed to your own AI.
        Copy the crafted prompt, paste it into any AI tab, then paste the answer back — it will be
        formatted, verified and included in the document like every other answer.
      </p>
      <CopyBox text={q.assist_prompt} />
      <div className="my-2 flex flex-wrap gap-2 text-xs">
        {AI_TABS.map(([name, url]) => (
          <a key={name} href={url} target="_blank" rel="noreferrer"
            className="rounded-lg border border-slate-700 px-2.5 py-1 text-slate-300 hover:border-slate-500">
            Open {name} ↗
          </a>
        ))}
      </div>
      <textarea
        className="h-32 w-full rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm outline-none focus:border-amber-500"
        placeholder="Paste the AI's full answer here (markdown survives)…"
        value={paste} onChange={(e) => setPaste(e.target.value)}
      />
      <button onClick={submit} disabled={busy || paste.trim().length < 10}
        className="mt-2 rounded-lg bg-amber-600 px-4 py-1.5 text-sm font-semibold text-black hover:bg-amber-500 disabled:opacity-50">
        {busy ? 'Saving…' : 'Save answer'}
      </button>
    </div>
  )
}

function CopyBox({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="relative">
      <pre className="max-h-36 overflow-y-auto whitespace-pre-wrap rounded-lg border border-slate-700 bg-slate-950 p-3 pr-20 text-xs text-slate-400">
        {text}
      </pre>
      <button onClick={copy}
        className="absolute right-2 top-2 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium hover:bg-indigo-500">
        {copied ? 'Copied ✓' : 'Copy'}
      </button>
    </div>
  )
}
