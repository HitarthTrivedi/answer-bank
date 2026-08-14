# AnswerBank — Handover

Read this first. It covers what works, what doesn't, what's deliberately the way it is,
and what to do next in priority order.

**Status: works end to end in mock mode. Not yet launchable.** One blocker (P0-1) stands
between this and a real student using it.

---

## 1. What it is

Students upload a question bank (PDF / DOCX / image / pasted text). AnswerBank answers it
**one question at a time** — because dumping 40 questions into a chatbot ruins answers
25–40 — routing each question to the AI best suited to its type, then exports the lot as a
polished DOCX with working, code, plots and diagrams.

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

Ships with `MOCK_LLM=true` and `MOCK_PAYMENTS=true`, so the whole product — including the
₹20 checkout — runs with **zero API keys and no payment account**. Register, upload
`sample_question_bank.txt`, watch it answer, hit export, pay the mock ₹20, get the DOCX.

```bash
cd backend && .venv/bin/python -m pytest tests/ -q   # 23 tests
cd extension && npm install && npm test              # 10 tests
```

---

## 3. How it works

```
upload → extract questions → student reviews/edits → picks who answers → sequential queue:
  ┌ per question ┐
  │ class cache? ─ hit → instant answer (free; outranks everything below)
  │ router agent ─ classifies: numerical | code | graph | diagram | theory
  │ engine_mode=auto      → solver chain: first provider with a key for that type
  │ engine_mode=extension → park for the student's own browser AI tabs
  │      └ no provider either way → Assist mode (crafted prompt, manual paste-back)
  │ verify       ─ numericals re-computed with SymPy → ✓ / ⚠ badge
  └ store → dashboard renders (KaTeX, code, mermaid, real plots)
→ DOCX export (cover, index, embedded figures) ── 🔒 1 credit
```

**Three ways to answer, one prompt contract.** Server APIs, the Chrome extension, and
manual paste-back all use the *same* crafted prompt from `solver.py`. An answer renders
and exports identically however it arrived. This is why the extension needed almost no
new backend — it's a robot doing what a human does in Assist mode.

---

## 4. What's done

### Core (v0.1)
- Auth: scrypt passwords, JWT access + rotating opaque refresh tokens, rate limiting
- Upload: magic-byte validation, PDF/DOCX/TXT/image text extraction
- Question extraction (LLM + regex fallback) with a **student review step before any
  quota is spent** — extraction is never silently trusted
- Router agent → 5 question types; per-type solver chains configured in `models.json`
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
  is already signed into. Pairs by 8-char single-use code, so it never sees the password.
- **`engine_mode`** on a project: `auto` (our APIs) or `extension` (their browser).
  Extension mode is exempt from the daily quota — it costs us no inference.
- **Server-side DOM selectors** (`backend/extension_selectors.json`) served at
  `/api/extension/config` — the site-redesign hotfix channel (§7).
- **Buyer's name on the DOCX cover** — mild anti-forwarding friction, not DRM.
- **SQLite column migration** (`db.migrate_columns`) — idempotent, runs on boot.
  Verified against a live DB with existing rows.
- **`tests/conftest.py`** — fixes a pre-existing bug where module-level env vars plus an
  `lru_cache`d settings object meant whichever test module imported first owned the app.
  Tests now pass in any order.

### Test coverage — 33 total
`backend` (23): auth + refresh rotation, upload magic bytes, extraction, SymPy
verification incl. injection payloads, class cache, prompt-injection envelope, full mock
pipeline, assist mode end to end, **export paywall** (free → 402 → paid unlock → free
re-download), **webhook signature rejection**, **replay-safety** (a repeated callback
doesn't mint a second credit), **pairing codes are single-use**, **cross-account
isolation**.

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
mode → `extension/`), pair, run a 5-question bank, check the DOCX. Watch for: answers
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

**One question at a time, fresh chat every time.** Both the server worker and the
extension. It costs seconds and it *is* the product — 40 questions in one thread is the
exact failure this exists to fix. The extension navigates to a new chat before every
prompt for this reason.

**Selectors live on the server, not in the extension.** When ChatGPT renames a button you
edit `backend/extension_selectors.json` and every installed extension picks it up on its
next run. Nobody reinstalls anything. Never hardcode a selector in the extension.

**Completion is detected by output length going stable, not by the stop button.** The
button is an accelerator only, because it's the selector most likely to go stale. A wrong
`stop` selector costs speed, not correctness. Keep it that way.

**Cache outranks engine mode.** A question the class already answered costs neither our
API quota nor a trip through the student's browser. There's a test on this.

**No model-generated code is ever executed.** Graphs are declarative JSON rendered
server-side with matplotlib; numerical verification runs allowlisted arithmetic through
SymPy. Uploaded text is wrapped in `<question>` tags and declared data, never instructions.

**The extension holds nothing worth stealing.** No question bank, no prompt templates, no
document builder, no API keys — it receives one prompt at a time. This is *why* the
paywall can't be bypassed by tampering with it. Don't move logic into it.

**Models are named in `models.json` only.** No model strings in code, ever. Free-tier IDs
rotate; verify current `:free` IDs at openrouter.ai/models before editing.

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
  app/config.py             settings (.env) — quotas, keys, billing, limits
  app/db.py                 engine, session, migrate_columns()
  app/models.py             SQLAlchemy schema
  app/security.py           scrypt, JWT, refresh rotation, rate limit, headers
  app/routers/
    auth.py                 register / login / refresh / logout / me
    projects.py             upload, review, start, assist, explain, assets, EXPORT 🔒
    billing.py              balance, checkout, webhook, mock gateway
    extension.py            pairing, config, work queue
  app/services/
    providers.py            one OpenAI-compatible client for Google/Groq/OpenRouter + mock
    ingest.py               file validation + text extraction
    extractor.py            raw text → questions
    router_agent.py         question → type classification
    solver.py               per-type prompts, assist prompts, explain-me
    verify.py               SymPy numerical re-computation (allowlisted)
    diagrams.py             graphspec → matplotlib PNG, mathtext renderer
    cache.py                class-wide answer cache
    queue.py                the one-question-at-a-time worker
    export.py               markdown → DOCX
    billing.py              credit ledger + export paywall
    payments.py             Razorpay payment links + mock gateway
  models.json               role → model config (the ONLY place models are named)
  extension_selectors.json  DOM contract for the extension ← the hotfix channel
frontend/                   Vite + React + Tailwind
extension/                  Chrome MV3 — see extension/README.md
SECURITY_AUDIT.md           implemented controls + pre-launch checklist
```

**Where to start reading:** `services/queue.py` (the core mechanic), then `solver.py`
(the prompt contract everything shares), then `services/billing.py` (the money).
