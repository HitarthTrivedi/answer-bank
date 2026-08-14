// Post-extraction checkpoint: the student fixes extraction mistakes BEFORE any
// quota is spent. Extraction is never silently trusted.
import { useState } from 'react'
import { api } from '../api'

export default function ReviewQuestions({ project, onStarted }) {
  const [questions, setQuestions] = useState(
    project.questions.map((q) => ({ text: q.text, marks: q.marks })),
  )
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const update = (i, patch) =>
    setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)))
  const remove = (i) => setQuestions(questions.filter((_, j) => j !== i))
  const add = () => setQuestions([...questions, { text: '', marks: null }])

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const clean = questions
        .map((q) => ({ text: q.text.trim(), marks: q.marks || null }))
        .filter((q) => q.text.length >= 5)
      if (!clean.length) throw new Error('Add at least one question')
      await api.put(`/projects/${project.id}/questions`, { questions: clean })
      await api.post(`/projects/${project.id}/start`)
      onStarted()
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-4 rounded-xl border border-sky-500/25 bg-sky-500/5 p-4 text-sm text-sky-200">
        <span className="font-semibold">Review before answering:</span> we extracted{' '}
        {questions.length} question{questions.length === 1 ? '' : 's'}. Fix any splits or typos and
        confirm marks — answer depth follows the marks. Nothing counts against your quota until you start.
      </div>

      <div className="space-y-3">
        {questions.map((q, i) => (
          <div key={i} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
            <span className="pt-2 text-sm font-semibold text-slate-500">{i + 1}.</span>
            <textarea
              className="min-h-[60px] flex-1 resize-y rounded-lg border border-slate-700 bg-slate-950 p-2.5 text-sm outline-none focus:border-indigo-500"
              value={q.text}
              onChange={(e) => update(i, { text: e.target.value })}
            />
            <div className="flex flex-col items-end gap-2">
              <input
                type="number" min="1" max="100" placeholder="marks"
                className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
                value={q.marks ?? ''}
                onChange={(e) => update(i, { marks: e.target.value ? +e.target.value : null })}
              />
              <button onClick={() => remove(i)} className="text-xs text-slate-500 hover:text-red-400">
                remove
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button onClick={add} className="rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:border-slate-500">
          + Add question
        </button>
        <div className="flex items-center gap-3">
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            onClick={start} disabled={busy}
            className="rounded-lg bg-indigo-600 px-6 py-2.5 text-sm font-semibold hover:bg-indigo-500 disabled:opacity-50"
          >
            {busy ? 'Starting…' : `Answer ${questions.length} questions →`}
          </button>
        </div>
      </div>
    </div>
  )
}
