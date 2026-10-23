# chat-memory-bench

A memory benchmark for consumer chat apps. It drives the **Gemini app** (gemini.google.com) and **Meta AI with Muse Spark** (meta.ai) through a real browser and scores two things:

- **Conversational memory.** It states made-up facts during a chat ("my locker code is 4821"), then asks about them later.
- **Long-context recall.** It hides access codes ("needles") inside a long synthetic document and asks for them back.

All values are invented and generated from a fixed seed, so the models can't guess them, and every run uses the same prompts. Scoring checks for the expected strings and ignores case and punctuation. No judge model is used.

## Test suites

| Suite | Category | What it checks |
|---|---|---|
| conversational | `recall_after_{0,5,15}_turns` | One fact, then N unrelated turns, then the question |
| | `multi_fact` | 5 facts mixed with chatter; one question asks for 2 of them |
| | `fact_update` | A fact is corrected later in the chat; the newest value must win |
| | `abstention` | Asks about something never said; passes only if the model says it doesn't know |
| | `cross_session` (opt-in) | Says "remember this" in one chat, asks in a new chat. Tests the app's saved memory |
| long_context | `single_needle` | One code at depth 0–100% in documents of about 2k–128k tokens |
| | `multi_needle` | Three codes at depths 15%, 50% and 85%; partial credit per code |

By default each conversational category runs 3 times, which gives 48 tasks. Each task starts in a fresh chat.

## Setup

Requires Node 20+.

```sh
npm install
npx playwright install chromium   # skip if a Chromium is already installed
npm test                          # unit tests
npm run test:web                  # browser adapter vs. a local fake chat page
```

## Running against the real apps

Both apps need you to be signed in. The most reliable way is to attach to your own Chrome, because Google often blocks sign-in from automated browsers:

```sh
# 1. Start Chrome with a separate profile and sign in to gemini.google.com and meta.ai
google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.chat-bench-profile"

# 2. Run each target (this takes a while; the browser drives the real UI)
node src/run.js --target gemini --cdp http://localhost:9222
node src/run.js --target muse   --cdp http://localhost:9222

# 3. Build the side-by-side report
node src/report.js results/gemini.jsonl results/muse.jsonl > report.md
```

You can also run `node src/login.js gemini` to save a session file and pass it with `--storage-state .auth/gemini.json`.

Useful flags (`node src/run.js --help` lists them all):

- `--resume` continues after a crash or a rate limit, skipping tasks that already finished.
- `--only 'lc-single-2000'` runs a subset of tasks by id (a regex).
- `--sizes 2000,8000,32000` limits the long-context sizes.
- `--headed` shows the browser.
- `--pace-ms 5000` waits longer between messages if you hit rate limits.
- `--cross-session` adds the cross-chat test. **It writes fake facts into your account's saved memory.** Delete them afterwards in Gemini's "Saved info" and Meta AI's memory settings.

### Before a real run

- **Check the selectors.** Chat UIs change often. `src/adapters/targets.json` sets the input box, send button, reply element and "stop" button for each app. The Gemini selectors match its usual markup. The **meta.ai selectors are guesses and need checking** in DevTools. Try one task first, for example `--only conv-recall_after_0_turns-1 --headed`.
- **Pick the model.** Meta AI uses Muse Spark by default. In Gemini, choose the model (for example Pro or Flash) in the UI before you start, and note which one you used.
- **Turn off personalization if you want a clean comparison.** Saved memory or past-chat context can leak facts from one task into another. The fresh-chat design limits this, but `abstention` and `cross_session` are sensitive to it.
- **Expect some ERR results.** These usually mean the app rejected or truncated a very large paste. The report shows ERR separately from a wrong answer.

## Layout

```
src/run.js                 CLI runner; writes results/<target>.jsonl
src/report.js              Markdown report from one or more results files
src/login.js               Saves a signed-in session for --storage-state
src/tasks/                 Task generators (conversational, longContext)
src/score.js               Scoring by string match, plus abstention detection
src/adapters/web.js        Playwright adapter for chat UIs
src/adapters/targets.json  Per-app selectors
src/adapters/mock.js       Simulated backends: `mock` (perfect memory), `mock-small` (≈10k-token window)
```
