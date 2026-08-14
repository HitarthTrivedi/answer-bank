// Read-only status panel. Every control lives in the web app — this exists so a student
// who clicks the toolbar icon out of habit sees progress instead of a dead end.

const $ = (id) => document.getElementById(id)
const APP_URL = 'http://localhost:5173/app'

function render(state) {
  const active = state.running || ['finished', 'error', 'stopped', 'stopping'].includes(state.status)
  $('idle').hidden = active
  $('run').hidden = !active

  if (active) {
    $('title').textContent = state.projectTitle || 'Question bank'
    const pct = state.total ? Math.round((state.done / state.total) * 100) : 0
    $('fill').style.width = `${pct}%`
    $('fill').className = state.status === 'finished' ? 'done' : state.status === 'error' ? 'failed' : ''
    $('status').textContent =
      state.status === 'finished' ? `Done — ${state.done} of ${state.total} answered`
      : state.status === 'error' ? state.message
      : state.message || 'Working…'
  }

  const failed = state.errors || []
  $('errors').hidden = failed.length === 0
  if (failed.length) {
    $('errors').textContent =
      `${failed.length} question${failed.length === 1 ? '' : 's'} skipped — answer them by hand in the app.`
  }
}

$('open').onclick = (e) => {
  e.preventDefault()
  chrome.tabs.create({ url: APP_URL })
}

chrome.runtime.sendMessage({ type: 'AB_STATUS' }).then((res) => {
  if (res && res.ok) render(res.state)
})
chrome.runtime.sendMessage({ type: 'AB_PING' }).then((res) => {
  if (res && res.ok) $('version').textContent = `v${res.version}`
})
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AB_STATE') render(msg.state)
})
