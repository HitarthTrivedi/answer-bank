// Prism — selector check. Paste into the DevTools console on chatgpt.com,
// claude.ai or gemini.google.com. Generated from backend/extension_selectors.json;
// regenerate with: node tools/gen-selector-check.mjs
(() => {
  const SITES = {
  "chatgpt": {
    "label": "ChatGPT",
    "match": [
      "chatgpt.com",
      "chat.openai.com"
    ],
    "composer": [
      "#prompt-textarea",
      "div[contenteditable='true']#prompt-textarea",
      "textarea[data-id]"
    ],
    "send": [
      "button[data-testid='send-button']",
      "#composer-submit-button",
      "button[aria-label*='Send']"
    ],
    "stop": [
      "button[data-testid='stop-button']",
      "button[aria-label*='Stop']"
    ],
    "turn": [
      "[data-message-author-role='assistant']"
    ],
    "content": [
      ".markdown",
      ".prose"
    ],
    "login_hint": [
      "a[href*='/auth/login']",
      "button[data-testid='login-button']"
    ]
  },
  "claude": {
    "label": "Claude",
    "match": [
      "claude.ai"
    ],
    "composer": [
      "div[contenteditable='true'].ProseMirror",
      "fieldset div[contenteditable='true']",
      "div[contenteditable='true']"
    ],
    "send": [
      "button[aria-label='Send message']",
      "button[aria-label*='Send']",
      "button[type='submit']"
    ],
    "stop": [
      "button[aria-label*='Stop']"
    ],
    "turn": [
      ".font-claude-message",
      "[data-is-streaming]"
    ],
    "content": [
      ".font-claude-message",
      ":scope"
    ],
    "login_hint": [
      "button[data-testid='login-with-google']",
      "a[href*='/login']"
    ]
  },
  "gemini": {
    "label": "Gemini",
    "match": [
      "gemini.google.com"
    ],
    "composer": [
      "rich-textarea .ql-editor",
      "div.ql-editor[contenteditable='true']",
      "div[contenteditable='true']"
    ],
    "send": [
      "button.send-button",
      "button[aria-label*='Send']"
    ],
    "stop": [
      "button[aria-label*='Stop']",
      "button.stop-icon"
    ],
    "turn": [
      "model-response",
      "message-content"
    ],
    "content": [
      "message-content",
      ".model-response-text",
      ":scope"
    ],
    "login_hint": [
      "a[href*='accounts.google.com']"
    ]
  }
};

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
