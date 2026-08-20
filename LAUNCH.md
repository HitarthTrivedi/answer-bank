# Prism for students — from local build to product

*Written the night before launch work starts. This is the plan we execute one item at a
time, in order. Each step says what it is, why it's in that position, what it needs from
Hitarth (accounts, money, decisions), and how we know it's done.*

**Where we are tonight:** the engine works end to end on a real bank — upload, split,
route, three windows answering in parallel, answers back in the deck, DOCX out. 55 backend
+ 15 extension tests. Everything runs on one laptop: extension loaded unpacked, website on
localhost, payments mocked. Nobody outside this room can use it yet.

---

## 1. The pitch, in one paragraph

Every student already has ChatGPT. The problem isn't access to AI — it's that **when you
paste a 30-question bank into one chat, the last ten answers are garbage.** The model runs
out of attention; answers get shorter, vaguer, and eventually it starts skipping. Students
know this and cope by pasting questions one at a time, for an hour, then copying each answer
into a Word file by hand and giving up on the diagrams.

Prism does that hour for them. Upload the bank, press one button, walk away. Each question
gets its own fresh chat, on whichever AI is best at that kind of question, three at a time.
Diagrams, graphs and tables come back as real figures, not ASCII. Twenty minutes later
there's a formatted answer document with every figure embedded — ₹20 to download.

The line for the header: **"One question bank in. Every answer, fully written."**

Alternatives, pick tomorrow:
- *"Your question bank, answered one question at a time — by the AIs you already use."*
- *"Stop pasting questions one by one. Upload the bank. Walk away."*
- *"Forty questions. Forty fresh chats. One document."*

Why "Prism": one beam in, a spectrum out — one bank in, split across every AI you're signed
into. The name already carries the "multiple specialised agents" legacy Hitarth wants.

---

## 2. Pricing and why ₹20 is not cheap

₹20 per document looks like nothing until you see the shape of the demand:

- **It's a class product, not a person product.** A question bank is issued to a whole
  class. The first student to run it pays ₹20 and spends twenty minutes. Every classmate
  after that hits the **class cache** — the same answers, instantly, zero tabs — and
  still pays ₹20 for the document. One bank can be 30–60 sales on one run's work.
- **The cache makes sharing the growth loop.** "Upload it, I'll get it instantly" is a
  real reason to tell a classmate — the product gets *faster* when your friends use it.
  Most products get worse when shared; this one gets better.
- **Our cost per sale is ~zero.** Answering runs on the student's own ChatGPT/Claude/
  Gemini. Our model call is one routing request per bank on a free tier. Hosting is the
  only real cost.
- **The exam calendar does the marketing.** Demand arrives in spikes: GTU mid-sems,
  end-sems, and the week before each. Every semester is a fresh cohort with fresh banks.

Packs already in the code (`CREDIT_PACKS`): ₹20 one bank · ₹99 six · ₹199 semester. The
packs exist to cut UPI friction, not to discount. First bank free (`FREE_BANKS=1`) so the
paywall appears only after they've read every answer on screen.

Suggestions to consider tomorrow, not decided:
- **Referral credit:** invite a classmate who pays → both get one free bank. Cheap, and
  it rides the cache loop.
- **Class pass:** one student (CR) buys a bank for the whole section at ₹149 and shares a
  link; everyone downloads free. Converts the CR into the distributor.
- **Watermark footer on every exported DOCX:** "Answered with Prism · prism.app" — the
  document is the thing students forward on WhatsApp. That footer is free distribution.
- Keep ₹20. Don't go lower; go wider.

---

## 3. Distribution: how students find it

Where the first thousand users come from, in order of effort-to-payoff:

1. **The exported document itself.** Footer link on every page. Students forward answer
   docs to each other constantly; each forward is an ad for the exact problem it solves.
2. **WhatsApp/Telegram class groups.** Every section has one, the question bank is posted
   there, and "I ran this through Prism, here's the doc" is a natural message. Give users
   a shareable link to the *finished bank page* (read-only view) so one message does it.
3. **GTU first.** The test files in this repo are GTU banks; the extraction is tuned on
   them. Pick one university, one semester, dominate it, then widen. Demand is
   concentrated and the banks repeat across colleges — a cache hit across colleges.
4. **A 30-second screen recording.** The three windows answering in parallel *is* the
   demo. Post it as a reel/short. No voiceover needed: upload, press, windows appear,
   deck fills, document downloads.
5. **Campus ambassadors:** one student per college gets free credits for every N paid
   banks from their college. Costs nothing until it works.
6. **Chrome Web Store listing** — not a channel by itself, but a trust signal ("Featured"
   badge later) and the only install path normal people will accept. See §5.

Honest risk to carry: **automating ChatGPT/Claude/Gemini's web UIs violates their terms.**
The extension runs in the student's own browser on their own account, which is the least
offensive shape this can take, but it's the students' accounts at risk, not ours. Say it in
the FAQ plainly. Do not hide it.

---

## 4. The website: what "professional" means here

Reviewed against what the good ones do (Notion, Linear, Grammarly, Cursor — different
products, same bones). Every serious product site has the same nine things; we're missing
most of them:

| Have | Missing |
|---|---|
| Hero with one claim | **Header** with logo, nav (How it works · Pricing · Docs · Support), sign-in |
| Three feature points | **Demo** — the 30-second recording, inline, autoplay muted |
| Monochrome design system | **How it works** in 3 steps with the actual screens |
| | **Pricing** page — three packs, FAQ under it, "first bank free" loud |
| | **Docs**: install the extension (with screenshots), supported files, what to do when a site changes, limits |
| | **Support / Contact**: email + a form, response-time promise |
| | **About / the maker**: who built it and why — students trust a student |
| | **Legal**: Privacy policy (Web Store *requires* a public URL), Terms, **Refund policy** (Razorpay requires it) |
| | **Footer**: the above, plus "Not affiliated with OpenAI, Anthropic or Google" |

Design stays monochrome white/black/grey — it's the thing that already looks finished.
Pages to build: `/` (landing) · `/how-it-works` · `/pricing` · `/docs/*` · `/support` ·
`/about` · `/privacy` · `/terms` · `/refunds`. All static React routes; no CMS.

---

## 5. The plan for tomorrow, in order

The order is set by **what takes the longest to come back**: Web Store review (days),
Razorpay KYC (days), domain DNS (hours). Those get kicked off first; everything else fills
the waiting time.

### Morning — start the slow clocks

**Step 1 · Accounts (Hitarth, ~1 hour).** Do these first because each one has a waiting
period we can't speed up:
- Razorpay account → KYC (PAN + bank). *Needed by:* Step 6.
- Chrome Web Store developer account — one-time $5. *Needed by:* Step 5.
- A domain. Suggest `prism.study` / `prismforstudents.in` / `useprism.in` — check
  availability tomorrow. *Needed by:* Step 2.
- OpenRouter: add $10 credit once → free-model limit rises from ~50/day to ~1000/day.
  Without this, routing silently degrades to keywords after the first ~40 questions of
  the day. *Needed by:* Step 2.

**Step 2 · Deploy the backend and the app (me, ~2 hours).**
- Backend → Railway or Render (persistent disk for SQLite + uploads; Postgres later).
  `SECRET_KEY` real, `CLASS_CACHE=true`, `MOCK_PAYMENTS=true` until Step 6.
- Frontend → Vercel/Netlify, `/api` proxied to the backend.
- HTTPS on the domain. *Done when:* a stranger can sign up and upload a bank.

**Step 3 · Point the extension at production (me, ~1 hour).**
- `host_permissions` and the bridge content script: the real domain instead of localhost.
- Bump to 1.0.0, pack, install from the zip on a *clean* Chrome profile, run a bank.
- *Done when:* the clean-profile run finishes untouched.

**Step 4 · Web Store listing (both, ~2 hours) — submit TODAY, review takes 1–7 days.**
- Needs: 128px icon (have), 1280×800 screenshots ×3–5 (the three-window run, the deck,
  the DOCX), the 30-second video, short + long description, category (Education),
  **a public privacy-policy URL** (Step 7 must ship a minimal one first).
- Permission justifications the reviewer will ask for: `tabs` (open/drive the AI tabs),
  `system.display` (tile the three windows), `power` (keep the display on during a run),
  host permissions for the three AI sites and our domain. Write them plainly.
- Single purpose statement: "answers a student's question bank using the AI sites they
  are already signed into." One sentence; reviewers reject vague ones.
- *Done when:* status reads "Pending review."

### Afternoon — the product around the engine

**Step 5 · Website pages (me, ~4 hours).** Header/footer shell, then in this order:
privacy + terms + refunds (unblock Steps 4 and 6), pricing, how-it-works, docs (install
guide with screenshots, supported files, FAQ incl. the ToS caveat), support, about.
*Done when:* every footer link lands on a real page.

**Step 6 · Real payments (me, 1 hour once Razorpay KYC clears).**
Keys into env, webhook `https://<domain>/api/billing/webhook` subscribed to
`payment_link.paid`, `MOCK_PAYMENTS=false`, one real ₹20 purchase end to end, refund it
from the dashboard to confirm the path. *Done when:* ₹20 moved and came back.

**Step 7 · Account basics (me, ~2 hours).** Email verification and password reset — both
missing; a paid product can't ship without them. Needs a transactional email provider
(Resend/Postmark free tier). *Done when:* a reset link arrives and works.

### Build items (day after, unless the above finishes early)

**Step 8 · Figures all the way into the document.** This is the feature Hitarth named as
the reason students will come back: *"we have to do something about the graphs, images,
diagrams and integrate them in the docs so they don't have to do it themselves."*
- Done already: mermaid → PNG → embedded; graphspec plots → PNG → embedded; extracted
  figures from the paper → embedded.
- Missing: **images the AI generated** (ChatGPT draws a diagram). Today we keep the chat
  link; the image URL expires. Build: the extension fetches the image bytes in the page
  (same-origin), posts them to `/answers/{id}/assets`, the exporter embeds them. Then a
  diagram question yields both the mermaid figure and the rendered image, in the DOCX.
- Then: image/photo uploads of handwritten banks (OCR path, or document mode only).

**Step 9 · Shareable bank page.** Read-only link to a finished bank — the WhatsApp unit of
distribution (§3, item 2). Viewers see answers; downloading the DOCX still costs ₹20.

**Step 10 · Referral credits + DOCX footer link** (§2). Small, high leverage.

---

## 6. Hitarth's notes from the last two days — kept verbatim in spirit

So nothing gets lost between sessions:

1. "I'm a lazy engineer who will press Answer all and not touch the laptop until every
   answer is there." — *The contract. Built: slot windows, keep-awake, tag guard. Keep
   every future change honest against this sentence.*
2. "Claude and ChatGPT are not even used" — *fixed: document mode no longer hijacks
   routing; comparisons/derivations/7+ marks → Claude.*
3. "It's difficult to see where the data is coming from" — *fixed: windows titled per
   question, chat link on every answer.*
4. "It gave me another question's answer" — *fixed: fresh-chat guard + answer tag.*
5. "For diagrams, give the answer through Kimi / LazyCook-style diagrams / ChatGPT can
   make images, give the chat link" — *LazyCook's diagrams are Mermaid, which we render;
   the bug was a lost language tag, fixed. Generated images: chat link now, embed in
   DOCX at Step 8. Kimi stays out until its selectors are verified live.*
6. "20 rupees might seem cheap for one person but many people using it is already a good
   thing" — *yes, and the class cache is the mechanism. §2.*
7. "Proper website with support, docs, header, footer, contact, maker" — *§4, Step 5.*
8. "When people give one large file to one agent it fucks up the last questions" — *this
   is the pitch. §1. Put it on the landing page in those words, cleaned up.*
9. "Graphs, images, diagrams integrated in the docs so they don't have to do it
   themselves — only then they return and pay" — *Step 8 is the retention feature.*
10. "Make this an official Chrome extension" — *Step 4, started tomorrow morning because
    review is the long pole.*

---

## 7. What could still bite us

- **Site redesigns.** ChatGPT/Claude/Gemini change their DOM without notice. We serve
  selectors from the server (`extension_selectors.json`), so a fix is a file edit and a
  restart, no reinstall — but someone has to notice. Add a daily smoke run on a test
  account, and the failure reports already land in the server log.
- **Free-tier caps.** ChatGPT: 3 file uploads/day. Claude: ~15 messages per 5 hours.
  Routing respects both today; a 60-question bank on free accounts will still pause on
  Claude. The router degrades gracefully, but say "sign into all three" in the docs.
- **ToS** (§3). Carry it in the FAQ and in the Web Store description honestly.
- **One laptop = one run.** The extension runs in the student's browser; there is no
  server-side answering and there never will be. That's the economics, and it's also why
  the product can't be "used from phone". Say so.

---

*Next session starts at Step 1. Bring: PAN, bank details, a card for $5, and a domain name
you like.*
