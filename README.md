# Prism — for students

*One question bank, split across every AI you're signed into.*

> **New to this repo? Read [HANDOVER.md](HANDOVER.md) first.**
> It covers current status, what's left in priority order, and the design decisions that
> look like bugs until you know why. This README explains the product; HANDOVER explains
> the state it's in.
>
> **Current status: browser-only engine wired end to end, not yet launchable.** One
> blocker — the Chrome extension has never been run against a live ChatGPT/Claude/Gemini
> page ([HANDOVER.md §5, P0-1](HANDOVER.md#5-whats-left)).

**Question bank in → exam-ready answer document out.**

A prism takes one beam and splits it into a spectrum. This one takes a question bank and
fans it across ChatGPT, Claude and Gemini — each question going to whichever handles it
best, three answering at a time.

Students upload a question bank from any source (PDF, DOCX, image, pasted text).
Prism answers it **one question at a time** — because dumping 40 questions into a
chatbot ruins answers 25–40 — with each question routed to the AI best suited for its
type, then exports everything as a polished DOCX with working, code, plots and diagrams.

## How it works

```
upload → extract questions (regex) → student reviews/edits → queue:
  ┌ per question ┐
  │ class cache? ─ hit → instant answer (free, outranks everything below)
  │ ROUTER AI    ─ the one model we call. Picks the answer type
  │                (numerical | code | graph | diagram | theory) AND which of the
  │                student's browser AIs should write it. It never answers anything.
  └ per batch of 3 ┘
    extension opens 3 tabs on 3 DIFFERENT assistants, each its own fresh chat,
    waits for all three, collects the answers → next 3
    (or the student pastes any prompt by hand — same prompt, same result)
  verify ─ numericals re-computed with SymPy → ✓ / ⚠ badge
  store  → dashboard renders (KaTeX, highlighted code, mermaid, real plots)
→ DOCX export (cover, index, embedded figures, credits) ── 🔒 1 credit
```

**Key design decisions**
- **Our AI routes; their AI answers.** The server calls exactly one model, and only to
  classify a question and pick which assistant should handle it — a few tokens on a free
  tier. The expensive part, actually answering, runs on the student's own
  ChatGPT/Claude/Gemini subscription. With no key at all, routing falls back to keywords.
- **Three at a time, across three assistants.** A batch is always spread over distinct
  AIs. 30 questions become 10 each rather than 30 on one account, so nobody's free
  message cap runs out mid-run — and the bank finishes ~3× faster.
- **One prompt contract.** The extension and a student pasting by hand use the *same*
  crafted prompt, so an answer renders and exports identically however it arrived.
- **No model-generated code is ever executed.** Graphs are declarative JSON specs
  rendered server-side with matplotlib; numerical verification evaluates allowlisted
  arithmetic through SymPy. See [SECURITY_AUDIT.md](SECURITY_AUDIT.md).
- **Class cache**: identical questions (hash includes marks + type) are answered once
  and served to every classmate instantly — the real cost killer, since whole classes
  share the same bank. A cache hit outranks everything: it costs nobody a trip through
  the browser at all.
- **Marks-aware depth**: "(2 marks)" gets 3 crisp lines; "(10 marks)" gets a full
  structured answer.

## Making money

Answering is free. **Downloading the finished DOCX costs 1 credit** (₹20), and unlocking
is stored per question bank, so re-downloads are free forever — you charge for the
document, not the click. The first bank is free (`FREE_BANKS=1`), so the paywall only
appears after the student has read every answer on screen.

Two things make the margin work:
- **The class cache.** Student #1 from a class costs compute; students #2–30 hit the
  cache and cost nothing. Thirty ₹20 sales on one bank's work is the actual business.
- **Inference costs you nothing, ever** — it's the student's own ChatGPT/Claude/Gemini
  subscription doing the work, which is also a better model than any free API tier.

Credits are granted in exactly one place (`billing._grant`), reachable only by a
signature-verified Razorpay webhook. The browser can start an order, never finish one.
`MOCK_PAYMENTS=true` runs the whole flow with no gateway account.

## Chrome extension

`extension/` — answers questions in the AI tabs the student is already signed into, one
fresh chat per question. See [extension/README.md](extension/README.md) for install,
the selector-hotfix channel, and the ToS caveats you should pass on to students.

## Quickstart

```bash
# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000

# frontend (second terminal)
cd frontend
npm install
npm run dev          # http://localhost:5173
```

`backend/.env.example` needs no editing to run: there are no AI keys to add, and
`MOCK_PAYMENTS=true` lets the ₹20 checkout complete without a gateway account.

**Then install the Chrome extension** — it's the engine, not an add-on:

1. `chrome://extensions` → turn on **Developer mode**
2. **Load unpacked** → select the `extension/` folder
3. Reload the app. The header shows *Extension ready*.

There is nothing to connect afterwards. The extension's content script runs on the app's
own origin, so it picks up the session you're already signed in with — no pairing code,
no second login. Upload a bank, review the questions, press **Answer with my AI**.

Without the extension the product still works: every question shows a ready-made prompt
to paste into any AI tab by hand.

## Tests

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

24 tests: auth flow + refresh rotation, upload magic-byte validation, extraction,
SymPy verification (incl. injection payloads), class cache, prompt-injection envelope,
the full pipeline with a stand-in for the browser (`tests/helpers.py`), proof that no
question is ever answered server-side, the export paywall (free bank → 402 → paid unlock
→ free re-download), webhook signature + replay safety, cross-account isolation, and the
batching guarantees: a batch spans three distinct assistants, never hands the same
question to two tabs, honours `?exclude=` for AIs you aren't signed into, and returns a
dead tab's question to the pool.

```bash
cd extension && npm install && npm test    # 10 tests: the HTML → markdown converter
```

## Repo layout

```
backend/
  app/main.py            FastAPI app, middleware, lifespan (starts the worker)
  app/config.py          settings (.env) — limits, billing, the router's key
  app/models.py          SQLAlchemy schema (users, projects, questions, answers,
                         cache, usage ledger, audit log)
  app/security.py        scrypt, JWT, refresh rotation, rate limit, headers
  app/routers/           auth, projects/questions/assist/export, billing, extension
  app/services/
    ingest.py            file validation + text extraction
    extractor.py         raw text → questions (regex)
    router_agent.py      THE routing AI — question → type + which assistant answers
    solver.py            prompt construction — the only lever on answer quality
    providers.py         one OpenAI-compatible client, used ONLY by the router
    verify.py            SymPy numerical re-computation (allowlisted)
    diagrams.py          graphspec → matplotlib PNG, mathtext renderer
    cache.py             class-wide answer cache
    queue.py             the one-question-at-a-time worker
    export.py            markdown → DOCX (figures embedded)
    billing.py           credit ledger + the export paywall
    payments.py          Razorpay payment links + mock gateway
  models.json            the router model (the only place a model is named)
  extension_selectors.json  DOM contract + per-site strengths + batch size
frontend/                Vite + React + Tailwind dashboard
extension/               Chrome MV3 extension (see its own README)
sample_question_bank.txt demo input covering all five question types
SECURITY_AUDIT.md        implemented controls + pre-launch checklist
```

## Roadmap (not yet built)

- PDF export; image OCR bundling (needs tesseract); scanned-PDF OCR
- Email verification + password reset
- Postgres + Redis for multi-node deploys (config-only swap for the DB)
- Per-course spaces and shared class libraries on top of the answer cache
- "Important questions" prediction from past papers
