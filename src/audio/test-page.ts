/**
 * Audition page for the audio engine (served by Vite at /audio-test.html).
 * Dev tool only: plain DOM, no styling framework.
 */
import { audio } from './audio';
import type { Jingle, MusicTrack, SfxName } from './audio';
import { SFX_NAMES } from './sfx';

const GROUPS: ReadonlyArray<readonly [string, readonly SfxName[]]> = [
  ['Ball & bricks', ['paddle', 'wall', 'brick', 'brickHit', 'brickMetalBreak', 'brickGold', 'brickRegen', 'launch', 'glue', 'shieldHit', 'teleport', 'lifeLost']],
  ['Weapons & blasts', ['laser', 'explosion', 'bigExplosion', 'paddleDeath']],
  ['Pickups', ['powerupDrop', 'powerupGood', 'powerupBad', 'extraLife', 'expand', 'shrink', 'multiball', 'shield', 'freeze', 'darkness', 'drunk', 'rocket', 'dynamite', 'warp', 'slow', 'fast', 'fireball', 'bigball', 'double', 'laserGet', 'catchGet']],
  ['Enemies & boss', ['enemySpawn', 'enemyHit', 'enemyShoot', 'dagger', 'invaderStep', 'gateOpen', 'bossHit', 'bossShoot', 'bossCharge', 'bossRoar', 'bossDeath']],
  ['UI', ['menuMove', 'menuSelect', 'codeOk', 'codeBad', 'pause', 'unpause', 'scoreTick']],
];
const TRACK_NAMES: readonly MusicTrack[] = ['title', 'game1', 'game2', 'game3', 'boss', 'victory'];
const JINGLE_NAMES: readonly Jingle[] = ['levelStart', 'levelClear', 'gameOver', 'bossIntro', 'codeReveal'];
/** Major-pentatonic combo run, like the game climbing the brick ping scale. */
const COMBO = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  parent?.appendChild(node);
  return node;
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`audio-test: missing #${id}`);
  return node;
}

function section(root: HTMLElement, title: string): HTMLElement {
  el('h2', title, root);
  const row = el('div', undefined, root);
  row.className = 'row';
  return row;
}

function slider(parent: HTMLElement, label: string, min: number, max: number, step: number, value: number, onInput?: (v: number) => void): () => number {
  const wrap = el('label', label, parent);
  const input = el('input', undefined, wrap);
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const out = el('output', String(value), wrap);
  input.addEventListener('input', () => {
    out.textContent = input.value;
    onInput?.(Number(input.value));
  });
  return () => Number(input.value);
}

function button(parent: HTMLElement, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', label, parent);
  b.addEventListener('click', () => {
    // Every click is a user gesture: unlocking here mirrors what the game should do.
    audio.unlock();
    onClick();
  });
  return b;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function main(): void {
  const app = byId('app');
  const status = byId('status');
  const log = byId('log');
  const say = (msg: string): void => {
    log.textContent = msg;
  };

  byId('unlock').addEventListener('click', () => audio.unlock());

  const ctl = section(app, 'Options (applied to SFX buttons)');
  const pitch = slider(ctl, 'pitch (semitones; invaderStep: index)', -12, 24, 1, 0);
  const pan = slider(ctl, 'pan', -1, 1, 0.1, 0);
  const volume = slider(ctl, 'volume', 0, 1, 0.05, 1);

  for (const [title, names] of GROUPS) {
    const row = section(app, title);
    for (const name of names) button(row, name, () => audio.play(name, { pitch: pitch(), pan: pan(), volume: volume() }));
  }
  const listed = new Set(GROUPS.flatMap(([, n]) => n));
  const rest = SFX_NAMES.filter((n) => !listed.has(n));
  if (rest.length > 0) {
    const row = section(app, 'Other');
    for (const name of rest) button(row, name, () => audio.play(name, { pitch: pitch(), pan: pan(), volume: volume() }));
  }

  const seq = section(app, 'Sequences & stress');
  button(seq, 'Combo run (brick)', () => {
    void (async () => {
      for (const p of COMBO) {
        audio.play('brick', { pitch: p, pan: (p / 24) * 1.2 - 0.6 });
        await sleep(110);
      }
    })();
  });
  button(seq, 'Invader march', () => {
    void (async () => {
      for (let i = 0; i < 8; i++) {
        audio.play('invaderStep', { pitch: i % 4 });
        await sleep(420 - i * 25);
      }
    })();
  });
  button(seq, 'Laser burst (12)', () => {
    void (async () => {
      for (let i = 0; i < 12; i++) {
        audio.play('laser');
        await sleep(90);
      }
    })();
  });
  button(seq, 'Stack 20 at once', () => {
    const names: SfxName[] = ['explosion', 'bigExplosion', 'brick', 'brickHit', 'brickMetalBreak', 'brickGold', 'paddle', 'wall', 'laser', 'enemyHit', 'bossHit', 'bossShoot', 'shieldHit', 'powerupGood', 'extraLife', 'multiball', 'glue', 'launch', 'enemyShoot', 'paddleDeath'];
    for (const n of names) audio.play(n, { pan: Math.random() * 2 - 1 });
    say('20 sounds triggered in the same frame: listen for clipping (there should be none).');
  });
  button(seq, 'Retrigger test (same name x10 in 1 frame)', () => {
    for (let i = 0; i < 10; i++) audio.play('wall');
    say('Only one wall knock should be heard (25 ms retrigger guard).');
  });

  const mus = section(app, 'Music');
  let paused = false;
  for (const t of TRACK_NAMES) button(mus, t, () => audio.playMusic(t));
  button(mus, 'stop (1 s)', () => audio.stopMusic());
  const pauseBtn = button(mus, 'pause: off', () => {
    paused = !paused;
    audio.setPaused(paused);
    pauseBtn.textContent = `pause: ${paused ? 'on' : 'off'}`;
    pauseBtn.classList.toggle('on', paused);
  });

  const jin = section(app, 'Jingles (duck the music)');
  for (const j of JINGLE_NAMES) {
    button(jin, j, () => {
      const t0 = performance.now();
      say(`${j}: playing…`);
      void audio.playJingle(j).then(() => say(`${j}: resolved after ${((performance.now() - t0) / 1000).toFixed(2)} s`));
    });
  }

  const thr = section(app, 'Thruster');
  slider(thr, 'intensity', 0, 1, 0.01, 0, (v) => {
    audio.unlock();
    audio.setThruster(v);
  });

  const tog = section(app, 'Settings (persisted in localStorage "ke.audio")');
  const musicBtn = button(tog, '', () => {
    audio.toggleMusic();
  });
  const sfxBtn = button(tog, '', () => {
    audio.toggleSfx();
  });

  const refresh = (): void => {
    status.textContent = audio.ready ? 'ready' : 'locked / suspended: click anything';
    musicBtn.textContent = `music: ${audio.musicEnabled ? 'on' : 'off'}`;
    musicBtn.classList.toggle('on', audio.musicEnabled);
    sfxBtn.textContent = `sfx: ${audio.sfxEnabled ? 'on' : 'off'}`;
    sfxBtn.classList.toggle('on', audio.sfxEnabled);
  };
  refresh();
  setInterval(refresh, 250);
}

main();
