// Shown only when the extension is missing. Installing it is the entire setup — there is
// no account to connect and no code to type, because the extension reads the session
// from this very page.
//
// Chrome gives no way to install an unpacked extension from a link, so the shortest
// honest path is: download, unzip, drag the folder onto chrome://extensions. Dragging
// beats "Load unpacked" because it skips the file picker.
import { useState } from 'react'

export default function ExtensionNeeded({ compact = false }) {
  const [copied, setCopied] = useState(false)

  if (compact) {
    return (
      <span className="text-xs text-amber-400">
        Chrome extension not detected — install it to answer automatically
      </span>
    )
  }

  const copyChromeUrl = async () => {
    try {
      await navigator.clipboard.writeText('chrome://extensions')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the text is on screen anyway */ }
  }

  return (
    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-5">
      <p className="font-medium text-amber-200">One-time setup — about 30 seconds</p>
      <p className="mt-1 text-sm text-slate-400">
        The extension answers each question in the ChatGPT, Claude or Gemini tab you're
        already signed into. Nothing to connect afterwards: it picks up your session from
        this page.
      </p>

      <ol className="mt-4 space-y-3 text-sm">
        <li className="flex items-start gap-3">
          <Step n={1} />
          <div className="pt-0.5">
            <a
              href="/api/extension/download"
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-indigo-500"
            >
              ⬇ Download extension
            </a>
            <span className="ml-2 text-slate-400">then unzip it</span>
          </div>
        </li>

        <li className="flex items-start gap-3">
          <Step n={2} />
          <div className="pt-0.5 text-slate-300">
            Open{' '}
            <button
              onClick={copyChromeUrl}
              title="Chrome blocks links to chrome:// pages — copy and paste it"
              className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-200 hover:bg-slate-700"
            >
              {copied ? 'copied ✓' : 'chrome://extensions'}
            </button>{' '}
            and turn on <span className="font-medium">Developer mode</span> (top right)
          </div>
        </li>

        <li className="flex items-start gap-3">
          <Step n={3} />
          <div className="pt-0.5 text-slate-300">
            <span className="font-medium">Drag the unzipped folder</span> onto that page.
            <span className="block text-xs text-slate-500">
              Dragging is quicker than the “Load unpacked” button — same result.
            </span>
          </div>
        </li>

        <li className="flex items-start gap-3">
          <Step n={4} />
          <div className="pt-0.5 text-slate-300">
            Come back and refresh this page — the header will read{' '}
            <span className="text-emerald-400">● Extension ready</span>
          </div>
        </li>
      </ol>

      <p className="mt-4 text-xs text-slate-500">
        Not now? You can still start the bank — every question shows a ready-made prompt
        to paste into any AI tab by hand.
      </p>
    </div>
  )
}

function Step({ n }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-slate-300">
      {n}
    </span>
  )
}
