// The one paid moment. Shown when export returns 402.
//
// It appears *after* the student has read every answer on screen — they've seen the goods
// before the wallet comes out, which is the whole reason the gate sits on export rather
// than on answering.
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { Eyebrow, Notice, Text } from './ui'

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
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-white/80 p-4 backdrop-blur-sm"
         onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
           className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-7 shadow-[0_20px_60px_-20px_rgba(0,0,0,0.25)]">
        <Eyebrow>Your answer document</Eyebrow>
        <p className="mt-4 text-[15px] leading-relaxed text-neutral-600">
          Answering is free. One credit unlocks this bank's Word document — cover page,
          index, every figure embedded — and re-downloading it stays free forever.
        </p>

        {order ? (
          <div className="mt-7 rounded-lg border border-neutral-200 bg-neutral-50 p-6 text-center">
            <p className="text-sm text-neutral-900">Waiting for the payment to clear…</p>
            <p className="mt-1.5 text-[13px] text-neutral-500">
              Finish up in the tab that opened. This unlocks by itself.
            </p>
            <a href={order.pay_url} target="_blank" rel="noopener noreferrer"
               className="mt-4 inline-block text-[13px] underline decoration-neutral-300 underline-offset-4 hover:decoration-neutral-900">
              Reopen the payment page
            </a>
          </div>
        ) : (
          <ul className="mt-7 border-t border-neutral-200">
            {packs.map((p) => (
              <li key={p.credits} className="border-b border-neutral-200">
                <button disabled={busy} onClick={() => buy(p.credits)}
                        className="flex w-full items-center justify-between py-4 text-left transition hover:opacity-60 disabled:opacity-40">
                  <span>
                    <span className="block text-[15px] font-medium">{p.label}</span>
                    <span className="mt-0.5 block text-[13px] text-neutral-400">
                      {p.credits} question bank{p.credits === 1 ? '' : 's'}
                      {p.credits > 1 && ` · ₹${(p.inr / p.credits).toFixed(0)} each`}
                    </span>
                  </span>
                  <span className="text-[15px] font-medium tabular-nums">₹{p.inr}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {error && <div className="mt-4"><Notice tone="loud">{error}</Notice></div>}
        {info?.mock_payments && (
          <p className="mt-4 text-[12px] text-neutral-400">
            Test mode — payments complete instantly and no money moves.
          </p>
        )}

        <div className="mt-6 text-center">
          <Text onClick={onClose}>Not now</Text>
        </div>
      </div>
    </div>
  )
}
