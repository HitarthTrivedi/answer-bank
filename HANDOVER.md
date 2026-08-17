# Prism (for students) — Handover

Read this first. It covers what works, what doesn't, what's deliberately the way it is,
and what to do next in priority order.

**Status: the browser-only engine is wired end to end. Not yet launchable.** One blocker
(P0-1) stands between this and a real student using it.

---

## 1. What it is

Students upload a question bank (PDF / DOCX / image / pasted text). Prism answers it
**one question at a time** — because dumping 40 questions into a chatbot ruins answers
25–40 — routing each question to the AI best suited to its type, then exports the lot as a
polished DOCX with working, code, plots and diagrams.

**Our AI routes; their AI answers.** The server's own model, on OpenRouter's free tier,
does exactly two things and neither is answering a question. It **sorts a bank** — one JSON
reply for the whole thing, giving each question a type and the assistant best placed to
write it — and it writes the **"explain it simply"** version of an answer already on
screen. Every actual answer comes from the student's own ChatGPT / Claude / Gemini
session, driven by the Chrome extension.

**Questions run three at a time, wherever they belong.** A batch is the next three
questions, each in its own fresh chat on the site the router chose — all three on Gemini
if all three are diagrams. Nothing reassigns a question to even out the load; spread falls
out of the routing itself, because different question types belong on different sites.

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
cd backend && .venv/bin/python -m pytest tests/ -q   # 46 tests
cd extension && npm install && npm test              # 15 tests
```

---

## 3. How it works

```
upload → extract questions (regex) → student reviews/edits → queue:
  ┌ per question ┐
  │ class cache? ─ hit → instant answer, no tab opens (free; outranks everything below)
  │ ROUTER AI    ─ sorts the WHOLE BANK in one call. qtype + which assistant. Never answers.
  │ else         ─ park the crafted prompt as `assist_waiting`
  └ per batch of 3 ┘
    GET /extension/batch leases the next 3, each on the site the router picked
      → extension opens 3 tabs, each a FRESH chat (one tab per question, even
        when two questions land on the same site), sends all three
      → waits for all three (~3 min), scrapes each, POSTs to /assist
      → next 3
    (or the student pastes any of them by hand — same prompt, same result)
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
- **Question splitting**: regex finds every candidate boundary, then ONE AI call decides
  which are real questions vs. steps inside an answer. A student review step follows, so a
  miss costs one edit rather than a wrong answer.
- **Router AI** (`services/router_agent.py`, model in `models.json`) → question type +
  which assistant answers it, for a whole bank in one call. Falls back to keywords with
  no key.
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
- **The server no longer answers.** `solver.py` only builds prompts; the solver chain is
  gone. The router survives as the one model call. Extraction is regex-only.
- **Batching across assistants.** `GET /api/extension/batch` leases 3 questions on 3
  distinct sites; the extension answers them concurrently. Leases (`assist_running` +
  `leased_at`) stop two tabs taking the same question, and `queue.expire_leases()` returns
  a question to the pool if its tab dies. `?exclude=` lets the extension tell the server
  which assistants the student isn't signed into.
- **Server-side DOM selectors** (`backend/extension_selectors.json`) served at
  `/api/extension/config` — the site-redesign hotfix channel (§7).
- **Document mode.** A question whose meaning lives in a figure is answered by attaching
  the ORIGINAL uploaded file to a fresh chat and asking "answer only question 7"
  (`solver.build_document_prompt`, `/api/extension/document/{id}`). This sidesteps
  figure→question association entirely: the paper already states which figure belongs
  where. Requires `Question.source_number` — the number the question carried in the file,
  which is why the extractor keeps it.
- **Figures (fallback).** Images embedded in an uploaded PDF/DOCX are extracted (`ingest.py`),
  anchored to a character offset, matched to the question whose text span contains them,
  shipped in the batch payload as base64, and pasted into the chat by the driver. They
  also land in the exported DOCX. **We never interpret them** — no OCR, no vision model,
  no cost; the student's own AI reads them.
- **Figure detector.** `extractor.mentions_a_figure()` flags a question that references a
  figure we couldn't find, at the review step. Without it those are answered blind and the
  AI invents a confident answer about a graph it never saw.
- **House style.** The solver prompt now pushes tables over prose for anything with
  parallel structure (step traces, comparisons, edge costs), taken from a marked-up
  reference answer document.
- **Buyer's name on the DOCX cover** — mild anti-forwarding friction, not DRM.
- **SQLite column migration** (`db.migrate_columns`) — idempotent, runs on boot.
  Verified against a live DB with existing rows.
- **`tests/conftest.py`** — fixes a pre-existing bug where module-level env vars plus an
  `lru_cache`d settings object meant whichever test module imported first owned the app.
  Tests now pass in any order.

### Added in the product pass (the shipping build)

**The interface was rebuilt.** It is monochrome — white, black, grey, no accent colour —
and it shows **one question per screen** instead of stacking all 28 down a scrolling page.
The arrow keys move between them, a rail across the top shows where you are and what's
answered, and the question number lives in the URL (`/app/p/:id/7`) so back, forward,
reload and shared links all land in the right place. `components/ui.jsx` holds the entire
visual vocabulary — a solid button, a quiet one, a text action, a field. Build from those
rather than reaching for new greys.

The review step uses the same deck: each question is editable on its own screen, with
marks, remove, and add-one-after-this. `AnswerCard.jsx` and `ReviewQuestions.jsx` are gone.

**Four bugs that were silently destroying image questions**, all fixed:

1. **The review save was deleting and recreating every question row.** That set every
   figure's `question_id` to NULL and dropped `source_number`. Since every bank passes
   through review, document mode could never fire in production and figure questions were
   answered with no figure. Rows are now matched by `id` and edited in place
   (`routers/projects.py::update_questions`). Regression test:
   `test_the_review_save_keeps_figures_and_the_number_in_the_paper`.
2. **`_dedupe` collapsed every picture row into one.** Two image-only questions have
   identical placeholder text, so a 5-figure bank kept one of them. Placeholder rows are
   now exempt from deduplication.
3. **The AI selection step dropped picture rows**, because it judges a candidate by its
   opening text and a picture has none. `_restore_numbered_gaps` puts back any candidate
   whose number is missing from inside the kept run — a bank numbered 1…27 obviously has
   a 10. Numbered steps inside an answer either reuse a number already present or sit
   outside the run, so they don't come back through this.
4. **Run-on rows swallowed whole questions.** A spreadsheet export produced
   `…characteristics 7 8Write A* algorithm` — three questions on one line, two of them
   lost with no error. `_recover_run_on_rows` splits them, but *only* where the numbering
   proves something is missing (a jump from 6 to 9). A contiguous run is never touched.

Measured on the real spreadsheet-export bank: **22 questions with figures lost → 28
questions with all five picture rows recovered and their figures attached.**

**Document mode is now the default path, not the exception.** Any bank we still hold the
file for is answered against that file: the paper is a better copy of the question than
our extraction is, and the model reading it decides which figure belongs to which question
far better than any heuristic. Extraction is now only responsible for *how many* questions
there are, never for what they say. Supporting changes:
- `build_document_prompt(..., number=None)` locates a question by **quoting its opening**
  when the paper has no usable numbering (a photo, a bulleted sheet).
- A number that appears twice in a paper is not trusted to identify a question
  (`_number_is_unique`) — spreadsheet exports restart their numbering, and "answer
  question 11" against two question 11s is a coin toss. Those quote instead.
- The batch carries a `fallback_prompt`. If the AI replies `NOT_FOUND`, the extension
  retries once in a fresh chat from the extracted text plus any anchored figure, so a
  miss costs one extra chat rather than the question.

### Added in the routing pass

**Our own model now does exactly two things, and answering is not one of them.**

- **"Explain it simply" is written by Prism** (`services/explainer.py`), not by the
  student's browser AI. It used to hand back a prompt to paste. That was the wrong trade:
  an explanation is a re-read of an answer already on screen, clicked on a whim and often
  abandoned two lines in, and spending one of the student's free ChatGPT messages on it
  costs more than the feature is worth. Answers still never come from here — the mock
  provider deliberately has no "answer a question" branch.
- **A whole bank is routed in one call** (`router_agent.classify_many`, chunked at 25).
  It used to be one call per question. A free tier's daily allowance is measured in tens,
  so a 28-question bank spent its entire routing budget on itself and degraded to keywords
  without saying so. Now it's one call for the bank, and the router sees the bank as a set.
- **The forced spread across assistants is gone.** `_assign` used to guarantee that a
  batch of three landed on three *different* sites, which silently overrode the router's
  decision on two questions out of every three. A batch is now the next three questions,
  each on the site the router chose — all three on Gemini if all three are diagrams. Spread
  falls out of the routing itself. The only override left is an assistant the student isn't
  signed into.
- **One tab per question, even on the same site.** `background.js` reused the first open
  tab for a site; with three same-site questions in flight they overwrote each other's
  prompt. Tabs are claimed for the duration of a question and released in a `finally`.
- **The keyword fallback was widened** with phrase patterns, because it is what runs
  whenever the daily allowance is spent — "write a Python program" doesn't contain the
  substring "write a program", so it was being routed as theory.
- **Figure questions get their own row in the deck.** `services/paper.py::is_visual`
  decides; the rail renders two groups, "Diagrams & figures" and "Theory". A misread
  diagram becomes a confident wrong answer rather than an obvious blank, so those are the
  ones worth a second look and they shouldn't be scattered through thirty theory questions.
- **Starting a run says when it can't.** If the extension isn't loaded, pressing "Answer
  all N" used to park the questions and do nothing visible. It now says so.
- **A cache hit says so on the answer.** "Already answered by your class — no tab needed",
  rather than looking like something answered it behind your back.

`services/paper.py` is new and owns the two predicates that were duplicated across routers:
`is_visual` (how the deck groups) and `answered_from_document` (how the extension answers).

### Added in the assistant-analysis pass

Routing used to run on invented `strengths` strings. They are now set from research done
in **August 2026** — and the half that turned out to matter most wasn't capability at all,
it was **free-tier capacity**.

| Site | Best at | Free tier | Documents |
|---|---|---|---|
| **ChatGPT** | numerical working, step-by-step math (leads AIME-style math reasoning), clean LaTeX; fastest and clearest explainer | unlimited text chat | **3 uploads/day** — almost none |
| **Claude** | long structured answers, derivations, proofs, comparisons; strongest coder (leads SWE-Bench Verified) | **smallest of the four** — compute pool on 5-hour windows, ~15 messages in practice | 5 per chat |
| **Gemini** | anything visual or spatial: reading a graph/circuit/table out of a document, producing plots and diagrams | compute-pooled, 5-hour resets | 10 per prompt, 100 MB |
| **Kimi** | slowest, but the most patient with a long attached paper — reads a whole question bank without truncating; good tables and plotted figures | **no message cap** | **no upload cap** |

**Why this changes the design.** Document mode uploads the question paper *once per
question*. ChatGPT allows three uploads a day on the free tier — spent before the first
batch of three finishes. Everything looks correctly routed right up to the point the
uploads stop being accepted, which is the worst kind of failure. So:

- **Kimi is now a fourth site** (`extension_selectors.json`, `manifest.json`). It is the
  only free tier that can absorb a figure-heavy bank, and it carries the bulk of theory.
  Its selectors are **unverified**, like the other three (P0-1) — deliberately generic so
  a class rename doesn't break them.
- **`document_sites`** is an ordered preference for questions that need the paper attached:
  `kimi, gemini, claude, chatgpt`. ChatGPT is last on purpose.
- **`_assign` rotates document questions across the sites with headroom** rather than
  piling them on the first. Measured on the real 28-question bank: kimi 8 / gemini 7 over
  five batches, none on ChatGPT. Piling them all on one site answers ~2× slower and puts
  the whole bank on one account.
- **A question that is *about* a figure keeps the router's choice** when that site has
  headroom — judging a diagram is exactly what the choice was about.
- **The router prompt now sees `free_tier` as well as `strengths`**, and is told to spend a
  scarce assistant on the questions where its advantage earns marks (long, high-mark,
  structured) rather than on bulk. Default map: numerical→chatgpt, code→claude,
  graph/diagram→gemini, **theory→kimi** (theory is the bulk type; sending it to Claude
  stops the bank a third of the way through).

**Re-check the free tiers before launch — they move every few months.** The evidence is
recorded in `extension_selectors.json` under `_routing_evidence` so it is obvious what the
routing is based on and when it was last checked.

### Test coverage — 62 total
`backend` (47): auth + refresh rotation, upload magic bytes, extraction, SymPy
verification incl. injection payloads, class cache, prompt-injection envelope, the full
pipeline driven by a stand-in for the browser (`tests/helpers.py`), **proof that no
question is ever answered server-side**, **export paywall** (free → 402 → paid unlock →
free re-download), **webhook signature rejection**, **replay-safety** (a repeated callback
doesn't mint a second credit), **cross-account isolation**.

`extension` (15): the HTML→markdown converter — KaTeX → original LaTeX, code fences with
language tags, tables, nested lists, the `FINAL:` line the verifier reads, and that the
live DOM is never mutated — plus five manifest checks, including the one for unrecognised
keys inside `content_scripts`, which is what silently blocked installation for a whole
afternoon.

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

**P0-1b. Verify image paste against the live sites.** The driver attaches figures with a
synthetic paste carrying a `File`. That is the same mechanism as the text paste, so it
should work — but it has never run against a real composer, and free tiers often cap
vision requests separately from message limits. Test with a bank containing a real figure.

**P0-2. End-to-end extension run.** Load unpacked (`chrome://extensions` → Developer
mode → `extension/`), reload the app, run a 5-question bank, check the DOCX. Watch for: answers
truncated mid-generation (raise `settle_ms`), math arriving as unicode instead of LaTeX
(`content` selector is wrong), navigation not producing a fresh chat.

### P1 — before taking real money

| # | Task | Notes |
|---|---|---|
| P1-0 | OpenRouter API key | openrouter.ai/keys — free, no card. Paste into `OPENROUTER_API_KEY`. Without it routing silently falls back to keywords: still works, routes worse. |
| P1-0b | Sanity-check the fallback IDs | The primary is `openrouter/free`, which self-maintains. The four *fallbacks* are pinned IDs and **do** rot — re-check with `GET /api/v1/models` if you see router warnings. |
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

**The router routes, it never answers.** It exists so questions reach the right
assistant cheaply. Don't grow it into a solver — the moment the server answers anything,
the economics and the whole product story change. Questions the extension fails on stay
`assist_waiting` on purpose, visible in the app for a manual paste.

**A batch always spans distinct assistants.** Not an optimisation — it's the rate-limit
strategy. If you change `batch_size` in `extension_selectors.json`, it is still capped by
how many sites exist, because one tab per site is the point.

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

**Use `openrouter/free`, don't hand-write model lists.** Individual `:free` IDs rot fast —
when this was first written with ten hand-picked IDs, every single one was already dead.
`openrouter/free` is OpenRouter's own router across live free models, so the list is
their problem, not ours.

**Keep `max_tokens` generous on the router.** It often lands on a *reasoning* model, and
reasoning tokens count against the completion budget (240–370 observed for a one-line
classification). Set it too low and the model spends the whole allowance thinking, then
returns empty content. Free models cost nothing, so there is no reason to be tight.

**Splitting is regex + one AI call, in that order.** "1." starts a question and also
starts every algorithm step inside an answer — pure regex turned a real 27-question bank
into 83 fragments. The regex finds candidates (cheap, exhaustive); the model judges which
are real (one small call, prompt sized by candidate count not file size). Don't "simplify"
this by sending the document to the model — that's several calls per upload on a 50/day
free tier.

**Hand over the document, don't crop the picture.** For figure questions the paper goes
to the AI whole, one numbered question at a time. Every attempt to decide *here* which
image belongs to which question is a heuristic that will be wrong on some layout; the
document is the authority and the model reads it better than we can.

**Prefer text to pixels.** The reference answer document this style came from covers A*
search, game trees and Bayesian networks across 23 pages with *zero* images — the data
lives in tables. Reach for a table before a figure; it reads better, exports cleanly, and
costs nothing to generate.

**Never interpret a figure server-side.** No OCR, no vision API. The pixels go to the
student's AI, which is better at it and already paid for. Adding tesseract would be more
work for a worse result and a bill.

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
