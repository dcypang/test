// Launching the headless browser the test suites drive.
//
// Split out because Playwright insists on the browser build that matches the
// version of the package, and this machine ships a browser that was installed
// once and does not move. When the two drift apart Playwright refuses to start
// at all, which reads like the suites are broken when nothing is. So: use
// whatever browser is actually here, and only fall back to Playwright's own
// bookkeeping when there isn't one.
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium',
];

export function chromePath() {
  for (const p of CANDIDATES) if (p && existsSync(p)) return p;
  return undefined;
}

// Software rendering: these machines have no GPU, so WebGL runs on SwiftShader.
// Everything the suites measure is CPU-side for that reason.
export const GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];

export function launch(options = {}) {
  const exe = chromePath();
  return chromium.launch({
    ...(exe ? { executablePath: exe } : {}),
    ...options,
    args: [...GL_ARGS, ...(options.args || [])],
  });
}
