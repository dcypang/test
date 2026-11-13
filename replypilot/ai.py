"""Claude-powered text generation: review replies (the product) and outreach emails (sales)."""

from __future__ import annotations

import anthropic

MODEL = "claude-opus-5-5"
_FALLBACK_BETA = "server-side-fallback-2026-07-01"

REPLY_SYSTEM = """You write public replies to online customer reviews on behalf of a local business.

Rules:
- Write as the business owner, in first person plural ("we").
- Address the specific things the reviewer mentioned; never sound generic or templated.
- Positive review: thank them warmly, echo one concrete detail, invite them back. 2-4 sentences.
- Negative or mixed review: apologise sincerely without admitting legal liability, acknowledge the
  specific problem, state one concrete fix or next step, and offer an offline contact. 3-5 sentences.
- Never invent facts (discounts, staff names, policies) that were not provided.
- Never argue with the reviewer, never reveal private customer details.
- Output only the reply text. No preamble, no quotation marks, no sign-off placeholders."""

OUTREACH_SYSTEM = """You write short, honest cold emails selling ReplyPilot, a service that drafts
professional replies to a business's Google/Yelp reviews in seconds.

Rules:
- 70-110 words. Plain text. One subject line first, formatted as "Subject: ...", then a blank line, then the body.
- Open with one specific, true observation about the business taken from the data provided.
- One clear benefit, one clear call to action (reply to this email for a free week).
- No hype, no fake urgency, no claims you cannot back up. Do not invent statistics.
- Sign off as {sender_name}."""


class AIError(RuntimeError):
    """Raised when Claude could not produce usable text."""


class ReplyWriter:
    """Thin wrapper around the Anthropic client so the web app and scripts can share it (and tests can fake it)."""

    def __init__(self, client: anthropic.Anthropic | None = None):
        self._client = client or anthropic.Anthropic()

    def _complete(self, system: str, prompt: str, max_tokens: int = 4000) -> str:
        try:
            response = self._client.beta.messages.create(
                model=MODEL,
                max_tokens=max_tokens,
                system=system,
                output_config={"effort": "low"},  # short, well-specified writing task
                betas=[_FALLBACK_BETA],
                fallbacks="default",  # retry on a fallback model if a safety classifier declines
                messages=[{"role": "user", "content": prompt}],
            )
        except anthropic.RateLimitError as e:
            raise AIError("The AI service is busy. Please try again in a minute.") from e
        except anthropic.APIStatusError as e:
            raise AIError(f"AI service error ({e.status_code}).") from e
        except anthropic.APIConnectionError as e:
            raise AIError("Could not reach the AI service.") from e

        if response.stop_reason == "refusal":
            raise AIError("This review could not be answered automatically. Please reply manually.")
        text = "".join(b.text for b in response.content if b.type == "text").strip()
        if not text:
            raise AIError("The AI returned an empty reply.")
        return text

    def review_reply(self, *, business: str, review: str, rating: int | None, tone: str, notes: str = "") -> str:
        prompt = (
            f"Business: {business}\n"
            f"Star rating: {rating if rating else 'unknown'} / 5\n"
            f"Desired tone: {tone}\n"
            f"Facts the owner wants included (may be empty): {notes or '-'}\n\n"
            f"<review>\n{review}\n</review>\n\nWrite the reply."
        )
        return self._complete(REPLY_SYSTEM, prompt)

    def outreach_email(self, *, lead: dict[str, str], sender_name: str, offer_url: str) -> str:
        facts = "\n".join(f"{k}: {v}" for k, v in lead.items() if v)
        prompt = f"Business data:\n{facts}\n\nSign-up link to mention once: {offer_url}\n\nWrite the email."
        return self._complete(OUTREACH_SYSTEM.format(sender_name=sender_name), prompt)
