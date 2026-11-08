/* ══════════════════════════════════════════════════════════════════════════
   Messi por favor — interface (version disque dur)
   Accueil, catalogue, collections, fiches et lecteur. Le catalogue vient du
   serveur (/api/data) : seulement ce qui est sur le disque. Pas de compte ;
   la progression est gardée sur le disque.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
'use strict';

const $  = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const parse = (s, def) => { try { return JSON.parse(s) ?? def; } catch(e) { return def; } };
const icon = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#i-${id}"/></svg>`;
// « Le Voyage de Chihiro » et « le voyage de chihiro » sont le même titre (même règle que requests.js)
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const pad2 = (n) => String(n).padStart(2, '0');

const view = $('#view');

// ─── SERVEUR ──────────────────────────────────────────────────────────────────
const api = async (url, body) => {
  const opt = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  try {
    const r = await fetch(url, opt);
    const data = await r.json().catch(() => ({}));
    return r.ok ? data : { ...data, error: data.error || 'Erreur ' + r.status };
  } catch(e) { return { error: 'Serveur injoignable' }; }
};

// ─── DONNÉES ──────────────────────────────────────────────────────────────────
const S = {
  episodes: [], progress: {},
  items: [], byKey: new Map(), newKeys: new Set(), // films et séries, dans un format commun
  collections: [],
};

const TYPES  = { film: 'Film', serie: 'Série', anime: 'Anime', animation: 'Animation' };
const PLURAL = { film: 'Films', serie: 'Séries', anime: 'Animes', animation: 'Animation' };

// Nom de fichier simple → dossier images/ du serveur
const imgUrl = (ref) => !ref ? null : /^(data:|https?:|\/)/.test(ref) ? ref : '/images/' + encodeURIComponent(ref);
const mediaUrl = (rel) => '/media/' + rel.split('/').map(encodeURIComponent).join('/');

const toItem = (o, kind) => {
  const anime = o.isAnime === true || o.section === 'anime';
  return {
    kind, id: o.id, key: kind + ':' + o.id,
    type: anime ? 'anime' : kind === 'serie' ? 'serie' : o.section === 'animation' ? 'animation' : 'film',
    title: o.title || 'Sans titre', year: String(o.year || '').trim(),
    genres: (o.genres || []).filter(g => g && g !== 'Autre'),
    director: o.director || '', cast: Array.isArray(o.cast) ? o.cast : [], duration: o.duration || '', rating: parseFloat(o.rating) || null,
    description: o.description || '', poster: imgUrl(o.poster), backdrop: imgUrl(o.backdrop),
    addedAt: o.addedAt || 0, videoRef: o.videoRef || '', noSeason: !!o.noSeason,
  };
};

const loadData = (d) => {
  S.episodes = d.episodes || [];
  S.progress = d.progress || {};
  const items = [
    ...(d.films || []).map(m => toItem(m, 'film')),
    ...(d.series || []).map(s => toItem(s, 'serie')),
  ];
  // Une série « récente » est celle dont le dernier épisode vient d'arriver
  for (const it of items) {
    if (it.kind !== 'serie') continue;
    const eps = episodesOf(it.id);
    it.epCount = eps.length;
    it.seasonCount = new Set(eps.map(e => e.season || 1)).size;
    for (const e of eps) if ((e.addedAt || 0) > it.addedAt) it.addedAt = e.addedAt;
  }
  S.items = items;
  S.byKey = new Map(items.map(it => [it.key, it]));
  S.newKeys = new Set(items.filter(it => it.addedAt > 0 && Date.now() - it.addedAt < 21 * 864e5)
    .sort((a, b) => b.addedAt - a.addedAt).slice(0, 12).map(it => it.key));
  // Collections : années, réalisateurs et durée totale déduits de leurs films
  S.collections = (d.collections || []).map(c => {
    const films = (c.filmIds || []).map(id => S.byKey.get('film:' + id)).filter(Boolean);
    const years = films.map(f => parseInt(f.year, 10)).filter(Boolean);
    const lo = Math.min(...years), hi = Math.max(...years);
    return {
      id: c.id, title: c.title || 'Sans titre', description: c.description || '', films,
      backdrop: imgUrl(c.backdrop) || films.find(f => f.backdrop)?.backdrop || null,
      years: !years.length ? '' : lo === hi ? String(lo) : `${lo} – ${hi}`,
      director: c.director || [...new Set(films.map(f => f.director).filter(Boolean))].join(', '),
      minutes: films.reduce((n, f) => n + (parseInt(f.duration, 10) || 0), 0),
    };
  }).filter(c => c.films.length).sort((a, b) => a.title.localeCompare(b.title, 'fr'));
};

const episodesOf = (seriesId) => S.episodes
  .filter(e => e.seriesId === seriesId)
  .sort((a, b) => (a.season || 1) - (b.season || 1) || (a.episode || 0) - (b.episode || 0));

// Pourcentage déjà vu d'un film, ou de l'épisode en cours d'une série
const progressPct = (contentId) => {
  const p = S.progress[contentId];
  return p && p.duration ? Math.min(100, Math.round(p.ts / p.duration * 100)) : 0;
};
const currentEpisode = (seriesId) => {
  let best = null;
  for (const e of S.episodes) {
    const p = S.progress[e.id];
    if (e.seriesId === seriesId && p && (!best || p.updatedAt > S.progress[best.id].updatedAt)) best = e;
  }
  return best;
};
const itemProgress = (it) => it.kind === 'film' ? progressPct(it.id) : (currentEpisode(it.id) ? progressPct(currentEpisode(it.id).id) : 0);

// ─── FORMATS ──────────────────────────────────────────────────────────────────
const fmtDuration = (d) => {
  d = String(d || '').trim();
  if (!/^\d+$/.test(d)) return d;
  const m = parseInt(d, 10);
  return m >= 60 ? `${Math.floor(m / 60)} h ${pad2(m % 60)} min` : `${m} min`;
};
const fmtTime = (s) => { s = Math.floor(s); const h = Math.floor(s / 3600); return (h ? h + ':' + pad2(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ':' + pad2(s % 60); };
const epLabel = (e, it) => (it?.noSeason ? '' : `S${e.season || 1} `) + `E${pad2(e.episode || 0)}`;
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ─── MORCEAUX D'INTERFACE ─────────────────────────────────────────────────────
// Motif discret tant que l'image n'est pas chargée (il reste si elle manque)
const placeholder = () => `<span class="ph" aria-hidden="true">${icon('film', '')}</span>`;
// L'image apparaît en fondu par-dessus le motif ; si elle manque, le motif reste
const imgTag = (src) => src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ok')" onerror="this.remove()">` : '';
const posterHtml = (src) => placeholder() + imgTag(src);
const bgUrl = (src) => `url(&quot;${esc(String(src).replace(/"/g, '%22'))}&quot;)`;
const logoFace = () => $('.header .logo-face')?.outerHTML || '';

// Note sur 10 à la française (8,6) ; durée courte (2 h 03) ; ce qu'il reste à voir
const fmtRating = (r) => r ? r.toFixed(1).replace('.', ',') : '';
const fmtShort = (d) => {
  d = String(d || '').trim();
  if (!/^\d+$/.test(d)) return d;
  const m = parseInt(d, 10);
  return m >= 60 ? `${Math.floor(m / 60)} h ${pad2(m % 60)}` : `${m} min`;
};
const fmtLeft = (sec) => 'encore ' + fmtShort(Math.max(1, Math.round(sec / 60)));
const seriesLine = (it) => `${it.seasonCount > 1 ? it.seasonCount + ' saisons, ' : ''}${it.epCount} épisode${it.epCount > 1 ? 's' : ''}`;
// « Nouveau » : parmi les 12 derniers arrivés, et depuis moins de trois semaines
// (après un gros import, le badge resterait sinon sur la moitié du catalogue)
const isNew = (it) => !!it && S.newKeys.has(it.key);

// Méta-données d'un titre : la note en jaune, puis année, durée…, puis les genres
const metaHtml = (rating, parts, tags = []) =>
  (rating ? `<span class="rate">${icon('star')}${fmtRating(rating)}</span>` : '') +
  parts.filter(Boolean).map(p => `<span>${esc(p)}</span>`).join('<span class="sep" aria-hidden="true"></span>') +
  tags.map(g => `<span class="tag">${esc(g)}</span>`).join('');

// Taille du grand titre selon sa longueur
const titleSize = (t) => t.length > 26 ? ' xl' : t.length > 15 ? ' l' : '';

// ─── COULEUR D'UNE IMAGE ──────────────────────────────────────────────────────
// La couleur dominante d'une image (les tons vifs et clairs comptent plus), ramenée
// à une même luminosité : elle teinte les reflets autour de la grande image et des cartes.
const tints = new Map();
const tintOf = (img) => {
  const src = img.currentSrc || img.src;
  if (tints.has(src)) return tints.get(src);
  let out = null;
  try {
    const c = document.createElement('canvas'); c.width = 24; c.height = 16;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, 24, 16);
    const d = g.getImageData(0, 0, 24, 16).data;
    let r = 0, gr = 0, b = 0, w = 0;
    for (let i = 0; i < d.length; i += 4) {
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
      const k = (mx - mn) / 255 * (mx / 255) + .02;
      r += d[i] * k; gr += d[i + 1] * k; b += d[i + 2] * k; w += k;
    }
    const rgb = [r / w, gr / w, b / w], f = 190 / (Math.max(...rgb) || 1);
    out = rgb.map(v => Math.round(Math.min(255, v * f))).join(',');
  } catch (e) {}
  tints.set(src, out);
  return out;
};
const whenLoaded = (img, fn) => { if (img.complete && img.naturalWidth) fn(); else img.addEventListener('load', fn, { once: true }); };
// La couleur d'une affiche colore son ombre au survol
view.addEventListener('pointerover', (e) => {
  const c = e.target.closest?.('.cp');
  if (!c || c.dataset.tinted) return;
  c.dataset.tinted = '1';
  const img = $('.im img', c);
  if (img) whenLoaded(img, () => { const t = tintOf(img); if (t) c.style.setProperty('--ct', t); });
});

// Résumé replié après quelques lignes ; « Voir plus » seulement s'il dépasse
const clampSynopsis = () => {
  const p = $('.synopsis');
  if (!p) return;
  p.classList.add('clamp');
  if (p.scrollHeight - p.clientHeight < 4) { p.classList.remove('clamp'); return; }
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'more-btn';
  btn.textContent = 'Voir plus'; btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => {
    const open = !p.classList.toggle('clamp');
    btn.textContent = open ? 'Voir moins' : 'Voir plus';
    btn.setAttribute('aria-expanded', open);
  });
  p.after(btn);
};

// ─── CARTES ───────────────────────────────────────────────────────────────────
// Affiche : badge (série, anime…), progression ; un point vert pour les nouveautés.
// Souris arrêtée dessus : l'aperçu s'ouvre (voir APERÇU AU SURVOL).
const card = (it, { num } = {}) => {
  const pct = itemProgress(it);
  const badge = num ? `<span class="num">${num}</span>` : it.type !== 'film' ? `<span class="badge">${TYPES[it.type]}</span>` : '';
  return `<a class="cp" href="/${it.kind}/${esc(it.id)}" data-link data-key="${esc(it.key)}">
    <span class="im">${posterHtml(it.poster)}${badge}
      ${pct ? `<span class="prog"><i style="width:${pct}%"></i></span>` : ''}
    </span>
    <b>${esc(it.title)}</b>
    <small>${isNew(it) ? '<i class="nw" title="Nouveau sur le disque"></i>' : ''}${esc(it.year)}${it.rating ? `<span class="r">${icon('star')}${fmtRating(it.rating)}</span>` : ''}</small>
  </a>`;
};

// Paysage : reprendre là où on s'est arrêté (un clic sur l'image relance la vidéo)
const resumeCard = ({ it, ep, p }) => {
  const img = (ep && imgUrl(ep.thumb)) || it.backdrop || it.poster;
  const pct = p.duration ? Math.min(100, p.ts / p.duration * 100) : 0;
  const sub = ep ? `${epLabel(ep, it)}${ep.title ? ', ' + ep.title : ''}` : [it.year, fmtShort(it.duration)].filter(Boolean).join(', ');
  return `<div class="cl">
    <button class="im" type="button" data-resume="${esc(it.key)}" aria-label="Reprendre ${esc(it.title)}">${placeholder()}${imgTag(img)}
      <span class="left">${fmtLeft(p.duration - p.ts)}</span><span class="pb"><i style="width:${pct}%"></i></span><span class="pl">${icon('play')}</span></button>
    <a href="/${it.kind}/${esc(it.id)}" data-link><b>${esc(it.title)}</b></a><small>${esc(sub)}</small>
  </div>`;
};

// Classement : grand chiffre détouré derrière l'affiche
const rankCard = (it, k) => `<a class="ck" href="/${it.kind}/${esc(it.id)}" data-link aria-label="${k + 1}. ${esc(it.title)}">
    <span class="n" aria-hidden="true">${k + 1}</span><span class="im">${posterHtml(it.poster)}</span></a>`;

// Collection : son image floutée en fond, trois affiches en éventail
const FAN = [[0, 14, -8], [48, 0, 2], [96, 18, 10]];
const colCard = (c) => `<a class="cc" href="/collection/${esc(c.id)}" data-link>
    ${c.backdrop ? `<span class="bg" style="background-image:${bgUrl(c.backdrop)}"></span>` : ''}
    <span class="fan" aria-hidden="true">${c.films.slice(0, 3).map((f, j) => f.poster
      ? `<img src="${esc(f.poster)}" alt="" loading="lazy" style="left:${FAN[j][0]}px;top:${FAN[j][1]}px;transform:rotate(${FAN[j][2]}deg);z-index:${j === 1 ? 3 : 2}">` : '').join('')}</span>
    <span class="t"><small>${c.films.length} films${c.years ? ', ' + esc(c.years) : ''}</small><h3>${esc(c.title)}</h3></span>
  </a>`;

// Genre : la plus belle image du genre, teintée d'une couleur qui lui est propre
const GENRE_TINT = {
  'Drame': '92,58,40', 'Thriller': '96,22,30', 'Crime': '120,90,24', 'Action': '150,60,20', 'Comédie': '170,120,20',
  'Romance': '150,50,90', 'Science-Fiction': '30,60,130', 'Aventure': '30,100,90', 'Historique': '110,80,50',
  'Mystère': '60,40,110', 'Guerre': '70,80,50', 'Documentaire': '40,90,60', 'Horreur': '110,10,20',
  'Fantastique': '90,50,130', 'Musique': '140,40,120', 'Western': '140,80,30', 'Animation': '40,110,70',
};
const genreTiles = () => {
  const counts = new Map();
  S.items.forEach(it => it.genres.forEach(g => counts.set(g, (counts.get(g) || 0) + 1)));
  const used = new Set(), best = (list) => list.filter(it => it.backdrop && !used.has(it)).sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
  return [...counts].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).map(([g, n]) => {
    const pick = best(S.items.filter(it => it.genres[0] === g)) || best(S.items.filter(it => it.genres.includes(g)));
    if (pick) used.add(pick);
    return `<a class="cg" href="/catalogue?genre=${encodeURIComponent(g)}" data-link style="--gt:${GENRE_TINT[g] || '60,60,72'}">
      ${pick ? `<img src="${esc(pick.backdrop)}" alt="" loading="lazy">` : ''}<b>${esc(g)}</b><small>${n} titre${n > 1 ? 's' : ''}</small></a>`;
  }).join('');
};

// ─── RANGÉES ──────────────────────────────────────────────────────────────────
// Rangée qui défile de côté ; des flèches apparaissent au survol (souris)
const rail = (html) => `<div class="rail-wrap">
    <button class="rail-btn prev" type="button" aria-label="Précédents" tabindex="-1" hidden>${icon('left')}</button>
    <div class="rail">${html}</div>
    <button class="rail-btn next" type="button" aria-label="Suivants" tabindex="-1" hidden>${icon('right')}</button></div>`;
const rowHead = (title, sub = '', more = '') => `<div class="rh"><h2>${esc(title)}</h2>${sub ? `<span>${esc(sub)}</span>` : ''}${more ? `<a href="${more}" data-link>Tout voir</a>` : ''}</div>`;
const row = (title, items, more, { sub = '', html = '' } = {}) => (html || items.length)
  ? `<section class="row">${rowHead(title, sub, more)}${rail(html || items.map(it => card(it)).join(''))}</section>` : '';
const initRails = () => $$('.rail-wrap', view).forEach(w => {
  const r = $('.rail', w), prev = $('.prev', w), next = $('.next', w);
  const paint = () => { prev.hidden = r.scrollLeft < 8; next.hidden = r.scrollLeft + r.clientWidth > r.scrollWidth - 8; };
  const by = (dir) => r.scrollBy({ left: dir * Math.max(200, r.clientWidth - 160), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  prev.addEventListener('click', () => by(-1));
  next.addEventListener('click', () => by(1));
  r.addEventListener('scroll', paint, { passive: true });
  new ResizeObserver(paint).observe(r);
});

const searchBar = (value = '') => `<form class="search" role="search" id="search-form">
    ${icon('search')}<label class="sr-only" for="search-input">Rechercher dans le catalogue</label>
    <input id="search-input" name="q" type="search" autocomplete="off" spellcheck="false" value="${esc(value)}" placeholder="${esc(examplePlaceholder())}">
  </form>`;

// Un titre du catalogue en exemple dans la barre de recherche
const examplePlaceholder = () => {
  const pool = S.items.filter(it => it.poster);
  const it = pool[Math.floor(Math.random() * pool.length)];
  return it ? `Titre, réalisateur, acteur… (« ${it.title} »)` : 'Titre, réalisateur, acteur…';
};
let placeholderTimer = null;
const rotatePlaceholder = () => {
  clearInterval(placeholderTimer);
  placeholderTimer = setInterval(() => {
    const input = $('#search-input');
    if (!input) return clearInterval(placeholderTimer);
    if (!input.value && document.activeElement !== input) input.placeholder = examplePlaceholder();
  }, 3500);
};

// ─── ACTIONS COMMUNES ─────────────────────────────────────────────────────────
// Lecture : le film, ou l'épisode en cours de la série (sinon le premier)
const playItem = (it) => {
  if (it.kind === 'film') return openPlayer(it, null);
  const eps = episodesOf(it.id);
  if (!eps.length) return toast('Les épisodes ne sont pas encore disponibles');
  openPlayer(it, currentEpisode(it.id) || eps[0]);
};
// ─── NAVIGATION ───────────────────────────────────────────────────────────────
const routes = [
  [/^\/$/,                 () => viewHome()],
  [/^\/catalogue\/?$/,     () => viewCatalogue()],
  [/^\/collections\/?$/,   () => viewCollections()],
  [/^\/collection\/([\w-]+)$/, (id) => viewCollection(id)],
  [/^\/(film|serie)\/([\w-]+)$/, (kind, id) => viewTitle(kind, id)],
];

// Onglet allumé dans le menu
const setTab = () => {
  const path = location.pathname;
  // « Catalogue » regroupe films et séries ; « Collections » a son propre onglet
  const tab = path === '/' ? 'accueil'
    : path.startsWith('/collection') ? 'collections'
    : /^\/(catalogue|film\/|serie\/)/.test(path) ? 'catalogue' : '';
  $$('[data-tab]').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === tab);
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  // La pilule blanche glisse sous l'onglet ouvert
  const nav = $('.nav'), ind = $('.nav-ind'), on = $('.nav a.active');
  if (on) {
    Object.assign(ind.style, { width: on.offsetWidth + 'px', height: on.offsetHeight + 'px', transform: `translate(${on.offsetLeft}px, ${on.offsetTop}px)`, opacity: 1 });
  }
  else ind.style.opacity = 0;
  if (!nav.classList.contains('ready')) requestAnimationFrame(() => requestAnimationFrame(() => nav.classList.add('ready')));
};
addEventListener('resize', setTab);
document.fonts?.ready.then(setTab);

// En-tête transparent sur la grande image, opaque dès qu'on descend
const header = $('#header');
const paintHeader = () => header.classList.toggle('solid', scrollY > 40);
// L'onglet ouvert prend la couleur du film affiché (null : pilule de verre neutre)
const setNavTint = (t) => { header.classList.toggle('tinted', !!t); if (t) header.style.setProperty('--nt', t); };
addEventListener('scroll', paintHeader, { passive: true });

const render = () => {
  if (!$('#player').hidden) closePlayer();
  closeWall();
  stopHero();
  setNavTint(null);
  closeOpenDD = null;
  const path = location.pathname;
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (!m) continue;
    fn(...m.slice(1));
    setTab();
    initRails();
    paintHeader();
    return;
  }
  go('/', { replace: true });
};

const go = (url, { replace = false } = {}) => {
  history.replaceState({ ...history.state, y: scrollY }, '');
  history[replace ? 'replaceState' : 'pushState']({ y: 0 }, '', url);
  render();
  scrollTo(0, 0);
};

history.scrollRestoration = 'manual';
addEventListener('popstate', (e) => { render(); scrollTo(0, e.state?.y || 0); });
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  go(a.getAttribute('href'));
});

const bindSearch = (onInput) => {
  const form = $('#search-form'), input = $('#search-input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (onInput) onInput(q, true); else go('/catalogue' + (q ? '?q=' + encodeURIComponent(q) : ''));
  });
  if (onInput) { let t; input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => onInput(input.value.trim()), 150); }); }
  rotatePlaceholder();
};

// ─── ACCUEIL ──────────────────────────────────────────────────────────────────
// Ce qu'on regardait : le dernier contenu commencé de chaque titre
const resumeEntries = () => {
  const seen = new Set(), out = [];
  Object.entries(S.progress).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)).forEach(([id, p]) => {
    const ep = p.seriesId ? S.episodes.find(e => e.id === id) : null;
    const it = ep ? S.byKey.get('serie:' + ep.seriesId) : S.byKey.get('film:' + id);
    if (it && p.duration && !seen.has(it.key)) { seen.add(it.key); out.push({ it, ep, p }); }
  });
  return out;
};

// Une sélection qui change chaque jour mais reste la même toute la journée
const dayPick = (list, n) => {
  let s = Math.floor(Date.now() / 864e5) % 233280;
  const rnd = () => (s = (s * 9301 + 49297) % 233280) / 233280;
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, n);
};

// La grande image : ce qu'on regardait, le dernier arrivé, puis la sélection du jour
let heroTimer = null;
const stopHero = () => { clearTimeout(heroTimer); heroTimer = null; };
const HERO_MS = 8000;

const heroCopy = ({ it }) => {
  return `<h1 class="hero-title${titleSize(it.title)}">${esc(it.title)}</h1>
    <div class="meta">${metaHtml(it.rating, [it.year, it.kind === 'film' ? fmtShort(it.duration) : seriesLine(it), it.director], it.genres.slice(0, 2))}</div>
    ${it.description ? `<p class="syn">${esc(it.description)}</p>` : ''}
    <div class="cta">
      <button class="btn play" type="button" data-hero="play">${icon('play')}${itemProgress(it) ? 'Reprendre' : 'Lecture'}</button>
      <a class="btn glass sq" href="/${it.kind}/${esc(it.id)}" data-link aria-label="Plus d'infos sur ${esc(it.title)}" title="Plus d'infos">${icon('info')}</a>
    </div>`;
};

const initHero = (picks) => {
  const hero = $('#hero');
  if (!hero) return;
  const slides = $$('.slide', hero), copy = $('#hero-copy'), thumbs = $$('.th', hero);
  let cur = -1, hold = false, startedAt = 0, left = HERO_MS;
  const show = (k) => {
    cur = k;
    slides.forEach((s, j) => s.classList.toggle('on', j === k));
    thumbs.forEach((t, j) => { t.classList.toggle('on', j === k); t.setAttribute('aria-pressed', j === k); });
    copy.innerHTML = heroCopy(picks[k]);
    copy.classList.remove('swap'); void copy.offsetWidth; copy.classList.add('swap');
    const img = $('img', slides[k]);
    if (img) whenLoaded(img, () => { const t = cur === k && img.isConnected && tintOf(img); if (t) { hero.style.setProperty('--tint', t); setNavTint(t); } });
  };
  const arm = (ms) => {
    stopHero();
    if (picks.length < 2) return;
    startedAt = Date.now(); left = ms;
    heroTimer = setTimeout(() => goSlide((cur + 1) % picks.length), ms);
  };
  const goSlide = (k) => { show(k); if (hold) { stopHero(); left = HERO_MS; } else arm(HERO_MS); };
  thumbs.forEach((t, j) => t.addEventListener('click', () => goSlide(j)));
  // Le défilement fait une pause quand la souris est sur le texte ou les boutons
  copy.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse' || hold) return;
    hold = true; left -= Date.now() - startedAt; stopHero(); hero.classList.add('hold');
  });
  copy.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse' || !hold) return;
    hold = false; hero.classList.remove('hold'); arm(Math.max(600, left));
  });
  copy.addEventListener('click', (e) => {
    if (e.target.closest('[data-hero="play"]')) playItem(picks[cur].it);
  });
  goSlide(0);
};

const viewHome = () => {
  document.title = 'Messi por favor';
  const resume = resumeEntries();
  const byRecent = S.items.slice().sort((a, b) => b.addedAt - a.addedAt);
  const byRating = S.items.filter(it => it.rating).sort((a, b) => b.rating - a.rating);

  const picks = [];
  // (sans bulle au-dessus du titre)
  const pick = (it) => { if (it && it.backdrop && !picks.some(p => p.it === it)) picks.push({ it }); };
  if (resume[0]) pick(resume[0].it);
  pick(byRecent[0]);
  dayPick(S.items.filter(it => it.backdrop && (it.rating || 0) >= 7.8 && !picks.some(p => p.it === it)), 5 - picks.length).forEach(pick);

  const series = S.items.filter(it => it.kind === 'serie').sort((a, b) => b.addedAt - a.addedAt);
  const anim = S.items.filter(it => it.type === 'anime' || it.type === 'animation').sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const classics = S.items.filter(it => it.kind === 'film' && parseInt(it.year, 10) < 1980).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 18);

  view.innerHTML = `${picks.length ? `<section class="hero" id="hero" aria-label="À l'affiche">
      ${picks.map((p, k) => `<div class="slide${k ? '' : ' on'}"><img src="${esc(p.it.backdrop)}" alt=""${k ? '' : ' fetchpriority="high"'}></div>`).join('')}
      <div class="glow" aria-hidden="true"></div>
      <div class="hero-copy" id="hero-copy"></div>
      ${picks.length > 1 ? `<div class="hero-next" role="group" aria-label="À l'affiche">${picks.map((p, k) =>
        `<button class="th" type="button" aria-pressed="false" aria-label="${esc(p.it.title)}"><span class="im"><img src="${esc(p.it.backdrop)}" alt=""><i class="bar"></i></span><span class="nm">${esc(p.it.title)}</span></button>`).join('')}</div>` : ''}
    </section>` : '<div class="hero-spacer"></div>'}
    <div class="rows">
      ${row('Reprendre', [], null, { sub: 'là où tu t\'es arrêté', html: resume.slice(0, 12).map(resumeCard).join('') })}
      ${row('Nouveautés sur le disque', byRecent.slice(0, 18), '/catalogue')}
      ${row('Les mieux notés', [], '/catalogue?tri=rating', { html: byRating.slice(0, 10).map(rankCard).join('') })}
      ${row('Collections', [], '/collections', { html: S.collections.map(colCard).join('') })}
      ${row('Séries', series.slice(0, 18), '/catalogue?type=serie')}
      ${row('Par genre', [], null, { html: genreTiles() })}
      ${row('Les classiques', classics, '/catalogue?a=1979&tri=rating', { sub: 'avant 1980' })}
      ${row('Animation et animes', anim, null)}
    </div>`;

  initHero(picks);
  view.querySelector('.rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-resume]');
    if (b) playItem(S.byKey.get(b.dataset.resume));
  });
};

// ─── CATALOGUE ────────────────────────────────────────────────────────────────
const SORTS = { recent: 'Ajout récent', title: 'Titre (A → Z)', newest: 'Sortie (récente)', oldest: 'Sortie (ancienne)', rating: 'Note' };

const readFilters = () => {
  const q = new URLSearchParams(location.search);
  return { q: q.get('q') || '', type: q.get('type') || '', genre: q.get('genre') || '', from: q.get('de') || '', to: q.get('a') || '', sort: SORTS[q.get('tri')] ? q.get('tri') : 'recent' };
};
const writeFilters = (f) => {
  const q = new URLSearchParams();
  if (f.q) q.set('q', f.q); if (f.type) q.set('type', f.type); if (f.genre) q.set('genre', f.genre);
  if (f.from) q.set('de', f.from); if (f.to) q.set('a', f.to); if (f.sort !== 'recent') q.set('tri', f.sort);
  history.replaceState(history.state, '', '/catalogue' + (q.toString() ? '?' + q : ''));
};

const filterItems = (f) => {
  const words = norm(f.q) ? f.q.split(/\s+/).map(norm).filter(Boolean) : [];
  const yr = (it) => parseInt(it.year, 10) || null;
  let list = S.items.filter(it => {
    if (f.type && it.type !== f.type) return false;
    if (f.genre && !it.genres.includes(f.genre)) return false;
    if (f.from && !(yr(it) >= +f.from)) return false;
    if (f.to && !(yr(it) <= +f.to)) return false;
    if (words.length) {
      const hay = norm([it.title, it.director, it.year, ...it.genres, ...it.cast, TYPES[it.type]].join(' '));
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });
  const by = {
    recent: (a, b) => b.addedAt - a.addedAt,
    title:  (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }),
    newest: (a, b) => (yr(b) || 0) - (yr(a) || 0),
    oldest: (a, b) => (yr(a) || 9999) - (yr(b) || 9999),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
  }[f.sort];
  return list.sort(by);
};

// ─── LISTES DÉROULANTES ───────────────────────────────────────────────────────
// Remplacent les <select> natifs, dont la liste ne se laisse pas habiller.
// Motif « combobox » de l'ARIA : le focus reste sur le bouton, les flèches parcourent la liste.
// prefix : petit mot affiché devant le choix (« Genre », « Tri »…), qui sert aussi d'étiquette
const dropdown = (id, opts, value, { label = '', prefix = '', variant = '', width = '' } = {}) => {
  const cur = opts.find(o => o[0] === value) || opts[0];
  if (prefix && !label) label = id + '-l';
  return `<div class="dd${variant ? ' dd-' + variant : ''}" id="${id}" data-value="${esc(cur[0])}"${width ? ` style="--w:${width}"` : ''}>
    ${prefix ? `<span class="sr-only" id="${id}-l">${esc(prefix)}</span>` : ''}
    <div class="${variant === 'b' ? 'sel-b' : 'select'} dd-btn"${prefix ? ` data-prefix="${esc(prefix)}"` : ''} tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false"
      aria-controls="${id}-list" aria-labelledby="${label ? label + ' ' : ''}${id}-v"><span id="${id}-v">${esc(cur[1])}</span></div>
    <ul class="dd-list" id="${id}-list" role="listbox"${label ? ` aria-labelledby="${label}"` : ''} hidden>
      ${opts.map(([v, l], i) => `<li role="option" id="${id}-o${i}" data-v="${esc(v)}" aria-selected="${v === cur[0]}"${v === '' ? ' class="all"' : ''}><span>${esc(l)}</span><small></small></li>`).join('')}
    </ul>
  </div>`;
};

let closeOpenDD = null;
document.addEventListener('pointerdown', (e) => { if (closeOpenDD && !e.target.closest('.dd.open')) closeOpenDD(); });

const initDropdowns = (root, onChange) => $$('.dd', root).forEach(dd => {
  const btn = $('.dd-btn', dd), list = $('.dd-list', dd);
  const items = () => $$('[role=option]', list);
  let active = -1, typed = '', typedAt = 0;

  const setActive = (i, scroll = true) => {
    const o = items();
    active = Math.max(0, Math.min(o.length - 1, i));
    o.forEach((li, j) => li.classList.toggle('active', j === active));
    btn.setAttribute('aria-activedescendant', o[active].id);
    if (scroll) o[active].scrollIntoView({ block: 'nearest' });
  };
  // Vers le haut s'il n'y a pas la place en dessous ; jamais au-delà du bord droit
  const place = () => {
    list.classList.remove('up', 'right');
    const r = list.getBoundingClientRect(), b = btn.getBoundingClientRect();
    if (r.bottom > innerHeight - 8 && b.top > innerHeight - b.bottom) list.classList.add('up');
    if (r.right > document.documentElement.clientWidth - 8) list.classList.add('right');
  };
  const close = () => {
    list.hidden = true; dd.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false'); btn.removeAttribute('aria-activedescendant');
    if (closeOpenDD === close) closeOpenDD = null;
  };
  const open = (i) => {
    if (closeOpenDD) closeOpenDD();
    list.hidden = false; dd.classList.add('open'); btn.setAttribute('aria-expanded', 'true');
    place();
    setActive(i ?? items().findIndex(li => li.getAttribute('aria-selected') === 'true'));
    closeOpenDD = close;
  };
  const pick = (i) => {
    const li = items()[i];
    if (!li) return;
    items().forEach(o => o.setAttribute('aria-selected', o === li));
    $('span', btn).textContent = $('span', li).textContent;
    const changed = dd.dataset.value !== li.dataset.v;
    dd.dataset.value = li.dataset.v;
    close(); btn.focus();
    if (changed) onChange(dd.id, li.dataset.v);
  };
  // Taper une lettre saute au premier choix qui commence par elle
  const typeahead = (ch) => {
    const now = Date.now();
    typed = (now - typedAt > 700 ? '' : typed) + ch; typedAt = now;
    const o = items(), start = typed.length === 1 ? active + 1 : active;
    for (let k = 0; k < o.length; k++) {
      const j = (start + k) % o.length;
      if (norm($('span', o[j]).textContent).startsWith(norm(typed))) return setActive(j);
    }
  };

  btn.addEventListener('click', () => list.hidden ? open() : close());
  btn.addEventListener('keydown', (e) => {
    const k = e.key, letter = k.length === 1 && k !== ' ' && !e.metaKey && !e.ctrlKey && !e.altKey;
    if (list.hidden) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(k)) { e.preventDefault(); open(); }
      else if (k === 'Home' || k === 'End') { e.preventDefault(); open(k === 'Home' ? 0 : items().length - 1); }
      else if (letter) { open(); typeahead(k); }
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (k === 'Home') { e.preventDefault(); setActive(0); }
    else if (k === 'End') { e.preventDefault(); setActive(items().length - 1); }
    else if (k === 'PageDown') { e.preventDefault(); setActive(active + 8); }
    else if (k === 'PageUp') { e.preventDefault(); setActive(active - 8); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); pick(active); }
    else if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (k === 'Tab') close();
    else if (letter) typeahead(k);
  });
  list.addEventListener('mousedown', (e) => e.preventDefault()); // garder le focus sur le bouton
  list.addEventListener('pointermove', (e) => { const li = e.target.closest('[role=option]'); if (li) setActive(items().indexOf(li), false); });
  list.addEventListener('click', (e) => { const li = e.target.closest('[role=option]'); if (li) pick(items().indexOf(li)); });
});

const TYPE_TITLES = { film: 'Films', serie: 'Séries', anime: 'Animes', animation: 'Animation' };

const viewCatalogue = () => {
  const f = readFilters();
  const genres = [...new Set(S.items.flatMap(it => it.genres))].sort((a, b) => a.localeCompare(b, 'fr'));
  const years = [...new Set(S.items.map(it => parseInt(it.year, 10)).filter(Boolean))].sort((a, b) => b - a).map(String);

  view.innerHTML = `<div class="page">
    <header class="page-head">
      <div><h1 class="page-title" id="cat-title">Catalogue</h1><p class="page-sub" id="res-count" aria-live="polite"></p></div>
      ${searchBar(f.q)}
    </header>
    <div class="toolbar">
      <div class="seg" id="f-types" role="group" aria-label="Type">
        ${[['', 'Tout'], ...Object.entries(PLURAL)].map(([v, l]) => `<button type="button" data-type="${v}" aria-pressed="${f.type === v}">${esc(l)}<small></small></button>`).join('')}
        ${S.collections.length ? `<a href="/collections" data-link>Collections<small>${S.collections.length}</small></a>` : ''}
      </div>
      <span class="tb-sep" aria-hidden="true"></span>
      <div class="filters">
        ${dropdown('f-genre', [['', 'Tous'], ...genres.map(g => [g, g])], f.genre, { prefix: 'Genre' })}
        ${dropdown('f-from', [['', 'Début'], ...years.slice().reverse().map(y => [y, y])], f.from, { prefix: 'De' })}
        ${dropdown('f-to', [['', 'Fin'], ...years.map(y => [y, y])], f.to, { prefix: 'À' })}
        ${dropdown('f-sort', Object.entries(SORTS), f.sort, { prefix: 'Tri' })}
        <button class="reset" id="f-reset" type="button" hidden>${icon('reset')}Tout effacer</button>
      </div>
    </div>
    <section id="results"></section>
  </div>`;

  const update = () => {
    $$('.filters .dd').forEach(dd => $('.dd-btn', dd).classList.toggle('dim', !dd.dataset.value && dd.id !== 'f-sort'));
    // Nombre de titres derrière chaque choix, compte tenu des autres filtres
    $$('#f-types [data-type]').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.type === f.type);
      $('small', b).textContent = filterItems({ ...f, type: b.dataset.type }).length;
    });
    $$('#f-genre-list [role=option]').forEach(li => { $('small', li).textContent = filterItems({ ...f, genre: li.dataset.v }).length; });
    const list = filterItems(f);
    const title = TYPE_TITLES[f.type] || 'Catalogue';
    $('#cat-title').textContent = title;
    document.title = title + ' · Messi por favor';
    $('#res-count').textContent = `${list.length} titre${list.length > 1 ? 's' : ''}${f.q ? ` pour « ${f.q} »` : ''}`;
    const filtered = f.q || f.genre || f.from || f.to || f.sort !== 'recent';
    $('#f-reset').hidden = !filtered;
    $('#results').innerHTML = list.length
      ? `<div class="grid">${list.map(it => card(it)).join('')}</div>`
      : `<div class="empty"><b>Rien ne correspond</b>Essaie un autre mot, ou enlève un filtre.<br><button class="btn glass" type="button" data-reset>${icon('reset')}Tout effacer</button></div>`;
    writeFilters(f);
    setTab();
  };
  // « Tout effacer » garde le type choisi (Films, Séries…)
  const reset = () => go('/catalogue' + (f.type ? '?type=' + f.type : ''), { replace: true });
  const keys = { 'f-genre': 'genre', 'f-from': 'from', 'f-to': 'to', 'f-sort': 'sort' };
  initDropdowns($('.filters'), (id, v) => { f[keys[id]] = v; update(); });
  $('#f-types').addEventListener('click', (e) => { const b = e.target.closest('[data-type]'); if (b) { f.type = b.dataset.type; update(); } });
  $('#f-reset').addEventListener('click', reset);
  $('#results').addEventListener('click', (e) => { if (e.target.closest('[data-reset]')) reset(); });
  bindSearch((q) => { f.q = q; update(); });
  update();
};

// ─── COLLECTIONS ──────────────────────────────────────────────────────────────
// Liens « Réalisé par » : chaque nom renvoie à une recherche dans le catalogue
const directorLinks = (names) => names.split(/\s*,\s*/).filter(Boolean)
  .map(n => `<a href="/catalogue?q=${encodeURIComponent(n)}" data-link><b>${esc(n)}</b></a>`).join(', ');

const viewCollections = () => {
  document.title = 'Collections · Messi por favor';
  const n = S.collections.length, films = S.collections.reduce((k, c) => k + c.films.length, 0);
  view.innerHTML = `<div class="page">
    <header class="page-head"><div><h1 class="page-title">Collections</h1>
      <p class="page-sub">${n} collection${n > 1 ? 's' : ''}, ${films} films à voir dans l'ordre</p></div></header>
    <div class="toolbar">
      <nav class="seg" aria-label="Catalogue">
        ${[['', 'Tout'], ...Object.entries(PLURAL)].map(([v, l]) => `<a href="/catalogue${v ? '?type=' + v : ''}" data-link>${esc(l)}<small>${v ? S.items.filter(it => it.type === v).length : S.items.length}</small></a>`).join('')}
        <a href="/collections" data-link aria-current="page">Collections<small>${n}</small></a>
      </nav>
    </div>
    ${n ? `<div class="col-grid">${S.collections.map(colCard).join('')}</div>` : `<div class="empty"><b>Aucune collection pour l'instant</b></div>`}
  </div>`;
};

// Fiche : l'image du film en grand, le texte en bas à gauche
const detailHero = ({ bg, crumb, title, meta, extra = '', synopsis, actions, after = '' }) => `<section class="detail">
    ${bg ? `<div class="detail-bg"><img src="${esc(bg)}" alt="" fetchpriority="high"></div>` : ''}
    <div class="glow" aria-hidden="true"></div>
    <div class="detail-in">
      ${crumb}
      <h1 class="detail-title${titleSize(title)}">${esc(title)}</h1>
      ${meta ? `<div class="meta">${meta}</div>` : ''}
      ${extra}
      ${synopsis ? `<p class="synopsis">${esc(synopsis)}</p>` : ''}
      <div class="actions">${actions}</div>
      ${after}
    </div>
  </section>`;
// Reflet coloré pris dans l'image
const tintDetail = () => {
  const d = $('.detail'), img = $('.detail-bg img');
  if (img) whenLoaded(img, () => { const t = img.isConnected && tintOf(img); if (t) { d.style.setProperty('--tint', t); setNavTint(t); } });
};

const viewCollection = (id) => {
  const c = S.collections.find(x => x.id === id);
  if (!c) {
    view.innerHTML = `<div class="page"><div class="empty"><b>Cette collection n'existe plus</b><a class="btn glass" href="/collections" data-link>Toutes les collections</a></div></div>`;
    return;
  }
  document.title = c.title + ' · Messi por favor';
  // Le film à lancer : le premier pas encore terminé, dans l'ordre de la collection
  const nextIdx = Math.max(0, c.films.findIndex(f => progressPct(f.id) < 90));
  const next = c.films[nextIdx], started = progressPct(next.id) > 0;

  view.innerHTML = detailHero({
    bg: c.backdrop,
    crumb: `<a class="crumb" href="/collections" data-link>${icon('left')}Collections</a>`,
    title: c.title,
    meta: metaHtml(null, [`${c.films.length} films`, c.years, c.minutes ? fmtShort(c.minutes) + ' en tout' : '']),
    extra: c.director ? `<p class="by">Réalisé par ${directorLinks(c.director)}</p>` : '',
    synopsis: c.description,
    actions: `<button class="btn play" id="play-btn" type="button">${icon('play')}${started ? 'Reprendre' : 'Lecture'}</button>`,
    after: `<p class="note">Film ${nextIdx + 1} sur ${c.films.length} : ${esc(next.title)}</p>`,
  }) + `<div class="fiche-body">
      <section class="row">${rowHead('Les films', 'dans l\'ordre de la collection')}<div class="grid">${c.films.map((f, k) => card(f, { num: k + 1 })).join('')}</div></section>
    </div>`;
  $('#play-btn').addEventListener('click', () => openPlayer(next, null));
  clampSynopsis();
  tintDetail();
};

// ─── FICHE FILM / SÉRIE ───────────────────────────────────────────────────────
const viewTitle = (kind, id) => {
  const it = S.byKey.get(kind + ':' + id);
  if (!it) {
    view.innerHTML = `<div class="page"><div class="empty"><b>Ce titre n'est plus sur le disque</b><a class="btn glass" href="/catalogue" data-link>Retour au catalogue</a></div></div>`;
    return;
  }
  document.title = it.title + ' · Messi por favor';
  const eps = kind === 'serie' ? episodesOf(it.id) : [];
  const bg = it.backdrop || it.poster;

  // Bouton principal : reprendre là où on s'est arrêté, sinon commencer
  let playLabel = 'Lecture', resume = null;
  if (kind === 'film') {
    const p = S.progress[it.id];
    if (p && p.ts > 20) { playLabel = 'Reprendre'; resume = { pct: progressPct(it.id), text: `Arrêté à ${fmtTime(p.ts)} sur ${fmtTime(p.duration)}` }; }
  } else {
    const cur = currentEpisode(it.id) || eps[0];
    if (cur) {
      const p = S.progress[cur.id];
      playLabel = (p ? 'Reprendre ' : 'Lecture ') + epLabel(cur, it);
      if (p) resume = { pct: progressPct(cur.id), text: `${cur.title || 'Épisode ' + cur.episode}, arrêté à ${fmtTime(p.ts)}` };
    }
  }

  const inCols = kind === 'film' ? S.collections.filter(c => c.films.includes(it)) : [];
  const cast = it.cast.slice(0, 5);

  // Les plus proches : genres en commun d'abord, puis la note
  const more = S.items
    .filter(o => o.key !== it.key && (it.genres.length ? o.genres.some(g => it.genres.includes(g)) : o.type === it.type))
    .map(o => [o, o.genres.filter(g => it.genres.includes(g)).length * 10 + (o.rating || 0)])
    .sort((a, b) => b[1] - a[1]).slice(0, 18).map(x => x[0]);

  view.innerHTML = detailHero({
    bg,
    crumb: `<a class="crumb" href="/catalogue?type=${it.type}" data-link>${icon('left')}${esc(PLURAL[it.type])}</a>`,
    title: it.title,
    meta: metaHtml(it.rating, [it.year, kind === 'film' ? fmtShort(it.duration) : seriesLine(it)], it.genres),
    extra: (it.director ? `<p class="by">Réalisé par ${directorLinks(it.director)}</p>` : '') +
      (cast.length ? `<p class="by">Avec ${cast.map(n => `<a href="/catalogue?q=${encodeURIComponent(n)}" data-link><b>${esc(n)}</b></a>`).join(', ')}</p>` : ''),
    synopsis: it.description,
    actions: `<button class="btn play" id="play-btn" type="button">${icon('play')}${esc(playLabel)}</button>`,
    after: (resume ? `<div class="resume"><span class="pb"><i style="width:${resume.pct}%"></i></span><span>${esc(resume.text)}</span></div>` : '') +
      inCols.map(c => `<a class="in-col" href="/collection/${esc(c.id)}" data-link>${icon('grid')}Fait partie de la collection <b>${esc(c.title)}</b></a>`).join('<br>'),
  }) + `<div class="fiche-body">
      ${kind === 'serie' ? `<section class="eps" id="episodes-zone"></section>` : ''}
      ${row(it.genres.length ? 'Dans le même genre' : 'À voir aussi', more, null)}
    </div>`;

  // Le bouton reste là même sans vidéo : il prévient simplement qu'elle arrive
  $('#play-btn').addEventListener('click', () => playItem(it));
  clampSynopsis();
  tintDetail();
  if (kind === 'serie') renderEpisodes(it, eps);
};

const renderEpisodes = (it, eps) => {
  const zone = $('#episodes-zone');
  if (!eps.length) { zone.innerHTML = `${rowHead('Épisodes')}<p class="empty" style="padding:0">Aucun épisode pour le moment.</p>`; return; }
  const seasons = it.noSeason ? [null] : [...new Set(eps.map(e => e.season || 1))];
  const cur = currentEpisode(it.id);
  let season = it.noSeason ? null : (cur ? cur.season || 1 : seasons[0]);

  const draw = () => {
    const list = season === null ? eps : eps.filter(e => (e.season || 1) === season);
    zone.innerHTML = `<div class="rh"><h2>Épisodes</h2>
        ${seasons.length > 1 ? `<div class="seasons" role="tablist" aria-label="Saisons">${seasons.map(s =>
          `<button type="button" role="tab" data-season="${s}" aria-selected="${s === season}">Saison ${s}</button>`).join('')}</div>`
          : season !== null ? `<span>Saison ${season}</span>` : ''}
        <span class="eps-count">${list.length} épisode${list.length > 1 ? 's' : ''}</span></div>
      <div class="episodes"${seasons.length > 1 ? ' role="tabpanel"' : ''}>
        ${list.map(e => {
          const pct = progressPct(e.id);
          const thumb = imgUrl(e.thumb) || it.backdrop;
          return `<button class="ep" type="button" data-ep="${esc(e.id)}">
            <span class="ep-thumb">${placeholder()}${imgTag(thumb)}
              ${cur && e.id === cur.id ? '<span class="ep-cur">En cours</span>' : ''}
              <span class="ep-play">${icon('play')}</span>
              ${pct ? `<span class="prog"><i style="width:${pct}%"></i></span>` : ''}</span>
            <span class="ep-row"><span class="ep-num">Épisode ${e.episode || ''}</span><span class="ep-dur">${esc(fmtDuration(e.duration))}</span></span>
            <span class="ep-title">${esc(e.title || 'Épisode ' + e.episode)}</span>
            ${e.description ? `<span class="ep-desc">${esc(e.description)}</span>` : ''}
          </button>`;
        }).join('')}
      </div>`;
    $$('[data-season]', zone).forEach(b => b.addEventListener('click', () => { season = +b.dataset.season; draw(); }));
    $$('[data-ep]', zone).forEach(b => b.addEventListener('click', () => openPlayer(it, eps.find(e => e.id === b.dataset.ep))));
  };
  draw();
};

// ─── LECTEUR ──────────────────────────────────────────────────────────────────
// Commandes faites maison (plus de commandes natives du navigateur) :
//   ordi       → barre de progression pleine largeur, boutons en bas, titre en haut à gauche ;
//   téléphone  → commandes au centre, luminosité à gauche, boutons texte en bas.
// Sur un téléphone, le lecteur passe en paysage : plein écran + rotation sur Android ;
// sur iPhone (rotation impossible à forcer), il s'affiche couché via le CSS.
const LANGS = { fre: 'Français', fra: 'Français', fr: 'Français', eng: 'Anglais', en: 'Anglais', jpn: 'Japonais', ja: 'Japonais', spa: 'Espagnol', es: 'Espagnol', ger: 'Allemand', deu: 'Allemand', de: 'Allemand', ita: 'Italien', it: 'Italien', por: 'Portugais', kor: 'Coréen', chi: 'Chinois', zho: 'Chinois', ara: 'Arabe', rus: 'Russe', und: 'Inconnue' };
const DONE = 0.95; // au-delà, le contenu est considéré comme vu
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

const P = {
  it: null, ep: null, ref: '', contentId: null, next: null, lastT: null, watched: 0, timer: null, idle: null,
  tracks: { audio: [], subtitles: [] }, subTracks: [], sub: -1, audio: 0, audioBusy: null,
  panel: null, panelSeason: null, bright: 1, lastTap: null, tapTimer: null, unlockTimer: null, nativeFs: false,
};
const player = $('#player');
const video = $('#player-video');
const bar = $('#pl-bar');
const panel = $('#pl-panel');
const subsBox = $('#pl-subs');

// Préférences de ce navigateur (volume, sous-titres, affichage du temps)
const store = {
  get: (k, def) => { try { const v = localStorage.getItem('mf_' + k); return v === null ? def : JSON.parse(v); } catch(e) { return def; } },
  set: (k, v) => { try { localStorage.setItem('mf_' + k, JSON.stringify(v)); } catch(e) {} },
};
P.showRemaining = store.get('remaining', true);

const isTouch = () => matchMedia('(hover: none) and (pointer: coarse)').matches;
const ROTATED = matchMedia('(orientation: portrait) and (hover: none) and (pointer: coarse) and (max-width: 600px)');
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const setIcon = (btn, id) => btn?.querySelector('use')?.setAttribute('href', '#i-' + id);
const langName = (l) => LANGS[l] || (l ? l.toUpperCase() : 'Inconnue');
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement || null;

// Position du doigt ou de la souris le long d'un curseur, en tenant compte du lecteur couché
const frac = (el, e, vertical = false) => {
  const r = el.getBoundingClientRect(), rot = ROTATED.matches;
  if (!vertical) return clamp01(rot ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width);
  return clamp01(rot ? (e.clientX - r.left) / r.width : (r.bottom - e.clientY) / r.height);
};
const drag = (el, onMove, onEnd) => el.addEventListener('pointerdown', (e) => {
  if (e.button > 0) return;
  e.preventDefault();
  try { el.setPointerCapture(e.pointerId); } catch(err) {}
  el.classList.add('drag');
  onMove(e);
  const move = (ev) => onMove(ev);
  const up = (ev) => {
    el.classList.remove('drag');
    el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up);
    onEnd?.(ev);
    wake();
  };
  el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
});

// ── Affichage ──
let seeking = null; // position (0-1) pendant qu'on fait glisser la barre
const paintProgress = () => {
  const d = video.duration;
  if (!d || !isFinite(d)) return;
  const t = seeking !== null ? seeking * d : video.currentTime;
  let b = 0;
  for (let i = 0; i < video.buffered.length; i++) if (video.buffered.start(i) <= video.currentTime + 1) b = Math.max(b, video.buffered.end(i));
  bar.style.setProperty('--p', (t / d * 100) + '%');
  bar.style.setProperty('--b', (b / d * 100) + '%');
  bar.setAttribute('aria-valuenow', Math.round(t / d * 100));
  $('#pl-time').textContent = P.showRemaining ? fmtTime(Math.max(0, d - t)) : `${fmtTime(t)} / ${fmtTime(d)}`;
};
const setTip = (f) => {
  bar.style.setProperty('--h', f * 100 + '%');
  if (video.duration) $('#pl-tip').textContent = fmtTime(f * video.duration);
};
const paintPlay = () => $$('[data-act="play"]', player).forEach(b => {
  setIcon(b, video.paused ? 'play' : 'pause');
  b.setAttribute('aria-label', video.paused ? 'Lecture' : 'Pause');
});
const volSlider = $('#pl-vol-slider');
const paintVolume = () => {
  const v = video.muted ? 0 : video.volume;
  volSlider.style.setProperty('--v', v);
  volSlider.style.setProperty('--p', v * 100 + '%');
  volSlider.setAttribute('aria-valuenow', Math.round(v * 100));
  setIcon($('[data-act="mute"]', player), v === 0 ? 'mute' : v < .5 ? 'vol-low' : 'vol');
};
const setBright = (b) => {
  P.bright = b;
  video.style.filter = b < 1 ? `brightness(${b.toFixed(2)})` : '';
  $('#pl-bright-fill').style.height = ((b - .2) / .8 * 100) + '%';
  $('#pl-bright').setAttribute('aria-valuenow', Math.round(b * 100));
};
const animate = (el) => { el.classList.remove('go'); void el.offsetWidth; el.classList.add('go'); };
const flash = (id) => { const f = $('#pl-flash'); f.innerHTML = icon(id, 'pl-ic'); animate(f); };

// Les commandes s'effacent pendant la lecture (3 s sur ordi, 4 s au doigt)
const wake = () => {
  player.classList.remove('idle');
  clearTimeout(P.idle);
  P.idle = setTimeout(() => {
    if (video.paused || !panel.hidden || $('.drag', player)) return;
    if (!player.classList.contains('touch') && $('.pl-bottom:hover, .pl-top:hover', player)) return wake();
    player.classList.add('idle');
  }, player.classList.contains('touch') ? 4000 : 3000);
};
const toggleUi = () => {
  if (player.classList.contains('idle')) return wake();
  if (!panel.hidden) return;
  clearTimeout(P.idle);
  player.classList.add('idle');
};

// ── Actions ──
const togglePlay = () => { if (video.paused || video.ended) video.play().catch(() => {}); else video.pause(); };
const skip = (s) => {
  if (!video.duration) return;
  video.currentTime = Math.min(video.duration - .5, Math.max(0, video.currentTime + s));
  animate($(s < 0 ? '#pl-hint-l' : '#pl-hint-r'));
  paintProgress();
};
const setSpeed = (r) => {
  video.playbackRate = video.defaultPlaybackRate = r;
  $('#pl-speed-lbl').textContent = `Vitesse (${String(r).replace('.', ',')}x)`;
};
const enterFs = () => {
  const req = player.requestFullscreen || player.webkitRequestFullscreen;
  if (!req) return Promise.reject(new Error('plein écran indisponible'));
  try { return Promise.resolve(req.call(player, { navigationUI: 'hide' })); } catch(e) { return Promise.reject(e); }
};
const exitFs = () => { if (fsEl()) Promise.resolve((document.exitFullscreen || document.webkitExitFullscreen).call(document)).catch(() => {}); };
// Plein écran : le lecteur entier (ordi, Android, iPad). Sur iPhone, Safari ne le permet
// qu'avec son propre lecteur vidéo : on y passe, et nos commandes reviennent à la sortie.
const fsOk = () => !!(player.requestFullscreen || player.webkitRequestFullscreen || video.webkitEnterFullscreen);
const nativeFs = () => {
  if (!video.webkitEnterFullscreen) return toast('Plein écran indisponible sur cet appareil');
  P.nativeFs = true; syncTrackModes(); // les sous-titres choisis s'affichent aussi dans le lecteur d'Apple
  try { video.webkitEnterFullscreen(); } catch(e) { P.nativeFs = false; syncTrackModes(); }
};
const toggleFs = () => {
  if (fsEl()) return exitFs();
  enterFs()
    .then(() => { if (isTouch()) return screen.orientation.lock('landscape').catch(() => {}); })
    .catch(nativeFs);
};
video.addEventListener('webkitendfullscreen', () => { P.nativeFs = false; syncTrackModes(); wake(); });
// Téléphone : plein écran + paysage là où le navigateur le permet (Android)
const goLandscape = () => {
  if (!isTouch() || fsEl()) return;
  enterFs()
    .then(() => screen.orientation.lock('landscape'))
    // Plein écran possible mais pas la rotation : on revient au lecteur couché du CSS
    .catch(() => { if (ROTATED.matches) exitFs(); });
};
const pipOk = () => !!((document.pictureInPictureEnabled && video.requestPictureInPicture) || typeof video.webkitSetPresentationMode === 'function');
const togglePip = () => {
  if (document.pictureInPictureElement) return document.exitPictureInPicture().catch(() => {});
  if (document.pictureInPictureEnabled && video.requestPictureInPicture) return video.requestPictureInPicture().catch(() => toast('Image dans l\'image indisponible'));
  if (video.webkitSetPresentationMode) video.webkitSetPresentationMode(video.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
};
const setLock = (on) => {
  closePanel();
  player.classList.toggle('locked', on);
  $('#pl-unlock').hidden = true;
  if (!on) wake();
};
const showUnlock = () => {
  const b = $('#pl-unlock');
  b.hidden = false;
  clearTimeout(P.unlockTimer);
  P.unlockTimer = setTimeout(() => { b.hidden = true; }, 3000);
};
const playNext = () => { if (P.next) { saveProgress(); openPlayer(P.it, P.next); } };

// ── Sous-titres : extraits en VTT par le serveur, affichés par le site ──
const langKey = (l) => langName(l).toLowerCase();
const renderCues = () => {
  subsBox.replaceChildren();
  const t = P.subTracks[P.sub];
  if (!t || !t.activeCues) return;
  [...t.activeCues].sort((a, b) => a.startTime - b.startTime).forEach(c => {
    const d = document.createElement('div');
    try { d.append(c.getCueAsHTML()); } catch(e) { d.textContent = c.text; }
    subsBox.append(d);
  });
};
const syncTrackModes = () => {
  for (const t of video.textTracks) {
    const want = t === P.subTracks[P.sub] ? (P.nativeFs ? 'showing' : 'hidden') : 'disabled';
    if (t.mode !== want) t.mode = want;
  }
};
const applySub = (i, remember = false) => {
  P.sub = i;
  syncTrackModes();
  renderCues();
  if (remember) store.set('sub', i < 0 ? 'off' : langKey(P.tracks.subtitles[i]?.lang));
};
// Par défaut : le dernier choix ; sinon des sous-titres français quand le film n'est pas en français
const defaultSub = () => {
  const subs = P.tracks.subtitles, pref = store.get('sub', null);
  const audioLang = langKey(P.tracks.audio[P.audio]?.lang);
  if (pref === 'off' || !subs.length) return -1;
  const want = pref || 'français';
  if (want === audioLang) return -1;
  return subs.findIndex(s => langKey(s.lang) === want);
};
video.textTracks.addEventListener?.('change', syncTrackModes);

const loadTracks = (ref, id) => api('/api/tracks?rel=' + encodeURIComponent(ref)).then(d => {
  if (P.contentId !== id) return;
  P.tracks = { audio: d.audio || [], subtitles: d.subtitles || [] };
  P.subTracks = P.tracks.subtitles.map(s => {
    const el = document.createElement('track');
    el.kind = 'subtitles'; el.srclang = s.lang; el.label = langName(s.lang);
    el.src = `/api/subtitle?rel=${encodeURIComponent(ref)}&index=${s.index}`;
    video.appendChild(el);
    el.track.addEventListener('cuechange', () => { if (P.subTracks[P.sub] === el.track) renderCues(); });
    return el.track;
  });
  applySub(defaultSub());
  if (P.panel === 'audio') renderPanel();
});

// ── Pistes audio : directement dans Safari, sinon le serveur prépare une copie ──
const switchSrc = (src, i) => {
  const t = video.currentTime, playing = !video.paused;
  P.audio = i;
  video.src = src;
  video.addEventListener('loadedmetadata', () => {
    video.currentTime = t;
    if (playing) video.play().catch(() => {});
    syncTrackModes();
  }, { once: true });
  if (P.panel === 'audio') renderPanel();
};
const selectAudio = async (i) => {
  if (i === P.audio || i === P.audioBusy) return;
  const native = video.audioTracks;
  if (native && native.length === P.tracks.audio.length && native.length > 1) {
    for (let k = 0; k < native.length; k++) native[k].enabled = k === i;
    P.audio = i;
    return renderPanel();
  }
  if (i === 0) { P.audioBusy = null; return switchSrc(mediaUrl(P.ref), 0); }
  const id = P.contentId;
  P.audioBusy = i; renderPanel();
  let st = await api(`/api/prepare-audio?rel=${encodeURIComponent(P.ref)}&audio=${i}`);
  const hash = st.hash || '';
  const poll = () => {
    if (P.contentId !== id || P.audioBusy !== i) return;
    if (st.status === 'ready') { P.audioBusy = null; return switchSrc(mediaUrl(P.ref) + '?audio=' + i, i); }
    if (st.status === 'pending') {
      setTimeout(async () => { st = await api('/api/audio-status?hash=' + encodeURIComponent(hash)); poll(); }, 2000);
      return;
    }
    P.audioBusy = null; renderPanel();
    toast(st.error || 'Impossible de préparer cette piste audio');
  };
  poll();
};

// ── Panneaux ──
const panelHead = (title, sub) => `<div class="pl-panel-head"><div>${sub ? `<span class="label">${esc(sub)}</span>` : ''}<h2>${esc(title)}</h2></div>
  <button class="pl-btn" data-act="panel-close" aria-label="Fermer">${icon('x', 'pl-ic')}</button></div>`;
const opt = (attr, label, sel, note = '') => `<button class="pl-opt${sel ? ' sel' : ''}${note ? ' busy' : ''}" ${attr}>${icon('check')}<span>${esc(label)}</span>${note ? `<small>${esc(note)}</small>` : ''}</button>`;
const renderPanel = () => {
  if (!P.panel) return;
  if (P.panel === 'audio') {
    const audio = P.tracks.audio;
    const names = audio.map(a => langName(a.lang));
    const audioHtml = audio.length
      ? audio.map((a, i) => opt(`data-audio="${i}"`, names.filter(n => n === names[i]).length > 1 && a.title ? `${names[i]} · ${a.title.slice(0, 22)}` : names[i],
          i === P.audio, i === P.audioBusy ? 'Préparation…' : '')).join('')
      : opt('data-audio="0"', 'Piste d\'origine', true);
    const subsHtml = opt('data-sub="-1"', 'Désactivés', P.sub < 0) +
      P.tracks.subtitles.map((s, i) => opt(`data-sub="${i}"`, langName(s.lang) + (s.forced ? ' (forcés)' : ''), i === P.sub)).join('');
    panel.innerHTML = panelHead('Audio et sous-titres') +
      `<div class="pl-cols"><div><h3 class="label">Audio</h3>${audioHtml}</div><div><h3 class="label">Sous-titres</h3>${subsHtml}</div></div>`;
  } else if (P.panel === 'speed') {
    panel.innerHTML = panelHead('Vitesse de lecture') + `<div class="pl-speeds">${SPEEDS.map(s =>
      `<button class="pl-speed${video.playbackRate === s ? ' sel' : ''}" data-speed="${s}"><i></i>${s === 1 ? '1x (normale)' : String(s).replace('.', ',') + 'x'}</button>`).join('')}</div>`;
  } else if (P.panel === 'episodes') {
    const eps = episodesOf(P.it.id);
    const seasons = [...new Set(eps.map(e => e.season || 1))];
    const season = P.panelSeason ?? (P.ep?.season || 1);
    const list = eps.filter(e => (e.season || 1) === season);
    const tabs = !P.it.noSeason && seasons.length > 1
      ? `<div class="pl-seasons">${seasons.map(n => `<button class="pl-season${n === season ? ' sel' : ''}" data-season="${n}">Saison ${n}</button>`).join('')}</div>` : '';
    panel.innerHTML = panelHead(P.it.noSeason ? 'Épisodes' : `Saison ${season}`, P.it.title) + tabs + `<ol>${list.map(e => {
      const pct = progressPct(e.id);
      return `<li><button class="pl-ep${e.id === P.ep?.id ? ' cur' : ''}" data-ep="${e.id}">
        <span>${e.episode || ''}</span>
        <span class="pl-ep-th">${e.thumb ? `<img src="${esc(imgUrl(e.thumb))}" alt="" loading="lazy">` : ''}${pct ? `<b style="width:${pct}%"></b>` : ''}</span>
        <span><strong>${esc(e.title || 'Épisode ' + (e.episode || ''))}</strong>${e.duration ? `<small>${esc(e.duration)}</small>` : ''}${e.description ? `<p>${esc(e.description)}</p>` : ''}</span>
      </button></li>`;
    }).join('')}</ol>`;
    $('.pl-ep.cur', panel)?.scrollIntoView({ block: 'nearest' });
  }
};
const openPanel = (kind) => {
  if (P.panel === kind) return closePanel();
  P.panel = kind; P.panelSeason = null;
  panel.className = 'pl-panel pl-panel-' + kind;
  panel.hidden = false;
  renderPanel();
  wake();
};
const closePanel = () => {
  if (panel.hidden) return false;
  panel.hidden = true; panel.innerHTML = ''; P.panel = null;
  wake();
  return true;
};
panel.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.act === 'panel-close') return closePanel();
  if (b.dataset.audio !== undefined) selectAudio(+b.dataset.audio);
  else if (b.dataset.sub !== undefined) { applySub(+b.dataset.sub, true); renderPanel(); }
  else if (b.dataset.speed) { setSpeed(+b.dataset.speed); renderPanel(); }
  else if (b.dataset.season) { P.panelSeason = +b.dataset.season; renderPanel(); }
  else if (b.dataset.ep) {
    const ep = S.episodes.find(x => x.id === b.dataset.ep);
    closePanel();
    if (ep && ep.id !== P.ep?.id) { saveProgress(); openPlayer(P.it, ep); }
  }
});

// ── Ouvrir / fermer ──
const openPlayer = (it, ep) => {
  const ref = ep ? ep.videoRef : it.videoRef;
  if (!ref) return toast('La vidéo n\'est pas encore disponible');
  const wasOpen = !player.hidden;
  const id = ep ? ep.id : it.id;
  Object.assign(P, { it, ep, ref, contentId: id, lastT: null, watched: S.progress[id]?.watchedSec || 0,
    tracks: { audio: [], subtitles: [] }, subTracks: [], sub: -1, audio: 0, audioBusy: null });
  closePanel();
  player.classList.remove('locked');
  player.classList.toggle('touch', isTouch());
  player.classList.toggle('film', !ep);
  player.hidden = false;
  document.body.style.overflow = 'hidden';
  if (!wasOpen) goLandscape();

  $('#pl-sub').textContent = ep
    ? [TYPES[it.type], epLabel(ep, it), ep.title].filter(Boolean).join(' · ')
    : [TYPES[it.type], it.year].filter(Boolean).join(' · ');
  $('#pl-name').textContent = it.title;
  $('#player-msg').hidden = true;
  const eps = ep ? episodesOf(it.id) : [];
  P.next = ep ? eps[eps.findIndex(e => e.id === ep.id) + 1] || null : null;
  player.classList.toggle('no-next', !P.next);
  $('#pl-pip').hidden = !pipOk();
  $('#pl-fs').hidden = !fsOk();

  $$('track', video).forEach(t => t.remove());
  subsBox.replaceChildren();
  bar.style.setProperty('--p', '0%'); bar.style.setProperty('--b', '0%');
  $('#pl-time').textContent = '';
  video.src = mediaUrl(ref);
  setSpeed(1);
  setBright(P.bright);
  const p = S.progress[id];
  video.addEventListener('loadedmetadata', () => {
    if (p && p.ts > 20 && p.ts < video.duration * DONE) video.currentTime = p.ts;
    paintProgress();
  }, { once: true });
  video.play().catch(() => {});
  paintPlay(); paintVolume();
  loadTracks(ref, id);

  // Le bouton « précédent » du navigateur ferme le lecteur
  if (!history.state?.player) history.pushState({ ...history.state, player: true }, '', location.href);
  clearInterval(P.timer);
  P.timer = setInterval(() => { if (!video.paused) saveProgress(); }, 15000);
  wake();
};

const saveProgress = (keepalive = false) => {
  if (!P.contentId || !video.duration || !isFinite(video.duration)) return;
  const t = video.currentTime, id = P.contentId;
  if (t / video.duration >= DONE) delete S.progress[id];
  else if (t > 5) S.progress[id] = { ts: t, duration: video.duration, watchedSec: Math.round(P.watched), seriesId: P.ep ? P.it.id : null, updatedAt: Date.now() };
  else return;
  // Gardée sur le disque : on la retrouve d'un ordi à l'autre
  fetch('/api/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive, body: JSON.stringify({ id, p: S.progress[id] || null }) }).catch(() => {});
};

const closePlayer = () => {
  if (player.hidden) return;
  saveProgress();
  closePanel();
  clearInterval(P.timer); clearTimeout(P.idle); clearTimeout(P.tapTimer); clearTimeout(P.unlockTimer);
  player.classList.remove('idle', 'locked');
  $('#pl-unlock').hidden = true;
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  exitFs();
  try { screen.orientation?.unlock?.(); } catch(e) {}
  video.pause(); video.removeAttribute('src'); video.load();
  $$('track', video).forEach(t => t.remove());
  subsBox.replaceChildren();
  $('#pl-spin').hidden = true;
  player.hidden = true;
  document.body.style.overflow = '';
  P.contentId = null; P.audioBusy = null; P.subTracks = [];
};

// ── Évènements de la vidéo ──
video.addEventListener('timeupdate', () => {
  const t = video.currentTime;
  if (P.lastT !== null && t > P.lastT && t - P.lastT < 2) P.watched += t - P.lastT;
  P.lastT = t;
  paintProgress();
});
['progress', 'durationchange', 'seeked'].forEach(ev => video.addEventListener(ev, paintProgress));
video.addEventListener('play', () => { paintPlay(); wake(); });
video.addEventListener('pause', () => { paintPlay(); saveProgress(); wake(); });
video.addEventListener('waiting', () => { $('#pl-spin').hidden = false; });
['playing', 'canplay', 'seeked', 'pause', 'error'].forEach(ev => video.addEventListener(ev, () => { $('#pl-spin').hidden = true; }));
video.addEventListener('volumechange', () => { paintVolume(); store.set('vol', { v: video.volume, m: video.muted }); });
video.addEventListener('ended', () => { saveProgress(); if (P.next) openPlayer(P.it, P.next); });
video.addEventListener('error', () => {
  if (!video.getAttribute('src')) return;
  const msg = $('#player-msg');
  msg.querySelector('p').textContent = 'Lecture impossible. Le disque des vidéos n\'est peut-être pas branché, ou le fichier a été déplacé.';
  msg.hidden = false;
});
{ const v = store.get('vol', null); if (v) { video.volume = clamp01(+v.v || 0); video.muted = !!v.m; } }

// ── Commandes ──
$('#pl-ui').addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  if (e.detail) b.blur(); // la barre d'espace ne doit pas « recliquer » le bouton
  const a = b.dataset.act;
  if (a === 'play') togglePlay();
  else if (a === 'rw') skip(-10);
  else if (a === 'ff') skip(10);
  else if (a === 'mute') { video.muted = !video.muted; if (!video.muted && video.volume === 0) video.volume = .5; }
  else if (a === 'next') playNext();
  else if (a === 'episodes' || a === 'audio' || a === 'speed') openPanel(a);
  else if (a === 'fullscreen') toggleFs();
  wake();
});
$('#pl-close').addEventListener('click', () => history.back());
$('#pl-pip').addEventListener('click', togglePip);
$('#pl-lock').addEventListener('click', () => setLock(true));
$('#pl-unlock').addEventListener('click', () => setLock(false));
$('#pl-time').addEventListener('click', () => { P.showRemaining = !P.showRemaining; store.set('remaining', P.showRemaining); paintProgress(); });

drag(bar, (e) => { if (!video.duration) return; seeking = frac(bar, e); setTip(seeking); paintProgress(); },
  () => { if (seeking !== null && video.duration) video.currentTime = seeking * video.duration; seeking = null; paintProgress(); });
bar.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && seeking === null) setTip(frac(bar, e)); });
const volRail = $('.pl-rail', volSlider);
drag(volSlider, (e) => { video.volume = frac(volRail, e); video.muted = video.volume === 0; });
const brightRail = $('.pl-vrail', $('#pl-bright'));
drag($('#pl-bright'), (e) => setBright(.2 + .8 * frac(brightRail, e, true)));

// Zone de la vidéo : un clic met en pause (ordi) ; au doigt, un toucher affiche ou cache
// les commandes et deux touchers rapides sur un côté avancent ou reculent de 10 s.
const tap = $('#pl-tap');
tap.addEventListener('click', (e) => {
  if (player.classList.contains('touch') || e.pointerType === 'touch') return;
  if (closePanel()) return;
  togglePlay();
  flash(video.paused ? 'pause' : 'play');
  wake();
});
tap.addEventListener('dblclick', () => { if (!player.classList.contains('touch')) toggleFs(); });
tap.addEventListener('pointerup', (e) => {
  if (e.pointerType === 'mouse') return;
  if (player.classList.contains('locked')) return showUnlock();
  if (closePanel()) return;
  const f = frac(tap, e);
  const side = f < 1 / 3 ? -1 : f > 2 / 3 ? 1 : 0;
  const now = Date.now();
  clearTimeout(P.tapTimer);
  if (side && P.lastTap && P.lastTap.side === side && now - P.lastTap.t < 320) {
    P.lastTap = { t: now, side };
    skip(side * 10);
    return;
  }
  P.lastTap = { t: now, side };
  P.tapTimer = setTimeout(() => { P.lastTap = null; toggleUi(); }, side ? 280 : 0);
});
player.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') wake(); });
$('#pl-ui').addEventListener('pointerdown', () => wake());
['fullscreenchange', 'webkitfullscreenchange'].forEach(ev => document.addEventListener(ev, () => {
  $$('[data-act="fullscreen"]', player).forEach(b => {
    setIcon(b, fsEl() ? 'fs-exit' : 'fs');
    b.setAttribute('aria-label', fsEl() ? 'Quitter le plein écran' : 'Plein écran');
  });
}));

// Raccourcis clavier : espace/K, ←/→ (10 s), ↑/↓ (volume), M (muet), F (plein écran), C (sous-titres)
document.addEventListener('keydown', (e) => {
  if (player.hidden || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea, select')) return;
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'k') { e.preventDefault(); togglePlay(); flash(video.paused ? 'pause' : 'play'); }
  else if (k === 'arrowleft') { e.preventDefault(); skip(-10); }
  else if (k === 'arrowright') { e.preventDefault(); skip(10); }
  else if (k === 'arrowup') { e.preventDefault(); video.muted = false; video.volume = Math.min(1, video.volume + .1); }
  else if (k === 'arrowdown') { e.preventDefault(); video.volume = Math.max(0, video.volume - .1); }
  else if (k === 'm') video.muted = !video.muted;
  else if (k === 'f') toggleFs();
  else if (k === 'c' && P.subTracks.length) applySub(P.sub >= 0 ? -1 : Math.max(0, defaultSub()), true);
  else return;
  wake();
});
addEventListener('pagehide', () => { if (!player.hidden) saveProgress(true); });

// ─── FENÊTRES ─────────────────────────────────────────────────────────────────
let lastFocus = null, onModalClose = null;
const modal = (title, body, { closable = true, cls = '' } = {}) => {
  closeModal();
  lastFocus = document.activeElement;
  $('#modals').innerHTML = `<div class="modal-bg" data-bg>
    <div class="modal ${cls}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      ${title ? `<div class="modal-head"><h2 class="display" id="modal-title">${esc(title)}</h2>
        ${closable ? `<button class="modal-close" data-close aria-label="Fermer">${icon('x')}</button>` : ''}</div>` : ''}
      <div class="modal-body">${body}</div>
    </div></div>`;
  const bg = $('[data-bg]');
  bg.dataset.closable = closable;
  bg.addEventListener('mousedown', (e) => { if (e.target === bg && closable) closeModal(); });
  $$('[data-close]', bg).forEach(b => b.addEventListener('click', closeModal));
  return $('.modal', bg);
};
const closeModal = () => {
  const bg = $('[data-bg]');
  if (!bg) return;
  bg.remove();
  const cb = onModalClose; onModalClose = null; cb?.();
  lastFocus?.focus?.();
};

const confirmBox = (title, text, ok) => new Promise(resolve => {
  const m = modal(title, `<p style="color:var(--fg-body);margin-bottom:20px">${esc(text)}</p>
    <div class="modal-foot"><button class="btn-ghost" data-close>Annuler</button><button class="btn-red" id="cf-ok">${esc(ok)}</button></div>`);
  let done = false;
  onModalClose = () => { if (!done) resolve(false); };
  $('#cf-ok', m).addEventListener('click', () => { done = true; closeModal(); resolve(true); });
  $('#cf-ok', m).focus();
});

let toastTimer = null;
const toast = (msg) => {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
};

// ─── LIEN AVEC LE DISQUE ──────────────────────────────────────────────────────
// La page garde une connexion avec le site : tant qu'elle est ouverte, il tourne.
// Quand on ferme la dernière page, il s'arrête tout seul et le disque peut être éjecté.
let events = null, offlineTimer = null, quitting = false;
const connect = () => {
  events = new EventSource('/api/events');
  events.onopen = () => { clearTimeout(offlineTimer); offlineTimer = null; $('#offline').hidden = true; };
  events.onerror = () => {
    if (quitting || offlineTimer || !$('#offline').hidden) return;
    offlineTimer = setTimeout(() => { offlineTimer = null; if (events.readyState !== 1) $('#offline').hidden = false; }, 4000);
  };
};

// Éjecter : le site s'arrête tout de suite (sinon, 1 min 30 après la fermeture de la page)
const showClosed = () => {
  quitting = true;
  events?.close();
  if (!player.hidden) closePlayer();
  closeModal();
  document.title = 'Fermé · Messi por favor';
  $('#offline').hidden = true;
  document.body.classList.add('closed');
  stopHero();
  view.innerHTML = `<div class="closed-screen">${logoFace()}
    <h1 class="display">Messi por favor est fermé</h1>
    <p>Tu peux fermer cet onglet et éjecter le disque.</p>
    <p class="hint">Pour revenir : double-clique sur « ▶ Messi por favor », tout en haut du disque.</p>
  </div>`;
};
$('#quit-btn').addEventListener('click', async () => {
  if (!await confirmBox('Éjecter le disque', 'Le site va s\'arrêter et ta progression est enregistrée. Tu pourras ensuite éjecter le disque dans le Finder.', 'Arrêter le site')) return;
  if (!player.hidden) saveProgress();
  quitting = true;
  await api('/api/quit', {});
  showClosed();
});

// ─── RECHERCHE : LE MUR D'AFFICHES (⌘K) ───────────────────────────────────────
// On tape dans le champ de la barre, qui reste à sa place. Dessous, toutes les affiches
// du disque : celles qui correspondent s'allument et glissent en tête, les autres
// s'éteignent. Flèches + Entrée au clavier.
const searchBox = $('#search-box'), searchIn = $('#search-in'), searchClose = $('#search-close');
let wall = null;
const closeWall = () => {
  if (!wall) return false;
  const w = wall; wall = null;
  clearTimeout(w.timer); clearTimeout(w.enterTimer);
  w.el.classList.add('out');
  setTimeout(() => w.el.remove(), 180);
  document.body.style.overflow = '';
  header.classList.remove('searching');
  searchIn.value = ''; searchIn.blur(); searchClose.hidden = true;
  return true;
};
const openWall = () => {
  if (wall) return;
  closeModal();
  const items = S.items.slice().sort((a, b) => b.addedAt - a.addedAt);
  const el = document.createElement('div');
  el.className = 'wall';
  el.setAttribute('role', 'region'); el.setAttribute('aria-label', 'Résultats de la recherche');
  el.innerHTML = `<div class="wall-info"><span class="wall-n" aria-live="polite"></span><span class="wall-empty" hidden></span></div>
    <div class="wall-grid">${items.map(it => `<a class="wall-p" href="/${it.kind}/${esc(it.id)}" data-link data-key="${esc(it.key)}" aria-label="${esc(it.title)}">
      ${posterHtml(it.poster)}<span class="wall-cap"><b>${esc(it.title)}</b><small>${esc([it.year, TYPES[it.type]].filter(Boolean).join(', '))}</small></span></a>`).join('')}</div>`;
  document.body.append(el);
  document.body.style.overflow = 'hidden';
  header.classList.add('searching'); searchClose.hidden = false;
  const grid = $('.wall-grid', el), count = $('.wall-n', el), empty = $('.wall-empty', el);
  const tiles = new Map($$('.wall-p', grid).map(a => [a.dataset.key, a]));
  const hay = new Map(items.map(it => [it.key, norm([it.title, it.director, it.year, ...it.genres, ...it.cast, TYPES[it.type]].join(' '))]));
  const cols = () => getComputedStyle(grid).gridTemplateColumns.split(' ').length;
  wall = { el, timer: null, enterTimer: null };

  // Apparition : une vague qui part du coin en haut à gauche (les premières rangées seulement)
  const n = cols();
  $$('.wall-p', grid).forEach((a, i) => {
    const r = Math.floor(i / n);
    if (r < 8) a.style.setProperty('--d', (r + i % n) * 28 + 'ms'); else a.classList.add('late');
  });
  el.classList.add('enter');
  wall.enterTimer = setTimeout(() => el.classList.remove('enter'), 1800);

  let hits = [], sel = 0;
  const paintSel = (scroll = true) => {
    $$('.wall-p.sel', grid).forEach(a => a.classList.remove('sel'));
    const a = hits[sel] && tiles.get(hits[sel].key);
    if (a) { a.classList.add('sel'); if (scroll) a.scrollIntoView({ block: 'nearest' }); }
  };
  const update = () => {
    const q = searchIn.value.trim(), words = q.split(/\s+/).map(norm).filter(Boolean), whole = words.join('');
    hits = words.length ? items.filter(it => words.every(w => hay.get(it.key).includes(w))) : [];
    hits.sort((a, b) => (norm(b.title).includes(whole) - norm(a.title).includes(whole)) || (b.rating || 0) - (a.rating || 0));
    sel = 0;
    const lit = new Set(hits.map(h => h.key));
    el.scrollTop = 0;
    // Les affiches trouvées glissent en tête (on anime le trajet de celles qui sont à l'écran)
    const animate = !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const first = animate ? new Map([...tiles].map(([k, a]) => [k, a.getBoundingClientRect()])) : null;
    (words.length ? [...hits, ...items.filter(it => !lit.has(it.key))] : items).forEach(it => grid.append(tiles.get(it.key)));
    tiles.forEach((a, k) => a.classList.toggle('on', lit.has(k)));
    el.classList.toggle('typing', words.length > 0);
    if (first) {
      const moved = [];
      tiles.forEach((a, k) => {
        const f = first.get(k), l = a.getBoundingClientRect(), dx = f.left - l.left, dy = f.top - l.top;
        if ((dx || dy) && ((f.top < innerHeight && f.bottom > 0) || (l.top < innerHeight && l.bottom > 0))) {
          a.style.transition = 'none'; a.style.transform = `translate(${dx}px, ${dy}px)`; moved.push(a);
        }
      });
      if (moved.length) { void grid.offsetWidth; moved.forEach(a => { a.style.transition = ''; a.style.transform = ''; }); }
    }
    count.textContent = !words.length ? `${items.length} titres sur le disque`
      : !hits.length ? 'Aucune affiche allumée'
      : `${hits.length} affiche${hits.length > 1 ? 's' : ''} allumée${hits.length > 1 ? 's' : ''}`;
    empty.hidden = !words.length || hits.length > 0;
    empty.textContent = `Rien ne correspond à « ${q} ». Essaie un autre mot.`;
    paintSel(false);
  };
  wall.update = update;
  wall.move = (key) => {
    if (!hits.length) return false;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols(), ArrowUp: -cols() }[key];
    if (step === undefined) return false;
    sel = Math.max(0, Math.min(hits.length - 1, sel + step));
    paintSel();
    return true;
  };
  wall.open = () => { const it = hits[sel]; if (it) go(`/${it.kind}/${it.id}`); };
  update();
};
searchBox.addEventListener('click', (e) => { if (e.target.closest('#search-close')) return; openWall(); searchIn.focus(); });
searchIn.addEventListener('focus', openWall);
searchIn.addEventListener('input', () => { if (!wall) openWall(); clearTimeout(wall.timer); wall.timer = setTimeout(wall.update, 90); });
searchIn.addEventListener('keydown', (e) => {
  if (!wall) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeWall(); return; }
  if (e.key === 'Enter') { e.preventDefault(); wall.open(); return; }
  if (wall.move(e.key)) e.preventDefault();
});
searchClose.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeWall(); });

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (!$('#player').hidden || quitting) return;
    if (wall) closeWall(); else if ($('[data-bg]')) closeModal(); else { openWall(); searchIn.focus(); }
    return;
  }
  if (e.key === 'Escape') {
    if (closeWall()) return;
    const bg = $('[data-bg]');
    if (bg) { if (bg.dataset.closable === 'true') closeModal(); return; }
    if (!$('#player').hidden) { if (!closePanel()) history.back(); return; }
  }
});

// ─── DÉMARRAGE ────────────────────────────────────────────────────────────────
const init = async () => {
  const data = await api('/api/data');
  if (data.error) {
    view.innerHTML = `<div class="wrap"><p class="empty">${esc(data.error)}. <a class="link-u" href="/">Réessayer →</a></p></div>`;
    return;
  }
  loadData(data);
  connect();
  render();
};
init();
})();
