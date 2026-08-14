# AnswerBank

**Question bank in → exam-ready answer document out.**

Students upload a question bank from any source (PDF, DOCX, image, pasted text).
AnswerBank answers it **one question at a time** — because dumping 40 questions into a
chatbot ruins answers 25–40 — with each question routed to the AI best suited for its
type, then exports everything as a polished DOCX with working, code, plots and diagrams.

## How it works

```
upload → extract questions → student reviews/edits → sequential queue:
  ┌ per question ┐
  │ class cache? ─ hit → instant answer (free)
  │ router agent ─ classifies: numerical | code | graph | diagram | theory
  │ solver chain ─ first available provider for that type
  │      └ none available → Assist mode (crafted prompt, student's own AI tab)
  │ verify       ─ numericals re-computed with SymPy → ✓ / ⚠ badge
  └ store → dashboard renders (KaTeX, highlighted code, mermaid, real plots)
→ one-click DOCX export (cover, index, embedded figures, credits)
```

**Key design decisions**
- **No browser puppeteering of ChatGPT/Claude/etc.** — that breaks their ToS, gets
  student accounts banned, and dies with every bot-detection update. Instead:
  free-tier APIs by default + **Assist mode** (the app crafts a perfect one-question
  prompt; the student pastes it into their own AI tab and pastes the answer back —
  same quality, zero cost, fully compliant).
- **No model-generated code is ever executed.** Graphs are declarative JSON specs
  rendered server-side with matplotlib; numerical verification evaluates allowlisted
  arithmetic through SymPy. See [SECURITY_AUDIT.md](SECURITY_AUDIT.md).
- **Class cache**: identical questions (hash includes marks + type) are answered once
  and served to every classmate instantly — the real cost killer, since whole classes
  share the same bank.
- **Marks-aware depth**: "(2 marks)" gets 3 crisp lines; "(10 marks)" gets a full
  structured answer.

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

14 tests: auth flow + refresh rotation, upload magic-byte validation, extraction,
SymPy verification (incl. injection payloads), class cache, prompt-injection envelope,
full mock pipeline (upload → answers → explain → DOCX), assist mode end-to-end.

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
  models.json            role → model config (the only place models are named)
frontend/                Vite + React + Tailwind dashboard
sample_question_bank.txt demo input covering all five question types
SECURITY_AUDIT.md        implemented controls + pre-launch checklist
```

## Roadmap (not yet built)

- PDF export; image OCR bundling (needs tesseract); scanned-PDF OCR
- Email verification + password reset; billing/plans on top of the usage ledger
- Postgres + Redis for multi-node deploys (config-only swap for the DB)
- Per-course spaces and shared class libraries on top of the answer cache
- "Important questions" prediction from past papers
