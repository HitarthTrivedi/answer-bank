"""Razorpay Payment Links, plus a mock gateway so the whole billing flow runs with no
account and no keys (mirrors MOCK_LLM).

Payment Links are deliberate: no checkout SDK in the frontend, no PCI surface, no card
data anywhere near this server. We hand the student a URL, they pay by UPI, Razorpay
calls our webhook, the webhook grants credits. The client is never trusted to report
its own payment.
"""
import base64
import hashlib
import hmac
import logging

import httpx

from ..config import get_settings

log = logging.getLogger("prism.payments")

_API = "https://api.razorpay.com/v1/payment_links"
_TIMEOUT = 20.0


class PaymentError(Exception):
    pass


def enabled() -> bool:
    s = get_settings()
    return s.mock_payments or bool(s.razorpay_key_id and s.razorpay_key_secret)


def provider_name() -> str:
    return "mock" if get_settings().mock_payments else "razorpay"


async def create_link(order_id: str, amount_paise: int, description: str,
                      customer_email: str, customer_name: str) -> tuple[str, str]:
    """Returns (provider_ref, pay_url). In mock mode the URL points back at our own
    /api/billing/mock-pay page, which completes the order exactly like a webhook would."""
    s = get_settings()
    if s.mock_payments:
        return f"mock_{order_id}", f"/api/billing/mock-pay/{order_id}"

    if not (s.razorpay_key_id and s.razorpay_key_secret):
        raise PaymentError("Razorpay keys are not configured")

    auth = base64.b64encode(f"{s.razorpay_key_id}:{s.razorpay_key_secret}".encode()).decode()
    payload = {
        "amount": amount_paise,
        "currency": "INR",
        "accept_partial": False,
        "description": description[:255],
        "customer": {"email": customer_email, "name": customer_name[:60]},
        "notify": {"email": False, "sms": False},   # we show the link in-app ourselves
        "reminder_enable": False,
        "notes": {"order_id": order_id},            # webhook reads this back
        "callback_url": s.payment_callback_url,
        "callback_method": "get",
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        r = await client.post(_API, json=payload,
                              headers={"Authorization": f"Basic {auth}"})
    if r.status_code >= 300:
        log.error("razorpay payment link failed: %s %s", r.status_code, r.text[:400])
        raise PaymentError(f"Payment gateway rejected the request ({r.status_code})")
    data = r.json()
    return data["id"], data["short_url"]


def verify_webhook(raw_body: bytes, signature: str) -> bool:
    """Razorpay signs the exact raw request body with the webhook secret (HMAC-SHA256).
    Must run on the untouched bytes — re-serialized JSON will not match."""
    secret = get_settings().razorpay_webhook_secret
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def order_id_from_webhook(body: dict) -> tuple[str | None, str | None]:
    """Pull (our order id, razorpay's ref) out of a payment_link.paid / payment.captured
    event. Returns (None, None) for events we don't act on."""
    event = body.get("event", "")
    payload = body.get("payload", {})
    if event.startswith("payment_link."):
        entity = payload.get("payment_link", {}).get("entity", {})
    elif event.startswith("payment."):
        entity = payload.get("payment", {}).get("entity", {})
    else:
        return None, None
    if event not in ("payment_link.paid", "payment.captured"):
        return None, None
    notes = entity.get("notes") or {}
    return notes.get("order_id"), entity.get("id")
