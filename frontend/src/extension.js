// Talks to the AnswerBank Chrome extension from the page.
//
// The extension's content script (content/bridge.js) runs on this origin and relays to
// its service worker. That's the whole reason there's no pairing step: the extension
// reads the session we're already signed in with, and the app drives the run from here
// instead of from a separate popup.

import { tokens } from './api'

const TAG = 'answerbank'
let seq = 0

/** Installed? The bridge stamps the <html> element at document_start, so this is
 *  synchronous and safe to call during render. */
export function extensionVersion() {
  return document.documentElement.getAttribute('data-answerbank-ext')
}

export const isInstalled = () => !!extensionVersion()

function call(type, payload, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    if (!isInstalled()) return reject(new Error('Extension not installed'))
    const id = `${TAG}-${++seq}`
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage)
      reject(new Error('The extension did not respond. Try reloading this page.'))
    }, timeoutMs)

    function onMessage(event) {
      const d = event.data
      if (event.source !== window || !d || d.tag !== TAG || d.dir !== 'to-page' || d.id !== id) return
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
      const r = d.response
      if (r && r.ok === false) reject(new Error(r.error || 'Extension error'))
      else resolve(r)
    }

    window.addEventListener('message', onMessage)
    window.postMessage({ tag: TAG, dir: 'to-ext', id, type, payload }, window.location.origin)
  })
}

/** Start answering a bank. Hands the extension this session so it can talk to our API. */
export function startRun(projectId) {
  return call('AB_START', {
    projectId,
    apiBase: window.location.origin,
    access: tokens.access,
    refresh: tokens.refresh,
  })
}

export const stopRun = () => call('AB_STOP')
export const getStatus = () => call('AB_STATUS')

/** Live progress while a run is going. Returns an unsubscribe function. */
export function onProgress(handler) {
  const listener = (event) => {
    const d = event.data
    if (event.source !== window || !d || d.tag !== TAG || d.dir !== 'to-page') return
    if (d.event === 'state') handler(d.state)
  }
  window.addEventListener('message', listener)
  return () => window.removeEventListener('message', listener)
}
