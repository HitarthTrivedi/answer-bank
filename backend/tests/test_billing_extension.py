"""The paid moment and the extension bridge.

Two things must hold no matter what the client says:
  1. a DOCX never leaves the server unless the bank is unlocked, and
  2. credits appear only via a verified payment, never because a browser asked nicely.
"""
import pytest

# env + the shared `client` fixture live in conftest.py

BANK = "1. Define normalization in DBMS. (5 marks)\n2. Calculate 12 * 4. (2 marks)\n"


@pytest.fixture(scope="module")
def auth(client):
    r = client.post("/api/auth/register", json={
        "email": "buyer@test.dev", "name": "Buyer One", "password": "supersecret1",
    })
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def _answered_project(client, auth, title, mode="auto", text=BANK):
    """Upload a bank, run it to completion, return the project id."""
    r = client.post("/api/projects", data={"title": title, "text": text}, headers=auth)
    pid = r.json()["id"]
    for _ in range(60):
        p = client.get(f"/api/projects/{pid}", headers=auth).json()
        if p["status"] in ("review", "error"):
            break
    assert p["status"] == "review", p
    client.post(f"/api/projects/{pid}/start", json={"engine_mode": mode}, headers=auth)
    for _ in range(120):
        p = client.get(f"/api/projects/{pid}", headers=auth).json()
        if p["status"] == "done" or p["counts"].get("assist_waiting"):
            break
    return pid


# ---------------- the export paywall ----------------


def test_first_bank_is_free_then_export_costs_a_credit(client, auth):
    first = _answered_project(client, auth, "Free Bank")
    r = client.get(f"/api/projects/{first}/export", headers=auth)
    assert r.status_code == 200
    assert r.content[:2] == b"PK"  # a real .docx is a zip

    # re-download of an already-unlocked bank stays free forever
    assert client.get(f"/api/projects/{first}/export", headers=auth).status_code == 200

    second = _answered_project(client, auth, "Paid Bank")
    r = client.get(f"/api/projects/{second}/export", headers=auth)
    assert r.status_code == 402
    detail = r.json()["detail"]
    assert detail["code"] == "payment_required"
    assert detail["credits"] == 0
    assert detail["packs"], "the paywall must carry the packs it wants to sell"


def test_credits_require_a_completed_order(client, auth):
    balance = client.get("/api/billing/me", headers=auth).json()
    assert balance["credits"] == 0

    order = client.post("/api/billing/checkout", json={"credits": 1}, headers=auth).json()
    assert order["amount_inr"] == 20

    # an order that exists but is unpaid grants nothing
    assert client.get("/api/billing/me", headers=auth).json()["credits"] == 0

    client.get(order["pay_url"])  # mock gateway stands in for the webhook
    assert client.get("/api/billing/me", headers=auth).json()["credits"] == 1

    # replaying the gateway callback must not mint a second credit
    client.get(order["pay_url"])
    assert client.get("/api/billing/me", headers=auth).json()["credits"] == 1


def test_paid_credit_unlocks_the_second_bank(client, auth):
    pid = [p["id"] for p in client.get("/api/projects", headers=auth).json()
           if p["title"] == "Paid Bank"][0]
    assert client.get(f"/api/projects/{pid}/export", headers=auth).status_code == 200
    assert client.get("/api/billing/me", headers=auth).json()["credits"] == 0

    ledger = client.get("/api/billing/history", headers=auth).json()
    assert [t["reason"] for t in ledger][:2] == ["spend", "purchase"]
    assert ledger[0]["balance_after"] == 0


def test_webhook_rejects_an_unsigned_payload(client):
    r = client.post("/api/billing/webhook", json={"event": "payment_link.paid"})
    assert r.status_code == 400


# ---------------- extension bridge ----------------


EXT_BANK = ("1. Explain ACID properties with an example. (10 marks)\n"
            "2. Compute the median of 3, 9, 4, 7. (2 marks)\n")


def test_extension_mode_parks_every_question_for_the_students_own_ai(client, auth):
    pid = _answered_project(client, auth, "Extension Bank", mode="extension", text=EXT_BANK)
    p = client.get(f"/api/projects/{pid}", headers=auth).json()
    # mock providers are available, yet nothing was answered by them
    assert p["counts"].get("assist_waiting") == p["total"]
    assert p["engine_mode"] == "extension"

    work = client.get(f"/api/extension/work?project_id={pid}", headers=auth).json()
    assert work["done"] is False
    assert work["prompt"], "the extension must receive a ready-made prompt"
    assert "<question>" in work["prompt"]
    assert work["preferred_site"] in ("chatgpt", "claude", "gemini")

    # answering through the normal assist route clears it
    r = client.post(f"/api/questions/{work['question_id']}/assist",
                    json={"content_md": "**Given** ...\n\nFINAL: 48"}, headers=auth)
    assert r.status_code == 200
    after = client.get(f"/api/extension/work?project_id={pid}", headers=auth).json()
    assert after["question_id"] != work["question_id"]


def test_cache_hits_skip_the_browser_even_in_extension_mode(client, auth):
    """A question the class already answered costs nobody anything — not our API quota,
    and not a trip through the student's browser. The cache outranks the engine mode."""
    pid = _answered_project(client, auth, "Cached In Extension Mode", mode="extension")
    p = client.get(f"/api/projects/{pid}", headers=auth).json()
    assert p["counts"].get("answered") == p["total"]
    assert p["counts"].get("assist_waiting") is None
    assert all(q["answer"]["engine"] == "cache" for q in p["questions"])


def test_pairing_code_is_single_use_and_never_leaks_the_password(client, auth):
    code = client.post("/api/extension/pair", headers=auth).json()["code"]
    assert len(code) == 8

    r = client.post("/api/extension/claim", json={"code": code})
    assert r.status_code == 200
    paired = r.json()
    assert paired["user"]["email"] == "buyer@test.dev"
    assert "password" not in str(paired)

    # replaying the same code gets nothing
    assert client.post("/api/extension/claim", json={"code": code}).status_code == 401
    assert client.post("/api/extension/claim", json={"code": "ZZZZZZZZ"}).status_code == 401

    # the token it handed over is a real session
    hdr = {"Authorization": f"Bearer {paired['access_token']}"}
    assert client.get("/api/extension/projects", headers=hdr).status_code == 200


def test_extension_endpoints_require_auth(client):
    assert client.get("/api/extension/work").status_code == 401
    assert client.get("/api/extension/config").status_code == 401
    assert client.post("/api/extension/pair").status_code == 401


def test_one_students_bank_is_invisible_to_another(client, auth):
    other = client.post("/api/auth/register", json={
        "email": "other@test.dev", "name": "Other", "password": "supersecret1",
    }).json()
    hdr = {"Authorization": f"Bearer {other['access_token']}"}
    mine = client.get("/api/projects", headers=auth).json()[0]["id"]
    assert client.get(f"/api/projects/{mine}/export", headers=hdr).status_code == 404
    assert client.get(f"/api/extension/work?project_id={mine}", headers=hdr).json()["done"] is True
