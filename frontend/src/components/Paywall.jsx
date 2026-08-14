// The one paid moment. Shown when export returns 402.
//
// It appears *after* the student has read every answer on screen — they've seen the
// goods before the wallet comes out, which is the whole reason the gate sits on export
// rather than on answering.
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

export default function Paywall({ info, onClose, onPaid }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [order, setOrder] = useState(null)
  const pollRef = useRef(null)

  const packs = info?.packs || []

  // once a payment window is open, watch the order until the webhook credits it
  useEffect(() => {
    if (!order) return
    pollRef.current = setInterval(async () => {
      try {
        const o = await api.get(`/billing/orders/${order.order_id}`)
        if (o.status === 'paid') {
          clearInterval(pollRef.current)
          onPaid()
        }
      } catch { /* keep polling */ }
    }, 2000)
    return () => clearInterval(pollRef.current)
  }, [order, onPaid])

  const buy = async (credits) => {
    setBusy(true)
    setError('')
    try {
      const res = await api.post('/billing/checkout', { credits })
      setOrder(res)
      const url = res.pay_url.startsWith('http') ? res.pay_url : `/api${res.pay_url.replace(/^\/api/, '')}`
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      setError(e.message)
    }
    setBusy(false)
  }

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6"
      >
        <h2 className="text-lg font-semibold">Download your answer document</h2>
        <p className="mt-1 text-sm text-slate-400">
          Answering is free. One credit unlocks this question bank's DOCX — cover page,
          index, embedded plots and diagrams — and re-downloads stay free forever.
        </p>

        {order ? (
          <div className="mt-5 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-5 text-center">
            <p className="text-sm">Waiting for payment…</p>
            <p className="mt-1 text-xs text-slate-500">
              Finish paying in the tab that opened. This unlocks by itself.
            </p>
            <a
              href={order.pay_url} target="_blank" rel="noopener noreferrer"
              className="mt-3 inline-block text-xs text-indigo-400 hover:text-indigo-300"
            >
              Reopen payment page →
            </a>
          </div>
        ) : (
          <div className="mt-5 space-y-2">
            {packs.map((p) => (
              <button
                key={p.credits}
                disabled={busy}
                onClick={() => buy(p.credits)}
                className="flex w-full items-center justify-between rounded-xl border border-slate-700 px-4 py-3 text-left transition hover:border-indigo-500 disabled:opacity-50"
              >
                <span>
                  <span className="text-sm font-medium">{p.label}</span>
                  <span className="block text-xs text-slate-500">
                    {p.credits} question bank{p.credits === 1 ? '' : 's'}
                    {p.credits > 1 && ` · ₹${(p.inr / p.credits).toFixed(0)} each`}
                  </span>
                </span>
                <span className="text-base font-semibold text-indigo-400">₹{p.inr}</span>
              </button>
            ))}
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
        {info?.mock_payments && (
          <p className="mt-3 text-xs text-amber-400/80">
            Test mode — payments complete instantly and no money moves.
          </p>
        )}

        <button onClick={onClose} className="mt-4 w-full py-2 text-sm text-slate-500 hover:text-slate-300">
          Not now
        </button>
      </div>
    </div>
  )
}
