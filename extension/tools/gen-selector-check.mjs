// Regenerates selector-check.js from the live selector config.
//
//   node tools/gen-selector-check.mjs
//
// Run this whenever backend/extension_selectors.json changes, so the console check and
// the extension can never disagree about what they are looking for.
import { readFileSync, writeFileSync } from 'node:fs'

const cfg = JSON.parse(readFileSync(new URL('../../backend/extension_selectors.json', import.meta.url), 'utf8'))

const sites = Object.fromEntries(
  Object.entries(cfg.sites).map(([k, v]) => [k, {
    label: v.label, match: v.match,
    composer: v.composer, send: v.send, stop: v.stop,
    turn: v.turn, content: v.content, login_hint: v.login_hint,
  }]),
)

const script = `// Prism — selector check. Paste into the DevTools console on chatgpt.com,
// claude.ai or gemini.google.com. Generated from backend/extension_selectors.json;
// regenerate with: node tools/gen-selector-check.mjs
(() => {
  const SITES = ${JSON.stringify(sites, null, 2)};

  const host = location.hostname;
  const entry = Object.entries(SITES).find(([, s]) => s.match.some((m) => host.includes(m)));
  if (!entry) {
    console.log('%cNot one of the three AI sites Prism drives.', 'color:#f87171');
    return;
  }
  const [key, site] = entry;

  const first = (list) => {
    for (const sel of list || []) {
      try { if (document.querySelector(sel)) return sel; } catch { /* bad selector */ }
    }
    return null;
  };
  const count = (list) => {
    for (const sel of list || []) {
      try { const n = document.querySelectorAll(sel).length; if (n) return [sel, n]; } catch { /* */ }
    }
    return [null, 0];
  };

  const composer = first(site.composer);
  const send = first(site.send);
  const [turnSel, turns] = count(site.turn);
  const login = first(site.login_hint);
  const stop = first(site.stop);

  console.log('%cPrism selector check — ' + site.label, 'font-size:14px;font-weight:bold');
  const rows = [
    { what: 'composer (required)', ok: !!composer, matched: composer || '— NONE MATCHED —' },
    { what: 'send button (required)', ok: !!send, matched: send || '— NONE MATCHED —' },
    { what: 'assistant turns', ok: true, matched: (turnSel || 'none yet') + '  (found ' + turns + ')' },
    { what: 'stop button (optional)', ok: true, matched: stop || 'not visible (only shows while generating)' },
    { what: 'login hint', ok: true, matched: login ? login + '  <- YOU LOOK SIGNED OUT' : 'none (signed in)' },
  ];
  console.table(rows.map((r) => ({ check: r.what, status: r.ok ? 'OK' : 'FAIL', matched: r.matched })));

  if (!composer || !send) {
    console.log('%cFix backend/extension_selectors.json -> sites.' + key +
      ', then restart the backend. No extension reinstall needed.', 'color:#fbbf24');
    console.log('Tip: right-click the message box or send button -> Inspect, and copy a stable ' +
      'attribute (data-testid, aria-label, id) rather than a generated class name.');
  } else if (turns === 0) {
    console.log('%cComposer and send are fine. Send one message by hand, then re-run this ' +
      'to check the answer-reading selectors.', 'color:#93c5fd');
  } else {
    console.log('%cAll good — Prism can drive this site.', 'color:#34d399');
  }
})();
`

writeFileSync(new URL('../selector-check.js', import.meta.url), script)
console.log('wrote extension/selector-check.js')
