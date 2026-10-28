# CLAUDE.md — Krypton Egg Remake

Remake web du casse-briques Krypton Egg (1989). Vite 8 + TypeScript 7 strict, Canvas 2D, Web Audio. Zéro dépendance runtime ; un seul asset binaire : la vidéo du logo DGS (`src/assets/dgs-intro.mp4`, 122 Ko).

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
- **Touches d'aide (demande de Damien)** : `P` = barrière permanente on/off (`Session.barrier`, gardée d'un niveau à l'autre et après une vie perdue ; même barrière que le bonus Bouclier mais **sans** l'immunité de la raquette) ; `M` en jeu = chaque balle se divise en 3 (`Play.splitBalls`, plafond 243 = 3⁵ ; le bonus Multi garde son plafond de 12). Pause = Échap seul ; `M` = musique hors partie (titre, pause).
- Raccourcis lettres lus sur `e.key` (`input.keyPressed('m')`), pas sur `e.code` : en AZERTY la touche M est `Semicolon`. Les touches de déplacement restent sur `e.code` (position physique).
- Handle de debug `window.__ke` exposé **uniquement en dev** (`import.meta.env.DEV`).
- **Version desktop = Electron** (Chromium embarqué, comme les tests : pointer lock, Web Audio, `ctx.filter`), pas Tauri (WebKit sur Mac, pointer lock incertain). Process principal en JS ESM typé par `// @ts-check` (`electron/main.js`, vérifié par `tsconfig.electron.json`), fenêtre unique verrouillée (sandbox, pas de navigation, liens externes vers le navigateur), `autoplayPolicy` libre → musique du titre dès le lancement.
- Vite en `base: './'` : le même build sert le web et `file://` dans Electron.
- Packaging electron-builder 26 (config dans `package.json > build`) : DMG universel x64+arm64 (~223 Mo, ULFO) signé **ad-hoc** (`identity: "-"`, `hardenedRuntime: false`), `.exe` Windows **portable** x64. Noms d'artefacts sans version pour les liens `releases/latest/download/...` du README.
- **Intro DGS** (`game/intro.ts`, écran `intro` de `Game`) : la vidéo muette du logo (4 s, 1080p60, sans piste audio) est dessinée dans le canvas ; le son est un sting synthétisé (`audio.playLogoSting()` → `spawnLogoSting` dans `sfx.ts`), démarré sur l'événement `playing` de la vidéo (synchro mesurée : 1 ms). Navigateur : écran « CLIQUEZ POUR COMMENCER » tant que l'audio n'est pas débloqué ; Electron : `audio.unlock()` au démarrage → l'intro part seule. Un clic/touche passe l'intro (après 0,35 s de vidéo). Retour au titre si la vidéo échoue ou cale.
  - Calage du sting sur les temps mesurés dans la vidéo : balayage 0,55 → 1,40 s (D/G/S finis à 0,85 / 1,12 / 1,40 s, de 15 % à 84 % de la largeur), sous-titre 1,67 → 1,95 s, fondu 3,30 → 3,90 s. Mi majeur (dominante du thème titre en la mineur). Niveau calé hors ligne à ≈ -17 LUFS momentané max (comme les jingles).
  - Les textures lourdes (titre + bois du premier plateau, ~150 ms bloquants) sont pré-calculées sur une image fixe de l'intro (`IntroScreen.still`), pas pendant le balayage.
- **Séisme des boss** : `Boss.quake` (0..1) monte pendant la descente (0,3 → 0,8), passe à 1 à l'atterrissage (rugissement + `bigExplosion` grave), reste ≥ 0,65 pendant l'agonie (+0,3 par explosion), 1 à l'explosion finale, puis décroît (0,9/s après l'atterrissage, 0,55/s après la mort). `Play.updateQuake` en tire le grondement (`audio.setQuake` → classe `Quake` de `sfx.ts`, boucle continue comme le propulseur : sub 38/51 Hz + bruit brun saturés, broyage rose, cliquetis de débris), la chute de débris du cadre et le roulis de caméra (tout l'écran, HUD compris, deux sinus par axe + légère rotation). Niveau : ≈ -16 LUFS à 1 (comme les grosses explosions), ≈ -28 à 0,3.
- **Musique des boss** : le thème `boss` continue pendant l'agonie et se coupe à l'explosion finale ; l'écran « SECTEUR LIBÉRÉ » lance `victory` sous le jingle `codeReveal`.
- **Générique de fin** (`game/credits.ts`, écran `credits`) : crawl de rôles AAA absurdes, tous tenus par « CLAUDO » (demande de Damien), ~2 min à 115 px/s, maintenir clic/Espace = ×7, Échap = passer ; s'arrête sur « Développé avec ♥ pour mon pote Raph », puis scène post-générique (l'œuf noir remonte). Lancé par l'écran de victoire (clic ou 14 s) et par l'entrée **CRÉDITS** du menu titre. Musique : `victory`.
- **Gags « memes »** (`game/memes.ts`, `MemeLayer`) : 23 cartes animées façon GIF de messagerie (cadre blanc, pied « GIF / @CLAUDO », animation hachée à 12 i/s, légendes blanches façon meme), dessinées avec les sprites du jeu. Apparition aléatoire toutes les 2,2–4,2 s dans les marges gauche/droite, tirage en sac (pas de répétition avant d'avoir tout vu). **Pas de vrais GIFs du web** : droits d'auteur (extraits de films/séries/photos) + repo public et binaires distribués. Pour en ajouter : une entrée `MemeDef` (`draw(ctx, t)` sur 560×420).
- Release : `.github/workflows/desktop.yml` — tag `v*` → build Mac + Windows sur runners natifs, smoke test, puis `gh release create`. Smoke test (`--smoke-test=<png>`, `electron/main.js` + `electron/smoke.js`) : attend l'écran titre via `document.documentElement.dataset.screen` (donc l'intro jouée ; un clic à 12 s si pas de carte son), capture, écrit `<png>.txt`, échoue si le titre n'est pas atteint en 30 s (code 5) ou si l'écart-type de luminance < 10 (image quasi uniforme, code 4). Le workflow affiche le rapport et téléverse capture + rapport même en échec.

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
- Les délais de l'intro se basent sur l'horloge murale et `video.currentTime`, jamais sur la somme des `dt` : `dt` est plafonné à 0,1 s, donc un onglet throttlé (~1 i/s) fausse tout chronomètre cumulé.
- QA en console Vite après des rechargements à chaud : les modules de l'app sont servis avec `?t=…` ; un `import('/src/…')` sans ce suffixe crée une **seconde instance** (ex. un `audio` jamais débloqué). Retrouver l'URL réelle via `performance.getEntriesByType('resource')`.
- 243 balles = ~3 500 halos additifs par frame : `renderBalls` espace les points de traînée (1 sur 2 au-delà de 12 balles, 1 sur 4 au-delà de 40). Mesuré au pire cas (243 balles + 1 100 particules, niveau 58) : rendu 15,9 ms en moyenne, p95 19,9 ms ; simulation < 1 ms.
- Les réglages audio sont persistés (`ke.audio`) : une QA qui appuie sur M hors partie (ou pendant une pause automatique) coupe la musique **durablement** dans ce navigateur. Vérifier `localStorage['ke.audio']` avant de conclure à « pas de musique ».
- Fenêtre Electron masquée ou derrière d'autres (app lancée en arrière-plan, runner macOS sans écran) : Chromium suspend `requestAnimationFrame` → capture noire, intro qui ne finit jamais. C'est ce qui a donné la capture noire du smoke test macOS de v0.2.0. Le mode smoke test passe `backgroundThrottling: false` ; les joueurs gardent le comportement normal.
- Panneau navigateur masqué : les captures d'écran sont figées. Pour la QA visuelle, exporter le canvas (`toBlob`) plutôt que de faire des screenshots.

## État d'avancement

- 2026-10-26 : v0.1 jouable de bout en bout (titre → 60 niveaux → 6 boss → victoire), HUD, pause, game over, codes, scores locaux. Build prod : 181 Ko JS (60 Ko gzip).
- Équilibrage actuel : PV boss = 22 + 7 × palier, laser 0,45 dégât/tir sur boss, dagues 480 + 2 × niveau px/s. Non validé en partie réelle.
- 2026-10-27 : builds desktop (Electron) — DMG Mac universel testé localement (smoke test OK), `.exe` Windows produit par la CI.
- 2026-10-27 : intro animée DGS avec jingle synthétisé (web + desktop).
- 2026-10-28 : touches P (barrière permanente) et M (balles ×3).
- 2026-10-28 : séisme (son + image) à l'arrivée et à la mort des boss ; musique continue pendant les phases de boss.
- 2026-10-28 : générique de fin « Claudo » + 23 gags memes, menu CRÉDITS.
- 2026-10-28 : release v0.2.0 (intro DGS, touches P/M, séisme des boss, générique).
- Reste à valider à l'oreille : SFX et musiques (vérifiés par mesure uniquement, voir `/audio-test.html`).
