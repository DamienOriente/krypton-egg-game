# Krypton Egg — Remake 2K

Remake navigateur du casse-briques **Krypton Egg** (Alexandre Kral, Atari ST / Amiga 1989, porté sur PC par C2V en 1994).
Rendu Canvas 2D en résolution interne fixe **2560×1440**, graphismes et sons 100 % procéduraux (aucun asset binaire).

## Lancer

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # typecheck + bundle dans dist/
```

Page d'écoute des sons (dev) : `http://127.0.0.1:5173/audio-test.html`.

## Commandes

| Action | Souris | Clavier |
|---|---|---|
| Déplacer la raquette | souris (capturée au premier clic) | ← → / Q D |
| Lancer la balle | clic gauche | Espace / Entrée |
| Tirer (bonus Lasers) | clic droit (ou gauche maintenu) | Espace maintenu |
| Voler (bonus Fusée) | souris haut/bas | ↑ ↓ / Z S |
| Pause / libérer la souris | — | P / Échap |
| Musique / sons | — | M / N |
| Plein écran | — | F |

Tactile : glisser pour déplacer, toucher pour lancer.

## Contenu

- 60 niveaux inspirés des tableaux originaux + 6 boss (après les niveaux 10, 20… 60).
- Niveaux 5, 15, 25, 35, 45, 55 : vague d'envahisseurs qui lâchent des dagues.
- Briques : couleur (1 coup), argent (2 coups, 3 à partir du niveau 31), or (indestructible), régénérante, explosive, téléporteurs.
- 18 bonus/malus : Géante, Lasers, Multi, Colle, Lente, Bouclier, X2, Feu, Grosse balle, Fusée, 1UP, Dynamite, Warp / Mini, Rapide, Gel, Nuit, Bière.
- Ennemis : orbes, cubes, méduses, mines, rayons incandescents (mortels sans bouclier).
- Codes de secteur révélés après chaque boss (à saisir dans « CODE SECTEUR »).
- 5 meilleurs scores sauvegardés en local (`localStorage`).
