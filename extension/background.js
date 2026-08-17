// Orchestrator. Owns the run loop, the API session, and all the timers.
//
// Work arrives in batches spread across DIFFERENT assistants: three questions, three
// tabs, three AIs answering simultaneously. Two reasons, and the second matters more:
//
//   1. wall-clock — three answers per ~3 minutes instead of one;
//   2. rate limits — a 30-question bank becomes 10 each rather than 30 on one account,
//      so nobody's free message cap runs out mid-run.
//
// Every question still gets its own brand-new chat. Parallel across assistants is not
// the same thing as batching questions into one thread, which is the exact failure this
// product exists to fix — so we navigate to a fresh chat before every prompt.
//
// The session arrives from the app's own page via content/bridge.js, so there is nothing
// to pair and nothing to log into twice.

const state = {
  running: false,
  stopRequested: false,
  projectId: null,
  projectTitle: '',
  done: 0,
  total: 0,
  status: 'idle',
  message: '',
  errors: [],
  sitesUsed: [],
  active: [],   // what each tab is working on right now, for the app's progress panel
}

let session = null  // {apiBase, access, refresh} — pushed by the app page
let appTabId = null // the Prism tab that started the run, so progress goes back to it

// ---------------------------------------------------------------- plumbing

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function broadcast() {
  // the popup is an extension page, so runtime.sendMessage reaches it...
  chrome.runtime.sendMessage({ type: 'AB_STATE', state }).catch(() => { /* popup closed */ })
  // ...but a content script is NOT a runtime message target, so the app's bridge has to
  // be addressed by tab.
  if (appTabId !== null) {
    chrome.tabs.sendMessage(appTabId, { type: 'AB_STATE', state })
      .catch(() => { appTabId = null })  // tab closed or navigated away
  }
}

function setStatus(status, message = '') {
  state.status = status
  state.message = message
  broadcast()
}

async function apiFetch(path, opts = {}, retry = true) {
  if (!session) throw new Error('not_connected')
  const headers = { ...(opts.headers || {}), Authorization: `Bearer ${session.access}` }
  if (opts.body !== undefined && typeof opts.body !== 'string') {
    headers['Content-Type'] = 'application/json'
    opts = { ...opts, body: JSON.stringify(opts.body) }
  }

  const res = await fetch(`${session.apiBase}/api${path}`, { ...opts, headers })
  if (res.status === 401 && retry && (await refreshSession())) return apiFetch(path, opts, false)
  if (!res.ok) {
    let detail = res.statusText
    try { detail = (await res.json()).detail ?? detail } catch { /* not json */ }
    const err = new Error(typeof detail === 'string' ? detail : JSON.stringify(detail))
    err.status = res.status
    throw err
  }
  return res.status === 204 ? null : res.json()
}

async function refreshSession() {
  if (!session || !session.refresh) return false
  try {
    const res = await fetch(`${session.apiBase}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh }),
    })
    if (!res.ok) return false
    const data = await res.json()
    session.access = data.access_token
    session.refresh = data.refresh_token
    return true
  } catch { return false }
}

// ---------------------------------------------------------------- tabs

function tell(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message })
      else resolve(resp || { ok: false, error: 'no_response' })
    })
  })
}

/** Tabs currently answering a question. A batch can now put three questions on the SAME
 *  assistant — the router sends every diagram question to whoever reads diagrams best —
 *  and without this they would all grab the one open ChatGPT tab and overwrite each
 *  other's prompt. One question, one tab, always. */
const claimed = new Set()

async function findFreeTab(site) {
  for (const host of site.match) {
    const tabs = await chrome.tabs.query({ url: `*://${host}/*` })
    const free = tabs.find((t) => !claimed.has(t.id))
    if (free) return free
  }
  return null
}

/** A tab on `site`, parked on a brand-new empty chat, with the driver alive in it.
 *  Claimed for the caller until it calls `release`. */
async function freshChatTab(site) {
  let tab = await findFreeTab(site)
  if (!tab) tab = await chrome.tabs.create({ url: site.url, active: false })
  else await chrome.tabs.update(tab.id, { url: site.url })
  claimed.add(tab.id)

  try {
    for (let i = 0; i < 60; i++) {
      await sleep(500)
      let info
      try { info = await chrome.tabs.get(tab.id) } catch { throw new Error('tab_closed') }
      if (info.status !== 'complete') continue
      const ping = await tell(tab.id, { type: 'AB_PING', site })
      if (ping.ok && ping.loggedOut) throw new Error(`not_signed_in:${site.key}`)
      if (ping.ok && ping.hasComposer) return tab
    }
    throw new Error(`composer_never_appeared:${site.key}`)
  } catch (e) {
    claimed.delete(tab.id)   // a tab we never got working must not stay reserved
    throw e
  }
}

function release(tab) {
  if (tab) claimed.delete(tab.id)
}

// ---------------------------------------------------------------- the run loop

/** Lazily learned during a run: sites the student turns out not to be signed into. No
 *  settings screen, no checkboxes — we find out by trying, then tell the server to stop
 *  assigning work to them via ?exclude=. */
const unavailable = new Set()

async function waitForAnswer(tabId, cfg, site) {
  const deadline = Date.now() + (cfg.max_wait_s || 300) * 1000
  let lastLen = -1
  let stable = 0

  while (Date.now() < deadline) {
    if (state.stopRequested) throw new Error('stopped')
    await sleep(cfg.poll_ms || 1500)

    const p = await tell(tabId, { type: 'AB_PROBE', site })
    if (!p.ok) continue
    if (p.generating) { stable = 0; lastLen = p.length; continue }
    if (p.turns <= p.baseline || p.length === 0) continue

    // No stop-button AND the text stopped growing for two polls — it's finished.
    // Length-stability is the real signal; the stop button is only an accelerator,
    // because it's the selector most likely to be stale.
    if (p.length === lastLen) {
      if (++stable >= 2) {
        await sleep(cfg.settle_ms || 1200)
        const final = await tell(tabId, { type: 'AB_PROBE', site })
        return final.ok && final.markdown ? final.markdown : p.markdown
      }
    } else {
      stable = 0
    }
    lastLen = p.length
  }
  throw new Error('timed_out_waiting_for_answer')
}

/** Fetch the project's source file as base64, so it can be attached to a chat. */
async function fetchDocument(url) {
  const res = await fetch(`${session.apiBase}${url}`, {
    headers: { Authorization: `Bearer ${session.access}` },
  })
  if (!res.ok) throw new Error(`document_fetch_failed_${res.status}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  let bin = ''
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000))
  }
  return { data: btoa(bin), mime: res.headers.get('content-type') || 'application/pdf' }
}

/** One prompt, one brand-new chat, one answer back. The single primitive both paths use.
 *
 *  `doc` attaches the whole question paper before sending — that is how figures, graphs,
 *  circuits and scanned layouts get answered without us ever interpreting a pixel.
 *  Extracting an image and pasting it would mean guessing which picture belongs to which
 *  question; the document already answers that, and the model reading it judges it far
 *  better than any anchoring heuristic. */
async function ask(item, cfg, sites, { prompt, doc, figures }) {
  const site = { key: item.site, ...sites[item.site] }
  const tab = await freshChatTab(site)
  try {
    if (doc) {
      const file = await fetchDocument(doc.url)
      const attached = await tell(tab.id, {
        type: 'AB_ATTACH', site, data: file.data, mime: file.mime, filename: doc.filename,
      })
      if (!attached.ok) throw new Error(attached.error)
      await sleep(cfg.upload_settle_ms || 4000)  // the upload must finish before a send lands
    }

    const sent = await tell(tab.id, { type: 'AB_SEND', text: prompt, site, figures: figures || [] })
    if (!sent.ok) throw new Error(sent.error)

    const markdown = await waitForAnswer(tab.id, cfg, site)
    if (!markdown || markdown.length < 10) throw new Error('empty_answer')
    return markdown
  } finally {
    release(tab)
  }
}

/** Answer one question start-to-finish, preferring the paper itself when we have it.
 *
 *  A paper the AI can't locate the question in isn't a lost question: it says NOT_FOUND
 *  and we retry once from the extracted text, with any figure we managed to anchor. */
async function submitAnswer(item, markdown) {
  await apiFetch(`/questions/${item.question_id}/assist`, {
    method: 'POST', body: { content_md: markdown },
  })
}

async function answerOne(item, cfg, sites) {
  // First try: against the paper itself, when there is one. Two ways that can come back
  // useless — the AI says NOT_FOUND, or it writes a polite "I can't see the file" that
  // the SERVER refuses with a 422 (a refusal accepted as an answer once got cached and
  // served to a whole class). Both mean the same thing: retry once from the extracted
  // text, in a fresh chat, with any figure we anchored.
  if (item.document) {
    const markdown = await ask(item, cfg, sites, {
      prompt: item.prompt, doc: item.document, figures: [],
    })
    if (!markdown.trim().startsWith('NOT_FOUND')) {
      try {
        await submitAnswer(item, markdown)
        return { key: item.site, ...sites[item.site] }
      } catch (e) {
        if (e.status !== 422) throw e   // 422 = the server judged it a non-answer
      }
    }
  }

  const markdown = await ask(item, cfg, sites, {
    prompt: item.fallback_prompt || item.prompt,
    figures: item.figures || [],
  })
  await submitAnswer(item, markdown)
  return { key: item.site, ...sites[item.site] }
}

async function runLoop() {
  const cfg = await apiFetch('/extension/config')
  unavailable.clear()
  claimed.clear()   // a previous run that was stopped mid-answer must not reserve tabs forever
  state.sitesUsed = []

  while (state.running && !state.stopRequested) {
    const exclude = [...unavailable].join(',')
    const res = await apiFetch(
      `/extension/batch?project_id=${encodeURIComponent(state.projectId)}` +
      (exclude ? `&exclude=${encodeURIComponent(exclude)}` : ''))

    if (res.error === 'no_sites_available') {
      throw new Error("You're not signed in to ChatGPT, Claude or Gemini in this browser. " +
                      'Sign in to any one of them and press Start again.')
    }
    if (res.done || !res.batch.length) { setStatus('finished', 'All questions answered'); break }

    const batch = res.batch
    state.total = batch[0].total
    state.projectTitle = batch[0].project_title
    state.done = state.total - res.waiting - batch.length
    state.active = batch.map((b) => ({
      idx: b.idx, site: cfg.sites[b.site].label, doc: !!b.document,
    }))
    setStatus('running', batch.length === 1
      ? `Question ${batch[0].idx} of ${state.total} → ${cfg.sites[batch[0].site].label}`
      : `Questions ${batch.map((b) => b.idx).join(', ')} of ${state.total} — ` +
        `${batch.map((b) => cfg.sites[b.site].label).join(', ')} answering together`)

    // all three run at once; Promise.allSettled so one bad tab can't sink the batch
    const results = await Promise.allSettled(batch.map((item) => answerOne(item, cfg, cfg.sites)))

    let progressed = false
    results.forEach((r, i) => {
      const item = batch[i]
      if (r.status === 'fulfilled') {
        state.done += 1
        progressed = true
        const label = cfg.sites[item.site].label
        if (!state.sitesUsed.includes(label)) state.sitesUsed.push(label)
        return
      }
      const msg = String(r.reason && r.reason.message ? r.reason.message : r.reason)
      if (msg.startsWith('not_signed_in:')) {
        // drop that assistant for the rest of the run; its questions go back in the pool
        // when the lease expires, and the next batch routes them elsewhere
        unavailable.add(msg.split(':')[1])
        return
      }
      if (msg !== 'stopped') state.errors.push({ q: item.idx, error: msg })
    })

    state.active = []
    broadcast()

    if (state.stopRequested) break
    // nothing landed and nothing to retry with → stop rather than spin
    if (!progressed && unavailable.size >= Object.keys(cfg.sites).length) {
      throw new Error('None of your AI tabs could answer. Check you are signed in.')
    }
    if (state.errors.length >= 5) throw new Error('Too many questions failed.')
    if (!progressed) await sleep(1500)
  }
}

async function start(projectId) {
  if (state.running) return
  Object.assign(state, {
    running: true, stopRequested: false, projectId,
    done: 0, total: 0, errors: [], sitesUsed: [], active: [], status: 'running', message: 'Starting…',
  })
  broadcast()
  try {
    await runLoop()
    if (state.status !== 'finished') setStatus('stopped', 'Stopped')
  } catch (e) {
    setStatus('error', String(e.message || e))
  } finally {
    state.running = false
    broadcast()
  }
}

// ---------------------------------------------------------------- messages

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  ;(async () => {
    try {
      switch (msg.type) {
        case 'AB_PING':
          respond({ ok: true, version: chrome.runtime.getManifest().version })
          break
        case 'AB_STATUS':
          respond({ ok: true, state, connected: !!session })
          break
        case 'AB_START':
          // the page hands over its own session — same origin, nothing to pair
          session = { apiBase: (msg.apiBase || '').replace(/\/$/, ''), access: msg.access, refresh: msg.refresh }
          if (sender.tab) appTabId = sender.tab.id  // send progress back to this tab
          start(msg.projectId)
          respond({ ok: true })
          break
        case 'AB_STOP':
          state.stopRequested = true
          setStatus('stopping', 'Finishing the current question…')
          respond({ ok: true })
          break
        default:
          respond({ ok: false, error: 'unknown_message' })
      }
    } catch (e) {
      respond({ ok: false, error: String(e.message || e) })
    }
  })()
  return true  // async respond
})
