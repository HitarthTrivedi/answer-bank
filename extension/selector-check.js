// Prism — selector check. Paste into the DevTools console on ChatGPT, Claude, Gemini.
// Generated from backend/extension_selectors.json; regenerate with:
//   node tools/gen-selector-check.mjs
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
    console.log('%cThis is not one of the sites Prism drives (ChatGPT, Claude, Gemini).', 'color:#c00');
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

  // ---- suggesting a fix -------------------------------------------------------
  // Prefer attributes a redesign is least likely to churn: data-testid, id, aria-label.
  // A generated class name works today and breaks next Tuesday.
  const describe = (el) => {
    if (el.dataset && el.dataset.testid) return el.tagName.toLowerCase() + '[data-testid="' + el.dataset.testid + '"]';
    if (el.id) return el.tagName.toLowerCase() + '#' + el.id;
    const aria = el.getAttribute('aria-label');
    if (aria) return el.tagName.toLowerCase() + '[aria-label="' + aria + '"]';
    const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean)[0];
    return el.tagName.toLowerCase() + (cls ? '.' + cls : '') + '   (no stable attribute — fragile)';
  };
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const composerCandidates = () =>
    [...document.querySelectorAll('[contenteditable="true"], textarea')]
      .filter(visible).slice(0, 6).map(describe);

  const buttonCandidates = (words) =>
    [...document.querySelectorAll('button, [role="button"]')]
      .filter(visible)
      .filter((b) => {
        const hay = ((b.getAttribute('aria-label') || '') + ' ' +
                     ((b.dataset && b.dataset.testid) || '') + ' ' +
                     (b.title || '')).toLowerCase();
        return words.some((w) => hay.includes(w));
      })
      .slice(0, 6).map(describe);

  // ---- the report -------------------------------------------------------------
  const composer = first(site.composer);
  const send = first(site.send);
  const stop = first(site.stop);
  const [turnSel, turns] = count(site.turn);
  const contentSel = first(site.content);
  const login = first(site.login_hint);

  const out = [];
  const say = (s) => { out.push(s); };

  say('=== PRISM SELECTOR CHECK — ' + site.label + ' (' + host + ') ===');
  say('composer   ' + (composer ? 'OK    ' + composer : 'FAIL  none of the configured selectors matched'));
  if (!composer) {
    say('           editable elements actually on this page:');
    composerCandidates().forEach((c) => say('             ' + c));
  }
  say('send       ' + (send ? 'OK    ' + send : 'FAIL  none of the configured selectors matched'));
  if (!send) {
    say('           buttons that look like send:');
    (buttonCandidates(['send', 'submit']).length
      ? buttonCandidates(['send', 'submit'])
      : ['(none — the send button often appears only once you type something)']
    ).forEach((c) => say('             ' + c));
  }
  say('stop       ' + (stop ? 'OK    ' + stop : 'not visible (only exists while it is generating — fine)'));
  say('turns      ' + (turns ? 'OK    ' + turnSel + '  (' + turns + ' found)'
                             : 'none yet — send one message by hand, then re-run'));
  say('content    ' + (contentSel ? 'OK    ' + contentSel
                                  : turns ? 'FAIL  answer body not found inside a turn' : 'untested (no turns yet)'));
  say('signed in  ' + (login ? 'NO — you look signed out, sign in and re-run' : 'yes'));
  say('attach     not tested yet — run  prism.attach()  to test the file upload path');

  const report = out.join('\n');
  console.log(report);

  if (!composer || !send) {
    console.log('%cFix backend/extension_selectors.json -> sites.' + key +
      ', then restart the backend. No extension reinstall needed.', 'color:#b45309');
  }

  // ---- the attach test --------------------------------------------------------
  // Document mode attaches the question paper to a fresh chat, and it does it the only
  // way that works on an editor like this: a synthetic paste carrying a File. Nothing
  // is sent — this drops a 1-page PDF into the composer so you can see whether the site
  // accepts it. Delete the attachment afterwards.
  window.prism = {
    report,
    attach() {
      const box = document.querySelector(site.composer.find((s) => document.querySelector(s)) || '');
      if (!box) return console.log('%cNo composer — fix that first.', 'color:#c00');
      const pdf = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
                  '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
                  '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
                  'trailer<</Root 1 0 R>>';
      const bytes = new Uint8Array([...pdf].map((c) => c.charCodeAt(0)));
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], 'prism-attach-test.pdf', { type: 'application/pdf' }));
      box.focus();
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      console.log('%cPasted a test PDF into the composer.', 'color:#0a0');
      console.log('Look at the message box: if a file chip/thumbnail appeared, document mode works ' +
                  'on ' + site.label + '. If nothing appeared, it does not — tell Prism and it will ' +
                  'route document questions elsewhere. Remove the attachment before you carry on.');
    },
    copy() {
      if (typeof copy === 'function') { copy(report); console.log('Report copied.'); }
      else console.log(report);
    },
  };
  console.log('%cRun prism.attach() to test file upload, prism.copy() to copy this report.', 'color:#666');
})();
