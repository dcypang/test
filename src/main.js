// ---------------------------------------------------------------------------
// main.js - bootstrap.
// ---------------------------------------------------------------------------

function fatal(message, detail) {
  const el = document.getElementById('loading');
  if (el) {
    el.classList.remove('hidden');
    el.innerHTML = `<div class="panel error">
      <h2>Can't start the game</h2>
      <p>${message}</p>
      ${detail ? `<pre>${String(detail).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>` : ''}
    </div>`;
  }
  console.error(message, detail);
}

function startGame() {
  const canvas = document.getElementById('gl');
  const hudCanvas = document.getElementById('hud');
  if (!canvas) return;

  let game;
  try {
    game = new Game(canvas, hudCanvas, null);
  } catch (err) {
    fatal('This game needs WebGL2. Try a recent Chrome, Firefox, Edge or Safari, and make sure hardware acceleration is enabled.', err && err.message);
    return;
  }

  try {
    game.ui = new UI(game);
  } catch (err) {
    fatal('The interface failed to start.', err && err.stack);
    return;
  }

  window.__game = game;

  // The audio context can only start from a gesture.
  const resume = () => {
    game.audio.start();
    game.audio.resume();
    // When the page is embedded, key events go to the host until the frame
    // itself has focus. Claim it on the first click or keypress.
    try { window.focus(); } catch (e) { /* cross-origin host, nothing to do */ }
  };
  window.addEventListener('pointerdown', resume, { once: true });
  window.addEventListener('keydown', resume, { once: true });

  game.boot().then(() => {
    game.frame();
  }).catch((err) => {
    fatal('Something went wrong while building the world.', err && err.stack);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startGame);
} else {
  startGame();
}
