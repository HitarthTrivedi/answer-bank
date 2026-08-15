// The brand, in one place.
//
// A prism takes one beam and splits it into a spectrum — which is precisely what this
// product does with a question bank: one upload, fanned out across several AIs, each
// taking the part it handles best.

export default function Wordmark({ size = 'md', tagline = false }) {
  const text = { sm: 'text-base', md: 'text-lg', lg: 'text-xl' }[size]
  const glyph = { sm: 14, md: 16, lg: 20 }[size]

  return (
    <span className="inline-flex items-center gap-2">
      <svg width={glyph} height={glyph} viewBox="0 0 20 20" aria-hidden="true" className="shrink-0">
        <defs>
          <linearGradient id="prism-spectrum" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="50%" stopColor="#c084fc" />
            <stop offset="100%" stopColor="#f472b6" />
          </linearGradient>
        </defs>
        <path d="M10 2 L18.5 17.5 L1.5 17.5 Z" fill="url(#prism-spectrum)" />
      </svg>
      <span className={`font-bold tracking-tight ${text}`}>
        Prism
        {tagline && <span className="ml-1.5 font-normal text-slate-500">for students</span>}
      </span>
    </span>
  )
}
