'use strict';

// Drives a consumer chat web app through Playwright. Selectors live in targets.json
// (or a file passed with --selectors) because these UIs change often.
class WebChatAdapter {
  constructor(name, cfg, { cdp, storageState, headless = true, timeoutMs = 180000, stableMs = 3000 } = {}) {
    this.name = name;
    this.cfg = cfg;
    this.opts = { cdp, storageState, headless, timeoutMs, stableMs };
  }

  async init() {
    const { chromium } = require('playwright');
    if (this.opts.cdp) {
      // Recommended: attach to your own Chrome, already signed in, started with --remote-debugging-port.
      this.browser = await chromium.connectOverCDP(this.opts.cdp);
      this.context = this.browser.contexts()[0] ?? (await this.browser.newContext());
    } else {
      this.browser = await chromium.launch({ headless: this.opts.headless });
      this.context = await this.browser.newContext({ storageState: this.opts.storageState });
    }
    this.page = await this.context.newPage();
  }

  async close() {
    await this.page?.close().catch(() => {});
    // Over CDP, closing would kill the user's own browser; just disconnect.
    if (!this.opts.cdp) await this.browser?.close();
  }

  async newChat() {
    await this.page.goto(this.cfg.newChatUrl, { waitUntil: 'domcontentloaded' });
    await this.page.locator(this.cfg.input).first().waitFor({ state: 'visible', timeout: 30000 });
  }

  async send(text) {
    const { page, cfg } = this;
    const responses = page.locator(cfg.response);
    const before = await responses.count();

    const input = page.locator(cfg.input).first();
    await input.click();
    // insertText handles very long prompts far faster than simulated typing.
    await input.evaluate((el, t) => {
      el.focus();
      document.execCommand('insertText', false, t);
    }, text);

    const sendButton = page.locator(cfg.send).first();
    if (cfg.send && (await sendButton.isVisible().catch(() => false))) await sendButton.click();
    else await input.press('Enter');

    const deadline = Date.now() + this.opts.timeoutMs;
    while ((await responses.count()) <= before) {
      if (Date.now() > deadline) throw new Error('no response appeared (input rejected or selectors out of date)');
      await page.waitForTimeout(500);
    }

    // Wait until the newest reply has stopped streaming.
    const last = responses.last();
    let prev = null;
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      await page.waitForTimeout(500);
      const now = await last.innerText().catch(() => '');
      const busy = cfg.busy ? await page.locator(cfg.busy).first().isVisible().catch(() => false) : false;
      if (now !== prev || busy) {
        prev = now;
        stableSince = Date.now();
      } else if (now && Date.now() - stableSince >= this.opts.stableMs) {
        return now;
      }
    }
    throw new Error('reply did not finish before timeout');
  }
}

module.exports = { WebChatAdapter };
