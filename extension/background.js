// Orchestrator. Owns the run loop, the API session, and all the timers.
//
// The loop mirrors the server's worker exactly: one question at a time, fresh chat per
// question. That second part is not an implementation detail — it IS the product. Forty
// questions pasted into one thread is precisely the failure AnswerBank exists to fix, so
// we navigate to a new chat before every single prompt even though it costs a few seconds.

const DEFAULTS = {
  apiBase: 'http://localhost:8000',
  sites: { chatgpt: true, claude: true, gemini: true },
}

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
}

// ---------------------------------------------------------------- storage

const store = {
  async get(keys) { return chrome.storage.local.get(keys) },
  async set(obj) { return chrome.storage.local.set(obj) },
}

async function settings() {
  const s = await store.get(['apiBase', 'sites'])
  return { ...DEFAULTS, ...s, sites: { ...DEFAULTS.sites, ...(s.sites || {}) } }
}

function broadcast() {
  chrome.runtime.sendMessage({ type: 'AB_STATE', state }).catch(() => { /* popup closed */ })
}

function setStatus(status, message = '') {
  state.status = status
  state.message = message
  broadcast()
}

// ---------------------------------------------------------------- API

async function apiFetch(path, opts = {}, retry = true) {
  const { apiBase } = await settings()
  const { access_token } = await store.get(['access_token'])
  const headers = { ...(opts.headers || {}) }
  if (access_token) headers.Authorization = `Bearer ${access_token}`
  if (opts.body !== undefined && typeof opts.body !== 'string') {
    headers['Content-Type'] = 'application/json'
    opts = { ...opts, body: JSON.stringify(opts.body) }
  }

  const res = await fetch(`${apiBase}/api${path}`, { ...opts, headers })
  if (res.status === 401 && retry && (await refreshSession())) {
    return apiFetch(path, opts, false)
  }
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
  const { apiBase } = await settings()
  const { refresh_token } = await store.get(['refresh_token'])
  if (!refresh_token) return false
  try {
    const res = await fetch(`${apiBase}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    })
    if (!res.ok) return false
    const data = await res.json()
    await store.set({ access_token: data.access_token, refresh_token: data.refresh_token })
    return true
  } catch { return false }
}

// ---------------------------------------------------------------- tabs

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function tell(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message })
      else resolve(resp || { ok: false, error: 'no_response' })
    })
  })
}

async function findTab(site) {
  for (const host of site.match) {
    const tabs = await chrome.tabs.query({ url: `*://${host}/*` })
    if (tabs.length) return tabs[0]
  }
  return null
}

/** A tab on `site`, parked on a brand-new empty chat, with the driver alive in it. */
async function freshChatTab(site) {
  let tab = await findTab(site)
  if (!tab) tab = await chrome.tabs.create({ url: site.url, active: false })
  else await chrome.tabs.update(tab.id, { url: site.url })

  // wait for load, then for the driver to answer, then for the composer to mount
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    let info
    try { info = await chrome.tabs.get(tab.id) } catch { throw new Error('tab_closed') }
    if (info.status !== 'complete') continue
    const ping = await tell(tab.id, { type: 'AB_PING', site })
    if (ping.ok && ping.loggedOut) throw new Error(`not_signed_in:${site.label}`)
    if (ping.ok && ping.hasComposer) return tab
  }
  throw new Error(`composer_never_appeared:${site.label}`)
}

// ---------------------------------------------------------------- the run loop

function chooseSite(cfg, preferred, enabled) {
  const order = [preferred, ...Object.keys(cfg.sites)]
  for (const key of order) {
    if (cfg.sites[key] && enabled[key]) return { key, ...cfg.sites[key] }
  }
  return null
}

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

    // no stop-button AND the text stopped growing for two polls — it's finished.
    // Length-stability is the real signal; the stop button is just an accelerator,
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

async function runLoop() {
  const cfg = await apiFetch('/extension/config')
  const { sites: enabled } = await settings()

  while (state.running && !state.stopRequested) {
    const work = await apiFetch(`/extension/work?project_id=${encodeURIComponent(state.projectId)}`)
    if (work.done) { setStatus('finished', 'All questions answered'); break }

    state.total = work.total
    state.done = work.total - work.waiting
    state.projectTitle = work.project_title

    const site = chooseSite(cfg, work.preferred_site, enabled)
    if (!site) throw new Error('No AI sites enabled — turn one on in the extension settings')

    setStatus('running', `Q${work.idx}/${work.total} → ${site.label}`)

    try {
      const tab = await freshChatTab(site)
      const sent = await tell(tab.id, { type: 'AB_SEND', text: work.prompt, site })
      if (!sent.ok) throw new Error(sent.error)

      const markdown = await waitForAnswer(tab.id, cfg, site)
      if (!markdown || markdown.length < 10) throw new Error('empty_answer')

      await apiFetch(`/questions/${work.question_id}/assist`, {
        method: 'POST', body: { content_md: markdown },
      })
      state.done += 1
      broadcast()
    } catch (e) {
      const msg = String(e.message || e)
      if (msg === 'stopped') break
      state.errors.push({ q: work.idx, error: msg })
      setStatus('running', `Q${work.idx} failed: ${msg} — skipping`)
      // a failed question stays assist_waiting, so it's still visible in the web app
      // for a manual paste. We move on rather than blocking the whole run on one bad DOM.
      if (state.errors.length >= 5) throw new Error('too_many_failures')
      await sleep(1500)
    }
  }
}

async function start(projectId) {
  if (state.running) return
  Object.assign(state, {
    running: true, stopRequested: false, projectId,
    done: 0, total: 0, errors: [], status: 'running', message: 'Starting…',
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

// ---------------------------------------------------------------- popup messages

chrome.runtime.onMessage.addListener((msg, _sender, respond) => {
  ;(async () => {
    try {
      switch (msg.type) {
        case 'AB_GET_STATE': {
          const { access_token, user } = await store.get(['access_token', 'user'])
          respond({ ok: true, state, connected: !!access_token, user: user || null,
                    settings: await settings() })
          break
        }
        case 'AB_PAIR': {
          const { apiBase } = await settings()
          const res = await fetch(`${apiBase}/api/extension/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: msg.code.trim().toUpperCase() }),
          })
          if (!res.ok) {
            let detail = 'Pairing failed'
            try { detail = (await res.json()).detail || detail } catch { /* ignore */ }
            respond({ ok: false, error: detail })
            break
          }
          const data = await res.json()
          await store.set({
            access_token: data.access_token,
            refresh_token: data.refresh_token,
            user: data.user,
          })
          respond({ ok: true, user: data.user })
          break
        }
        case 'AB_DISCONNECT':
          await chrome.storage.local.remove(['access_token', 'refresh_token', 'user'])
          respond({ ok: true })
          break
        case 'AB_PROJECTS':
          respond({ ok: true, projects: await apiFetch('/extension/projects') })
          break
        case 'AB_BALANCE':
          respond({ ok: true, balance: await apiFetch('/billing/me') })
          break
        case 'AB_START':
          start(msg.projectId)
          respond({ ok: true })
          break
        case 'AB_STOP':
          state.stopRequested = true
          setStatus('stopping', 'Finishing the current question…')
          respond({ ok: true })
          break
        case 'AB_SAVE_SETTINGS':
          await store.set({ apiBase: msg.apiBase, sites: msg.sites })
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
