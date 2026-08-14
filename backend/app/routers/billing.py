"""Credit balance, credit purchases, and the payment webhook.

Trust boundary: the browser can *start* an order, never finish one. Credits are granted
in exactly one place — `_grant()` — reached only by a signature-verified webhook (or the
mock gateway when MOCK_PAYMENTS=true).
"""
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..models import CreditTxn, Order, User
from ..security import audit, client_ip, current_user
from ..services import billing, payments

log = logging.getLogger("answerbank.billing")
router = APIRouter(prefix="/api/billing", tags=["billing"])


@router.get("/me")
def my_balance(user: User = Depends(current_user), db: Session = Depends(get_db)):
    return billing.status(db, user)


@router.get("/history")
def history(user: User = Depends(current_user), db: Session = Depends(get_db)):
    rows = (db.query(CreditTxn).filter_by(user_id=user.id)
            .order_by(CreditTxn.at.desc()).limit(50).all())
    return [{"delta": t.delta, "reason": t.reason, "ref": t.ref,
             "balance_after": t.balance_after, "at": t.at.isoformat()} for t in rows]


class CheckoutIn(BaseModel):
    credits: int = Field(ge=1, le=100)


@router.post("/checkout")
async def checkout(body: CheckoutIn, request: Request,
                   user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Create an order for one of the configured packs and return a payment URL."""
    s = get_settings()
    if not payments.enabled():
        raise HTTPException(503, "Payments are not configured on this server yet")

    pack = next((p for p in s.packs if p["credits"] == body.credits), None)
    if pack is None:
        raise HTTPException(400, "Unknown credit pack")

    order = Order(user_id=user.id, credits=pack["credits"], amount_paise=pack["inr"] * 100,
                  provider=payments.provider_name())
    db.add(order)
    db.commit()

    try:
        ref, url = await payments.create_link(
            order.id, order.amount_paise,
            f"AnswerBank — {pack['credits']} question bank credit(s)",
            user.email, user.name,
        )
    except payments.PaymentError as e:
        order.status = "failed"
        db.commit()
        raise HTTPException(502, str(e))

    order.provider_ref, order.pay_url = ref, url
    db.commit()
    audit(db, "order_created", user.id, detail=f"{order.id} {pack['credits']}cr", ip=client_ip(request))
    return {"order_id": order.id, "pay_url": url, "amount_inr": pack["inr"], "credits": pack["credits"]}


@router.get("/orders/{order_id}")
def order_status(order_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Polled by the billing page while the student pays in the other tab."""
    order = db.get(Order, order_id)
    if order is None or order.user_id != user.id:
        raise HTTPException(404, "Order not found")
    return {"id": order.id, "status": order.status, "credits": order.credits,
            "balance": user.credits or 0}


def _grant(db: Session, order: Order, provider_ref: str = "") -> bool:
    """Idempotent: a webhook that fires twice must not hand out credits twice."""
    if order.status == "paid":
        return False
    user = db.get(User, order.user_id)
    if user is None:
        return False
    order.status = "paid"
    order.paid_at = datetime.now(timezone.utc)
    if provider_ref:
        order.provider_ref = provider_ref
    db.commit()
    billing.post(db, user, order.credits, "purchase", ref=order.id)
    log.info("granted %s credits to %s (order %s)", order.credits, user.id, order.id)
    return True


@router.post("/webhook")
async def webhook(request: Request, db: Session = Depends(get_db)):
    """Razorpay → us. Signature is checked against the raw body before anything else."""
    raw = await request.body()
    if not payments.verify_webhook(raw, request.headers.get("X-Razorpay-Signature", "")):
        audit(db, "webhook_bad_signature", detail=request.headers.get("X-Razorpay-Event-Id", "")[:80],
              ip=client_ip(request))
        raise HTTPException(400, "Invalid signature")

    order_id, provider_ref = payments.order_id_from_webhook(await request.json())
    if not order_id:
        return {"ok": True, "ignored": True}    # event we don't act on — 200 so it isn't retried

    order = db.get(Order, order_id)
    if order is None:
        log.warning("webhook for unknown order %s", order_id)
        return {"ok": True, "ignored": True}
    granted = _grant(db, order, provider_ref or "")
    audit(db, "order_paid" if granted else "order_paid_duplicate", order.user_id, detail=order.id)
    return {"ok": True}


# ---------------------------------------------------------------- mock gateway


@router.get("/mock-pay/{order_id}", response_class=HTMLResponse)
def mock_pay(order_id: str, db: Session = Depends(get_db)):
    """Stand-in for the Razorpay hosted page when MOCK_PAYMENTS=true. Unauthenticated by
    design (a real gateway page is too) — it can only complete an order that already
    exists, and only ever credits that order's own owner."""
    s = get_settings()
    if not s.mock_payments:
        raise HTTPException(404, "Not found")
    order = db.get(Order, order_id)
    if order is None:
        raise HTTPException(404, "Order not found")
    already = order.status == "paid"
    if not already:
        _grant(db, order)
    return HTMLResponse(f"""<!doctype html><meta charset="utf-8">
<title>Mock payment</title>
<style>
 body{{font:15px/1.6 system-ui,sans-serif;background:#0f172a;color:#e2e8f0;
      display:grid;place-items:center;height:100vh;margin:0;text-align:center}}
 .c{{border:1px solid #334155;background:#1e293b;border-radius:16px;padding:32px 40px;max-width:380px}}
 .t{{font-size:40px}} b{{color:#34d399}} a{{color:#818cf8}}
</style>
<div class="c">
 <div class="t">✓</div>
 <h2>{'Already paid' if already else 'Payment successful'}</h2>
 <p><b>{order.credits} credit(s)</b> added — ₹{order.amount_paise // 100}</p>
 <p style="color:#64748b;font-size:13px">Mock gateway (MOCK_PAYMENTS=true). No money moved.</p>
 <p><a href="{s.payment_callback_url}">← Back to AnswerBank</a></p>
</div>""")
