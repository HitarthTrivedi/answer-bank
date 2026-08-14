# AnswerBank — Security Audit (v0.1)

Scope: the whole codebase as of this audit. Format: what's implemented (with file
references), what's deliberately deferred, and what to do before public deployment.

## Threat model

Users are students uploading question-bank files and receiving AI-generated answers.
Assets to protect: user credentials, uploaded content, answer data, provider API keys,
and the server itself. Notable attack surfaces:

1. **Uploaded files** (malicious PDFs/DOCX, wrong-type files, oversized files)
2. **Question text as prompt injection** (a file that tries to hijack the LLM)
3. **Model output as injection** (markdown/SVG that tries to run script in the dashboard)
4. **Auth** (credential stuffing, token theft/replay, user enumeration)
5. **Cross-tenant access** (reading another student's projects/answers)
6. **Expression evaluation** (SymPy verify/graph rendering as an RCE vector)

## Implemented controls

### Authentication & session
- Passwords hashed with **scrypt** (n=2^14, r=8, p=1, per-user 16-byte salt), constant-time
  comparison — `backend/app/security.py`
- **JWT access tokens (30 min)** + **opaque rotating refresh tokens (7 days)**; only the
  SHA-256 of a refresh token is stored, so a DB leak cannot replay sessions; refresh
  rotation revokes the presented token; logout revokes server-side
- Identical error for unknown-email vs wrong-password (**no user enumeration**) — `routers/auth.py`
- Registration/login **rate-limited to 10/min per IP**; general API 240/min — `RateLimitMiddleware`
- Tested: refresh rotation, generic 401s, protected routes (`tests/test_core.py`)

### Authorization
- Every project/question/answer route resolves ownership through the user chain and
  404s on foreign IDs (`_own_project/_own_question/_own_answer` in `routers/projects.py`) —
  no sequential IDs (UUID hex), no cross-tenant reads

### Uploads
- Size cap (15 MB default), extension allowlist, **magic-byte sniffing** (content must
  match claimed type; docx must be a real zip with `[Content_Types].xml`) — `services/ingest.py`
- Filenames sanitized for display; stored files renamed to server-generated UUIDs
- Tested: magic-byte mismatch and disallowed extensions rejected

### Prompt injection (file → LLM)
- Question text is wrapped in `<question>` tags and the system prompt explicitly declares
  it data: instructions found inside are answered as exam text, never followed — `services/solver.py`
- Tested: injection phrasing stays inside the data envelope

### Model output → browser (XSS)
- Answers render through **react-markdown, which never emits raw HTML** (no `rehype-raw`);
  no `dangerouslySetInnerHTML` for answer content
- The single exception is Mermaid SVG, rendered with mermaid's **`securityLevel: 'strict'`**
  (label sanitization on) — `frontend/src/components/figures.jsx`
- API sets `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`,
  restrictive `Content-Security-Policy` — `SecurityHeadersMiddleware`

### No model-generated code execution (the big one)
- Graphs and numerical checks are **declarative specs, not code**: graphspec JSON and
  bare arithmetic expressions. Both pass a strict character allowlist (no `__`, no
  quotes/brackets, no names beyond a fixed SymPy function list, length caps) before
  SymPy evaluation — `services/verify.py`, `services/diagrams.py`
- Tested: `__import__`, `open()` and dunder payloads are rejected
- Nothing from a model or a user is ever passed to `exec`/`eval`/subprocess

### Quotas & abuse
- Per-user daily question quota enforced at start and per regenerate (`usage_ledger`)
- Global per-provider pacing (default 4 s) keeps free-tier RPM limits honest
- Security-relevant events (register, login, failed login, upload, processing start,
  export, delete) written to an **audit log** table with IP

### CORS & transport
- CORS locked to the configured frontend origin, explicit method/header lists, no
  credentialed requests (bearer tokens only)

## Accepted risks / deferred items (do before public launch)

| Item | Risk | Plan |
|---|---|---|
| Tokens in `localStorage` | XSS-theft (mitigated by no-raw-HTML rendering) | Move refresh token to httpOnly cookie + CSRF token when hosting on a real domain |
| SQLite + in-process worker | Fine single-node; no HA | Swap `DATABASE_URL` to Postgres (SQLAlchemy makes this config-only) and worker to a queue (e.g. RQ) at scale |
| In-memory rate limiter | Resets on restart; per-process | Redis-backed limiter behind a load balancer |
| Class cache shares answers across users | A question containing personal info would be shared | Acceptable for question banks; `CLASS_CACHE=false` to disable; add per-user opt-out later |
| Assist paste-back is trusted content | Student pastes wrong/garbage answer for themselves | By design (their document); numericals still get verified |
| No email verification / password reset | Account takeover via typo'd email is low-impact here | Add before real user data accumulates (needs an email provider) |
| No HTTPS termination in repo | Local dev is HTTP | Deploy behind a TLS proxy (Caddy/nginx); then enable HSTS |
| Mermaid `strict` SVG via innerHTML | Residual SVG surface | Consider server-side mermaid rendering later |
| `sympify` on allowlisted strings | SymPy parser CVEs would matter | Allowlist blocks quotes/brackets/dunders; keep SymPy pinned & updated |

## Pre-deployment checklist

- [ ] Set a real `SECRET_KEY` (startup warns loudly on the dev default)
- [ ] `MOCK_LLM=false`, real provider keys in `backend/.env` (never commit — `.env` is git-ignored)
- [ ] Postgres `DATABASE_URL`; run behind TLS; set `FRONTEND_ORIGIN` to the real domain
- [ ] `npm run build` and serve the static frontend (don't expose the Vite dev server)
- [ ] Review quota defaults; add monitoring on `audit_log` failed-login spikes
- [ ] Legal: answers are AI-generated study aids (already labelled in UI/exports);
      privacy policy for stored questions/answers; DPDP alignment for Indian users
