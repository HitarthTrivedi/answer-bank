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

// ---------------------------------------------------------------- failure evidence
//
// When a selector misses, the driver is the only thing looking at the page — so a bare
// "composer_not_found" throws away the one chance to see WHY. These describe what is
// actually there, in the stable-attribute-first form a fixed selector would use, and the
// description rides the error back to the Prism server (the student's own backend, and
// nowhere else). Debugging a broken site then means reading the server log, not asking
// a student to open a console.

function describe(el) {
  if (el.dataset && el.dataset.testid) return `${el.tagName.toLowerCase()}[data-testid="${el.dataset.testid}"]`
  if (el.id) return `${el.tagName.toLowerCase()}#${el.id}`
  const aria = el.getAttribute('aria-label')
  if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria}"]`
  const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean)[0]
  return el.tagName.toLowerCase() + (cls ? '.' + cls : '')
}

function onPage(kind) {
  const seen = kind === 'composer'
    ? [...document.querySelectorAll('[contenteditable="true"], textarea')]
    : [...document.querySelectorAll('button, [role="button"]')].filter((b) => {
        const hay = ((b.getAttribute('aria-label') || '') + ' ' +
                     ((b.dataset && b.dataset.testid) || '')).toLowerCase()
        return hay.includes('send') || hay.includes('submit') || hay.includes('stop')
      })
  const visible = seen.filter((el) => {
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0
  })
  return visible.slice(0, 4).map(describe).join(', ') || 'nothing matching'
}

const missing = (what, kind) =>
  ({ ok: false, error: `${what} @ ${location.hostname} — on the page instead: ${onPage(kind)}` })

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
        // a brand-new chat has no assistant turns. If some are still on screen the site
        // hasn't finished switching away from the previous conversation — sending now
        // would land the prompt in the OLD thread, with the old context.
        turns: SITE ? assistantTurns().length : 0,
      })
      return true
    }

    // Name the window after the question it is working on, so three small windows
    // side by side read "Q4 → ChatGPT", "Q5 → Gemini", "Q6 → ChatGPT" instead of three
    // identical site titles. The sites rename their tab later; the probe re-asserts it.
    if (msg.label) document.title = msg.label

    if (!SITE && msg.site) SITE = msg.site

    // Attach the whole question paper, once, before a run of numbered questions.
    // Same synthetic-paste mechanism as a figure — the sites accept a File either way.
    if (msg.type === 'AB_ATTACH') {
      SITE = msg.site
      const composer = pick(SITE.composer)
      if (!composer) { respond(missing('composer_not_found', 'composer')); return true }
      try {
        const bin = atob(msg.data)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const dt = new DataTransfer()
        dt.items.add(new File([bytes], msg.filename || 'question-paper.pdf', { type: msg.mime }))
        composer.focus()
        composer.dispatchEvent(new ClipboardEvent('paste', {
          clipboardData: dt, bubbles: true, cancelable: true,
        }))
        respond({ ok: true })
      } catch (e) {
        respond({ ok: false, error: 'attach_failed:' + (e && e.message) })
      }
      return true
    }

    if (msg.type === 'AB_SEND') {
      SITE = msg.site
      const composer = pick(SITE.composer)
      if (!composer) { respond(missing('composer_not_found', 'composer')); return true }
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
        if (++tries > 40) { respond(missing('send_button_unavailable', 'button')); return }
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
        url: location.href,   // the chat this answer lives in — kept so the student can open it
      })
      return true
    }

    respond({ ok: false, error: 'unknown_message' })
  } catch (e) {
    respond({ ok: false, error: String(e && e.message ? e.message : e) })
  }
  return true
})
