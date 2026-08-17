// One question. One screen. Nothing else on it.
//
// The old build stacked every question and its answer down a single page, and a
// 28-question bank became a wall you scrolled past rather than read. A question deserves
// the whole viewport: the question at the top in a size you'd actually read, the answer
// under it with room to breathe, and the next one an arrow key away.

import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { isInstalled, startRun } from '../extension'
import ExtensionNeeded from './ExtensionNeeded'
import Markdown from './Markdown'
import { Button, Eyebrow, Notice, Pulse, Quiet, Text, fieldClass } from './ui'

const SITE_NAMES = { chatgpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini' }

export default function QuestionScreen({ q, index, total, project, mode, run, onChanged,
                                         onPatch, onRemove, onAdd }) {
  const active = (run?.active || []).find((a) => a.idx === index + 1)

  return (
    <article className="screen-in" key={q.id ?? index}>
      <header className="flex items-baseline justify-between gap-6">
        <Eyebrow>
          Question {String(index + 1).padStart(2, '0')}
          <span className="text-neutral-300"> / {String(total).padStart(2, '0')}</span>
        </Eyebrow>
        <Meta q={q} />
      </header>

      {mode === 'review' ? (
        <ReviewBody q={q} onPatch={onPatch} onRemove={onRemove} onAdd={onAdd} />
      ) : (
        <>
          <h1 className="mt-5 text-[22px] font-medium leading-[1.45] tracking-[-0.01em] text-neutral-900 sm:text-[26px]">
            {q.text}
          </h1>
          <Figures figures={q.figures} />
          <hr className="my-9 border-neutral-200" />
          <AnswerBody q={q} project={project} active={active} onChanged={onChanged} />
        </>
      )}
    </article>
  )
}

function Meta({ q }) {
  const bits = []
  if (q.marks) bits.push(`${q.marks} mark${q.marks === 1 ? '' : 's'}`)
  // which row of the rail this one sits in — worth saying, because a figure question is
  // the kind where a misread paper turns into a confident wrong answer
  if (q.visual) bits.push('reads a figure')
  if (q.qtype && !(q.visual && ['graph', 'diagram'].includes(q.qtype))) bits.push(q.qtype)
  if (q.answer?.verified === false) bits.push('check the working')
  if (!bits.length) return null
  return (
    <p className="shrink-0 text-[13px] text-neutral-400" title={q.route_reason || undefined}>
      {bits.join(' · ')}
    </p>
  )
}

/** Figures we pulled out of the file. Shown small: they're a reassurance that we read the
 *  paper properly, not the subject of the screen. The AI reads the original file anyway. */
function Figures({ figures }) {
  if (!figures?.length) return null
  return (
    <div className="mt-6 flex flex-wrap gap-3">
      {figures.map((f) => (
        <img
          key={f.id} src={f.url} alt="Figure from your paper"
          className="max-h-44 rounded-lg border border-neutral-200 bg-white object-contain p-2"
        />
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ review mode

function ReviewBody({ q, onPatch, onRemove, onAdd }) {
  const ref = useRef(null)

  // grow to fit — a question is one to five lines, and a scrollbar inside a five-line
  // box is the fiddliest thing you can hand someone who is only fixing a typo
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [q.text])

  return (
    <div className="mt-5">
      <textarea
        ref={ref}
        value={q.text}
        onChange={(e) => onPatch({ text: e.target.value })}
        aria-label="Question text"
        className="w-full resize-none border-0 bg-transparent p-0 text-[22px] font-medium leading-[1.45]
                   tracking-[-0.01em] text-neutral-900 outline-none placeholder-neutral-300 sm:text-[26px]"
        placeholder="Type the question…"
      />
      <Figures figures={q.figures} />

      {q.needs_figure && !q.figures?.length && (
        <p className="mt-6 text-[13px] text-neutral-500">
          This one points at a figure. Your AI reads it straight from the file you
          uploaded, so there's nothing to fix here.
        </p>
      )}

      <div className="mt-8 flex items-center gap-5 border-t border-neutral-200 pt-5">
        <label className="flex items-center gap-2 text-[13px] text-neutral-500">
          Marks
          <input
            type="number" min="1" max="100" placeholder="—"
            value={q.marks ?? ''}
            onChange={(e) => onPatch({ marks: e.target.value ? +e.target.value : null })}
            className={`${fieldClass} h-9 w-20 px-2 py-0 text-center`}
          />
        </label>
        <span className="flex-1" />
        <Text onClick={onAdd}>Add one after this</Text>
        <Text onClick={onRemove}>Remove</Text>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ answer mode

function AnswerBody({ q, project, active, onChanged }) {
  if (q.status === 'answered' && q.answer) {
    return <Answered q={q} onChanged={onChanged} />
  }
  if (q.status === 'error') {
    return (
      <div className="space-y-5">
        <Notice tone="loud">{q.error || 'This one didn\'t come back. Try it again.'}</Notice>
        <Regenerate q={q} onChanged={onChanged} label="Try again" />
      </div>
    )
  }
  if (q.status === 'assist_waiting' || q.status === 'assist_running') {
    return <Waiting q={q} project={project} active={active} onChanged={onChanged} />
  }
  return <Pulse>{q.status === 'answering' ? 'Answering now…' : 'Waiting its turn'}</Pulse>
}

function Answered({ q, onChanged }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [explaining, setExplaining] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      await api.put(`/answers/${q.answer.id}`, { content_md: draft })
      setEditing(false)
      onChanged()
    } catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  if (editing) {
    return (
      <div>
        <textarea
          value={draft} onChange={(e) => setDraft(e.target.value)}
          className="h-[60vh] w-full rounded-lg border border-neutral-200 bg-neutral-50 p-4 font-mono
                     text-[13px] leading-relaxed outline-none focus:border-neutral-900"
        />
        <div className="mt-4 flex items-center gap-3">
          <Button onClick={save} disabled={busy} size="sm">{busy ? 'Saving…' : 'Save'}</Button>
          <Text onClick={() => setEditing(false)}>Cancel</Text>
        </div>
      </div>
    )
  }

  return (
    <div>
      <Markdown content={q.answer.content_md} answerId={q.answer.id} />

      {explaining && <Explain q={q} />}

      <div className="mt-10 flex flex-wrap items-center gap-6 border-t border-neutral-200 pt-5">
        <Text onClick={() => setExplaining(!explaining)}>
          {explaining ? 'Hide the simple version' : 'Explain it simply'}
        </Text>
        <Text onClick={() => { setDraft(q.answer.content_md); setEditing(true) }}>Edit</Text>
        <Regenerate q={q} onChanged={onChanged} label="Answer again" asText />
        {/* Where the answer came from. Worth stating plainly: a cache hit opens no tab
            at all, which otherwise reads as "something answered this behind my back". */}
        <span className="ml-auto text-[12px] text-neutral-400">
          {q.answer.engine === 'cache'
            ? 'already answered by your class — no tab needed'
            : `answered in ${SITE_NAMES[q.target_site] || 'your AI'}`}
        </span>
      </div>
    </div>
  )
}

function Regenerate({ q, onChanged, label, asText }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try { await api.post(`/questions/${q.id}/regenerate`); onChanged() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }
  const Cmp = asText ? Text : Quiet
  return <Cmp onClick={go} disabled={busy} size={asText ? undefined : 'sm'}>{busy ? '…' : label}</Cmp>
}

function Explain({ q }) {
  const [state, setState] = useState(q.answer.explain_md ? 'ready' : 'loading')
  const [md, setMd] = useState(q.answer.explain_md || '')
  const [prompt, setPrompt] = useState('')
  const [paste, setPaste] = useState('')

  useEffect(() => {
    if (state !== 'loading') return
    let alive = true
    api.post(`/questions/${q.id}/explain`)
      .then((r) => {
        if (!alive) return
        if (r.explain_md) { setMd(r.explain_md); setState('ready') }
        else { setPrompt(r.assist_prompt); setState('assist') }
      })
      .catch(() => alive && setState('error'))
    return () => { alive = false }
  }, [state, q.id])

  const submit = async () => {
    try {
      const r = await api.post(`/questions/${q.id}/explain/assist`, { explain_md: paste })
      setMd(r.explain_md)
      setState('ready')
    } catch (e) { alert(e.message) }
  }

  return (
    <section className="mt-10 border-l-2 border-neutral-900 pl-6">
      {/* The one thing Prism's own model writes. Answers never come from here — but
          re-reading an answer you already have isn't worth a browser tab and one of your
          free messages, so this one is on us. */}
      <Eyebrow className="mb-3">In plain words · written by Prism</Eyebrow>
      {state === 'loading' && <Pulse>Writing the beginner's version…</Pulse>}
      {state === 'error' && <p className="text-sm text-neutral-500">Couldn't write it. Try again in a moment.</p>}
      {state === 'ready' && <Markdown content={md} answerId={q.answer.id} />}
      {state === 'assist' && (
        <div className="space-y-4">
          <p className="text-sm text-neutral-600">
            Paste this into any AI tab, then paste its reply back.
          </p>
          <CopyBox text={prompt} />
          <textarea
            value={paste} onChange={(e) => setPaste(e.target.value)}
            placeholder="Paste the explanation here…"
            className="h-28 w-full rounded-lg border border-neutral-200 bg-white p-3 text-sm outline-none focus:border-neutral-900"
          />
          <Button size="sm" onClick={submit} disabled={paste.trim().length < 10}>Save</Button>
        </div>
      )}
    </section>
  )
}

// --------------------------------------------------- waiting on the student's own AI

function Waiting({ q, project, active, onChanged }) {
  const [manual, setManual] = useState(false)
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)
  const hasExt = isInstalled()

  if (active) {
    return (
      <Pulse>
        {active.doc
          ? `Reading your paper in ${active.site} to answer this one`
          : `${active.site} is writing this answer`}
      </Pulse>
    )
  }

  const run = async () => {
    try { await startRun(project.id); onChanged() } catch (e) { alert(e.message) }
  }

  const submit = async () => {
    setBusy(true)
    try { await api.post(`/questions/${q.id}/assist`, { content_md: paste }); onChanged() }
    catch (e) { alert(e.message) } finally { setBusy(false) }
  }

  if (manual) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">
          Copy this into any AI tab, then paste the full reply back. It's formatted,
          checked and exported exactly like an automatic answer.
        </p>
        <CopyBox text={q.assist_prompt} />
        <textarea
          value={paste} onChange={(e) => setPaste(e.target.value)}
          placeholder="Paste the AI's answer here…"
          className="h-40 w-full rounded-lg border border-neutral-200 bg-white p-3 text-sm outline-none focus:border-neutral-900"
        />
        <div className="flex items-center gap-4">
          <Button size="sm" onClick={submit} disabled={busy || paste.trim().length < 10}>
            {busy ? 'Saving…' : 'Save answer'}
          </Button>
          <Text onClick={() => setManual(false)}>Back</Text>
        </div>
      </div>
    )
  }

  if (!hasExt) return <ExtensionNeeded onManual={() => setManual(true)} />

  return (
    <div className="flex flex-wrap items-center gap-6">
      <Button onClick={run}>Answer with my AI</Button>
      <Text onClick={() => setManual(true)}>or paste it in myself</Text>
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
      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-neutral-200
                      bg-neutral-50 p-4 pr-24 text-[12px] leading-relaxed text-neutral-500">
        {text}
      </pre>
      <button
        onClick={copy}
        className="absolute right-2 top-2 rounded-md bg-neutral-900 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-neutral-700"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
