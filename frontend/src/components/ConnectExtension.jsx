// Pairing handshake for the Chrome extension.
//
// A short-lived one-use code, not the account password: the extension never learns
// credentials, and a code shoulder-surfed off a screen is dead in five minutes.
import { useEffect, useState } from 'react'
import { api } from '../api'

export default function ConnectExtension({ onClose }) {
  const [code, setCode] = useState(null)
  const [left, setLeft] = useState(0)
  const [error, setError] = useState('')

  const issue = async () => {
    setError('')
    setCode(null)
    try {
      const res = await api.post('/extension/pair')
      setCode(res.code)
      setLeft(res.expires_in_s)
    } catch (e) {
      setError(e.message)
    }
  }

  useEffect(() => { issue() }, [])

  useEffect(() => {
    if (!code || left <= 0) return
    const t = setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(t)
  }, [code, left])

  const mins = String(Math.floor(left / 60)).padStart(1, '0')
  const secs = String(left % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6"
      >
        <h2 className="text-lg font-semibold">Connect the Chrome extension</h2>
        <p className="mt-1 text-sm text-slate-400">
          The extension answers your questions in the AI tabs you're already signed into —
          one fresh chat per question, no copy-pasting.
        </p>

        <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950 p-6 text-center">
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : code === null ? (
            <p className="text-sm text-slate-500">Generating…</p>
          ) : left === 0 ? (
            <p className="text-sm text-slate-500">This code expired.</p>
          ) : (
            <>
              <div className="font-mono text-3xl font-bold tracking-[0.3em] text-indigo-400">{code}</div>
              <p className="mt-2 text-xs text-slate-500">Expires in {mins}:{secs}</p>
            </>
          )}
        </div>

        <ol className="mt-4 list-decimal space-y-1 pl-5 text-sm text-slate-400">
          <li>Click the AnswerBank icon in your Chrome toolbar</li>
          <li>Type this code and hit Connect</li>
          <li>Start a question bank in <span className="text-slate-200">“Use my browser AI”</span> mode</li>
        </ol>

        <div className="mt-5 flex gap-3">
          <button
            onClick={issue}
            className="flex-1 rounded-lg border border-slate-700 py-2 text-sm text-slate-300 hover:border-slate-500"
          >
            New code
          </button>
          <button onClick={onClose} className="flex-1 rounded-lg bg-indigo-600 py-2 text-sm font-semibold hover:bg-indigo-500">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
