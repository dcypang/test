# ReplyPilot

An AI service that writes replies to Google, Yelp and TripAdvisor reviews for local businesses, sold as a
subscription ($29 / $79 / $249 a month). It also includes a daily sales agent that drafts personalised outreach emails.

See **[BUSINESS_PLAN.md](BUSINESS_PLAN.md)** for the path to $1,000/day and what it realistically takes.

## What's included
| Piece | File |
|---|---|
| Landing page, reply tool and pricing | `replypilot/static/index.html` |
| Web app: reply API, free-tier limits, Stripe checkout and webhook, revenue endpoint | `replypilot/app.py` |
| Claude integration (Opus 5.5, with refusal fallback) | `replypilot/ai.py` |
| Customers, access keys and usage limits (SQLite) | `replypilot/db.py` |
| Daily sales agent and revenue report | `scripts/daily_agent.py` |
| Tests | `tests/` (`pytest`) |

## Run it locally
```bash
pip install -r requirements.txt
cp .env.example .env        # fill in your keys
export $(grep -v '^#' .env | xargs)
uvicorn replypilot.app:app --reload
# open http://localhost:8000
```

## Go live (about one afternoon)
1. **Anthropic API key:** create one at console.anthropic.com and set it as `ANTHROPIC_API_KEY`.
2. **Stripe:** create a product with three monthly prices (29, 79, 249). Put their price IDs in
   `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO` and `STRIPE_PRICE_AGENCY`, and your secret key in `STRIPE_SECRET_KEY`.
   Add a webhook pointing to `https://YOUR-DOMAIN/stripe/webhook` for the events `checkout.session.completed` and
   `customer.subscription.deleted`, then set `STRIPE_WEBHOOK_SECRET`.
3. **Deploy** to any Python host (Render, Railway, Fly.io) with the start command
   `uvicorn replypilot.app:app --host 0.0.0.0 --port $PORT`. Put the SQLite file (`REPLYPILOT_DB`) on a
   persistent disk, and set `BASE_URL` to your domain.
4. **Start the daily routine** described in BUSINESS_PLAN.md.

Check revenue at any time: `curl -H "X-Admin-Token: $ADMIN_TOKEN" https://YOUR-DOMAIN/admin/revenue`
