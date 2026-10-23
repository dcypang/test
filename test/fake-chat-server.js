'use strict';

// A local chat page that mimics a streaming assistant UI (Gemini-like markup),
// answered by the mock backend. Used to exercise the Playwright adapter offline.
const http = require('http');
const { MockAdapter } = require('../src/adapters/mock');

const PAGE = `<!doctype html><meta charset="utf-8"><title>Fake chat</title>
<div id="log"></div>
<rich-textarea><div class="ql-editor" contenteditable="true" style="min-height:2em;border:1px solid"></div></rich-textarea>
<button class="send-button">Send</button>
<script>
const input = document.querySelector('.ql-editor');
async function send() {
  const text = input.innerText; input.innerHTML = '';
  const res = await fetch('/send', { method: 'POST', body: text });
  const reply = await res.text();
  const host = document.createElement('model-response');
  const msg = document.createElement('message-content');
  host.append(msg); document.getElementById('log').append(host);
  const stop = document.createElement('button'); stop.setAttribute('aria-label', 'Stop response'); document.body.append(stop);
  for (const word of reply.split(' ')) { msg.textContent += word + ' '; await new Promise(r => setTimeout(r, 40)); }
  stop.remove();
}
document.querySelector('.send-button').onclick = send;
</script>`;

function startFakeChat(port = 0) {
  const brain = new MockAdapter();
  const server = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/') {
      await brain.newChat();
      res.end(PAGE);
    } else if (req.method === 'POST' && req.url === '/send') {
      let body = '';
      for await (const chunk of req) body += chunk;
      res.end(await brain.send(body));
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { startFakeChat };
