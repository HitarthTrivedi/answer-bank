// node --test test/manifest.test.js
//
// Chrome will not tell you a manifest is bad until you try to load it, and then it tells
// you in a card on chrome://extensions that nobody is looking at. An unknown key inside a
// content_scripts entry makes the WHOLE extension fail to install — the symptom is simply
// "extension not installed", with the app quietly behaving as if it were never there.
// That cost a debugging session once; it does not get to happen twice.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const dir = new URL('../', import.meta.url)
const manifest = JSON.parse(readFileSync(new URL('manifest.json', dir), 'utf8'))

// Chrome rejects anything it doesn't recognise in these positions.
const TOP_LEVEL = new Set([
  'manifest_version', 'name', 'version', 'description', 'permissions', 'host_permissions',
  'optional_permissions', 'optional_host_permissions', 'background', 'action', 'icons',
  'content_scripts', 'web_accessible_resources', 'options_page', 'options_ui', 'commands',
  'default_locale', 'author', 'homepage_url', 'minimum_chrome_version', 'key',
  'content_security_policy', 'declarative_net_request', 'externally_connectable',
  'devtools_page', 'omnibox', 'side_panel', 'storage', 'update_url', 'short_name',
])
const CONTENT_SCRIPT = new Set([
  'matches', 'exclude_matches', 'css', 'js', 'run_at', 'all_frames', 'match_about_blank',
  'include_globs', 'exclude_globs', 'world', 'match_origin_as_fallback',
])

test('no unrecognised top-level keys', () => {
  const bad = Object.keys(manifest).filter((k) => !TOP_LEVEL.has(k))
  assert.deepEqual(bad, [], `Chrome will reject these: ${bad.join(', ')}`)
})

test('no unrecognised keys inside content_scripts — this one blocks installation', () => {
  manifest.content_scripts.forEach((cs, i) => {
    const bad = Object.keys(cs).filter((k) => !CONTENT_SCRIPT.has(k))
    assert.deepEqual(bad, [],
      `content_scripts[${i}] has ${bad.join(', ')} — the extension will refuse to load. ` +
      'Put the explanation in README.md instead.')
  })
})

test('every file the manifest points at exists', () => {
  const files = [manifest.background.service_worker, manifest.action.default_popup,
                 ...Object.values(manifest.icons),
                 ...manifest.content_scripts.flatMap((cs) => cs.js || [])]
  for (const f of files) {
    assert.ok(existsSync(new URL(f, dir)), `manifest references a missing file: ${f}`)
  }
})

test('the app bridge covers localhost AND 127.0.0.1', () => {
  // Chrome treats them as separate origins. Missing one leaves the extension silently
  // invisible on that URL: no error, no tabs, no clue.
  const bridge = manifest.content_scripts.find((cs) => cs.js.some((f) => f.includes('bridge')))
  assert.ok(bridge, 'no content script injects the app bridge')
  for (const host of ['localhost', '127.0.0.1']) {
    assert.ok(bridge.matches.some((m) => m.includes(host)),
      `the bridge does not inject on ${host} — the app cannot see the extension there`)
  }
})

test('host permissions cover every site a content script runs on', () => {
  const hosts = manifest.host_permissions.join(' ')
  for (const cs of manifest.content_scripts) {
    for (const m of cs.matches) {
      const origin = m.replace(/\/\*$/, '')
      assert.ok(hosts.includes(origin),
        `${m} is matched by a content script but missing from host_permissions`)
    }
  }
})
