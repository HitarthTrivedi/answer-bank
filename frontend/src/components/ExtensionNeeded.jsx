// Shown only when the extension is missing. Installing it is the entire setup — there is
// no account to connect and no code to type, because the extension reads the session
// from this very page.
export default function ExtensionNeeded({ compact = false }) {
  if (compact) {
    return (
      <span className="text-xs text-amber-400">
        Chrome extension not detected — install it to answer automatically
      </span>
    )
  }
  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5">
      <p className="font-medium text-amber-200">One-time setup: install the Chrome extension</p>
      <p className="mt-1 text-sm text-slate-400">
        It answers each question in the ChatGPT, Claude or Gemini tab you're already signed
        into. Nothing to connect afterwards — it picks up your session from this page.
      </p>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-300">
        <li>Open <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">chrome://extensions</code></li>
        <li>Turn on <span className="font-medium">Developer mode</span> (top right)</li>
        <li>Click <span className="font-medium">Load unpacked</span> and choose the <code className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">extension</code> folder</li>
        <li>Reload this page</li>
      </ol>
      <p className="mt-3 text-xs text-slate-500">
        Prefer not to install it? You can still start the bank and paste each answer in by
        hand — every question shows a ready-made prompt.
      </p>
    </div>
  )
}
