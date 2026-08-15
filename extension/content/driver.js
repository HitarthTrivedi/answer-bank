// Runs inside chatgpt.com / claude.ai / gemini.google.com.
//
// Deliberately dumb: it answers discrete questions ("insert this", "what's on screen
// now?") and holds no timers of its own. The polling loop lives in the service worker,
// because Chrome throttles timers in background tabs to the point where a content-script
// loop would stall for minutes at a time.
//
// Every selector arrives from the server (backend/extension_selectors.json). Nothing
// about any site's DOM is hardcoded here — that's what makes a site redesign a
// server-side edit instead of a re-install for every student.

let SITE = null          // the site config block handed over by the worker
let baselineTurns = 0    // how many assistant turns existed before we sent — the new one is anything past this

function pick(selectors) {
  for (const sel of selectors || []) {
    try {
      const el = document.querySelector(sel)
      if (el) return el
    } catch { /* selector invalid on this page */ }
  }
  return null
}

function pickAll(selectors) {
  for (const sel of selectors || []) {
    try {
      const els = document.querySelectorAll(sel)
      if (els.length) return [...els]
    } catch { /* ignore */ }
  }
  return []
}

// ---------------------------------------------------------------- input

/** base64 -> File, so a figure can ride the same paste event as the prompt. */
function toFile(fig, i) {
  const bin = atob(fig.data)
  const bytes = new Uint8Array(bin.length)
  for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j)
  const ext = fig.mime === 'image/png' ? 'png' : 'jpg'
  return new File([bytes], `figure-${i + 1}.${ext}`, { type: fig.mime })
}

/** Attach the question's figures to the composer.
 *
 *  This is where the product gets its image handling for free: ChatGPT, Claude and
 *  Gemini all read a pasted image, and it's the student's own subscription paying for
 *  the vision. Our server never looks at the pixels. */
function attachFigures(el, figures) {
  if (!figures || !figures.length) return 0
  let attached = 0
  for (let i = 0; i < figures.length; i++) {
    try {
      const dt = new DataTransfer()
      dt.items.add(toFile(figures[i], i))
      el.focus()
      el.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt, bubbles: true, cancelable: true,
      }))
      attached++
    } catch (e) { /* a site that refuses images still gets the text */ }
  }
  return attached
}

// React/ProseMirror/Quill/Lexical all ignore direct .value or .textContent writes —
// their internal model never learns about the change and the send button stays disabled.
// A synthetic paste event is the one approach all four honour.
function insertText(el, text) {
  el.focus()
  try {
    const dt = new DataTransfer()
    dt.setData('text/plain', text)
    el.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    }))
  } catch { /* fall through */ }

  if (currentText(el).length >= text.length * 0.8) return true

  // fallback 1: execCommand still drives contenteditable correctly in Chrome
  el.focus()
  try { document.execCommand('insertText', false, text) } catch { /* ignore */ }
  if (currentText(el).length >= text.length * 0.8) return true

  // fallback 2: plain textarea with the native setter, so React sees the change
  if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement : HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
    setter.call(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return currentText(el).length > 0
  }
  return false
}

function currentText(el) {
  return (el.value !== undefined ? el.value : el.innerText) || ''
}

function clearComposer(el) {
  el.focus()
  try {
    document.execCommand('selectAll', false, null)
    document.execCommand('delete', false, null)
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------- reading

function assistantTurns() {
  return pickAll(SITE.turn)
}

function latestAnswerMarkdown() {
  const turns = assistantTurns()
  if (turns.length <= baselineTurns) return ''
  const turn = turns[turns.length - 1]
  let contentEl = turn
  for (const sel of SITE.content || []) {
    if (sel === ':scope') break
    try {
      const found = turn.querySelector(sel)
      if (found) { contentEl = found; break }
    } catch { /* ignore */ }
  }
  return self.htmlToMarkdown(contentEl)
}

function isGenerating() {
  if (pick(SITE.stop)) return true
  const turns = assistantTurns()
  const last = turns[turns.length - 1]
  return !!(last && last.closest('[data-is-streaming="true"]'))
}

function isLoggedOut() {
  return !pick(SITE.composer) && !!pick(SITE.login_hint)
}

// ---------------------------------------------------------------- message API

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  try {
    if (msg.type === 'AB_PING') {
      SITE = msg.site || SITE
      respond({
        ok: true,
        hasComposer: !!(SITE && pick(SITE.composer)),
        loggedOut: !!(SITE && isLoggedOut()),
      })
      return true
    }

    if (!SITE && msg.site) SITE = msg.site

    if (msg.type === 'AB_SEND') {
      SITE = msg.site
      const composer = pick(SITE.composer)
      if (!composer) { respond({ ok: false, error: 'composer_not_found' }); return true }
      if (isLoggedOut()) { respond({ ok: false, error: 'logged_out' }); return true }

      baselineTurns = assistantTurns().length
      clearComposer(composer)

      // figures first: the upload has to be accepted before we hit send, and pasting
      // text afterwards keeps the caret in the composer where the site expects it
      const attached = attachFigures(composer, msg.figures)

      const inserted = insertText(composer, msg.text)
      if (!inserted) { respond({ ok: false, error: 'insert_failed' }); return true }

      // an image upload needs a moment to land before the site will let you send
      const settleForUpload = attached ? 1500 : 200

      // the send button enables a tick after the editor model updates
      let tries = 0
      const clickSend = () => {
        const btn = pick(SITE.send)
        if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
          btn.click()
          respond({ ok: true, baseline: baselineTurns, figuresAttached: attached })
          return
        }
        if (++tries > 40) { respond({ ok: false, error: 'send_button_unavailable' }); return }
        setTimeout(clickSend, 150)
      }
      setTimeout(clickSend, settleForUpload)
      return true
    }

    if (msg.type === 'AB_PROBE') {
      const md = latestAnswerMarkdown()
      respond({
        ok: true,
        generating: isGenerating(),
        turns: assistantTurns().length,
        baseline: baselineTurns,
        length: md.length,
        markdown: md,
      })
      return true
    }

    respond({ ok: false, error: 'unknown_message' })
  } catch (e) {
    respond({ ok: false, error: String(e && e.message ? e.message : e) })
  }
  return true
})
