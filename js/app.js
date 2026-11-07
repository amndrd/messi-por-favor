/* ══════════════════════════════════════════════════════════════════════════
   Messi por favor — interface (version disque dur)
   Accueil, catalogue, collections, fiches et lecteur. Le catalogue vient du
   serveur (/api/data) : seulement ce qui est sur le disque. Pas de compte ;
   la progression et « Ma liste » sont gardées sur le disque.
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
  episodes: [], progress: {}, myList: [],
  items: [], byKey: new Map(), // films et séries, dans un format commun
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
  S.myList   = d.myList || [];
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

const inMyList = (it) => S.myList.some(x => x.kind === it.kind && x.id === it.id);

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
const placeholder = () => `<div class="ph" aria-hidden="true"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><span class="ph-ring">${icon('film', '')}</span></div>`;
// L'affiche apparaît en fondu par-dessus le motif ; si elle manque, le motif reste
const imgTag = (src) => src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ok')" onerror="this.remove()">` : '';
const posterHtml = (src) => placeholder() + imgTag(src);

// Résumé replié après quelques lignes ; « Voir plus » seulement s'il dépasse
const clampSynopsis = () => {
  const p = $('.synopsis');
  if (!p) return;
  p.classList.add('clamp');
  if (p.scrollHeight - p.clientHeight < 4) { p.classList.remove('clamp'); return; }
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'more-btn label';
  btn.textContent = 'Voir plus'; btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => {
    const open = !p.classList.toggle('clamp');
    btn.textContent = open ? 'Voir moins' : 'Voir plus';
    btn.setAttribute('aria-expanded', open);
  });
  p.after(btn);
};

const card = (it) => {
  const pct = itemProgress(it);
  const line = it.kind === 'serie'
    ? `${it.seasonCount > 1 ? it.seasonCount + ' saisons · ' : ''}${it.epCount} épisode${it.epCount > 1 ? 's' : ''}`
    : fmtDuration(it.duration);
  return `<a class="card" href="/${it.kind}/${esc(it.id)}" data-link>
    <div class="poster">
      ${posterHtml(it.poster)}
      <span class="tag">${TYPES[it.type]}</span>
      <div class="peek" aria-hidden="true">
        ${it.director ? `<p class="peek-by">${esc(it.director)}</p>` : ''}
        ${line ? `<div class="peek-line">${it.year ? `<span class="box">${esc(it.year)}</span>` : ''}<span>${esc(line)}</span></div>` : ''}
        ${it.description ? `<p class="peek-desc">${esc(it.description)}</p>` : ''}
      </div>
      ${it.rating ? `<span class="score">${icon('star')}${it.rating.toFixed(1)}/10</span>` : ''}
      ${pct ? `<div class="prog"><i style="width:${pct}%"></i></div>` : ''}
    </div>
    <div class="card-meta"><span class="card-title">${esc(it.title)}</span>${it.year ? `<span class="card-year">${esc(it.year)}</span>` : ''}</div>
    ${it.genres.length ? `<p class="card-genres">${esc(it.genres.slice(0, 2).join(' · '))}</p>` : ''}
  </a>`;
};

const row = (title, items, more) => items.length ? `<section class="row">
    <div class="row-head"><h2 class="display">${esc(title)}</h2>${more ? `<a class="link-u" href="${more}" data-link>Voir tout →</a>` : ''}</div>
    <div class="grid">${items.map(card).join('')}</div>
  </section>` : '';

const searchBar = (value = '') => `<form class="searchbar" role="search" id="search-form">
    <label class="label" for="search-input">Rechercher</label>
    <input id="search-input" name="q" type="search" autocomplete="off" spellcheck="false" value="${esc(value)}" placeholder="${esc(examplePlaceholder())}">
    <button class="btn-red" type="submit">Chercher →</button>
  </form>`;

// Un titre du catalogue en exemple dans la barre de recherche
const examplePlaceholder = () => {
  const pool = S.items.filter(it => it.poster);
  const it = pool[Math.floor(Math.random() * pool.length)];
  return it ? [it.title, it.year, TYPES[it.type]].filter(Boolean).join(' · ') : 'Titre, réalisateur, genre…';
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

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
const routes = [
  [/^\/$/,                 () => viewHome()],
  [/^\/catalogue\/?$/,     () => viewCatalogue()],
  [/^\/collections\/?$/,   () => viewCollections()],
  [/^\/collection\/([\w-]+)$/, (id) => viewCollection(id)],
  [/^\/(film|serie)\/([\w-]+)$/, (kind, id) => viewTitle(kind, id)],
];

const render = () => {
  if (!$('#player').hidden) closePlayer();
  closeMenus();
  closeOpenDD = null;
  const path = location.pathname;
  for (const [re, fn] of routes) {
    const m = path.match(re);
    if (!m) continue;
    fn(...m.slice(1));
    const liste = new URLSearchParams(location.search).get('liste') === '1';
    const tab = path.startsWith('/catalogue') ? (liste ? 'liste' : 'catalogue')
      : path.startsWith('/collection') ? 'collections' : path === '/' ? 'accueil' : '';
    $$('[data-tab]').forEach(a => {
      a.classList.toggle('active', a.dataset.tab === tab);
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
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
const latest = (type, n = 6) => S.items.filter(it => it.type === type).sort((a, b) => b.addedAt - a.addedAt).slice(0, n);

const viewHome = () => {
  document.title = 'Messi por favor';
  // Reprendre : le dernier contenu commencé de chaque titre
  const seen = new Set(), resume = [];
  Object.entries(S.progress).sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)).forEach(([id, p]) => {
    const ep = p.seriesId ? S.episodes.find(e => e.id === id) : null;
    const it = ep ? S.byKey.get('serie:' + ep.seriesId) : S.byKey.get('film:' + id);
    if (it && !seen.has(it.key)) { seen.add(it.key); resume.push(it); }
  });
  const films = latest('film'), series = latest('serie'), animes = latest('anime'), animation = latest('animation');
  const mine = S.myList.map(x => S.byKey.get(x.kind + ':' + x.id)).filter(Boolean).slice(0, 6);

  view.innerHTML = `<div class="wrap">
    <section class="home-top">
      ${searchBar()}
      <div class="quick">
        <span class="label">Filtres rapides :</span>
        <a href="/catalogue?type=film" data-link>Films</a>
        <a href="/catalogue?type=serie" data-link>Séries</a>
        <a href="/catalogue?type=anime" data-link>Animes</a>
        <a href="/catalogue?type=animation" data-link>Animation</a>
        <a href="/catalogue?liste=1" data-link>Ma liste</a>
      </div>
    </section>
    ${row('Reprendre', resume.slice(0, 6), null)}
    ${row('Derniers films', films, '/catalogue?type=film')}
    ${row('Dernières séries', series, '/catalogue?type=serie')}
    ${row('Derniers animes', animes, '/catalogue?type=anime')}
    ${row('Derniers films d\'animation', animation, '/catalogue?type=animation')}
    ${row('Ma liste', mine, '/catalogue?liste=1')}
  </div>`;
  bindSearch();
};

// ─── CATALOGUE ────────────────────────────────────────────────────────────────
const SORTS = { recent: 'Ajout récent', title: 'Titre (A → Z)', newest: 'Sortie (récente)', oldest: 'Sortie (ancienne)', rating: 'Note' };

const readFilters = () => {
  const q = new URLSearchParams(location.search);
  return { q: q.get('q') || '', type: q.get('type') || '', genre: q.get('genre') || '', from: q.get('de') || '', to: q.get('a') || '', sort: SORTS[q.get('tri')] ? q.get('tri') : 'recent', liste: q.get('liste') === '1' };
};
const writeFilters = (f) => {
  const q = new URLSearchParams();
  if (f.q) q.set('q', f.q); if (f.type) q.set('type', f.type); if (f.genre) q.set('genre', f.genre);
  if (f.from) q.set('de', f.from); if (f.to) q.set('a', f.to); if (f.sort !== 'recent') q.set('tri', f.sort); if (f.liste) q.set('liste', '1');
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
    if (f.liste && !inMyList(it)) return false;
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
const dropdown = (id, opts, value, { label = '', variant = '', width = '' } = {}) => {
  const cur = opts.find(o => o[0] === value) || opts[0];
  return `<div class="dd${variant ? ' dd-' + variant : ''}" id="${id}" data-value="${esc(cur[0])}"${width ? ` style="--w:${width}"` : ''}>
    <div class="${variant === 'b' ? 'sel-b' : 'select'} dd-btn" tabindex="0" role="combobox" aria-haspopup="listbox" aria-expanded="false"
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

const viewCatalogue = () => {
  document.title = 'Catalogue · Messi por favor';
  const f = readFilters();
  const genres = [...new Set(S.items.flatMap(it => it.genres))].sort((a, b) => a.localeCompare(b, 'fr'));
  const years = [...new Set(S.items.map(it => parseInt(it.year, 10)).filter(Boolean))].sort((a, b) => b - a).map(String);

  view.innerHTML = `<div class="wrap">
    <section class="page-head">
      <h1 class="display page-title">Catalogue</h1>
      ${searchBar(f.q)}
      <div class="filters">
        <div class="field"><span class="label" id="f-type-l">Type</span>
          ${dropdown('f-type', [['', 'Tout'], ...Object.entries(PLURAL)], f.type, { label: 'f-type-l' })}</div>
        <div class="field"><span class="label" id="f-genre-l">Genres</span>
          ${dropdown('f-genre', [['', 'Tous'], ...genres.map(g => [g, g])], f.genre, { label: 'f-genre-l' })}</div>
        <div class="field"><span class="label" id="f-from-l">Sortie : de</span>
          ${dropdown('f-from', [['', 'Début'], ...years.slice().reverse().map(y => [y, y])], f.from, { label: 'f-from-l' })}</div>
        <div class="field"><span class="label" id="f-to-l">Sortie : à</span>
          ${dropdown('f-to', [['', 'Fin'], ...years.map(y => [y, y])], f.to, { label: 'f-to-l' })}</div>
        <div class="field"><span class="label" id="f-sort-l">Tri</span>
          ${dropdown('f-sort', Object.entries(SORTS), f.sort, { label: 'f-sort-l' })}</div>
        <div class="field"><span class="label" id="f-liste-l">Ma liste</span>
          <button class="toggle" id="f-liste" type="button" aria-labelledby="f-liste-l" aria-pressed="${f.liste}">Seulement<span class="box"></span></button></div>
      </div>
      <div class="results-bar"><span class="label" id="res-count" aria-live="polite"></span>
        <button class="btn-ghost" id="f-reset" type="button">${icon('reset')}Réinitialiser</button></div>
    </section>
    <section class="grid-wrap" id="results"></section>
  </div>`;

  const update = () => {
    $$('.filters .dd').forEach(dd => $('.dd-btn', dd).classList.toggle('dim', !dd.dataset.value && dd.id !== 'f-sort'));
    // Nombre de titres derrière chaque choix, compte tenu des autres filtres
    [['f-type', 'type'], ['f-genre', 'genre']].forEach(([id, key]) => $$(`#${id}-list [role=option]`).forEach(li => {
      $('small', li).textContent = filterItems({ ...f, [key]: li.dataset.v }).length;
    }));
    const list = filterItems(f);
    $('#res-count').innerHTML = `<b>${list.length}</b> résultat${list.length > 1 ? 's' : ''}`;
    $('#results').innerHTML = list.length
      ? `<div class="grid">${list.map(card).join('')}</div>`
      : `<p class="empty">${f.liste && !S.myList.length ? 'Ta liste est vide. Ajoute des titres avec « + Ma liste » sur leur fiche.' : 'Rien ne correspond.'}</p>`;
    writeFilters(f);
  };
  const keys = { 'f-type': 'type', 'f-genre': 'genre', 'f-from': 'from', 'f-to': 'to', 'f-sort': 'sort' };
  initDropdowns($('.filters'), (id, v) => { f[keys[id]] = v; update(); });
  $('#f-liste').addEventListener('click', (e) => { f.liste = !f.liste; e.currentTarget.setAttribute('aria-pressed', f.liste); update(); });
  $('#f-reset').addEventListener('click', () => go('/catalogue', { replace: true }));
  bindSearch((q) => { f.q = q; update(); });
  update();
};

// ─── COLLECTIONS ──────────────────────────────────────────────────────────────
// Liens « Réalisé par » : chaque nom renvoie à une recherche dans le catalogue
const directorLinks = (names) => names.split(/\s*,\s*/).filter(Boolean)
  .map(n => `<a href="/catalogue?q=${encodeURIComponent(n)}" data-link><b>${esc(n)}</b></a>`).join(', ');

const colCard = (c) => `<a class="col-card" href="/collection/${esc(c.id)}" data-link>
    <div class="col-art">
      ${placeholder()}${imgTag(c.backdrop)}
      <span class="tag">Collection · ${c.films.length} films</span>
      <div class="col-strip" aria-hidden="true">${c.films.slice(0, 6).map(f => `<span class="col-mini">${imgTag(f.poster)}</span>`).join('')}</div>
    </div>
    <div class="card-meta"><span class="card-title">${esc(c.title)}</span>${c.years ? `<span class="card-year">${esc(c.years)}</span>` : ''}</div>
    ${c.director ? `<p class="card-genres">${esc(c.director)}</p>` : ''}
  </a>`;

const viewCollections = () => {
  document.title = 'Collections · Messi por favor';
  const n = S.collections.length;
  view.innerHTML = `<div class="wrap">
    <section class="page-head">
      <h1 class="display page-title long">Collections</h1>
      <div class="results-bar col-count"><span class="label"><b>${n}</b> collection${n > 1 ? 's' : ''}</span></div>
    </section>
    <section class="grid-wrap">${n
      ? `<div class="col-grid">${S.collections.map(colCard).join('')}</div>`
      : `<p class="empty">Aucune collection pour l'instant.</p>`}</section>
  </div>`;
};

const viewCollection = (id) => {
  const c = S.collections.find(x => x.id === id);
  if (!c) {
    view.innerHTML = `<div class="wrap"><p class="empty">Cette collection n'existe plus. <a class="link-u" href="/collections" data-link>Toutes les collections →</a></p></div>`;
    return;
  }
  document.title = c.title + ' · Messi por favor';
  // Le film à lancer : le premier pas encore terminé, dans l'ordre de la collection
  const nextIdx = Math.max(0, c.films.findIndex(f => progressPct(f.id) < 90));
  const next = c.films[nextIdx], started = progressPct(next.id) > 0;
  const chips = [
    `<span class="chip">${c.films.length} films</span>`,
    c.years ? `<span class="chip">${esc(c.years)}</span>` : '',
    c.minutes ? `<span class="chip">${esc(fmtDuration(c.minutes))} au total</span>` : '',
  ].join('');

  view.innerHTML = `<section class="hero">
      ${c.backdrop ? `<div class="hero-bg" style="background-image:url(&quot;${esc(c.backdrop.replace(/"/g, '%22'))}&quot;)"></div>` : ''}
      <div class="wrap hero-in">
        <nav class="crumbs label" aria-label="Fil d'Ariane">
          <a href="/collections" data-link>/Collections</a><span aria-hidden="true">/</span><span class="here">${esc(slug(c.title))}</span>
        </nav>
        <div class="hero-grid solo">
          <h1 class="display">${esc(c.title)}</h1>
          <div class="chips">${chips}</div>
          ${c.director ? `<p class="by label">Réalisé par ${directorLinks(c.director)}</p>` : ''}
          ${c.description ? `<p class="synopsis">${esc(c.description)}</p>` : ''}
          <div class="actions">
            <button class="btn-red" id="play-btn">${icon('play')}${started ? 'Reprendre' : 'Lecture'}</button>
          </div>
          <p class="label resume-note">Film ${nextIdx + 1} sur ${c.films.length} · ${esc(next.title)}</p>
        </div>
      </div>
    </section>
    <div class="wrap fiche-body">${row('Les films', c.films, null)}</div>`;
  $('#play-btn').addEventListener('click', () => openPlayer(next, null));
  clampSynopsis();
};

// ─── FICHE FILM / SÉRIE ───────────────────────────────────────────────────────
const viewTitle = (kind, id) => {
  const it = S.byKey.get(kind + ':' + id);
  if (!it) {
    view.innerHTML = `<div class="wrap"><p class="empty">Ce titre n'est plus au catalogue. <a class="link-u" href="/catalogue" data-link>Retour au catalogue →</a></p></div>`;
    return;
  }
  document.title = it.title + ' · Messi por favor';
  const eps = kind === 'serie' ? episodesOf(it.id) : [];
  const bg = it.backdrop || it.poster;

  // Bouton principal : reprendre là où on s'est arrêté, sinon commencer
  let playLabel = 'Lecture', resumeNote = '';
  if (kind === 'film') {
    const p = S.progress[it.id];
    if (p && p.ts > 20) { playLabel = 'Reprendre'; resumeNote = `Arrêté à ${fmtTime(p.ts)} sur ${fmtTime(p.duration)}`; }
  } else {
    const cur = currentEpisode(it.id) || eps[0];
    if (cur) {
      playLabel = (S.progress[cur.id] ? 'Reprendre ' : 'Lecture ') + epLabel(cur, it);
      if (S.progress[cur.id]) resumeNote = `${cur.title || 'Épisode ' + cur.episode} · arrêté à ${fmtTime(S.progress[cur.id].ts)}`;
    }
  }

  const chips = [
    it.rating ? `<span class="chip">${icon('star')}${it.rating.toFixed(1)}/10</span>` : '',
    it.year ? `<span class="chip">${esc(it.year)}</span>` : '',
    kind === 'film' && it.duration ? `<span class="chip">${esc(fmtDuration(it.duration))}</span>` : '',
    kind === 'serie' ? `<span class="chip">${it.epCount} épisode${it.epCount > 1 ? 's' : ''}</span>` : '',
    ...it.genres.map(g => `<span class="chip">${esc(g)}</span>`),
  ].join('');

  const inCols = kind === 'film' ? S.collections.filter(c => c.films.includes(it)) : [];

  // Dans le même genre, sinon du même type
  const more = S.items
    .filter(o => o.key !== it.key && (it.genres.length ? o.genres.some(g => it.genres.includes(g)) : o.type === it.type))
    .sort((a, b) => b.addedAt - a.addedAt).slice(0, 6);

  view.innerHTML = `<section class="hero">
      ${bg ? `<div class="hero-bg" style="background-image:url(&quot;${esc(bg.replace(/"/g, '%22'))}&quot;)"></div>` : ''}
      <div class="wrap hero-in">
        <nav class="crumbs label" aria-label="Fil d'Ariane">
          <a href="/catalogue?type=${it.type}" data-link>/${esc(PLURAL[it.type])}</a><span aria-hidden="true">/</span><span class="here">${esc(slug(it.title))}</span>
        </nav>
        <div class="hero-grid">
          <div class="hero-poster">${posterHtml(it.poster)}</div>
          <h1 class="display">${esc(it.title)}</h1>
          ${chips ? `<div class="chips">${chips}</div>` : ''}
          ${it.director ? `<p class="by label">Réalisé par <a href="/catalogue?q=${encodeURIComponent(it.director)}" data-link><b>${esc(it.director)}</b></a></p>` : ''}
          ${inCols.length ? `<p class="by label">Collection · ${inCols.map(c => `<a href="/collection/${esc(c.id)}" data-link><b>${esc(c.title)}</b></a>`).join(', ')}</p>` : ''}
          ${it.cast.length ? `<p class="by label">Avec ·${it.cast.map(n => `<a href="/catalogue?q=${encodeURIComponent(n)}" data-link><b>${esc(n)}</b></a>`).join(', ')}</p>` : ''}
          ${it.description ? `<p class="synopsis">${esc(it.description)}</p>` : ''}
          <div class="actions">
            <button class="btn-red" id="play-btn">${icon('play')}${esc(playLabel)}</button>
            <button class="btn-line${inMyList(it) ? ' on' : ''}" id="list-btn" aria-pressed="${inMyList(it)}">${inMyList(it) ? '✓ Dans ma liste' : '+ Ma liste'}</button>
          </div>
          ${resumeNote ? `<p class="label resume-note">${esc(resumeNote)}</p>` : ''}
        </div>
      </div>
    </section>
    <div class="wrap fiche-body">
      ${kind === 'serie' ? `<div id="episodes-zone"></div>` : ''}
      <div class="more">${row(it.genres.length ? 'Dans le même genre' : 'À voir aussi', more, null)}</div>
    </div>`;

  // Le bouton reste là même sans vidéo : il prévient simplement qu'elle arrive
  $('#play-btn').addEventListener('click', () => {
    if (kind === 'film') return openPlayer(it, null);
    if (!eps.length) return toast('Les épisodes ne sont pas encore disponibles');
    openPlayer(it, currentEpisode(it.id) || eps[0]);
  });
  $('#list-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget, on = !inMyList(it);
    btn.disabled = true;
    const r = await api('/api/mylist', { kind: it.kind, id: it.id, on });
    btn.disabled = false;
    if (r.error) return toast(r.error);
    S.myList = r.myList;
    btn.classList.toggle('on', on); btn.setAttribute('aria-pressed', on);
    btn.textContent = on ? '✓ Dans ma liste' : '+ Ma liste';
    toast(on ? 'Ajouté à ta liste' : 'Retiré de ta liste');
  });
  clampSynopsis();
  if (kind === 'serie') renderEpisodes(it, eps);
};

const renderEpisodes = (it, eps) => {
  const zone = $('#episodes-zone');
  if (!eps.length) { zone.innerHTML = `<p class="empty">Aucun épisode pour le moment.</p>`; return; }
  const seasons = it.noSeason ? [null] : [...new Set(eps.map(e => e.season || 1))];
  const cur = currentEpisode(it.id);
  let season = it.noSeason ? null : (cur ? cur.season || 1 : seasons[0]);

  const draw = () => {
    const list = season === null ? eps : eps.filter(e => (e.season || 1) === season);
    zone.innerHTML = `
      <div class="tabs" role="tablist" aria-label="Saisons">
        ${seasons.map(s => `<button role="tab" data-season="${s ?? ''}" aria-selected="${s === season}">${s === null ? 'Épisodes' : 'Saison ' + s}</button>`).join('')}
      </div>
      <div class="episodes" role="tabpanel">
        ${list.map(e => {
          const pct = progressPct(e.id);
          const thumb = imgUrl(e.thumb) || it.backdrop;
          return `<button class="ep" data-ep="${esc(e.id)}">
            <div class="ep-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" onerror="this.remove()">` : placeholder()}
              <div class="ep-play"><span>${icon('play')}</span></div>
              ${pct ? `<div class="prog"><i style="width:${pct}%"></i></div>` : ''}</div>
            <div>
              <p class="ep-num">${epLabel(e, it)}</p>
              <p class="ep-title">${esc(e.title || 'Épisode ' + e.episode)}</p>
              ${e.description ? `<p class="ep-desc">${esc(e.description)}</p>` : ''}
            </div>
            <span class="ep-dur">${esc(fmtDuration(e.duration))}</span>
          </button>`;
        }).join('')}
      </div>`;
    $$('[data-season]', zone).forEach(b => b.addEventListener('click', () => { season = b.dataset.season ? +b.dataset.season : null; draw(); }));
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

// ─── MENU TÉLÉPHONE ───────────────────────────────────────────────────────────
const closeMenus = () => { $('#mobile-nav').hidden = true; $('#menu-btn').setAttribute('aria-expanded', 'false'); };
$('#menu-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const nav = $('#mobile-nav'), open = nav.hidden;
  nav.hidden = !open; $('#menu-btn').setAttribute('aria-expanded', open);
});
document.addEventListener('click', (e) => { if (!e.target.closest('#mobile-nav')) closeMenus(); });

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

// Quitter : le site s'arrête tout de suite (sinon, 1 min 30 après la fermeture de la page)
const showClosed = () => {
  quitting = true;
  events?.close();
  if (!player.hidden) closePlayer();
  closeModal();
  document.title = 'Fermé · Messi por favor';
  $('#offline').hidden = true;
  document.body.classList.add('closed');
  view.innerHTML = `<div class="wrap closed-screen">
    <h1 class="display">Messi por favor est fermé<span class="dot">.</span></h1>
    <p>Tu peux fermer cet onglet et éjecter le disque.</p>
    <p class="label">Pour revenir : double-clique sur « ▶ Messi por favor », tout en haut du disque.</p>
  </div>`;
};
$('#quit-btn').addEventListener('click', async () => {
  if (!await confirmBox('Quitter', 'Le site va s\'arrêter. Ta progression est enregistrée sur le disque, tu pourras ensuite l\'éjecter.', 'Quitter')) return;
  if (!player.hidden) saveProgress();
  quitting = true;
  await api('/api/quit', {});
  showClosed();
});

// ─── RECHERCHE RAPIDE (⌘K) ────────────────────────────────────────────────────
const openPalette = () => {
  const pages = [['Accueil', '/'], ['Catalogue', '/catalogue'], ['Collections', '/collections'], ['Ma liste', '/catalogue?liste=1']];
  const m = modal('', `<div class="palette-in">${icon('search')}
      <label class="sr-only" for="pal-in">Rechercher</label>
      <input id="pal-in" placeholder="Rechercher un film, une série, une page…" autocomplete="off" spellcheck="false">
      <button class="modal-close" data-close aria-label="Fermer">${icon('x')}</button></div>
    <div class="palette-list" id="pal-list"></div>`, { cls: 'palette' });
  m.querySelector('.modal-body').style.padding = '0';
  const input = $('#pal-in', m), listEl = $('#pal-list', m);
  let entries = [], sel = 0;

  const draw = () => {
    const k = norm(input.value);
    const titles = k ? S.items.filter(it => norm(it.title + ' ' + it.director).includes(k)).slice(0, 8) : [];
    const cols = k ? S.collections.filter(c => norm(c.title).includes(k)).slice(0, 3) : [];
    const pg = pages.filter(([l]) => !k || norm(l).includes(k));
    entries = [
      ...titles.map(it => ({ href: `/${it.kind}/${it.id}`, label: it.title, small: [TYPES[it.type], it.year].filter(Boolean).join(' · ') })),
      ...cols.map(c => ({ href: `/collection/${c.id}`, label: c.title, small: `Collection · ${c.films.length} films` })),
      ...pg.map(([l, h]) => ({ href: h, label: l, small: h })),
    ];
    sel = Math.max(0, Math.min(sel, entries.length - 1));
    let html = '', i = 0;
    if (titles.length) html += `<p class="label">Titres</p>` + titles.map(() => item(i++)).join('');
    if (cols.length) html += `<p class="label">Collections</p>` + cols.map(() => item(i++)).join('');
    if (pg.length) html += `<p class="label">Naviguer</p>` + pg.map(() => item(i++)).join('');
    if (!entries.length) html = `<p class="label">Aucun résultat sur ce disque</p>`;
    listEl.innerHTML = html;
  };
  const item = (i) => `<button class="palette-item${i === sel ? ' sel' : ''}" data-i="${i}"><span>${esc(entries[i].label)}</span><small>${esc(entries[i].small)}</small></button>`;
  const pick = (i) => {
    const en = entries[i]; if (!en) return;
    closeModal();
    go(en.href);
  };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', (e) => {
    if (!entries.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % entries.length; draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + entries.length) % entries.length; draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(sel); }
  });
  listEl.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) pick(+b.dataset.i); });
  draw();
  input.focus();
};
$('#palette-btn').addEventListener('click', openPalette);

document.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (!$('#player').hidden || quitting) return;
    if ($('[data-bg]')) closeModal(); else openPalette();
    return;
  }
  if (e.key === 'Escape') {
    const bg = $('[data-bg]');
    if (bg) { if (bg.dataset.closable === 'true') closeModal(); return; }
    if (!$('#player').hidden) { if (!closePanel()) history.back(); return; }
    closeMenus();
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
