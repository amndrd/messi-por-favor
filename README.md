# WATCHIT

Les films d'un disque dur, dans le navigateur. On branche le disque, on double-clique sur « ▶ WATCH » et le site s'ouvre : pas de compte, pas d'internet, rien à installer. Pensé pour prêter le disque à quelqu'un.

Node.js sans dépendance, HTML, CSS et JavaScript sans framework ni étape de build.

## Ce qu'il y a dedans

- **Accueil façon plateforme de streaming** : une grande image qui fait défiler plusieurs films (avec un léger zoom et une lueur prise dans la couleur de l'image), puis des rangées Reprendre, Nouveautés, Les mieux notés, Collections, Séries, Par genre, Les classiques…
- **Catalogue** : frise des années à poignées, genres en vignettes, barre de filtres collante (type, période, genre, tri), affichage en affiches ou en liste, rangement par décennie, aperçu au survol.
- **Recherche, le mur d'affiches** (⌘K) : toutes les affiches du disque ; en tapant, celles qui correspondent s'allument et passent devant.
- **Collections** à voir dans l'ordre, **fiches** de films et de séries, épisodes par saison.
- **Lecteur** : reprise là où on s'était arrêté, sous-titres et pistes audio (FFmpeg), raccourcis clavier.
- **La taupe** : la mascotte sort de son trou à l'ouverture et explose en popcorn (Web Animations API, sans bibliothèque). Elle sert aussi de logo, de favicon et d'icône de l'app.

## Comment ça marche

- `server.js` lit les vidéos du **dossier parent** (MOVIES, sur le disque) et sert le site sur `127.0.0.1`, ports 8777 à 8796. Il s'arrête seul 90 s après la fermeture de la dernière page, pour qu'on puisse éjecter le disque.
- `catalogue.json` contient les fiches (titre, année, note, résumé, affiche, image de fond). Une vidéo du disque sans fiche s'affiche quand même, avec le nom du fichier ; les épisodes `SxxEyy` sont rattachés à leur série.
- `progression.json` garde où on en est, sur le disque.
- `outils/lanceur/` contient l'app « ▶ WATCH » (Swift) : elle lance le serveur avec le Node du disque et ouvre le navigateur.

```
WATCHIT (site)/
├── server.js            le serveur (Node.js, aucune dépendance)
├── index.html           la page unique du site
├── css/                 style.css (interface), fonts.css (polices locales)
├── js/                  app.js (interface), intro.js + pop-styles.js (intro de la taupe)
├── fonts/               Archivo et Inter, embarquées (le site marche hors ligne)
├── images/              favicon ; les images des films ne sont pas dans le dépôt
├── outils/lanceur/      l'app du disque : main.swift, construire.sh, icône
├── catalogue.exemple.json
└── LISEZ-MOI.txt        le mode d'emploi pour la personne qui reçoit le disque
```

**Pas dans le dépôt** : `catalogue.json`, `progression.json` et `cache/` (données personnelles), les affiches et images des films, et les binaires de Node.js et FFmpeg (`outils/node-*`, `outils/ffmpeg-*`, `outils/ffprobe-*`, environ 500 Mo).

## Lancer le site pour travailler dessus

Il faut Node.js (22 ou plus) et, pour les sous-titres et les pistes audio, FFmpeg (`brew install ffmpeg`).

```sh
cp catalogue.exemple.json catalogue.json   # facultatif : sans catalogue, les vidéos s'affichent avec leur nom de fichier
WATCHIT_OUTILS_SYSTEME=1 node server.js
```

Variables utiles : `WATCHIT_OUTILS_SYSTEME=1` (Node et FFmpeg du Mac plutôt que ceux du disque), `PORT=8799`, `NO_OPEN=1` (ne pas ouvrir le navigateur), `WATCHIT_NO_AUTOSTOP=1` (ne jamais s'arrêter seul), `WATCHIT_DELAI=<secondes>`.

Les vidéos sont cherchées dans le dossier au-dessus de celui du site.

## Préparer un disque

1. Ranger les vidéos et le dossier du site dans un dossier `MOVIES` à la racine du disque : à la racine, il ne reste que `▶ WATCH` et `MOVIES`.
2. Ajouter dans `outils/` les binaires pour Mac Apple Silicon et Intel : `node-arm64`, `node-x64` ([nodejs.org](https://nodejs.org)), `ffmpeg-arm64`, `ffmpeg-x64`, `ffprobe-arm64`, `ffprobe-x64` (versions statiques, par exemple [ffmpeg.martin-riedl.de](https://ffmpeg.martin-riedl.de)).
3. Fabriquer le bouton : `outils/lanceur/construire.sh` (il faut Xcode ou les outils en ligne de commande). L'app « ▶ WATCH » apparaît à la racine du disque.

Le disque doit être au format Mac (APFS ou HFS+) : l'app a besoin de l'autorisation « accéder à un volume amovible », que macOS ne demande que pour un vrai exécutable signé (d'où l'app en Swift plutôt qu'un script).
