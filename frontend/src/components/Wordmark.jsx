// The brand, in one place.
//
// A prism takes one beam and splits it into a spectrum — which is precisely what this
// product does with a question bank: one upload, fanned out across several AIs, each
// taking the part it handles best. The mark draws that literally: one ray in, three out.
//
// Greyscale on purpose. The answers carry the colour here — plots, diagrams, code — and
// a tinted logo would be the loudest thing on a page it has no business leading.

export default function Wordmark({ size = 'md', tagline = false }) {
  const text = { sm: 'text-[13px]', md: 'text-[15px]', lg: 'text-lg' }[size]
  const glyph = { sm: 16, md: 18, lg: 22 }[size]

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <svg width={glyph} height={glyph} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
        {/* the beam in */}
        <path d="M1 13 H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        {/* the prism */}
        <path d="M12 4 L20.5 18.5 H3.5 Z" fill="none" stroke="currentColor" strokeWidth="1.5"
              strokeLinejoin="round" />
        {/* the spectrum out, separated by weight rather than colour */}
        <path d="M15 11.5 L23 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M15.5 13 L23 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              opacity="0.55" />
        <path d="M16 14.5 L23 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              opacity="0.3" />
      </svg>
      <span className={`font-semibold tracking-tight ${text}`}>
        Prism
        {tagline && <span className="ml-1.5 font-normal text-neutral-400">for students</span>}
      </span>
    </span>
  )
}
