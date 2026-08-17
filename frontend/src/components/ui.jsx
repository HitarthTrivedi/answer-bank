// The whole visual vocabulary, in one file.
//
// Four shapes: a solid button, a quiet one, a text action, and a field. Everything in the
// product is built from these, which is the only reliable way to keep a monochrome
// interface from drifting into eight shades of grey that each mean something different.

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium ' +
  'transition disabled:pointer-events-none disabled:opacity-40'

const SIZES = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4',
  lg: 'h-12 px-6 text-[15px]',
}

/** The one thing to do on this screen. There should rarely be two. */
export function Button({ size = 'md', className = '', ...props }) {
  return (
    <button
      {...props}
      className={`${base} ${SIZES[size]} bg-neutral-900 text-white hover:bg-neutral-700 ${className}`}
    />
  )
}

/** A real action, but not the one we're recommending. */
export function Quiet({ size = 'md', className = '', ...props }) {
  return (
    <button
      {...props}
      className={`${base} ${SIZES[size]} border border-neutral-200 text-neutral-700 hover:border-neutral-400 hover:text-neutral-900 ${className}`}
    />
  )
}

/** Tertiary — reads as a link, weighs nothing, sits in a row of its peers. */
export function Text({ className = '', ...props }) {
  return (
    <button
      {...props}
      className={`text-[13px] text-neutral-500 underline decoration-neutral-300 underline-offset-4 transition hover:text-neutral-900 hover:decoration-neutral-900 disabled:opacity-40 ${className}`}
    />
  )
}

export const fieldClass =
  'w-full rounded-lg border border-neutral-200 bg-white px-3 py-2.5 text-sm text-neutral-900 ' +
  'placeholder-neutral-400 outline-none transition focus:border-neutral-900'

export function Field({ className = '', ...props }) {
  return <input {...props} className={`${fieldClass} ${className}`} />
}

/** Anything that failed. Kept in ink rather than red: the palette is greyscale, so a
 *  problem announces itself by being the darkest, most solid thing on the screen. */
export function Notice({ children, tone = 'quiet' }) {
  if (!children) return null
  const style = tone === 'loud'
    ? 'bg-neutral-900 text-white'
    : 'border border-neutral-200 bg-neutral-50 text-neutral-700'
  return <div className={`rounded-lg px-4 py-3 text-sm ${style}`}>{children}</div>
}

/** Work in progress, without a spinner shouting about it. */
export function Pulse({ children }) {
  return (
    <span className="inline-flex items-center gap-2.5 text-sm text-neutral-500">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neutral-400" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-neutral-900" />
      </span>
      {children}
    </span>
  )
}

/** Small caps label — the only decorative typography in the product. */
export function Eyebrow({ children, className = '' }) {
  return (
    <p className={`text-[11px] font-medium uppercase tracking-[0.14em] text-neutral-400 ${className}`}>
      {children}
    </p>
  )
}
