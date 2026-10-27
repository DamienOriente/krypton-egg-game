// @ts-check
// Desktop shell: a single locked-down window around the static Vite build.
// Plain JS (type-checked by tsconfig.electron.json) so Electron runs it without a compile step.
import { app, BrowserWindow, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

/**
 * @param {BrowserWindow} window
 * @param {string} file
 */
function armSmokeTest(window, file) {
  // Hard stop so a hung renderer can never block a CI job.
  const watchdog = setTimeout(() => {
    console.error('[smoke] timeout');
    app.exit(2);
  }, 20000);
  window.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      try {
        const image = await window.webContents.capturePage();
        fs.writeFileSync(file, image.toPNG());
        console.log(`[smoke] ${image.getSize().width}x${image.getSize().height} -> ${file}`);
        clearTimeout(watchdog);
        app.exit(0);
      } catch (err) {
        console.error('[smoke] capture failed', err);
        app.exit(3);
      }
    }, 3000);
  });
  window.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error('[renderer]', event.message);
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
