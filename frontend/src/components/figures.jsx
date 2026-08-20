// Figure rendering for answers: mermaid diagrams (client-rendered, PNG posted back for
// DOCX export) and graphspec plots (server-rendered PNG fetched with auth).
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'
import { api } from '../api'

export const MdCtx = createContext({ answerId: null })

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict', // sanitizes labels — diagrams are model-generated content
  theme: 'default',        // the classic look: tinted subgraph groups, lavender nodes — reads as a diagram, not a wireframe
  flowchart: { curve: 'basis', padding: 12 },
})

let seq = 0
const postedAssets = new Set()

async function sha16(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.trim()))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

async function postMermaidPng(answerId, code, svg) {
  const key = await sha16(code)
  const memo = `${answerId}:${key}`
  if (postedAssets.has(memo)) return
  postedAssets.add(memo)
  try {
    const png = await svgToPng(svg)
    if (png) await api.post(`/answers/${answerId}/assets`, { kind: 'mermaid', key, png_base64: png })
  } catch { postedAssets.delete(memo) /* retry on next render */ }
}

function svgToPng(svgText) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }))
    img.onload = () => {
      const w = img.naturalWidth || 800
      const h = img.naturalHeight || 500
      const scale = Math.min(2, 1600 / w)
      const canvas = document.createElement('canvas')
      canvas.width = w * scale
      canvas.height = h * scale
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#ffffff' // white ground so the figure works inside the exported doc
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png').split(',')[1] || null)
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null) }
    img.src = url
  })
}

export function Mermaid({ code }) {
  const { answerId } = useContext(MdCtx)
  const [svg, setSvg] = useState('')
  const [failed, setFailed] = useState(false)
  const [full, setFull] = useState(false)

  useEffect(() => {
    let alive = true
    mermaid
      .render(`ab-mm-${++seq}`, code)
      .then(({ svg }) => {
        if (!alive) return
        setSvg(svg)
        if (answerId) postMermaidPng(answerId, code, svg)
      })
      .catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [code, answerId])

  // close full-size on Escape
  useEffect(() => {
    if (!full) return
    const onKey = (e) => { if (e.key === 'Escape') setFull(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [full])

  const download = async () => {
    const png = await svgToPng(svg)
    if (!png) return
    const a = document.createElement('a')
    a.href = `data:image/png;base64,${png}`
    a.download = 'diagram.png'
    a.click()
  }

  if (failed) {
    return <pre className="text-xs text-neutral-500">{code}</pre>
  }

  const figure = (
    <div
      className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )

  return (
    <>
      {/* A figure card with its own small toolbar — the diagram is usually the whole
          answer, so it gets the affordances a reader wants: see it big, take it away. */}
      <figure className="my-6 overflow-hidden rounded-lg border border-neutral-200 bg-white">
        <div className="flex items-center justify-between border-b border-neutral-100 px-3 py-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-neutral-400">Diagram</span>
          <span className="flex gap-3 text-[12px] text-neutral-400">
            <button onClick={() => setFull(true)} className="hover:text-neutral-900">full size</button>
            <button onClick={download} className="hover:text-neutral-900">download PNG</button>
          </span>
        </div>
        <div className="overflow-x-auto p-4">{figure}</div>
      </figure>

      {full && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-white/95 p-8 backdrop-blur-sm"
             onClick={() => setFull(false)}>
          <div className="max-h-full w-full max-w-6xl overflow-auto [&_svg]:h-auto [&_svg]:w-full"
               onClick={(e) => e.stopPropagation()}>
            {figure}
          </div>
          <button onClick={() => setFull(false)}
                  className="absolute right-6 top-5 text-[13px] text-neutral-500 hover:text-neutral-900">
            close (esc)
          </button>
        </div>
      )}
    </>
  )
}

const graphUrlCache = new Map()

export function GraphImage({ spec }) {
  const { answerId } = useContext(MdCtx)
  const [url, setUrl] = useState(null)
  const [state, setState] = useState('loading')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    ;(async () => {
      if (!answerId) return setState('error')
      const key = await sha16(spec)
      const memo = `${answerId}:${key}`
      if (graphUrlCache.has(memo)) {
        setUrl(graphUrlCache.get(memo))
        return setState('ok')
      }
      try {
        const blob = await api.blob(`/answers/${answerId}/graph/${key}.png`)
        const objUrl = URL.createObjectURL(blob)
        graphUrlCache.set(memo, objUrl)
        if (mounted.current) { setUrl(objUrl); setState('ok') }
      } catch {
        if (mounted.current) setState('error')
      }
    })()
    return () => { mounted.current = false }
  }, [spec, answerId])

  if (state === 'loading') {
    return <div className="my-6 h-48 animate-pulse rounded-lg bg-neutral-100" />
  }
  if (state === 'error') {
    return <p className="my-4 text-[13px] text-neutral-400">this plot could not be drawn</p>
  }
  return (
    <div className="my-6 overflow-hidden rounded-lg border border-neutral-200 bg-white p-3">
      <img src={url} alt="plot" className="mx-auto max-w-full" />
    </div>
  )
}
