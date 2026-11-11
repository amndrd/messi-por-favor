<p align="center">
  <img src="docs/icon.png" width="128" alt="WATCHIT icon">
</p>

<h1 align="center">WATCHIT</h1>

<p align="center">
  <b>Your movies on a hard drive, as your own streaming site.</b><br>
  Plug the drive into a Mac, double-click ▶ WATCH, and your films and series open in the browser. No account, no internet, nothing to install.
</p>

<p align="center">
  <img alt="macOS 11+" src="https://img.shields.io/badge/macOS-11%2B-black?logo=apple">
  <img alt="Works offline" src="https://img.shields.io/badge/works-offline-2ea44f">
  <img alt="Node.js, no dependencies" src="https://img.shields.io/badge/Node.js-no%20dependencies-5FA04E?logo=nodedotjs&logoColor=white">
  <img alt="Vanilla JavaScript" src="https://img.shields.io/badge/JavaScript-no%20framework-F7DF1E?logo=javascript&logoColor=black">
</p>

<p align="center">
  <a href="README.fr.md">🇫🇷 Lire en français</a>
</p>

![WATCHIT on a Mac: the home page, a film projected on a cinema screen](docs/screenshots/hero.jpg)

## What it does

### A cinema screen at home

The home page projects one film at a time on a screen with rounded corners, a soft halo of its colors around it. The title is drawn with the film's own logo, under the director's name and a line of credits. It moves on to the next film by itself.

<p align="center">
  <img src="docs/screenshots/home.gif" alt="The home page: the drive's logo, then a film on the cinema screen, then the next one" width="100%">
</p>

### Hover for a preview

Rest the pointer on a poster: a light in the film's colors glows behind it. Stay a moment and a preview slides out of the poster, with a scene, the synopsis and a Play button.

<p align="center">
  <img src="docs/screenshots/hover.gif" alt="Posters light up in their colors and open a preview card" width="100%">
</p>

### ⌘ K · Find anything

A wall of posters that narrows down as you type: titles, directors, actors, years.

<p align="center">
  <img src="docs/screenshots/search.gif" alt="⌘ K opens the search; typing a director's name keeps only his films" width="100%">
</p>

### Browse by year and genre

The catalogue lays every year on the drive out on a timeline: drag across it to pick a period. Genres come as tiles, each with a scene from its best film.

<p align="center">
  <img src="docs/screenshots/catalogue.gif" alt="The timeline of years, a period dragged across it, then a genre" width="100%">
</p>

### Directors and actors

Every film shows its director and cast. Click a name to open their page: a portrait, a short biography, and all their films on the drive along a timeline. The catalogue has a page of its own for them, with a search.

<p align="center">
  <img src="docs/screenshots/people.gif" alt="From a film's cast to the director's page, his films on a timeline" width="100%">
</p>

### Collections, in order

Sagas are shown as slices of their films; each one opens up under the pointer. ▶ plays the next film you haven't seen.

<p align="center">
  <img src="docs/screenshots/collections.gif" alt="A collection's slices open one by one under the pointer" width="100%">
</p>

### Light or dark

A dark cinema, or a warm paper page. Images keep their dark veil either way, and the button bars turn to smoked glass.

<p align="center">
  <img src="docs/screenshots/theme.gif" alt="Settings: the site switches to the light theme" width="100%">
</p>

### A screensaver for your films

Leave it alone for a few minutes and the films parade by: scenes in full screen, or a wall of posters drifting slowly, one lighting up now and then.

<p align="center">
  <img src="docs/screenshots/screensaver.gif" alt="The screensaver: a wall of posters drifting" width="100%">
</p>

### Ends like a movie

⏏ stops the site so the drive can be ejected. The last screen reminds you where you stopped.

<p align="center">
  <img src="docs/screenshots/closing.gif" alt="The closing screen: the show is over, and the film to pick up next time" width="100%">
</p>

### Some details

- Picks up where you left off, film or episode. Progress is saved on the drive itself, so it follows the drive to another Mac.
- Plays the drive's videos as they are, with their subtitles and audio tracks.
- A film or series dropped into the drive's folder shows up on its own.
- Keyboard: ⌘ K to search, Esc to close, Space to pause.
- The site stops by itself a minute and a half after its last tab is closed.
- The interface is in French.

## How it's made

- A Node.js server with no dependencies; HTML, CSS and JavaScript, no framework, no build step.
- Node and FFmpeg travel on the drive, so the Mac needs nothing installed.
- Film details, logos, casts and portraits are fetched once from [TMDB](https://www.themoviedb.org) by small scripts, then stay on the drive: the site works without internet.
- ▶ WATCH is a small Swift app that starts the site and opens the browser.
