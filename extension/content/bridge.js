// Runs on the AnswerBank web app's own origin. This file is why there is no setup.
//
// Because it shares an origin with the app, it can read the session the student is
// already signed in with — no pairing code, no second login, nothing to type. And it
// lets the app drive the whole run from its own page, so the extension popup is
// optional rather than a second place the student has to go.
//
// The page and the service worker can't talk directly, so this relays both ways:
//   page  --window.postMessage-->  bridge  --chrome.runtime-->  service worker
//
// It relays a fixed set of message types and nothing else. The page can ask the worker
// to start, stop or report; it can't reach any other extension API through here.

const ALLOWED = new Set(['AB_PING', 'AB_START', 'AB_STOP', 'AB_STATUS'])
const TAG = 'answerbank'

// Synchronous marker so the app can tell "installed" from "not installed" on first
// paint, without waiting for a round trip.
document.documentElement.setAttribute('data-answerbank-ext', chrome.runtime.getManifest().version)

window.addEventListener('message', (event) => {
  // only this page, in this window — never a frame or another origin
  if (event.source !== window) return
  const msg = event.data
  if (!msg || msg.tag !== TAG || msg.dir !== 'to-ext') return
  if (!ALLOWED.has(msg.type)) return

  chrome.runtime.sendMessage(msg.payload ? { type: msg.type, ...msg.payload } : { type: msg.type })
    .then((response) => reply(msg.id, response))
    .catch((e) => reply(msg.id, { ok: false, error: String(e && e.message ? e.message : e) }))
})

function reply(id, response) {
  window.postMessage({ tag: TAG, dir: 'to-page', id, response }, window.location.origin)
}

// live progress pushed from the worker while a run is going
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'AB_STATE') {
    window.postMessage({ tag: TAG, dir: 'to-page', event: 'state', state: msg.state },
                       window.location.origin)
  }
})
