// Thin view over the service worker. Holds no logic worth reverse-engineering — every
// decision (what to answer, what it costs, whether it's paid for) is made server-side.

const $ = (id) => document.getElementById(id)
const send = (msg) => chrome.runtime.sendMessage(msg)

const views = { connect: $('view-connect'), main: $('view-main'), settings: $('view-settings') }
function show(name) {
  for (const [key, el] of Object.entries(views)) el.hidden = key !== name
}

let current = { connected: false, settings: null }

// ---------------------------------------------------------------- render

function renderRun(state) {
  const busy = state.running || state.status === 'stopping'
  $('run').hidden = busy
  $('stop').hidden = !busy
  $('project').disabled = busy

  const active = busy || ['finished', 'error', 'stopped'].includes(state.status)
  $('progress-wrap').hidden = !active
  if (active) {
    const pct = state.total ? Math.round((state.done / state.total) * 100) : 0
    $('bar-fill').style.width = `${pct}%`
    $('bar-fill').classList.toggle('done', state.status === 'finished')
    $('status').textContent =
      state.status === 'finished' ? `Done — ${state.done}/${state.total} answered`
      : state.status === 'error' ? `Error: ${state.message}`
      : state.message || 'Working…'
  }

  const failed = state.errors || []
  $('errors').hidden = failed.length === 0
  if (failed.length) {
    $('errors').textContent =
      `${failed.length} question(s) skipped — answer them by hand in the web app.`
  }
}

async function loadProjects() {
  const res = await send({ type: 'AB_PROJECTS' })
  const select = $('project')
  if (!res.ok) {
    select.innerHTML = '<option>Could not reach the server</option>'
    $('run').disabled = true
    return
  }
  const withWork = res.projects.filter((p) => p.waiting > 0)
  if (!withWork.length) {
    select.innerHTML = '<option value="">Nothing waiting</option>'
    $('project-meta').textContent =
      'Upload a bank and start it in "use my browser AI" mode.'
    $('run').disabled = true
    return
  }
  $('run').disabled = false
  select.innerHTML = withWork
    .map((p) => `<option value="${p.id}">${p.title}</option>`).join('')
  const meta = () => {
    const p = withWork.find((x) => x.id === select.value)
    $('project-meta').textContent = p ? `${p.waiting} of ${p.total} questions waiting` : ''
  }
  select.onchange = meta
  meta()
}

async function loadBalance() {
  const res = await send({ type: 'AB_BALANCE' })
  if (!res.ok) return
  const { credits, free_banks_left } = res.balance
  $('credits').textContent = free_banks_left > 0
    ? `${free_banks_left} free` : `${credits} credit${credits === 1 ? '' : 's'}`
}

async function refresh() {
  const res = await send({ type: 'AB_GET_STATE' })
  if (!res || !res.ok) return
  current = res
  if (!res.connected) { show('connect'); return }

  show('main')
  $('who').textContent = res.user ? res.user.email : ''
  renderRun(res.state)
  await Promise.all([loadProjects(), loadBalance()])
}

// ---------------------------------------------------------------- events

$('pair').onclick = async () => {
  const code = $('code').value.trim()
  $('pair-error').hidden = true
  if (code.length !== 8) {
    $('pair-error').textContent = 'The code is 8 characters.'
    $('pair-error').hidden = false
    return
  }
  $('pair').disabled = true
  const res = await send({ type: 'AB_PAIR', code })
  $('pair').disabled = false
  if (!res.ok) {
    $('pair-error').textContent = res.error
    $('pair-error').hidden = false
    return
  }
  await refresh()
}

$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pair').click() })

$('run').onclick = async () => {
  const projectId = $('project').value
  if (!projectId) return
  await send({ type: 'AB_START', projectId })
  await refresh()
}

$('stop').onclick = async () => {
  await send({ type: 'AB_STOP' })
  await refresh()
}

$('gear').onclick = async () => {
  if (!views.settings.hidden) { await refresh(); return }
  const s = current.settings || {}
  $('api').value = s.apiBase || ''
  for (const box of document.querySelectorAll('[data-site]')) {
    box.checked = !!(s.sites || {})[box.dataset.site]
  }
  show('settings')
}

$('save').onclick = async () => {
  const sites = {}
  for (const box of document.querySelectorAll('[data-site]')) sites[box.dataset.site] = box.checked
  await send({ type: 'AB_SAVE_SETTINGS', apiBase: $('api').value.trim().replace(/\/$/, ''), sites })
  await refresh()
}

$('disconnect').onclick = async () => {
  await send({ type: 'AB_DISCONNECT' })
  await refresh()
}

// live progress while the popup is open
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AB_STATE' && !views.main.hidden) renderRun(msg.state)
})

refresh()
