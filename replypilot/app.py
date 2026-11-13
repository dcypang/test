"""ReplyPilot web app: landing page, reply generator, Stripe checkout + webhook.

Run:  uvicorn replypilot.app:app --reload
"""

from __future__ import annotations

import html
import os
from pathlib import Path

import stripe
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field

from .ai import AIError, ReplyWriter
from .db import PLANS, Store

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8000")
stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
PRICE_IDS = {plan: os.environ.get(f"STRIPE_PRICE_{plan.upper()}", "") for plan in PLANS if plan != "free"}

app = FastAPI(title="ReplyPilot")
app.state.store = None
app.state.writer = None


def store() -> Store:
    if app.state.store is None:
        app.state.store = Store()
    return app.state.store


def writer() -> ReplyWriter:
    if app.state.writer is None:
        app.state.writer = ReplyWriter()
    return app.state.writer


# --------------------------------------------------------------------------- pages
_INDEX = (Path(__file__).parent / "static" / "index.html").read_text()


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return _INDEX


@app.get("/health")
def health() -> dict:
    return {"ok": True}


# --------------------------------------------------------------------------- product API
class ReplyRequest(BaseModel):
    business: str = Field(min_length=1, max_length=120)
    review: str = Field(min_length=3, max_length=5000)
    rating: int | None = Field(default=None, ge=1, le=5)
    tone: str = Field(default="warm and professional", max_length=60)
    notes: str = Field(default="", max_length=500)


@app.post("/api/reply")
def generate_reply(body: ReplyRequest, request: Request, x_access_key: str | None = Header(default=None)) -> dict:
    s = store()
    if x_access_key:
        plan = s.plan_for_key(x_access_key)
        if plan is None:
            raise HTTPException(401, "Unknown or cancelled access key.")
        who = x_access_key
    else:
        plan = "free"
        who = "ip:" + (request.client.host if request.client else "unknown")

    limit = PLANS[plan][1]
    if not s.consume(who, limit):
        raise HTTPException(429, f"Daily limit of {limit} replies reached on the {plan} plan. Upgrade for more.")

    try:
        reply = writer().review_reply(
            business=body.business, review=body.review, rating=body.rating, tone=body.tone, notes=body.notes
        )
    except AIError as e:
        raise HTTPException(502, str(e)) from e
    return {"reply": reply, "plan": plan}


# --------------------------------------------------------------------------- billing
@app.get("/checkout/{plan}")
def checkout(plan: str):
    price = PRICE_IDS.get(plan)
    if not price or not stripe.api_key:
        raise HTTPException(503, "Billing is not configured yet. Set STRIPE_SECRET_KEY and STRIPE_PRICE_* env vars.")
    session = stripe.checkout.Session.create(
        mode="subscription",
        line_items=[{"price": price, "quantity": 1}],
        metadata={"plan": plan},
        subscription_data={"metadata": {"plan": plan}, "trial_period_days": 7},
        success_url=f"{BASE_URL}/success?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{BASE_URL}/#pricing",
    )
    return RedirectResponse(session.url, status_code=303)


@app.get("/success", response_class=HTMLResponse)
def success(session_id: str) -> str:
    """Verify the Checkout Session with Stripe, then show the customer their access key."""
    session = stripe.checkout.Session.retrieve(session_id)
    if session.status != "complete" or not session.subscription:
        raise HTTPException(402, "Payment not completed.")
    details = session.customer_details
    metadata = session.metadata
    key = store().upsert_subscription(
        email=(getattr(details, "email", None) or "") if details else "",
        plan=(getattr(metadata, "plan", None) or "starter") if metadata else "starter",
        stripe_customer=str(session.customer),
        stripe_subscription=str(session.subscription),
    )
    return (
        "<!doctype html><meta charset=utf-8><title>Welcome to ReplyPilot</title>"
        "<body style='font-family:system-ui;max-width:640px;margin:60px auto;padding:0 16px'>"
        "<h1>You're in.</h1><p>Your access key (save it somewhere safe):</p>"
        f"<pre style='background:#f3f3f3;padding:12px;overflow-x:auto'>{html.escape(key)}</pre>"
        "<p><a href='/'>Start writing replies →</a></p></body>"
    )


@app.post("/stripe/webhook")
async def stripe_webhook(request: Request, stripe_signature: str | None = Header(default=None)) -> dict:
    payload = await request.body()
    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature or "", WEBHOOK_SECRET)
    except (ValueError, stripe.SignatureVerificationError) as e:
        raise HTTPException(400, "Invalid webhook") from e

    obj = event["data"]["object"]
    if event["type"] == "customer.subscription.deleted":
        store().deactivate_subscription(obj["id"])
    elif event["type"] == "checkout.session.completed" and obj.get("subscription"):
        store().upsert_subscription(
            email=(obj.get("customer_details") or {}).get("email", ""),
            plan=(obj.get("metadata") or {}).get("plan", "starter"),
            stripe_customer=str(obj.get("customer")),
            stripe_subscription=str(obj["subscription"]),
        )
    return {"received": True}


@app.get("/admin/revenue")
def revenue(x_admin_token: str | None = Header(default=None)) -> dict:
    token = os.environ.get("ADMIN_TOKEN")
    if not token or x_admin_token != token:
        raise HTTPException(403, "Forbidden")
    return store().revenue_summary()
