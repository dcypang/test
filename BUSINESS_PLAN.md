# ReplyPilot: plan to reach $1,000/day

## First, the honest part
No idea, product or agent can **guarantee** $1,000/day. Anything sold as guaranteed passive income at that level
(trading bots, "AI arbitrage", dropshipping courses) is a scam or a coin flip. What *can* reach $1,000/day is a
real product that people pay for every month. That takes consistent daily sales work, usually over **12–24 months**,
and many attempts never get there. This plan is built to give you the best odds, not a promise.

## The idea
Local businesses (restaurants, dentists, salons, auto shops, hotels) get reviews every week. Replying to them
helps trust and local search ranking, but owners rarely have the time, so many reviews go unanswered.
**ReplyPilot** writes a specific, professional reply in about 10 seconds. The owner copies and posts it.

Why this idea:
- **Easy to spot who needs it.** Any business with unanswered reviews on Google Maps is a lead, and you can see that before you contact them.
- **Cheap to run.** Each reply is a short AI call costing a fraction of a cent, so most of each subscription is profit.
- **Recurring.** New reviews keep coming, so customers keep paying monthly.
- **Agencies resell it.** Marketing agencies that manage dozens of clients are natural buyers for the $249 plan.

## The math
$1,000/day ≈ **$30,400 in monthly recurring revenue (MRR)**. A few ways to get there:

| Mix | Customers | MRR |
|---|---|---|
| All Pro ($79) | 385 | $30,415 |
| 200 Starter + 200 Pro + 40 Agency | 440 | $31,560 |
| 100 Agency ($249) + 75 Pro | 175 | $30,825 |

The agency route needs the fewest customers. One agency with 20 clients is worth more than 8 Pro customers.

## The daily engine (what you do every day)
1. **Find 40 leads.** Look for businesses with 4+ unanswered reviews on Google Maps or Yelp. Put them in `leads.csv`.
2. **Run the agent:** `python scripts/daily_agent.py leads.csv --sender "Your Name"`. It drafts a personalised
   email for each lead in `outbox/YYYY-MM-DD.csv`, skips anyone already contacted, and prints your revenue against the $1,000/day goal.
3. **Read and send** the drafts from your own mailbox. Follow cold-email law (CAN-SPAM/GDPR): include your real
   address and an opt-out, and stop when someone asks.
4. **Reply to every response the same day** and offer the 7-day free trial.
5. **Once a week, pitch 5 agencies** about the Agency plan.

Rough funnel to check yourself against: 40 emails/day → ~1,000/month → 2–4% start a trial → 30–40% of trials pay
→ **roughly 8–15 new customers a month at the start.** These are rough starting guesses, not measurements, so track
your real numbers. To reach $30k MRR you'll need to improve on them through referrals, agencies, SEO pages
("how to reply to a bad review at a [restaurant]") and a Google Business Profile integration (see roadmap).

## Costs
- AI: about $0.001–0.01 per reply on Claude Opus 5.5 at low effort. 100k replies/month is roughly $100–1,000.
- Hosting: about $5–25/month (Render, Railway, Fly.io).
- Stripe: 2.9% + 30¢ per charge.
- At $30k MRR, expect gross margin above 90%.

## Roadmap (in order of revenue impact)
1. Connect to Google Business Profile so replies post automatically (the biggest upgrade, and it justifies higher prices).
2. Weekly email listing new reviews with reply drafts ready to approve.
3. White-label branding for agencies.
4. Multi-language replies (charge more for hospitality and tourism).
