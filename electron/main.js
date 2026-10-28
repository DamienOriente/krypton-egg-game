// @ts-check
// Desktop shell: a single locked-down window around the static Vite build.
// Plain JS (type-checked by tsconfig.electron.json) so Electron runs it without a compile step.
import { app, BrowserWindow, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MIN_LUMA_STD, lumaStats } from './smoke.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = path.join(here, '..', 'dist', 'index.html');

// `--smoke-test=<file.png>`: load the game, save a screenshot and quit (used by CI to prove the package renders).
const smokeArg = process.argv.find((a) => a.startsWith('--smoke-test='));
const smokeFile = smokeArg ? smokeArg.slice('--smoke-test='.length) : null;

/** @type {BrowserWindow | null} */
let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 960,
    minHeight: 540,
    backgroundColor: '#05070c',
    title: 'Krypton Egg',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Lets the title music start without waiting for a first click.
      autoplayPolicy: 'no-user-gesture-required',
      // A window that is hidden or behind others gets its frames suspended. Players launch
      // the game in front, but the smoke test runs it unseen (CI has no display), and a
      // suspended frame loop means a black capture and an intro that never ends.
      backgroundThrottling: !smokeFile,
    },
  });

  // The game never needs to leave its own page: block navigation, send real links to the browser.
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      shell.openExternal(url).catch((err) => console.error('[main] openExternal failed', err));
    }
    return { action: 'deny' };
  });

  win.once('ready-to-show', () => {
    if (!win) return;
    if (!smokeFile) win.maximize();
    win.show();
  });
  win.on('closed', () => {
    win = null;
  });

  if (smokeFile) armSmokeTest(win, smokeFile);

  win.loadFile(indexHtml).catch((err) => {
    console.error('[main] cannot load', indexHtml, err);
    app.exit(1);
  });
}

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Smoke test: wait for the title screen (i.e. the logo intro has played), capture it,
 * and fail when the picture is nearly uniform (a black screen means the game did not
 * render). A short report goes to stdout and next to the PNG for the CI logs.
 * Exit codes: 0 ok, 2 watchdog, 3 capture error, 4 uniform picture, 5 title never reached.
 * @param {BrowserWindow} window
 * @param {string} file
 */
function armSmokeTest(window, file) {
  const t0 = Date.now();
  const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1);
  // Hard stop so a hung renderer can never block a CI job.
  const watchdog = setTimeout(() => {
    console.error('[smoke] timeout');
    app.exit(2);
  }, 45000);
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error('[renderer]', event.message);
  });
  window.webContents.once('did-finish-load', async () => {
    try {
      let screen = '';
      let clicked = false;
      while (Date.now() - t0 < 30000) {
        screen = String(await window.webContents.executeJavaScript('document.documentElement.dataset.screen ?? ""'));
        if (screen === 'title') break;
        // The intro starts on its own in Electron; a machine without an audio device keeps
        // it on its "press start" screen, so give it the one click a player would.
        if (!clicked && Date.now() - t0 > 12000) {
          clicked = true;
          for (const type of /** @type {const} */ (['mouseDown', 'mouseUp'])) {
            window.webContents.sendInputEvent({ type, x: 200, y: 200, button: 'left', clickCount: 1 });
          }
        }
        await sleep(250);
      }
      const reachedAt = elapsed();
      // Let the title settle: menu, floating bricks, egg.
      await sleep(1500);
      const image = await window.webContents.capturePage();
      fs.writeFileSync(file, image.toPNG());
      // A fixed-size copy has a single representation, so its bitmap matches getSize().
      const small = image.resize({ width: 480 });
      const { width, height } = small.getSize();
      const { mean, std } = lumaStats(small.toBitmap(), width, height);
      const ok = screen === 'title' && std >= MIN_LUMA_STD;
      const report = [
        `screen=${screen} after ${reachedAt}s${clicked ? ' (needed a click: no audio device?)' : ''}`,
        `capture ${image.getSize().width}x${image.getSize().height}, luma mean=${mean.toFixed(1)} std=${std.toFixed(1)} (min ${MIN_LUMA_STD})`,
        ok ? 'result=OK' : screen !== 'title' ? 'result=FAIL title screen never reached' : 'result=FAIL capture is nearly uniform: the game did not render',
      ];
      fs.writeFileSync(file.replace(/\.png$/i, '') + '.txt', report.join('\n') + '\n');
      for (const line of report) (ok ? console.log : console.error)(`[smoke] ${line}`);
      clearTimeout(watchdog);
      app.exit(ok ? 0 : screen !== 'title' ? 5 : 4);
    } catch (err) {
      console.error('[smoke] capture failed', err);
      app.exit(3);
    }
  });
}

// A second double-click focuses the running game instead of starting another copy.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    // Keep the standard app menu on macOS (Cmd+Q, Cmd+H...), no menu bar elsewhere.
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // It's a game, not a document app: closing the window quits on every platform.
  app.on('window-all-closed', () => app.quit());
}
