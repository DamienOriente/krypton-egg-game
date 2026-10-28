# Publier sur itch.io — mise en place

La CI pousse automatiquement trois versions à chaque tag `v*` : **web** (jouable dans le navigateur), **Mac** et **Windows**. Il reste quelques réglages à faire une seule fois, à la main.

## 1. Créer la page (itch.io, une fois)

1. *Dashboard → Create new project*.
2. Remplis les champs avec [`PAGE.md`](PAGE.md) : titre, accroche, genre, tags, description.
3. **Kind of project : HTML.** C'est ce qui rend le jeu jouable dans la page.
4. **Pricing** : selon ta décision sur les droits (voir plus bas). *$0 or donate* (prix libre) est le plus prudent.
5. **Embed options** (section *Embed options*, qui apparaît après le premier envoi web) :
   - *Viewport dimensions* : **1280 × 720**
   - *Fullscreen button* : **coché**
   - *Mobile friendly* : coché, orientation **Landscape**
   - *Automatically start on page load* : **décoché** (le jeu attend de toute façon un clic pour le son)
   - *SharedArrayBuffer support* : décoché
6. **Images** :
   - *Cover image* : `cover-1260x1000.png` (2× le format recommandé 630 × 500)
   - *Screenshots* : les 6 `screenshot-*.jpg`
   - Dans la description, insère `gameplay.gif` en tête (le bloc `![Gameplay](gameplay.gif)` de `PAGE.md` sert de repère)
7. **Edit theme** (bouton sur la page) : *Banner* = `banner-1920x480.png`, fond `#05070c`, texte `#d8f6ff`, liens `#ffb020`.
8. **Contenu généré par IA** : itch.io demande si le projet en contient. Le code, les graphismes procéduraux, les sons et les textes ont été produits avec Claude : réponds en conséquence.
9. Laisse la page en **Draft** jusqu'au premier envoi réussi.

## 2. Brancher la CI (une fois)

L'adresse de la page est `https://<utilisateur>.itch.io/<jeu>`. La cible butler est `<utilisateur>/<jeu>`.

1. Génère une clé : *itch.io → Settings → API keys → Generate new API key*.
2. Enregistre-la comme secret GitHub, en la collant dans le terminal (jamais dans un chat ni un fichier) :

   ```bash
   gh secret set BUTLER_API_KEY --repo DamienOriente/krypton-egg-game
   ```

3. Déclare la cible (ce n'est pas un secret) :

   ```bash
   gh variable set ITCH_TARGET --repo DamienOriente/krypton-egg-game --body "<utilisateur>/<jeu>"
   ```

Tant que `ITCH_TARGET` n'est pas défini, le job *Publish to itch.io* est simplement ignoré.

## 3. Premier envoi

1. Pousse un nouveau tag (par exemple `v0.2.1`). Un tag déjà publié rejouerait l'ancien workflow, sans le job itch.io.
2. Le job pousse trois *channels* : `html5`, `mac`, `windows` (versions détectées automatiquement d'après le nom).
3. Dans *Edit game → Uploads*, coche **« This file will be played in the browser »** sur l'upload `html5`. C'est à faire une seule fois : les envois suivants mettent à jour le même upload.
4. Teste la page en **Draft** : le jeu web, puis les téléchargements Mac et Windows (décompresser, lancer).
5. Passe la page en **Public**.

Les tags suivants mettent à jour les trois versions tout seuls. Les joueurs qui utilisent l'app itch reçoivent des mises à jour différentielles.

## Ce que fait la CI

- Les jobs de build empaquettent l'app Mac (`Krypton Egg.app`) et le dossier Windows en `.tgz`, pour préserver les liens symboliques de l'app Mac entre deux jobs.
- Le job `itch` (Linux) refait le build web, installe **butler 15.32.0** (version épinglée), puis pousse :
  - `dist/` → `<cible>:html5`
  - un dossier contenant `Krypton Egg.app` → `<cible>:mac` (format recommandé par itch.io)
  - un dossier `Krypton Egg/` (Windows portable) → `<cible>:windows`
- La clé d'API n'est exposée qu'à l'étape d'envoi, pas aux scripts d'installation npm.

## Droits

La page porte le nom *Krypton Egg* et les niveaux reprennent les tableaux de 1989. Une page itch.io peut être retirée sur plainte de l'ayant droit, comme sur Steam. La voie sûre reste l'accord écrit d'Alexandre Kral, surtout si le jeu est payant.
