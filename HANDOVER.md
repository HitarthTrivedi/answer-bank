# AnswerBank — Handover

Read this first. It covers what works, what doesn't, what's deliberately the way it is,
and what to do next in priority order.

**Status: the browser-only engine is wired end to end. Not yet launchable.** One blocker
(P0-1) stands between this and a real student using it.

---

## 1. What it is

Students upload a question bank (PDF / DOCX / image / pasted text). AnswerBank answers it
**one question at a time** — because dumping 40 questions into a chatbot ruins answers
25–40 — routing each question to the AI best suited to its type, then exports the lot as a
polished DOCX with working, code, plots and diagrams.

**The server never calls a model.** There are no AI keys and no provider code. Every
answer is produced by the student's own ChatGPT / Claude / Gemini session, driven by the
Chrome extension. What runs server-side is deterministic: regex extraction, keyword
routing, SymPy verification, DOCX assembly.

**Business model:** answering is free, the DOCX download costs ₹20 (1 credit). First bank
free. See §6.

---

## 2. Run it in five minutes

```bash
# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env
.venv/bin/uvicorn app.main:app --port 8000

# frontend (second terminal)
cd frontend && npm install && npm run dev      # http://localhost:5173
```

Then **install the extension — it is the engine, not an add-on**: `chrome://extensions` →
Developer mode → Load unpacked → pick `extension/`. Reload the app; the header reads
*Extension ready*. There is nothing to connect afterwards (see §7).

`MOCK_PAYMENTS=true` means the ₹20 checkout completes with no gateway account. Register,
upload `sample_question_bank.txt`, review, press **Answer with my AI**, watch it work,
export, pay the mock ₹20, get the DOCX.

Without the extension nothing breaks — every question just shows a ready-made prompt to
paste into any AI tab by hand.

```bash
cd backend && .venv/bin/python -m pytest tests/ -q   # 21 tests
cd extension && npm install && npm test              # 10 tests
```

---

## 3. How it works

```
upload → extract questions (regex) → student reviews/edits → sequential queue:
  ┌ per question ┐
  │ class cache? ─ hit → instant answer (free; outranks everything below)
  │ router agent ─ keyword classify: numerical | code | graph | diagram | theory
  │ else         ─ park the crafted prompt as `assist_waiting`
  │                  → extension opens a FRESH ChatGPT/Claude/Gemini chat, pastes it,
  │                    reads the reply back, posts it to /assist
  │                  → or the student pastes it by hand — same prompt, same result
  │ verify       ─ numericals re-computed with SymPy → ✓ / ⚠ badge
  └ store → dashboard renders (KaTeX, code, mermaid, real plots)
→ DOCX export (cover, index, embedded figures) ── 🔒 1 credit
```

**One prompt contract.** The extension and a student pasting by hand use the *same*
prompt from `solver.py`, so an answer renders and exports identically however it arrived.
The extension is a robot doing exactly what a human would do — which is why it needed
almost no new backend.

**The UX is one button.** Upload → review → **Answer with my AI** → export. No engine
choice, no pairing code, no popup: the extension's content script runs on the app's own
origin, so it reads the session the student is already signed in with and the app drives
the whole run from its own page. Installing the extension is the entire setup.

---

## 4. What's done

### Core (v0.1)
- Auth: scrypt passwords, JWT access + rotating opaque refresh tokens, rate limiting
- Upload: magic-byte validation, PDF/DOCX/TXT/image text extraction
- Question extraction (regex) with a **student review step before any answering starts** —
  extraction is never silently trusted, so a miss costs one edit, not a wrong answer
- Router agent → 5 question types, deciding prompt shape and target site
- Sequential worker; state in DB, so a restart resumes exactly where it stopped
- SymPy re-computation of numericals → verified ✓ / check-working ⚠ badge
- Class cache: identical questions answered once, served to every classmate
- Server-rendered matplotlib plots from declarative `graphspec` JSON; client-rendered
  mermaid posted back as PNG assets
- DOCX export: cover, index, embedded figures, per-answer credits
- Explain-me (ELI5) per answer

### Added this round
- **Export paywall.** One chokepoint: `backend/app/routers/projects.py` → `export_docx`.
  Unlocking is stored per bank (`Project.unlocked`), so **re-downloads are free forever** —
  you charge for the document, not the click. `FREE_BANKS=1` means the paywall only shows
  after the student has read every answer on screen.
- **Credit ledger** (`services/billing.py`) — append-only `CreditTxn`; `User.credits` is a
  cache the ledger can always rebuild.
- **Razorpay Payment Links** + a mock gateway (`services/payments.py`). No checkout SDK in
  the frontend, no card data near the server.
- **Chrome MV3 extension** (`extension/`) — answers questions in the AI tabs the student
  is already signed into, one fresh chat per question.
- **Zero-setup pairing.** `content/bridge.js` runs on the app's own origin, so the
  extension reads the existing session — no pairing code, no second login, no popup to
  visit. The app drives the run and shows live progress on its own page.
- **The server AI is gone.** No provider code, no `models.json`, no API keys, no quota.
  Extraction and routing are deterministic; `solver.py` only builds prompts now. If you
  need the old provider chain, it is in git history at `4247259`.
- **Server-side DOM selectors** (`backend/extension_selectors.json`) served at
  `/api/extension/config` — the site-redesign hotfix channel (§7).
- **Buyer's name on the DOCX cover** — mild anti-forwarding friction, not DRM.
- **SQLite column migration** (`db.migrate_columns`) — idempotent, runs on boot.
  Verified against a live DB with existing rows.
- **`tests/conftest.py`** — fixes a pre-existing bug where module-level env vars plus an
  `lru_cache`d settings object meant whichever test module imported first owned the app.
  Tests now pass in any order.

### Test coverage — 31 total
`backend` (21): auth + refresh rotation, upload magic bytes, extraction, SymPy
verification incl. injection payloads, class cache, prompt-injection envelope, the full
pipeline driven by a stand-in for the browser (`tests/helpers.py`), **proof that no
question is ever answered server-side**, **export paywall** (free → 402 → paid unlock →
free re-download), **webhook signature rejection**, **replay-safety** (a repeated callback
doesn't mint a second credit), **cross-account isolation**.

`extension` (10): the HTML→markdown converter — KaTeX → original LaTeX, code fences with
language tags, tables, nested lists, the `FINAL:` line the verifier reads, and that the
live DOM is never mutated.

---

## 5. What's left

### P0 — blocks a real student using this

**P0-1. Verify the extension's DOM selectors.** ~1 hour. **Nobody has run the extension
against a live site.** The selectors in `backend/extension_selectors.json` were written
from knowledge of these UIs, not tested — there was no logged-in ChatGPT/Claude/Gemini
session available. Until this is done the extension fails at `composer_not_found`.

For each site, open DevTools console and confirm:
```js
document.querySelector("#prompt-textarea")                    // composer
document.querySelector("button[data-testid='send-button']")   // send
document.querySelectorAll("[data-message-author-role='assistant']").length
```
Fix the JSON, restart the backend, re-run. No extension reinstall needed.

**P0-2. End-to-end extension run.** Load unpacked (`chrome://extensions` → Developer
mode → `extension/`), reload the app, run a 5-question bank, check the DOCX. Watch for: answers
truncated mid-generation (raise `settle_ms`), math arriving as unicode instead of LaTeX
(`content` selector is wrong), navigation not producing a fresh chat.

### P1 — before taking real money

| # | Task | Notes |
|---|---|---|
| P1-1 | Razorpay account + keys | KYC needs PAN + bank. Webhook → `<domain>/api/billing/webhook`, subscribe `payment_link.paid`. Set `MOCK_PAYMENTS=false`. |
| P1-2 | Real `SECRET_KEY` | `python -c "import secrets; print(secrets.token_hex(32))"`. Boot logs a warning until you do. |
| P1-3 | Production `host_permissions` | `extension/manifest.json` only lists localhost. Add the API domain or the extension can't reach it. |
| P1-4 | Pin `EXTENSION_ORIGIN_REGEX` | To the real extension ID once Chrome assigns one. |
| P1-5 | Email verification + password reset | Not built. Currently anyone can register with any address. |
| P1-6 | Refund path | `CreditTxn` supports `reason="refund"` but nothing calls it. Decide the policy first. |
| P1-7 | Work through `SECURITY_AUDIT.md` | Pre-launch checklist already written. |

### P2 — scale and polish

- **Postgres + Redis.** SQLite is a config-only swap (`DATABASE_URL`), but
  `db.migrate_columns()` is SQLite-only and no-ops elsewhere — bring in Alembic before
  the move. The rate limiter is in-memory per process and won't survive multi-node either.
- PDF export; scanned-PDF and image OCR (needs tesseract)
- Per-course spaces / shared class libraries on top of the answer cache
- "Important questions" prediction from past papers
- Frontend bundle is 1.4 MB (mermaid). Code-split it.
- The extension has no retry — a failed question is skipped after logging and stays
  `assist_waiting` for manual paste. Consider one automatic retry.

---

## 6. The business model, and why it's shaped this way

**₹20 per question bank. Answering free, download paid.**

- **The paywall sits on export, not on answering.** They see every answer on screen
  first. Paying after you've seen the goods converts far better than paying before.
- **Unlock is per bank, not per download.** Charging twice for the same document is how
  you get chargebacks and bad word of mouth.
- **The class cache is the actual business.** Student #1 from a class costs compute;
  students #2–30 hit the cache and cost nothing. Thirty ₹20 sales on one bank's work.
  Anything that raises cache hit rate (course codes on upload, sharing prompts, referrals)
  is worth more than anything that raises price.
- **Credit packs exist to cut payment friction, not to discount.** Every separate ₹20 is
  its own UPI approval, and that friction is what loses sales. Packs are in
  `CREDIT_PACKS` in `.env` — tune freely, no code change.
- **Extension mode costs zero inference** — it's the student's own ChatGPT/Gemini
  subscription, which is also a *better model* than any free API tier.

**Trust boundary:** the browser can start an order, never finish one. Credits are granted
in exactly one function, `billing._grant`, reached only by a signature-verified webhook.
Two tests enforce this. Do not add a "mark as paid" endpoint.

---

## 7. Design decisions — please don't undo these

**One question at a time, fresh chat every time.** It costs seconds and it *is* the
product — 40 questions in one thread is the exact failure this exists to fix. The
extension navigates to a new chat before every prompt for this reason.

**No server-side AI, deliberately.** Answers come only from the student's own browser
session. Don't "helpfully" add an API fallback for questions the extension fails on —
they stay `assist_waiting` on purpose, visible in the app for a manual paste.

**The extension has no settings screen.** Which AI sites are usable is discovered by
trying: a site that reports "not signed in" is dropped for the rest of the run and the
next question picks another. Don't add checkboxes.

**Selectors live on the server, not in the extension.** When ChatGPT renames a button you
edit `backend/extension_selectors.json` and every installed extension picks it up on its
next run. Nobody reinstalls anything. Never hardcode a selector in the extension.

**Completion is detected by output length going stable, not by the stop button.** The
button is an accelerator only, because it's the selector most likely to go stale. A wrong
`stop` selector costs speed, not correctness. Keep it that way.

**Cache outranks everything.** A question the class already answered costs nobody a trip
through the browser at all. There's a test on this.

**No model-generated code is ever executed.** Graphs are declarative JSON rendered
server-side with matplotlib; numerical verification runs allowlisted arithmetic through
SymPy. Uploaded text is wrapped in `<question>` tags and declared data, never instructions.

**The extension holds nothing worth stealing.** No question bank, no prompt templates, no
document builder, no API keys — it receives one prompt at a time. This is *why* the
paywall can't be bypassed by tampering with it. Don't move logic into it.

**The prompt is the product.** `solver.py` is the only lever on answer quality now that
we don't choose the model. Treat changes there as product changes, not refactors.

---

## 8. Known risks

**Automating ChatGPT / Claude / Gemini web violates all three of their ToS.** This is a
product decision that was made with eyes open, not an oversight. Tell students plainly.
Gemini is the one to flag hardest — that's their *Google account*, not a throwaway. The
manual paste-back path exists precisely so nobody is forced into this.

**The Chrome Web Store rejects extensions that automate third-party services.** Plan on
load-unpacked or a self-hosted CRX, not a store listing.

**Free web tiers have message caps.** A 40-question bank can exhaust them mid-run.
Failures degrade gracefully — the question stays `assist_waiting` and is pasteable by
hand — but expect it.

**Selector rot is permanent maintenance.** Three companies redesign without warning. The
server-side config makes each break a one-file fix, but somebody has to own noticing.

**Academic integrity.** Position as revision material, not "submit this". Changes nothing
technically; matters if a college asks.

---

## 9. Repo map

```
backend/
  app/main.py               FastAPI app, middleware, lifespan (starts the worker)
  app/config.py             settings (.env) — limits + billing (no AI keys anywhere)
  app/db.py                 engine, session, migrate_columns()
  app/models.py             SQLAlchemy schema
  app/security.py           scrypt, JWT, refresh rotation, rate limit, headers
  app/routers/
    auth.py                 register / login / refresh / logout / me
    projects.py             upload, review, start, assist, explain, assets, EXPORT 🔒
    billing.py              balance, checkout, webhook, mock gateway
    extension.py            selector config + the work queue
  app/services/
    ingest.py               file validation + text extraction
    extractor.py            raw text → questions (regex)
    router_agent.py         question → type classification (keywords)
    solver.py               prompt construction — the whole quality lever
    verify.py               SymPy numerical re-computation (allowlisted)
    diagrams.py             graphspec → matplotlib PNG, mathtext renderer
    cache.py                class-wide answer cache
    queue.py                the one-question-at-a-time worker
    export.py               markdown → DOCX
    billing.py              credit ledger + export paywall
    payments.py             Razorpay payment links + mock gateway
  extension_selectors.json  DOM contract for the extension ← the hotfix channel
frontend/                   Vite + React + Tailwind
extension/                  Chrome MV3 — see extension/README.md
SECURITY_AUDIT.md           implemented controls + pre-launch checklist
```

**Where to start reading:** `services/queue.py` (the core mechanic), then `solver.py`
(the prompt contract everything shares), then `services/billing.py` (the money).
