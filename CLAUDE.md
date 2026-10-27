# CLAUDE.md — Krypton Egg Remake

Remake web du casse-briques Krypton Egg (1989). Vite 8 + TypeScript 7 strict, Canvas 2D, Web Audio. Zéro dépendance runtime, zéro asset binaire.

## Décisions d'archi

- **Résolution interne fixe 2560×1440** (`src/config.ts`), letterboxée en CSS. Toute la géométrie de jeu est en pixels 2K ; ne jamais lire `clientWidth` hors de `core/input.ts`.
- **Simulation à pas fixe 1/120 s** (`game/game.ts`), input lu une fois par frame (`Play.frameInput`), balle sous-échantillonnée à ≤ 6 px par sous-pas → pas de tunneling à 1650 px/s.
- **Tout est procédural** : sprites pré-rendus une fois (`render/sprites.ts`), décors mis en cache par motif (`render/background.ts`), police dot-matrix 5×7 avec cache LRU de chaînes (`render/font.ts`). Les glows passent par `drawGlow` (sprites radiaux additifs) : **jamais de `shadowBlur` au runtime**, trop lent en 2K.
- **Couche de briques mise en cache** (`BrickField.rebuild`) et reconstruite uniquement sur `dirty` ; les effets animés (flash, régénération, explosifs) sont dessinés par-dessus en additif.
- **Audio 100 % Web Audio** (`src/audio/`) : API publique figée dans `audio/audio.ts` (`play`, `playMusic`, `playJingle`, `setPaused`, `setThruster`). Page d'écoute : `/audio-test.html`.
  - Mix : sfx / musique / jingles / réverbe → compresseur-limiteur → soft-clip plafonné à 0.99 (`mixer.ts`). Throttle 25 ms par nom de son, 6 voix max par nom, 40 au total.
  - Ping de brique en E5 + `pitch` en demi-tons (gamme pentatonique de combo côté jeu) ; toutes les tonalités des morceaux contiennent mi pour que les combos ne jurent pas.
  - `invaderStep` : `pitch` = index 0..3 de la marche, pas des demi-tons.
  - Onglet masqué → l'AudioContext est suspendu (`ready` repasse à false) pour éviter une musique hachée par le throttling ; reprise au retour.
- **Niveaux** : `src/levels/levels.ts`, 60 grilles ASCII 18×13 (légende dans `levels/types.ts`). Les boss ne sont pas dans `LEVELS` : séquence des stages dans `game/session.ts` (`STAGES`).
- Codes de secteur : `NEON`, `ARGO`, `XENO`, `RADO`, `HELI` → niveaux 11, 21, 31, 41, 51.
- Handle de debug `window.__ke` exposé **uniquement en dev** (`import.meta.env.DEV`).
- **Version desktop = Electron** (Chromium embarqué, comme les tests : pointer lock, Web Audio, `ctx.filter`), pas Tauri (WebKit sur Mac, pointer lock incertain). Process principal en JS ESM typé par `// @ts-check` (`electron/main.js`, vérifié par `tsconfig.electron.json`), fenêtre unique verrouillée (sandbox, pas de navigation, liens externes vers le navigateur), `autoplayPolicy` libre → musique du titre dès le lancement.
- Vite en `base: './'` : le même build sert le web et `file://` dans Electron.
- Packaging electron-builder 26 (config dans `package.json > build`) : DMG universel x64+arm64 (~223 Mo, ULFO) signé **ad-hoc** (`identity: "-"`, `hardenedRuntime: false`), `.exe` Windows **portable** x64. Noms d'artefacts sans version pour les liens `releases/latest/download/...` du README.
- Release : `.github/workflows/desktop.yml` — tag `v*` → build Mac + Windows sur runners natifs, smoke test (`--smoke-test=<png>` capture la fenêtre et quitte), puis `gh release create`.

## Pièges rencontrés

- `requestPointerLock()` et `AudioContext.resume()` doivent être appelés **dans** le handler d'un geste utilisateur → `Game.onGesture()` est branché en synchrone sur `mousedown` / `keydown` / `touchstart` (`main.ts`), pas dans la boucle rAF.
- Échap libère le pointer lock (→ pause) et peut aussi arriver en `keydown` : la pause ignore Échap pendant 300 ms.
- Les lettres M / N / F sont des raccourcis sauf sur l'écran de saisie de code (`Game.typing`), sinon « NEON » couperait le son.
- Un panneau navigateur masqué throttle rAF à ~2 FPS : pour la QA, simuler en appelant `__ke.game.frame(1/60)` en boucle plutôt que de compter sur rAF.
- Le blend `multiply` assombrit trop les plaques teal ; l'arène de boss utilise `color` (garde la luminance).
- Une brique régénérante ne réapparaît pas tant qu'une balle occupe sa case (`BrickField.regenBlocked`), sinon la balle se retrouve piégée dedans (niveaux 30 et 40).
- Build Windows depuis un Mac = Wine (Docker) : on le fait sur un runner `windows-latest`.
- Sans certificat, Gatekeeper / SmartScreen avertissent au premier lancement (procédure dans le README). Le ad-hoc signing évite le message « app endommagée » sur Apple Silicon. Signature + notarisation = compte Apple Developer requis.
- npm 12 bloque les scripts d'install par défaut : Electron télécharge son binaire au premier lancement, ce n'est pas bloquant.
- Panneau navigateur masqué : les captures d'écran sont figées. Pour la QA visuelle, exporter le canvas (`toBlob`) plutôt que de faire des screenshots.

## État d'avancement

- 2026-10-26 : v0.1 jouable de bout en bout (titre → 60 niveaux → 6 boss → victoire), HUD, pause, game over, codes, scores locaux. Build prod : 181 Ko JS (60 Ko gzip).
- Équilibrage actuel : PV boss = 22 + 7 × palier, laser 0,45 dégât/tir sur boss, dagues 480 + 2 × niveau px/s. Non validé en partie réelle.
- 2026-10-27 : builds desktop (Electron) — DMG Mac universel testé localement (smoke test OK), `.exe` Windows produit par la CI.
- Reste à valider à l'oreille : SFX et musiques (vérifiés par mesure uniquement, voir `/audio-test.html`).
