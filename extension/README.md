# AnswerBank Runner (Chrome extension)

Answers a question bank using the AI tabs the student is **already signed into** —
ChatGPT, Claude, Gemini — instead of an API key. It is a robot doing exactly what a
human does in Assist mode: take one prompt, paste it into a fresh chat, copy the answer
back.

## Install (development)

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → select this `extension/` folder
3. Click the AnswerBank icon → ⚙ → confirm the server URL (default `http://localhost:8000`)
4. In the web app: **Connect extension** → type the 8-character code into the popup
5. Upload a bank, pick **“Use my browser AI”** at the review step, then hit
   **Start answering** in the popup

## How it works

```
server                              extension                     student's browser
──────                              ─────────                     ─────────────────
GET /api/extension/work    ──────►  open a FRESH chat tab   ────► chatgpt.com / claude.ai
  {prompt, preferred_site}          paste prompt, click send
                                    poll until output stops
                                    DOM ──► markdown
POST /questions/{id}/assist ◄─────  answer
```

**A fresh chat per question, every time.** This costs a few seconds of navigation and is
non-negotiable: 40 questions in one thread is the exact failure AnswerBank exists to fix.

**The extension holds nothing worth stealing.** No question bank (the server extracted
it), no prompt templates (they live in `solver.py`), no document builder, no API keys.
It receives one prompt at a time and hands back one answer. Unplug the server and it's
an empty shell — which is also why the export paywall can't be bypassed by tampering
with it.

## The part that will break

`backend/extension_selectors.json` holds every CSS selector for all three sites. When
ChatGPT renames a button, **edit that file on the server** — every installed extension
picks it up on its next run. Nobody reinstalls anything.

The selectors shipped are best-effort and **must be verified against the live sites
before launch**. To check one: open the site, DevTools console, and run

```js
document.querySelector("#prompt-textarea")                   // composer
document.querySelector("button[data-testid='send-button']")  // send
document.querySelectorAll("[data-message-author-role='assistant']").length
```

Answer completion is detected primarily by **output length going stable for two polls**,
not by the stop button — the button is just an accelerator, because it's the selector
most likely to go stale. So a wrong `stop` selector degrades speed, not correctness.

## Tests

```bash
npm install     # jsdom, dev only
npm test        # the HTML → markdown converter
```

The converter is the only piece that decides answer *quality*. Its tests cover the
things a naive `innerText` scrape destroys: KaTeX → original LaTeX, code fences with
language tags, tables, nested lists, and the `FINAL:` line the numerical verifier reads.

## Before you ship this

- **Automating ChatGPT / Claude / Gemini web violates all three of their ToS.** Tell
  students plainly. Gemini is the one to flag hardest — that's their Google account,
  not a throwaway.
- Free web tiers have message caps. A 40-question bank can hit them mid-run; failed
  questions stay `assist_waiting` so they can be pasted by hand.
- The Chrome Web Store rejects extensions that automate third-party services. Plan on
  load-unpacked or a self-hosted CRX.
- Pin `EXTENSION_ORIGIN_REGEX` to your real extension ID before going public.
