// Prism — doctor. Paste into the DevTools console ON THE PRISM PAGE (localhost:5173).
// Tells you in one shot why a run isn't starting.
(async () => {
  const line = (label, ok, detail) =>
    console.log(`%c${ok ? '  OK  ' : ' FAIL '}%c ${label.padEnd(26)} ${detail}`,
      `background:${ok ? '#065f46' : '#7f1d1d'};color:#fff;font-weight:bold`, '')

  console.log('%cPrism doctor', 'font-size:14px;font-weight:bold')

  // 1. which origin are we on — the extension is injected per-origin
  const origin = location.origin
  line('page origin', true, origin)

  // 2. is the bridge content script here?
  const ver = document.documentElement.getAttribute('data-prism-ext')
  line('extension injected', !!ver, ver ? `v${ver}` : 'NOT FOUND — see notes below')

  // 3. is the API up?
  let api = 'unreachable'
  let apiOk = false
  try {
    const r = await fetch('/api/health')
    api = `HTTP ${r.status} ${JSON.stringify(await r.json())}`
    apiOk = r.ok
  } catch (e) { api = String(e.message || e) }
  line('backend /api/health', apiOk, api)

  // 4. are we signed in?
  const tok = localStorage.getItem('ab_access')
  line('signed in', !!tok, tok ? 'session token present' : 'no token — sign in first')

  // 5. can the page actually talk to the extension?
  if (ver) {
    const reply = await new Promise((resolve) => {
      const id = 'doctor-' + Date.now()
      const t = setTimeout(() => resolve(null), 4000)
      const onMsg = (e) => {
        const d = e.data
        if (e.source === window && d && d.tag === 'prism' && d.dir === 'to-page' && d.id === id) {
          clearTimeout(t); window.removeEventListener('message', onMsg); resolve(d.response)
        }
      }
      window.addEventListener('message', onMsg)
      window.postMessage({ tag: 'prism', dir: 'to-ext', id, type: 'AB_STATUS' }, origin)
    })
    line('extension responds', !!reply, reply ? JSON.stringify(reply.state || reply) : 'no reply in 4s')
  }

  console.log('\n%cWhat to do', 'font-weight:bold')
  if (!ver) {
    console.log('• The extension is not injected on this origin.')
    console.log('  - Are you on http://localhost:5173 ? (127.0.0.1 is a DIFFERENT origin to Chrome)')
    console.log('  - chrome://extensions — is "Prism Runner" listed and enabled?')
    console.log('  - After installing or updating it, RELOAD this page.')
  } else if (!apiOk) {
    console.log('• The backend is down. Start it:  cd backend && .venv/bin/uvicorn app.main:app --port 8000')
  } else if (!tok) {
    console.log('• Sign in, then re-run this.')
  } else {
    console.log('• All green. If tabs still do not open, open the service worker console:')
    console.log('  chrome://extensions -> Prism Runner -> "service worker", then start a run.')
  }
})()
