# AnswerBank

> **New to this repo? Read [HANDOVER.md](HANDOVER.md) first.**
> It covers current status, what's left in priority order, and the design decisions that
> look like bugs until you know why. This README explains the product; HANDOVER explains
> the state it's in.
>
> **Current status: works end to end in mock mode, not yet launchable.** One blocker —
> the Chrome extension has never been run against a live site
> ([HANDOVER.md §5, P0-1](HANDOVER.md#5-whats-left)).

**Question bank in → exam-ready answer document out.**

Students upload a question bank from any source (PDF, DOCX, image, pasted text).
AnswerBank answers it **one question at a time** — because dumping 40 questions into a
chatbot ruins answers 25–40 — with each question routed to the AI best suited for its
type, then exports everything as a polished DOCX with working, code, plots and diagrams.

## How it works

```
upload → extract questions → student reviews/edits → picks who answers → sequential queue:
  ┌ per question ┐
  │ class cache? ─ hit → instant answer (free, outranks everything below)
  │ router agent ─ classifies: numerical | code | graph | diagram | theory
  │ engine_mode=auto      → solver chain: first available provider for that type
  │ engine_mode=extension → park for the student's own AI tabs
  │      └ no provider either way → Assist mode (crafted prompt, manual paste-back)
  │ verify       ─ numericals re-computed with SymPy → ✓ / ⚠ badge
  └ store → dashboard renders (KaTeX, highlighted code, mermaid, real plots)
→ DOCX export (cover, index, embedded figures, credits) ── 🔒 1 credit
```

**Key design decisions**
- **Three ways to answer, one prompt contract.** Server APIs, the student's own browser
  tabs (via the Chrome extension), or manual paste-back all use the *same* crafted
  prompt — so an answer renders and exports identically however it arrived.
- **No model-generated code is ever executed.** Graphs are declarative JSON specs
  rendered server-side with matplotlib; numerical verification evaluates allowlisted
  arithmetic through SymPy. See [SECURITY_AUDIT.md](SECURITY_AUDIT.md).
- **Class cache**: identical questions (hash includes marks + type) are answered once
  and served to every classmate instantly — the real cost killer, since whole classes
  share the same bank. A cache hit outranks the engine mode: it costs neither our API
  quota nor a trip through the student's browser.
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
- **Extension mode costs you zero inference** — it's the student's own ChatGPT/Gemini
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

`backend/.env` ships with `MOCK_LLM=true` → the whole product works immediately with
canned deterministic answers (register, upload `sample_question_bank.txt`, watch it run,
export the DOCX). For real answers:

1. Set `MOCK_LLM=false` in `backend/.env`
2. Add at least one key (all optional — with zero keys everything routes to Assist mode):
   - `GOOGLE_API_KEY` — aistudio.google.com (⚠ a key shared with project delta shares
     its gemma quota; prefer a separate key)
   - `GROQ_API_KEY` — console.groq.com (code questions)
   - `OPENROUTER_API_KEY` — openrouter.ai (DeepSeek R1 for numericals, Kimi K2 for
     graphs/diagrams — free-tier model IDs)

**Models are configured only in `backend/models.json`** (role → provider/model fallback
chains). Free-tier model IDs rotate — verify current `:free` IDs at openrouter.ai/models
before editing. No model strings live in code.

## Tests

```bash
cd backend && .venv/bin/python -m pytest tests/ -q
```

23 tests: auth flow + refresh rotation, upload magic-byte validation, extraction,
SymPy verification (incl. injection payloads), class cache, prompt-injection envelope,
full mock pipeline (upload → answers → explain → DOCX), assist mode end-to-end, the
export paywall (free bank → 402 → paid unlock → free re-download), webhook signature +
replay, extension pairing (single-use codes), and cross-account isolation.

```bash
cd extension && npm install && npm test    # 10 tests: the HTML → markdown converter
```

## Repo layout

```
backend/
  app/main.py            FastAPI app, middleware, lifespan (starts the worker)
  app/config.py          settings (.env) — quotas, keys, limits
  app/models.py          SQLAlchemy schema (users, projects, questions, answers,
                         cache, usage ledger, audit log)
  app/security.py        scrypt, JWT, refresh rotation, rate limit, headers
  app/routers/           auth + projects/questions/assist/explain/export routes
  app/services/
    providers.py         one OpenAI-compatible client for Google/Groq/OpenRouter + mock
    ingest.py            file validation + text extraction
    extractor.py         raw text → questions (LLM + regex fallback)
    router_agent.py      question → type classification
    solver.py            per-type prompts, assist prompts, explain-me
    verify.py            SymPy numerical re-computation (allowlisted)
    diagrams.py          graphspec → matplotlib PNG, mathtext renderer
    cache.py             class-wide answer cache
    queue.py             the one-question-at-a-time worker
    export.py            markdown → DOCX (figures embedded)
    billing.py           credit ledger + the export paywall
    payments.py          Razorpay payment links + mock gateway
  models.json            role → model config (the only place models are named)
  extension_selectors.json  DOM contract for the extension — the site-redesign hotfix channel
frontend/                Vite + React + Tailwind dashboard
extension/               Chrome MV3 extension (see its own README)
sample_question_bank.txt demo input covering all five question types
SECURITY_AUDIT.md        implemented controls + pre-launch checklist
```

## Roadmap (not yet built)

- PDF export; image OCR bundling (needs tesseract); scanned-PDF OCR
- Email verification + password reset; billing/plans on top of the usage ledger
- Postgres + Redis for multi-node deploys (config-only swap for the DB)
- Per-course spaces and shared class libraries on top of the answer cache
- "Important questions" prediction from past papers
