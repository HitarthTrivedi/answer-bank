// Shown only when the extension is missing. Installing it is the entire setup — there is
// no account to connect and no code to type, because the extension reads the session from
// this very page.
//
// Chrome gives no way to install an unpacked extension from a link, so the shortest honest
// path is: download, unzip, drag the folder onto chrome://extensions. Dragging beats
// "Load unpacked" because it skips the file picker.
import { useState } from 'react'
import { Eyebrow, Text } from './ui'

const STEPS = [
  ['Download and unzip it', null],
  ['Open chrome://extensions and turn on Developer mode', 'chrome://extensions'],
  ['Drag the unzipped folder onto that page', null],
  ['Come back and refresh — that\'s it', null],
]

export default function ExtensionNeeded({ onManual }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText('chrome://extensions')
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard blocked — the address is on screen anyway */ }
  }

  return (
    <div>
      <Eyebrow>One-time setup · about 30 seconds</Eyebrow>
      <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-neutral-600">
        The extension answers each question in the ChatGPT, Claude or Gemini tab you're
        already signed into. There's nothing to connect afterwards — it picks up your
        session from this page.
      </p>

      <ol className="mt-8 space-y-4">
        {STEPS.map(([label, chrome], i) => (
          <li key={label} className="flex gap-4 text-[15px] text-neutral-700">
            <span className="w-4 shrink-0 tabular-nums text-neutral-300">{i + 1}</span>
            <span>
              {chrome ? (
                <>
                  Open{' '}
                  <button onClick={copy} title="Chrome blocks links to chrome:// pages — copy it"
                          className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5 font-mono text-[12px] hover:border-neutral-900">
                    {copied ? 'copied' : 'chrome://extensions'}
                  </button>{' '}
                  and turn on <span className="font-medium text-neutral-900">Developer mode</span>
                </>
              ) : label}
            </span>
          </li>
        ))}
      </ol>

      <div className="mt-8 flex flex-wrap items-center gap-6">
        <a href="/api/extension/download"
           className="inline-flex h-10 items-center rounded-lg bg-neutral-900 px-4 text-sm font-medium text-white transition hover:bg-neutral-700">
          Download the extension
        </a>
        {onManual && <Text onClick={onManual}>or answer this one by hand</Text>}
      </div>
    </div>
  )
}
