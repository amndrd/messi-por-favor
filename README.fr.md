<p align="center">
  <img src="docs/icon.png" width="128" alt="Icône de WATCHIT">
</p>

<h1 align="center">WATCHIT</h1>

<p align="center">
  <b>Les films d'un disque dur, comme un site de streaming à toi.</b><br>
  Branche le disque sur un Mac, double-clique sur ▶ WATCH : tes films et tes séries s'ouvrent dans le navigateur. Pas de compte, pas d'internet, rien à installer.
</p>

<p align="center">
  <img alt="macOS 11+" src="https://img.shields.io/badge/macOS-11%2B-black?logo=apple">
  <img alt="Marche hors ligne" src="https://img.shields.io/badge/marche-hors%20ligne-2ea44f">
  <img alt="Node.js sans dépendance" src="https://img.shields.io/badge/Node.js-sans%20d%C3%A9pendance-5FA04E?logo=nodedotjs&logoColor=white">
  <img alt="JavaScript sans framework" src="https://img.shields.io/badge/JavaScript-sans%20framework-F7DF1E?logo=javascript&logoColor=black">
</p>

<p align="center">
  <a href="README.md">🇬🇧 Read in English</a>
</p>

![WATCHIT sur un Mac : l'accueil, un film projeté sur un écran de cinéma](docs/screenshots/hero.jpg)

## Ce que ça fait

### Un écran de cinéma à la maison

L'accueil projette un film à la fois sur un écran aux coins arrondis, entouré d'un halo doux à ses couleurs. Le titre est dessiné avec le logo du film, sous le nom du réalisateur et une ligne de générique. Il passe tout seul au film suivant.

<p align="center">
  <img src="docs/screenshots/home.gif" alt="L'accueil : le logo du disque, puis un film sur l'écran de cinéma, puis le suivant" width="100%">
</p>

### Un aperçu au survol

Pose la souris sur une affiche : une lumière à la couleur du film s'allume derrière. Reste un instant et un aperçu sort de l'affiche, avec une scène, le résumé et un bouton Lecture.

<p align="center">
  <img src="docs/screenshots/hover.gif" alt="Les affiches s'éclairent à leurs couleurs et ouvrent un aperçu" width="100%">
</p>

### ⌘ K · Tout retrouver

Un mur d'affiches qui se resserre pendant qu'on tape : titres, réalisateurs, acteurs, années.

<p align="center">
  <img src="docs/screenshots/search.gif" alt="⌘ K ouvre la recherche ; le nom d'un réalisateur ne garde que ses films" width="100%">
</p>

### Par année et par genre

Le catalogue étale toutes les années du disque sur une frise : glisse dessus pour choisir une période. Les genres sont des vignettes, chacune avec une scène de son meilleur film.

<p align="center">
  <img src="docs/screenshots/catalogue.gif" alt="La frise des années, une période choisie en glissant, puis un genre" width="100%">
</p>

### Réalisateurs et acteurs

Chaque film montre son réalisateur et sa distribution. Un clic sur un nom ouvre sa page : un portrait, une courte biographie, et tous ses films du disque sur une frise. Le catalogue leur consacre aussi une page, avec une recherche.

<p align="center">
  <img src="docs/screenshots/people.gif" alt="De la distribution d'un film à la page du réalisateur, ses films sur une frise" width="100%">
</p>

### Les collections, dans l'ordre

Les sagas sont des tranches de leurs films ; chacune s'ouvre sous la souris. ▶ lance le prochain film pas encore vu.

<p align="center">
  <img src="docs/screenshots/collections.gif" alt="Les tranches d'une collection s'ouvrent une à une sous la souris" width="100%">
</p>

### Sombre ou clair

Une salle de cinéma, ou une page de papier chaud. Les images gardent leur voile sombre dans les deux, et les barres de boutons passent en verre fumé.

<p align="center">
  <img src="docs/screenshots/theme.gif" alt="Réglages : le site passe en thème clair" width="100%">
</p>

### Un écran de veille pour tes films

Laisse-le quelques minutes et les films défilent : des scènes en plein écran, ou un mur d'affiches qui dérive doucement, l'une s'allumant de temps en temps.

<p align="center">
  <img src="docs/screenshots/screensaver.gif" alt="L'écran de veille : un mur d'affiches qui dérive" width="100%">
</p>

### Une fin de séance

⏏ arrête le site pour qu'on puisse éjecter le disque. Le dernier écran rappelle où l'on s'est arrêté.

<p align="center">
  <img src="docs/screenshots/closing.gif" alt="L'écran de fermeture : la séance est terminée, et le film à reprendre la prochaine fois" width="100%">
</p>

### Quelques détails

- Reprend là où tu t'étais arrêté, film ou épisode. La progression est enregistrée sur le disque lui-même : elle le suit sur un autre Mac.
- Lit les vidéos du disque telles quelles, avec leurs sous-titres et leurs pistes audio.
- Un film ou une série déposé dans le dossier du disque apparaît tout seul.
- Au clavier : ⌘ K pour chercher, Échap pour fermer, Espace pour mettre en pause.
- Le site s'arrête tout seul une minute et demie après la fermeture de son dernier onglet.

## Comment c'est fait

- Un serveur Node.js sans dépendance ; HTML, CSS et JavaScript, sans framework ni étape de build.
- Node et FFmpeg voyagent sur le disque : le Mac n'a rien à installer.
- Les fiches, logos, distributions et portraits viennent une fois de [TMDB](https://www.themoviedb.org) par de petits scripts, puis restent sur le disque : le site marche sans internet.
- ▶ WATCH est une petite app Swift qui lance le site et ouvre le navigateur.
