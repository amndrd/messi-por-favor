/* ══════════════════════════════════════════════════════════════════════════
   WATCHIT — interface (version disque dur)
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
    logo: imgUrl(o.logo), logoTone: o.logoTone || '',
    addedAt: o.addedAt || 0, videoRef: o.videoRef || '', noSeason: !!o.noSeason,
    equipe: o.equipe && Array.isArray(o.equipe.real) ? o.equipe : null,
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
  // Réalisateurs et acteurs (outils/personnes.js) : chacun avec ses titres sur le disque
  const P = d.people || {};
  S.people = new Map();
  const person = (id) => {
    if (!S.people.has(id) && P[id]) S.people.set(id, { id, ...P[id], real: [], avec: [] });
    return S.people.get(id);
  };
  for (const it of items) {
    if (!it.equipe) continue;
    for (const id of it.equipe.real) person(id)?.real.push(it);
    for (const [id, role] of it.equipe.avec || []) person(id)?.avec.push([it, role]);
    const names = (it.equipe.avec || []).map(([id]) => P[id]?.nom).filter(Boolean);
    if (names.length) it.cast = names;           // la recherche trouve aussi les acteurs
  }
  for (const p of S.people.values()) p.titles = [...new Set([...p.real, ...p.avec.map(x => x[0])])].sort((a, b) => (yearOf(a) || 9999) - (yearOf(b) || 9999));
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
      dirIds: [...new Set(films.flatMap(f => f.equipe ? f.equipe.real : []))].filter(id => S.people.has(id)),
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
const imgTag = (src, full) => src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ok')" onerror="${full && full !== src ? `this.onerror=null;this.src='${esc(full)}'` : 'this.remove()'}">` : '';
// la petite version d'une image du disque (outils/images.js), pour les cartes : bien plus légère à charger et à afficher
const thumbUrl = (u) => u && u.startsWith('/images/') && !u.startsWith('/images/min/') ? '/images/min/' + u.slice(8) : u;
const thumbTag = (src) => imgTag(thumbUrl(src), src);
const posterHtml = (src) => placeholder() + thumbTag(src);
const bgUrl = (src) => `url(&quot;${esc(String(src).replace(/"/g, '%22'))}&quot;)`;
const logoMark = () => $('.header .logo-mark')?.outerHTML || '';

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

// Méta-données d'un titre : la note en jaune, puis année, durée…, puis les genres
const metaHtml = (rating, parts, tags = []) =>
  (rating ? `<span class="rate">${icon('star')}${fmtRating(rating)}</span>` : '') +
  parts.filter(Boolean).map(p => `<span>${esc(p)}</span>`).join('<span class="sep" aria-hidden="true"></span>') +
  tags.map(g => `<span class="tag">${esc(g)}</span>`).join('');

// Taille du grand titre selon sa longueur
const titleSize = (t) => t.length > 26 ? ' xl' : t.length > 15 ? ' l' : '';
// Le grand titre : le logo du film s'il existe (images/…-logo), sinon le titre écrit
// La teinte du logo est mesurée à l'affichage : un logo blanc passe en noir en thème clair, un logo noir passe en blanc en sombre
window.mpfTone = (img) => {
  try {
    const w = 48, h = Math.max(1, Math.round(w * img.naturalHeight / img.naturalWidth)), c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data; let s = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 100) { s += .2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2]; n++; }
    if (n) img.dataset.tone = s / n > 170 ? 'light' : s / n < 70 ? 'dark' : 'mid';
  } catch (e) { /* teinte inconnue : le logo reste tel quel */ }
};
const titleHtml = (cls, title, logo, tone) => logo
  ? `<h1 class="${cls} has-logo"><img class="title-logo" src="${esc(logo)}" alt="${esc(title)}" decoding="async" onload="mpfTone(this)"></h1>`
  : `<h1 class="${cls}${titleSize(title)}">${esc(title)}</h1>`;

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
// Affiche : badge (série, anime…), progression.
// Souris arrêtée dessus : l'aperçu s'ouvre (voir APERÇU AU SURVOL).
const card = (it, { num } = {}) => {
  const pct = itemProgress(it);
  const badge = num ? `<span class="num">${num}</span>` : it.type !== 'film' ? `<span class="badge">${TYPES[it.type]}</span>` : '';
  return `<a class="cp" href="/${it.kind}/${esc(it.id)}" data-link data-key="${esc(it.key)}">
    <span class="im">${posterHtml(it.poster)}${badge}
      ${pct ? `<span class="prog"><i style="width:${pct}%"></i></span>` : ''}
    </span>
    <b>${esc(it.title)}</b>
    <small>${esc(it.year)}${it.rating ? `<span class="r">${icon('star')}${fmtRating(it.rating)}</span>` : ''}</small>
  </a>`;
};

// Paysage : reprendre là où on s'est arrêté (un clic sur l'image relance la vidéo)
const resumeCard = ({ it, ep, p }) => {
  const img = (ep && imgUrl(ep.thumb)) || it.backdrop || it.poster;
  const pct = p.duration ? Math.min(100, p.ts / p.duration * 100) : 0;
  const sub = ep ? `${epLabel(ep, it)}${ep.title ? ', ' + ep.title : ''}` : [it.year, fmtShort(it.duration)].filter(Boolean).join(', ');
  return `<div class="cl">
    <button class="im" type="button" data-resume="${esc(it.key)}" aria-label="Reprendre ${esc(it.title)}">${placeholder()}${thumbTag(img)}
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

// Collection en tranches (page Collections) : une scène par film, dans l'ordre de la
// collection ; au survol, la tranche s'élargit et donne le titre du film.
// Le film à lancer : le premier pas encore terminé.
const colNext = (c) => {
  const i = Math.max(0, c.films.findIndex(f => progressPct(f.id) < 90));
  return { i, film: c.films[i], started: progressPct(c.films[i].id) > 0, done: c.films.every(f => progressPct(f.id) >= 90) };
};
// « Star Wars: Episode IV - A New Hope » → « Episode IV - A New Hope » quand tous les films partagent le début
const sliceTitle = (f, c) => {
  const pre = f.title.split(': ')[0];
  return f.title.includes(': ') && c.films.every(x => x.title.startsWith(pre + ': ')) ? f.title.slice(pre.length + 2) : f.title;
};
const colSlices = (c, w) => {
  const n = c.films.length, nx = colNext(c);
  const label = nx.done ? 'Revoir' : nx.started ? 'Reprendre' : nx.i ? `Film ${nx.i + 1}` : 'Commencer';
  return `<div class="cs w${w}">
    <a class="cs-in" href="/collection/${esc(c.id)}" data-link aria-label="${esc(c.title)}, ${n} films">
      ${c.films.map((f, k) => {
        const p = progressPct(f.id);
        return `<span class="sl">${imgTag(f.backdrop || f.poster)}<span class="no" aria-hidden="true">${k + 1}</span>
          ${p >= 90 ? `<span class="vu" title="Déjà vu">${icon('check')}</span>` : ''}
          <span class="ft"><b>${esc(sliceTitle(f, c))}</b><small>${[f.year, fmtShort(f.duration)].filter(Boolean).map(esc).join(' · ')}</small></span>
          ${p > 0 && p < 90 ? `<span class="pr"><i style="width:${p}%"></i></span>` : ''}</span>`;
      }).join('')}
      <span class="t"><small>${[`${n} film${n > 1 ? 's' : ''}`, c.years, c.minutes ? fmtShort(c.minutes) : ''].filter(Boolean).map(esc).join(' · ')}</small><h3>${esc(c.title)}</h3></span>
    </a>
    <button class="cs-go" type="button" data-col="${esc(c.id)}" aria-label="${label} : ${esc(nx.film.title)}">${icon('play')}${label}</button>
  </div>`;
};
// Largeur des cartes sur 12 colonnes : 5 films et plus en pleine largeur, 3–4 films par deux,
// 1–2 films par trois ; une carte qui resterait seule au bout de sa ligne s'élargit.
const colLayout = (cols) => {
  const span = (c) => c.films.length >= 5 ? 12 : c.films.length >= 3 ? 6 : 4;
  const list = [...cols].sort((a, b) => b.films.length - a.films.length || a.title.localeCompare(b.title, 'fr')).map(c => ({ c, w: span(c) }));
  const six = list.filter(x => x.w === 6), four = list.filter(x => x.w === 4);
  if (six.length % 2) six[six.length - 1].w = 12;
  if (four.length % 3 === 1) four[four.length - 1].w = 12;
  if (four.length % 3 === 2) four.slice(-2).forEach(x => { x.w = 6; });
  return list;
};

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
  // genres du catalogue : une page entière de vignettes ; ailleurs, presque un écran
  const step = () => {
    if (!r.classList.contains('cat-grail')) return Math.max(200, r.clientWidth - 160);
    const cs = getComputedStyle(r);
    return r.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + parseFloat(cs.columnGap);
  };
  const by = (dir) => r.scrollBy({ left: dir * step(), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  prev.addEventListener('click', () => by(-1));
  next.addEventListener('click', () => by(1));
  // la rangée défile : l'affiche bouge, l'aperçu s'efface simplement
  r.addEventListener('scroll', () => { paint(); hidePreview(false, true); lightOff(true); }, { passive: true });
  new ResizeObserver(paint).observe(r);
});

// ─── ACTIONS COMMUNES ─────────────────────────────────────────────────────────
// Lecture : le film, ou l'épisode en cours de la série (sinon le premier)
const playItem = (it) => {
  if (it.kind === 'film') return openPlayer(it, null);
  const eps = episodesOf(it.id);
  if (!eps.length) return toast('Les épisodes ne sont pas encore disponibles');
  openPlayer(it, currentEpisode(it.id) || eps[0]);
};
// ─── LUMIÈRE AU SURVOL ────────────────────────────────────────────────────────
// Sur un fond presque noir, une ombre ne se voit pas : la profondeur vient de la lumière.
// Deux rendus, au choix dans les Réglages (gardé dans le navigateur) :
//   « film »       les couleurs de l'affiche (puis de la scène, autour de l'aperçu)
//                  débordent autour d'elle, floutées, comme un écran qui éclaire la pièce ;
//   « projecteur » une lumière douce et neutre tombe derrière la carte, et dedans une vraie
//                  ombre en plusieurs couches devient visible.
// Une seule lumière par affiche (.cp-light) : quand l'aperçu s'ouvre, elle s'étire avec la
// carte, au même rythme, et passe des couleurs de l'affiche à celles de la scène ; quand il
// se referme, elle se resserre sur l'affiche. Elle est rangée juste après la carte mais
// placée par rapport au cadre de la rangée (la rangée, qui défile, ne la coupe pas), entre
// les autres affiches (qu'elle éclaire) et l'affiche survolée. Elle se mélange « en écran »
// (elle éclaire sans jamais assombrir) et son flou reste dans sa boîte (marge LIGHT_PAD) :
// Safari coupe ce qui dépasse d'un calque animé.
const LIGHTS = {
  film: ['Film', 'Les couleurs de l’affiche débordent autour d’elle, floutées, comme un écran qui éclaire la pièce. Autour de l’aperçu, celles de la scène.'],
  projecteur: ['Projecteur', 'Une lumière douce et neutre tombe derrière la carte ; dedans, son ombre se voit, avec un filet de lumière sur le bord du haut.'],
};
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const canHover = matchMedia('(hover: hover) and (pointer: fine)');
let lightMode = 'film';
try { const m = localStorage.getItem('mpf-lumiere'); if (LIGHTS[m]) lightMode = m; } catch (e) { /* stockage indisponible : film */ }
const paintLight = () => {
  document.body.classList.toggle('light-film', lightMode === 'film');
  document.body.classList.toggle('light-spot', lightMode === 'projecteur');
};
paintLight();

// L'apparence : sombre (par défaut) ou claire. Le choix est posé dès le <head> d'index.html (pas d'éclair au chargement).
const THEMES = {
  sombre: ['Sombre', 'Un fond noir, comme une salle de cinéma : les images et les affiches ressortent.'],
  clair: ['Clair', 'Un fond papier, doux et lumineux, pour regarder en plein jour. Le lecteur reste sombre.'],
};
let theme = document.documentElement.dataset.theme === 'light' ? 'clair' : 'sombre';
const setTheme = (k) => {
  if (k === theme || !THEMES[k]) return;
  const apply = () => {
    theme = k;
    if (k === 'clair') document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', k === 'clair' ? '#F4F3EF' : '#060607');
    try { localStorage.setItem('mpf-theme', k); } catch (e) { /* stockage indisponible : le temps de la visite */ }
  };
  // un fondu entre les deux apparences, là où le navigateur sait le faire
  if (document.startViewTransition && !calm.matches) document.startViewTransition(apply); else apply();
};
const setLightMode = (m) => {
  if (!LIGHTS[m]) return;
  lightMode = m;
  try { localStorage.setItem('mpf-lumiere', m); } catch (e) { /* gardé seulement pour cette page */ }
  hidePreview(false, true); lightOff(true); paintLight();
};
// Le cadre d'une affiche au repos (sans l'agrandissement du survol)
const restRect = (c) => {
  const im = $('.im', c), r = c.getBoundingClientRect();
  return { left: r.left + im.offsetLeft, top: r.top + im.offsetTop, width: im.offsetWidth, height: im.offsetHeight };
};
const LIGHT_PAD = 220;          // marge de la boîte de lumière : le flou n'en sort jamais
const LIGHT_EASE = 'cubic-bezier(.2,.8,.2,1)';
let lit = null;                 // l'affiche éclairée : { c, el }
// La boîte de lumière autour d'un cadre (coordonnées de l'écran), dans son bloc conteneur
const lightBox = (el, r) => {
  const op = el.offsetParent;
  let bx = -scrollX, by = -scrollY;
  if (op && op !== document.body && getComputedStyle(op).position !== 'static') {
    const o = op.getBoundingClientRect(); bx = o.left + op.clientLeft - op.scrollLeft; by = o.top + op.clientTop - op.scrollTop;
  }
  return { left: `${r.left - bx - LIGHT_PAD}px`, top: `${r.top - by - LIGHT_PAD}px`, width: `${r.width + LIGHT_PAD * 2}px`, height: `${r.height + LIGHT_PAD * 2}px` };
};
// Étirer la lumière vers un autre cadre, au rythme de la carte
const lightMove = (el, r, duration, easing) => {
  // repartir de là où elle est vraiment, même au milieu d'un mouvement
  const cs = getComputedStyle(el), from = { left: cs.left, top: cs.top, width: cs.width, height: cs.height }, to = lightBox(el, r);
  el.getAnimations().filter(a => !('transitionProperty' in a)).forEach(a => a.cancel());
  Object.assign(el.style, to);
  if (!calm.matches) el.animate([from, to], { duration, easing });
};
const lightOff = (quick) => {
  if (!lit) return;
  const { c, el } = lit; lit = null;
  c.classList.remove('lit');
  // étirée sur un aperçu : elle se resserre sur son affiche en s'éteignant
  if (el.classList.contains('big') && quick !== true && c.isConnected) { el.classList.remove('big'); lightMove(el, restRect(c), PV_CLOSE, 'cubic-bezier(.4,0,.2,1)'); }
  el.classList.remove('on');
  if (quick === true || calm.matches) el.remove(); else setTimeout(() => el.remove(), 700);
};
// Accents colorés (lumière « Film ») : une petite version de l'image qui garde ses couleurs franches, un peu
// ravivées, et remplace ses tons ternes (blancs, beiges, gris) par sa couleur dominante. La lueur prend ainsi de
// vraies couleurs. Une image sans couleur (noir et blanc) reste telle quelle. Réglage : Réglages › Lumière au survol.
const accents = true;   // la lumière « Film » en accents colorés (le réglage Vives / Fidèles a été retiré)
const accentMemo = new Map();
const accentOf = (img) => {
  const key = img.currentSrc || img.src;
  if (accentMemo.has(key)) return accentMemo.get(key);
  let out = null;
  try {
    const w = 24, h = Math.max(8, Math.round(w * img.naturalHeight / img.naturalWidth));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
    const id = g.getImageData(0, 0, w, h), p = id.data, vivid = new Uint8Array(w * h);
    let ar = 0, ag = 0, ab = 0, aw = 0;
    for (let i = 0, j = 0; i < p.length; i += 4, j++) {
      const r = p[i], gg = p[i + 1], b = p[i + 2], mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), ch = (mx - mn) / 255, l = (mx + mn) / 510;
      if (ch > .2 && l > .1 && l < .9) { vivid[j] = 1; const wt = ch * ch; ar += r * wt; ag += gg * wt; ab += b * wt; aw += wt; }
    }
    if (aw > w * h * .004) {   // assez de couleur dans l'image pour s'en servir
      let A = [ar / aw, ag / aw, ab / aw]; const ay = (A[0] + A[1] + A[2]) / 3;
      A = A.map(v => Math.min(255, Math.max(0, ay + (v - ay) * 1.5)));
      for (let i = 0, j = 0; i < p.length; i += 4, j++) {
        if (vivid[j]) { const y = (p[i] + p[i + 1] + p[i + 2]) / 3; for (let k = 0; k < 3; k++) p[i + k] = Math.min(255, Math.max(0, y + (p[i + k] - y) * 1.35)); }
        else for (let k = 0; k < 3; k++) p[i + k] = A[k] * .85 + p[i + k] * .15;
      }
      g.putImageData(id, 0, 0); out = `url("${c.toDataURL()}")`;
    }
  } catch (e) { /* image illisible : elle reste telle quelle */ }
  accentMemo.set(key, out);
  return out;
};
const accentFor = (img) => accents && lightMode === 'film' && img && img.complete && img.naturalWidth ? accentOf(img) : null;

const lightOn = (c) => {
  if (lit?.c === c || !c.isConnected) return;
  lightOff();
  const img = $('.im img', c), el = document.createElement('div');
  el.className = 'cp-light'; el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--lpad', LIGHT_PAD + 'px');
  if (img) el.style.setProperty('--pimg', accentFor(img) || `url("${(img.currentSrc || img.src).replace(/"/g, '%22')}")`);
  el.innerHTML = '<b><i class="lp1"></i><i class="lp2"></i><i class="ls1"></i><i class="ls2"></i></b>';
  c.after(el);
  Object.assign(el.style, lightBox(el, restRect(c)));
  el.getBoundingClientRect(); // part éteinte : la transition l'allume
  el.classList.add('on');
  c.classList.add('lit');
  lit = { c, el };
};
// L'aperçu s'ouvre : la lumière de l'affiche s'étire jusqu'à la carte et prend les couleurs de la scène
const lightGrow = (c, r, src) => {
  if (lit?.c !== c) lightOn(c);
  if (!lit) return;
  const el = lit.el;
  if (src) {
    el.style.setProperty('--simg', `url("${String(src).replace(/"/g, '%22')}")`);
    // la scène aussi, en accents colorés, dès qu'elle est chargée
    if (accents && lightMode === 'film') { const im = new Image(); im.onload = () => { const a = accentOf(im); if (a && el.isConnected) el.style.setProperty('--simg', a); }; im.src = src; }
  }
  el.classList.add('big');
  lightMove(el, r, PV_OPEN, LIGHT_EASE);
};
// L'aperçu se referme : elle se resserre sur l'affiche, et s'éteint si la souris n'y est plus
const lightShrink = (c, r, stay) => {
  if (lit?.c !== c) return;
  if (!stay) { lightOff(); return; }
  const el = lit.el;
  el.classList.remove('big');
  lightMove(el, r, PV_CLOSE, 'cubic-bezier(.4,0,.2,1)');
};
let mouseX = -1, mouseY = -1;
view.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse' || !canHover.matches) return;
  const c = e.target.closest?.('.cp');
  if (c && c !== lit?.c && c !== pv?.card) lightOn(c);
});
view.addEventListener('pointerout', (e) => {
  const c = e.target.closest?.('.cp');
  // la souris passe sur l'aperçu de cette affiche : sa lumière reste (elle s'étire avec lui)
  if (c && c === lit?.c && c !== pv?.card && !c.contains(e.relatedTarget)) lightOff();
});
view.addEventListener('focusin', (e) => { const c = e.target.closest?.('.cp'); if (c && canHover.matches) lightOn(c); });
view.addEventListener('focusout', (e) => { const c = e.target.closest?.('.cp'); if (c && c === lit?.c && c !== pv?.card && !c.contains(e.relatedTarget)) lightOff(); });

// ─── APERÇU AU SURVOL ─────────────────────────────────────────────────────────
// Souris arrêtée sur une affiche : la carte sort de l'affiche et s'agrandit (image du
// film, note, résumé, Lecture, Fiche) ; quand la souris en sort, elle rétrécit et rentre
// dans l'affiche. Entre l'affiche et la scène, une mise au point : l'une passe dans le
// flou pendant que l'autre en sort ; le texte n'arrive qu'une fois l'affiche partie.
// .pv-c est la carte, découpée par un clip-path animé. Son ombre est un élément à part (.pv-sh),
// posé juste dessous : Safari ne redessine pas une ombre calculée sur une forme découpée pendant
// qu'elle s'anime (elle n'apparaissait qu'à la fin). .pv-sh grandit exactement comme la carte
// (même durée, même courbe) : l'ombre est là dès le premier instant, à la taille de l'affiche,
// avant que la lumière ne s'étire. Simple fondu si « réduire les animations ».
let pv = null, pvTimer = null;
const PV_EASE = 'cubic-bezier(.2,.8,.2,1)';
const PV_DELAY = 900; // ms de souris immobile sur une affiche avant l'aperçu
const PV_OPEN = 460, PV_CLOSE = 400;
// Le cadre de l'affiche vu depuis la carte, en clip-path (bords arrondis comme l'affiche)
const pvInset = (l, t, pw, ph, w, h) =>
  `inset(${Math.max(0, t).toFixed(1)}px ${Math.max(0, w - l - pw).toFixed(1)}px ${Math.max(0, h - t - ph).toFixed(1)}px ${Math.max(0, l).toFixed(1)}px round 14px)`;
// L'affiche posée sur la carte, à sa place
const pvPoster = (card, src, l, t, r) => {
  const po = document.createElement('img');
  po.className = 'pv-po'; po.alt = ''; if (src) po.src = src;
  Object.assign(po.style, { left: l + 'px', top: t + 'px', width: r.width + 'px', height: r.height + 'px' });
  card.append(po);
  return po;
};
const pvOpen = (el, sh, { l, t, r, poster }) => {
  const card = $('.pv-c', el), w = card.offsetWidth, h = card.offsetHeight;
  const L = el.offsetLeft, T = el.offsetTop;
  sh.animate([
    { left: `${L + l}px`, top: `${T + t}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '14px' },
    { left: `${L}px`, top: `${T}px`, width: `${w}px`, height: `${h}px`, borderRadius: '18px' },
  ], { duration: PV_OPEN, easing: PV_EASE });
  const sc = $('.pv-im img', card), title = $('.pv-im b', card), bd = $('.pv-bd', card);
  const po = pvPoster(card, poster, l, t, r);
  card.animate([{ clipPath: pvInset(l, t, r.width, r.height, w, h) }, { clipPath: 'inset(0px 0px 0px 0px round 18px)' }], { duration: PV_OPEN, easing: PV_EASE });
  // mise au point : l'affiche passe dans le flou…
  po.animate([{ opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' }, { opacity: 0, filter: 'blur(14px)', transform: 'scale(1.1)' }],
    { duration: 300, delay: 40, easing: 'cubic-bezier(.4,0,1,1)', fill: 'both' }).finished.then(() => po.remove(), () => {});
  // … pendant que la scène en sort
  if (sc) sc.animate([
    { opacity: .4, filter: 'blur(18px)', transform: 'scale(1.18)' }, // ses couleurs floues entourent déjà l'affiche
    { opacity: 1, offset: .45 },
    { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' },
  ], { duration: 500, delay: 40, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'backwards' });
  if (title) title.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 340, delay: 230, easing: PV_EASE, fill: 'backwards' });
  if (bd) bd.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 260, easing: PV_EASE, fill: 'backwards' });
};
const pvClose = (el, sh, c, poster) => {
  const card = $('.pv-c', el), sc = $('.pv-im img', card), title = $('.pv-im b', card), bd = $('.pv-bd', card);
  const shs = getComputedStyle(sh), shNow = { left: shs.left, top: shs.top, width: shs.width, height: shs.height, borderRadius: shs.borderTopLeftRadius };
  // repartir de là où en est l'ouverture si elle n'est pas finie
  const now = (x, ...p) => { if (!x) return null; const s = getComputedStyle(x); return Object.fromEntries(p.map(k => [k, s[k] === 'none' && k !== 'opacity' ? (k === 'filter' ? 'blur(0px)' : 'none') : s[k]])); };
  const clip = getComputedStyle(card).clipPath;
  const scNow = now(sc, 'opacity', 'filter', 'transform'), tNow = now(title, 'opacity'), bNow = now(bd, 'opacity');
  el.getAnimations({ subtree: true }).forEach(a => a.cancel());
  sh.getAnimations().forEach(a => a.cancel());
  $$('.pv-po', card).forEach(x => x.remove());
  // la carte rentre dans l'affiche au repos (celle-ci reprend sa taille pendant ce temps)
  const cr = card.getBoundingClientRect(), r = restRect(c), l = r.left - cr.left, t = r.top - cr.top;
  const po = pvPoster(card, poster, l, t, r);
  const anims = [
    card.animate([{ clipPath: clip && clip !== 'none' ? clip : 'inset(0px 0px 0px 0px round 18px)' }, { clipPath: pvInset(l, t, r.width, r.height, cr.width, cr.height) }],
      { duration: PV_CLOSE, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }),
    po.animate([{ opacity: 0, filter: 'blur(14px)', transform: 'scale(1.1)' }, { opacity: 1, filter: 'blur(0px)', transform: 'scale(1)' }],
      { duration: 300, delay: 90, easing: 'cubic-bezier(0,0,.2,1)', fill: 'both' }),
    // l'ombre suit la carte jusqu'à l'affiche, puis toutes deux s'effacent sur l'affiche, identique
    sh.animate([{ ...shNow, opacity: 1, offset: 0 }, { opacity: 1, offset: (PV_CLOSE - 90) / PV_CLOSE },
      { left: `${r.left + scrollX}px`, top: `${r.top + scrollY}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: '14px', opacity: 0, offset: 1 }],
      { duration: PV_CLOSE, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' }),
    el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 90, delay: PV_CLOSE - 90, fill: 'forwards' }),
  ];
  if (sc) anims.push(sc.animate([scNow, { opacity: 1, filter: 'blur(14px)', transform: 'scale(1.08)' }], { duration: 300, easing: 'ease-in', fill: 'forwards' }));
  [[title, tNow], [bd, bNow]].forEach(([x, s]) => { if (x) anims.push(x.animate([s, { opacity: 0, transform: 'translateY(6px)' }], { duration: 150, easing: 'ease-out', fill: 'forwards' })); });
  const done = () => { el.remove(); sh.remove(); };
  Promise.all(anims.map(a => a.finished)).then(done, done);
  return r;
};
// keep === true : on ferme sans annuler l'aperçu de l'affiche où arrive la souris ;
// quick : simple fondu (on change de page, on lance la vidéo, la rangée défile)
const hidePreview = (keep, quick) => {
  if (keep !== true) clearTimeout(pvTimer);
  if (!pv) return;
  const { el, sh, card, poster } = pv; pv = null;
  el.classList.add('closing');
  if (quick === true || calm.matches || !card.isConnected) {
    el.classList.add('out'); sh.classList.add('out');
    setTimeout(() => { el.remove(); sh.remove(); }, 170);
    if (lit?.c === card) { if (quick === true) lightOff(true); else lightShrink(card, restRect(card), false); }
    return;
  }
  const r = pvClose(el, sh, card, poster);
  // la souris est-elle revenue sur l'affiche ? (l'aperçu qui se ferme ne capte plus la souris)
  const under = mouseX >= 0 && document.elementFromPoint(mouseX, mouseY);
  lightShrink(card, r, !!under && card.contains(under));
};
const showPreview = (c) => {
  const it = S.byKey.get(c.dataset.key);
  if (!it || !c.isConnected || wall) return;
  hidePreview();
  const r = $('.im', c).getBoundingClientRect(), X = r.left + scrollX, Y = r.top + scrollY;
  const href = `/${it.kind}/${esc(it.id)}`;
  const meta = [it.year, it.kind === 'film' ? fmtShort(it.duration) : seriesLine(it), it.director].filter(Boolean);
  const star = it.rating ? `<span class="star">${icon('star')}${fmtRating(it.rating)}</span>` : '';
  const W = Math.round(Math.max(400, Math.min(460, r.width * 2.4)));
  const el = document.createElement('div');
  el.className = 'pv';
  el.innerHTML = `<div class="pv-c"><a class="pv-im" href="${href}" data-link tabindex="-1">${it.backdrop || it.poster ? `<img src="${esc(it.backdrop || it.poster)}" alt="">` : ''}
      <b${it.title.length > 24 ? ' class="l"' : ''}>${esc(it.title)}</b></a>
    <div class="pv-bd"><p class="pv-m">${star}${meta.map(esc).join('<i></i>')}</p>
      ${it.genres.length ? `<p class="pv-g">${esc(it.genres.slice(0, 3).join(', '))}</p>` : ''}
      ${it.description ? `<p class="pv-s">${esc(it.description)}</p>` : ''}
      <div class="pv-a"><button class="pv-play" type="button" data-pv="play">${icon('play')}${itemProgress(it) ? 'Reprendre' : 'Lecture'}</button>
        <a class="pv-rd" href="${href}" data-link aria-label="Fiche" title="Fiche">${icon('info')}</a>
        <span class="pv-ty">${esc(TYPES[it.type] || '')}</span></div></div></div>`;
  el.style.width = W + 'px';
  const img = $('img', c), t = c.style.getPropertyValue('--ct') || (img && img.complete && img.naturalWidth && tintOf(img));
  if (t) el.style.setProperty('--ct', t);
  document.body.append(el);
  // centrée sur l'affiche, dans l'écran et sous la barre du haut
  const vw = document.documentElement.clientWidth;
  const L = Math.max(scrollX + 12, Math.min(scrollX + vw - W - 12, X + r.width / 2 - W / 2));
  const minTop = scrollY + parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav')) + 6;
  const T = Math.max(minTop, Math.min(scrollY + innerHeight - el.offsetHeight - 12, Y - 24));
  el.style.left = L + 'px'; el.style.top = T + 'px';
  // l'ombre de la carte, juste dessous
  const sh = document.createElement('div');
  sh.className = 'pv-sh'; sh.setAttribute('aria-hidden', 'true');
  Object.assign(sh.style, { left: L + 'px', top: T + 'px', width: el.offsetWidth + 'px', height: el.offsetHeight + 'px' });
  el.before(sh);
  pv = { el, sh, card: c, poster: it.poster };
  // la lumière de l'affiche s'étire avec la carte, au même rythme
  lightGrow(c, { left: L - scrollX, top: T - scrollY, width: el.offsetWidth, height: el.offsetHeight }, it.backdrop || it.poster);
  if (!calm.matches) pvOpen(el, sh, { l: X - L, t: Y - T, r, poster: it.poster });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-pv="play"]')) { hidePreview(false, true); playItem(it); }
    else if (e.target.closest('a[data-link]')) hidePreview(false, true);
  });
};
view.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse' || !canHover.matches) return;
  const c = e.target.closest('.cp[data-key]');
  if (!c || pv?.card === c) return;
  clearTimeout(pvTimer);
  pvTimer = setTimeout(() => showPreview(c), PV_DELAY);
});
view.addEventListener('pointerout', (e) => {
  const c = e.target.closest('.cp[data-key]');
  if (c && !c.contains(e.relatedTarget)) clearTimeout(pvTimer);
});
// la souris sort de l'aperçu (ou n'y est jamais entrée) : il se ferme, sans annuler
// celui de l'affiche où elle vient d'arriver
document.addEventListener('pointermove', (e) => {
  mouseX = e.clientX; mouseY = e.clientY;
  if (pv && !pv.el.contains(e.target) && e.target !== pv.card && !pv.card.contains(e.target)) hidePreview(true);
}, { passive: true });
addEventListener('scroll', hidePreview, { passive: true });

// ─── NAVIGATION ───────────────────────────────────────────────────────────────
const routes = [
  [/^\/$/,                 () => viewHome()],
  [/^\/catalogue\/?$/,     () => viewCatalogue()],
  [/^\/catalogue\/personnes\/?$/, () => viewPeople()],
  [/^\/personne\/(\d+)$/,  (id) => viewPerson(id)],
  [/^\/collections\/?$/,   () => viewCollections()],
  [/^\/reglages\/?$/,      () => viewSettings()],
  [/^\/collection\/([\w-]+)$/, (id) => viewCollection(id)],
  [/^\/(film|serie)\/([\w-]+)$/, (kind, id) => viewTitle(kind, id)],
];

// Onglet allumé dans le menu
const setTab = () => {
  const path = location.pathname;
  // « Catalogue » regroupe films et séries ; « Collections » a son propre onglet
  const tab = path === '/' ? 'accueil'
    : path.startsWith('/collection') ? 'collections'
    : /^\/(catalogue|film\/|serie\/|personne\/)/.test(path) ? 'catalogue' : '';
  $$('[data-tab]').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === tab);
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const sb = $('#settings-btn');
  if (sb) { if (path.startsWith('/reglages')) sb.setAttribute('aria-current', 'page'); else sb.removeAttribute('aria-current'); }
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
const paintHeader = () => {
  header.classList.toggle('solid', scrollY > 40);
  // barre de filtres du catalogue collée en haut : elle prend un fond
  const w = $('#cat-wrap');
  if (w) w.classList.toggle('stuck', w.getBoundingClientRect().top <= parseFloat(getComputedStyle(w).top) + 1);
};
// L'onglet ouvert prend la couleur du film affiché (null : pilule de verre neutre)
const setNavTint = (t) => { header.classList.toggle('tinted', !!t); if (t) header.style.setProperty('--nt', t); };
addEventListener('scroll', paintHeader, { passive: true });

const render = () => {
  if (!$('#player').hidden) closePlayer();
  closeWall();
  hidePreview(false, true);
  lightOff(true);
  stopHero();
  setNavTint(null);
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

// comme le générique d'un film : « Un film de… », le titre (ou son logo), une ligne d'infos en petites capitales
const heroCopy = ({ it }) => {
  const by = it.director ? `${it.kind === 'serie' ? 'Une série de' : 'Un film de'} ${it.director}` : '';
  const bits = [it.year, it.kind === 'film' ? fmtShort(it.duration) : seriesLine(it), it.genres.slice(0, 2).join(' · ')].filter(Boolean);
  return `${by ? `<p class="hero-kick">${esc(by)}</p>` : ''}
    ${titleHtml('hero-title', it.title, it.logo, it.logoTone)}
    <div class="hero-line">${bits.map(b => `<span>${esc(b)}</span>`).join('<i aria-hidden="true"></i>')}${it.rating ? `<i aria-hidden="true"></i><span class="r">★ ${fmtRating(it.rating)}</span>` : ''}</div>
    ${it.description ? `<p class="syn">${esc(it.description)}</p>` : ''}
    <div class="cta">
      <button class="btn play" type="button" data-hero="play">${icon('play')}${itemProgress(it) ? 'Reprendre' : 'Lecture'}</button>
      <a class="hero-more" href="/${it.kind}/${esc(it.id)}" data-link>Plus d'infos <span aria-hidden="true">→</span></a>
    </div>`;
};

// Le halo autour de l'écran : l'image du film réduite à quelques pixels (avec une large marge vide), adoucie,
// un peu plus saturée, puis agrandie par la page. Équivaut à un flou de ~90 px, sans filtre CSS.
const HALO_M = 260;   // la marge (en px de page) autour de l'image, que le halo remplit en s'estompant
const paintHalo = (cv, img, hero) => {
  const w = hero.clientWidth * .88, h = Math.max(100, hero.clientHeight - 200), W2 = w + 2 * HALO_M, H2 = h + 2 * HALO_M;
  const tw = 64, th = Math.max(12, Math.round(tw * H2 / W2)); cv.width = tw; cv.height = th;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const sc = Math.max(w / img.naturalWidth, h / img.naturalHeight), iw = img.naturalWidth * sc, ih = img.naturalHeight * sc;
  g.save(); g.scale(tw / W2, th / H2); g.translate(HALO_M, HALO_M); g.beginPath(); g.rect(0, 0, w, h); g.clip();
  g.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih); g.restore();
  const id = g.getImageData(0, 0, tw, th), px = id.data;
  for (let i = 0; i < px.length; i += 4) { const a = px[i + 3] / 255; px[i] *= a; px[i + 1] *= a; px[i + 2] *= a; }   // prémultiplié : pas de liseré sombre
  const pass = (dx, dy) => {
    const src = Float32Array.from(px), R = 3;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
      for (let k = -R; k <= R; k++) { const xx = x + k * dx, yy = y + k * dy; if (xx < 0 || yy < 0 || xx >= tw || yy >= th) continue;
        const q = (yy * tw + xx) * 4; s0 += src[q]; s1 += src[q + 1]; s2 += src[q + 2]; s3 += src[q + 3]; }
      const o = (y * tw + x) * 4, n = 2 * R + 1; px[o] = s0 / n; px[o + 1] = s1 / n; px[o + 2] = s2 / n; px[o + 3] = s3 / n;
    }
  };
  pass(1, 0); pass(0, 1); pass(1, 0); pass(0, 1);
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3] / 255 || 1, r = px[i] / a, gg = px[i + 1] / a, b = px[i + 2] / a, y = .2126 * r + .7152 * gg + .0722 * b;
    px[i] = Math.min(255, Math.max(0, y + (r - y) * 1.5)); px[i + 1] = Math.min(255, Math.max(0, y + (gg - y) * 1.5)); px[i + 2] = Math.min(255, Math.max(0, y + (b - y) * 1.5));
  }
  g.putImageData(id, 0, 0);
};

const initHero = (picks) => {
  const hero = $('#hero');
  if (!hero) return;
  const slides = $$('.slide', hero), copy = $('#hero-copy'), thumbs = $$('.th', hero);
  $$('.hero-amb canvas', hero).forEach((c, j) => { const im = slides[j] && $('img', slides[j]); if (im) whenLoaded(im, () => { try { paintHalo(c, im, hero); } catch (e) { /* pas de halo */ } }); });
  let cur = -1, hold = false, startedAt = 0, left = HERO_MS;
  const show = (k) => {
    cur = k;
    slides.forEach((s, j) => s.classList.toggle('on', j === k));
    $$('.hero-amb canvas', hero).forEach((c, j) => c.classList.toggle('on', j === k));   // le halo prend les couleurs du film
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
  document.title = 'WATCHIT';
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
      <div class="hero-amb" aria-hidden="true">${picks.map((p, k) => `<canvas class="${k ? '' : 'on'}"></canvas>`).join('')}</div>
      <div class="hero-sh" aria-hidden="true"></div>
      ${picks.map((p, k) => `<div class="slide${k ? '' : ' on'}"><img src="${esc(p.it.backdrop)}" alt=""${k ? '' : ' fetchpriority="high"'}></div>`).join('')}
      <div class="glow" aria-hidden="true"></div>
      <div class="hero-copy" id="hero-copy"></div>
      ${picks.length > 1 ? `<div class="hero-next" role="group" aria-label="À l'affiche">${picks.map((p, k) =>
        `<button class="th" type="button" aria-pressed="false" aria-label="${esc(p.it.title)}" title="${esc(p.it.title)}"><span class="im"><img src="${esc(p.it.backdrop)}" alt=""><i class="bar"></i></span><span class="nm">${esc(p.it.title)}</span></button>`).join('')}</div>` : ''}
    </section>` : '<div class="hero-spacer"></div>'}
    <div class="rows">
      ${row('Reprendre', [], null, { html: resume.slice(0, 12).map(resumeCard).join('') })}
      ${row('Nouveautés', byRecent.slice(0, 18), '/catalogue')}
      ${row('Les mieux notés', [], '/catalogue?tri=rating', { html: byRating.slice(0, 10).map(rankCard).join('') })}
      ${row('Collections', [], '/collections', { html: S.collections.map(colCard).join('') })}
      ${row('Séries', series.slice(0, 18), '/catalogue?type=serie')}
      ${row('Par genre', [], null, { html: genreTiles() })}
      ${row('Les classiques', classics, '/catalogue?a=1979&tri=rating')}
      ${row('Animation', anim, null)}
    </div>`;

  initHero(picks);
  view.querySelector('.rows').addEventListener('click', (e) => {
    const b = e.target.closest('[data-resume]');
    if (b) playItem(S.byKey.get(b.dataset.resume));
  });
};

// ─── CATALOGUE ────────────────────────────────────────────────────────────────
// En haut : la frise des années (on tire les poignées, on glisse pour tracer une période,
// un clic choisit une décennie) et les genres en couleur. Dessous : une barre qui résume
// les filtres actifs et reste en haut quand on descend. « Par année » range par décennie.
const SORTS = { recent: 'Récents', rating: 'Mieux notés', year: 'Par année', title: 'A – Z' };
const OLD_SORTS = { newest: 'year', oldest: 'year' }; // anciens liens
const TYPE_TITLES = { film: 'Films', serie: 'Séries', anime: 'Animes', animation: 'Animation' };
const yearOf = (it) => parseInt(it.year, 10) || null;
const decadeLabel = (d) => 'les années ' + (d < 2000 ? String(d).slice(2) : d);

const readFilters = () => {
  const q = new URLSearchParams(location.search), tri = OLD_SORTS[q.get('tri')] || q.get('tri');
  return { q: q.get('q') || '', type: TYPES[q.get('type')] ? q.get('type') : '', genre: q.get('genre') || '',
    from: q.get('de') || '', to: q.get('a') || '', sort: SORTS[tri] ? tri : 'recent' };
};
// Barre du catalogue : une seule pastille blanche par groupe (type, tri, affichage), qui glisse
// et s'élargit jusqu'au bouton choisi, comme celle du menu du haut
const moveSegs = () => $$('.cat-seg', view).forEach(seg => {
  let ind = $('.seg-ind', seg);
  if (!ind) { ind = document.createElement('i'); ind.className = 'seg-ind'; ind.setAttribute('aria-hidden', 'true'); seg.prepend(ind); }
  const on = $('button[aria-pressed="true"]', seg);
  if (!on) { ind.style.opacity = 0; return; }
  Object.assign(ind.style, { width: on.offsetWidth + 'px', height: on.offsetHeight + 'px', transform: `translate(${on.offsetLeft}px, ${on.offsetTop}px)`, opacity: 1 });
  // la première fois elle se pose sans glisser
  if (!seg.classList.contains('ready')) requestAnimationFrame(() => requestAnimationFrame(() => seg.classList.add('ready')));
});
addEventListener('resize', () => { if ($('.cat-seg', view)) moveSegs(); });
document.fonts?.ready.then(() => { if ($('.cat-seg', view)) moveSegs(); });

const writeFilters = (f) => {
  const q = new URLSearchParams();
  if (f.q) q.set('q', f.q); if (f.type) q.set('type', f.type); if (f.genre) q.set('genre', f.genre);
  if (f.from) q.set('de', f.from); if (f.to) q.set('a', f.to); if (f.sort !== 'recent') q.set('tri', f.sort);
  history.replaceState(history.state, '', '/catalogue' + (q.toString() ? '?' + q : ''));
};

const filterItems = (f) => {
  const words = norm(f.q) ? f.q.split(/\s+/).map(norm).filter(Boolean) : [];
  const list = S.items.filter(it => {
    if (f.type && it.type !== f.type) return false;
    if (f.genre && !it.genres.includes(f.genre)) return false;
    if (f.from && !(yearOf(it) >= +f.from)) return false;
    if (f.to && !(yearOf(it) <= +f.to)) return false;
    if (words.length) {
      const hay = norm([it.title, it.director, it.year, ...it.genres, ...it.cast, TYPES[it.type]].join(' '));
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });
  const by = {
    recent: (a, b) => b.addedAt - a.addedAt,
    title:  (a, b) => a.title.localeCompare(b.title, 'fr', { sensitivity: 'base' }),
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    year:   (a, b) => (yearOf(a) || 9999) - (yearOf(b) || 9999) || (b.rating || 0) - (a.rating || 0),
  }[f.sort];
  return list.sort(by);
};

const viewCatalogue = () => {
  const f = readFilters();
  const years = S.items.map(yearOf).filter(Boolean);
  const Y0 = Math.min(...years), Y1 = Math.max(...years), SPAN = Y1 - Y0 + 1;
  const decades = [];
  for (let d = Math.ceil(Y0 / 10) * 10; d <= Y1; d += 10) decades.push(d);
  const genres = [...new Set(S.items.flatMap(it => it.genres))]
    .map(g => [g, S.items.filter(it => it.genres.includes(g)).length]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
  // Une image par genre : la scène du film le mieux noté du genre (jamais deux fois la même)
  const used = new Set(), pics = new Map();
  const best = (list) => list.filter(it => it.backdrop && !used.has(it)).sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
  genres.forEach(g => {
    const it = best(S.items.filter(x => x.genres[0] === g)) || best(S.items.filter(x => x.genres.includes(g)));
    if (it) { used.add(it); pics.set(g, it.backdrop); }
  });

  view.innerHTML = `<div class="page cat">
    <header class="page-head"><div><h1 class="page-title" id="cat-title">Catalogue</h1>
      <p class="page-sub">${S.items.length} titres, de ${Y0} à ${Y1}</p></div>${catSwitch('titres')}</header>
    <section class="cat-board" aria-label="Filtres">
      <div class="cat-years" id="cat-years"><div class="cat-years-in">
      <div class="cat-fh"><h2>Les années</h2><span class="cat-per" id="cat-per" aria-live="polite"></span>
        <button class="cat-all" id="cat-all" type="button" hidden>Toutes les années</button></div>
      <div class="cat-frise" id="cat-frise" title="Tire les poignées, ou glisse pour choisir une période. Un clic choisit une décennie.">
        <div class="cat-bars">${Array.from({ length: SPAN }, (_, i) => `<i data-y="${Y0 + i}"></i>`).join('')}</div>
        <div class="cat-range" id="cat-range">
          <span class="cat-h" data-h="from" role="slider" tabindex="0" aria-label="Première année" aria-valuemin="${Y0}" aria-valuemax="${Y1}"></span>
          <span class="cat-h" data-h="to" role="slider" tabindex="0" aria-label="Dernière année" aria-valuemin="${Y0}" aria-valuemax="${Y1}"></span>
        </div>
      </div>
      <div class="cat-dec" aria-hidden="true">${decades.map(d => `<span data-d="${d}" style="left:${(d - Y0 + .5) / SPAN * 100}%">${d}</span>`).join('')}</div>
      </div></div>
      <div class="cat-genres" role="group" aria-label="Genres">
        <div class="cat-gh"><h2>Genres</h2><span class="cat-per" id="cat-gsel" aria-live="polite"></span>
          <button class="cat-all" id="cat-gall" type="button" hidden>Tous les genres</button></div>
        <div class="rail-wrap"><button class="rail-btn prev" type="button" aria-label="Genres précédents" tabindex="-1" hidden>${icon('left')}</button>
          <div class="rail cat-grail">${genres.map(g => `<button type="button" class="cat-gt" data-g="${esc(g)}" style="--g:${GENRE_TINT[g] || '80,80,90'}" aria-pressed="false">
            ${pics.get(g) ? `<img src="${esc(pics.get(g))}" alt="" loading="lazy" decoding="async">` : ''}<b>${esc(g)}</b><small></small></button>`).join('')}</div>
          <button class="rail-btn next" type="button" aria-label="Genres suivants" tabindex="-1" hidden>${icon('right')}</button></div>
      </div>
    </section>
    <div class="cat-wrap" id="cat-wrap"><div class="cat-bar">
      <div class="cat-seg" id="cat-types" role="group" aria-label="Type">${[['', 'Tout'], ...Object.entries(PLURAL)].map(([v, l]) =>
        `<button type="button" data-type="${v}">${esc(l)}<small></small></button>`).join('')}</div>
      <span class="cat-sep" aria-hidden="true"></span>
      <div class="cat-act" id="cat-act"></div>
      <span class="cat-n" id="cat-n" aria-live="polite"></span>
      <div class="cat-seg cat-sort" role="group" aria-label="Trier">${Object.entries(SORTS).map(([v, l]) => `<button type="button" data-sort="${v}">${l}</button>`).join('')}</div>
    </div></div>
    <section class="cat-res" id="results"></section>
  </div>`;

  const frise = $('#cat-frise'), bars = $$('.cat-bars i', frise), range = $('#cat-range'), wrap = $('#cat-wrap'), board = $('.cat-board');
  const lo = () => f.from ? Math.max(Y0, +f.from) : Y0, hi = () => f.to ? Math.min(Y1, +f.to) : Y1;

  // La frise : hauteur des barres = titres de l'année (avec les autres filtres), période en blanc
  const paintFrise = (a = lo(), b = hi()) => {
    const base = filterItems({ ...f, from: '', to: '' });
    const cnt = new Map();
    base.forEach(it => { const y = yearOf(it); if (y) cnt.set(y, (cnt.get(y) || 0) + 1); });
    const top = Math.max(1, ...cnt.values());
    bars.forEach(i => {
      const y = +i.dataset.y, c = cnt.get(y) || 0;
      i.style.height = c ? `${8 + c / top * 88}%` : '3px';
      i.classList.toggle('in', c > 0 && y >= a && y <= b);
    });
    range.style.left = `${(a - Y0) / SPAN * 100}%`; range.style.width = `${(b - a + 1) / SPAN * 100}%`;
    const full = a === Y0 && b === Y1;
    range.classList.toggle('full', full);
    $$('.cat-dec span').forEach(s => s.classList.toggle('in', !full && +s.dataset.d >= Math.floor(a / 10) * 10 && +s.dataset.d <= b));
    $$('.cat-h', range).forEach(h => { const v = h.dataset.h === 'from' ? a : b; h.setAttribute('aria-valuenow', v); h.setAttribute('aria-valuetext', String(v)); });
    const n = base.filter(it => { const y = yearOf(it); return full || (y && y >= a && y <= b); }).length;
    $('#cat-per').innerHTML = `<strong>${full ? 'Toutes les années' : `${a} – ${b}`}</strong>, ${n} titre${n > 1 ? 's' : ''}`;
    $('#cat-all').hidden = full;
  };
  const setRange = (a, b) => {
    a = Math.max(Y0, Math.min(a, b)); b = Math.min(Y1, Math.max(a, b));
    f.from = a <= Y0 ? '' : String(a); f.to = b >= Y1 ? '' : String(b);
    update();
  };

  // Dans la barre : ce qui est choisi, en pastilles qu'on retire d'un clic
  const paintBar = (count) => {
    const title = TYPE_TITLES[f.type] || 'Catalogue';
    $('#cat-title').textContent = title;
    document.title = title + ' · WATCHIT';
    $$('#cat-types [data-type]').forEach(b => {
      b.setAttribute('aria-pressed', b.dataset.type === f.type);
      $('small', b).textContent = filterItems({ ...f, type: b.dataset.type }).length;
    });
    // Vignettes de genres : nombre de titres (avec les autres filtres), ✓ sur le genre choisi
    $('.cat-genres').classList.toggle('has', !!f.genre);
    $$('.cat-gt').forEach(b => {
      const on = b.dataset.g === f.genre, n = filterItems({ ...f, genre: b.dataset.g }).length;
      b.setAttribute('aria-pressed', on); b.disabled = !on && !n;
      $('small', b).innerHTML = on ? icon('check') : n;
      b.setAttribute('aria-label', `${b.dataset.g}, ${n} titre${n > 1 ? 's' : ''}`);
    });
    const gn = f.genre ? filterItems(f).length : 0;
    $('#cat-gsel').innerHTML = f.genre ? `<strong>${esc(f.genre)}</strong>, ${gn} titre${gn > 1 ? 's' : ''}` : `${$$('.cat-gt').length} genres`;
    $('#cat-gall').hidden = !f.genre;
    $$('[data-sort]', wrap).forEach(b => b.setAttribute('aria-pressed', b.dataset.sort === f.sort));
    moveSegs();
    const pills = [
      (f.from || f.to) && `<button type="button" class="cat-pill" data-clear="years">${lo()} – ${hi()}${icon('x')}</button>`,
      f.genre && `<button type="button" class="cat-pill g" data-clear="genre" style="--g:${GENRE_TINT[f.genre] || '90,90,100'}">${esc(f.genre)}${icon('x')}</button>`,
      f.q && `<button type="button" class="cat-pill q" data-clear="q">« ${esc(f.q)} »${icon('x')}</button>`,
    ].filter(Boolean);
    $('#cat-act').innerHTML = pills.join('') + (pills.length > 1 ? '<button type="button" class="cat-clear" data-clear="all">Tout effacer</button>' : '');
    $('#cat-n').textContent = `${count} titre${count > 1 ? 's' : ''}`;
  };

  const paintResults = (list) => {
    const block = (arr) => `<div class="grid">${arr.map(it => card(it)).join('')}</div>`;
    if (!list.length) {
      $('#results').innerHTML = `<div class="empty"><b>Rien ne correspond</b>Élargis la période ou enlève un filtre.<br>
        <button class="btn glass" type="button" data-clear="all">${icon('reset')}Tout effacer</button></div>`;
      return;
    }
    if (f.sort !== 'year') { $('#results').innerHTML = block(list); return; }
    const groups = new Map();
    list.forEach(it => { const y = yearOf(it), d = y ? Math.floor(y / 10) * 10 : 0; if (!groups.has(d)) groups.set(d, []); groups.get(d).push(it); });
    $('#results').innerHTML = [...groups].map(([d, arr]) => `<section class="cat-sec">
        <div class="cat-dh"><b>${d || '?'}</b><span>${arr.length} titre${arr.length > 1 ? 's' : ''}${d ? ', ' + decadeLabel(d) : ', sans date'}</span></div>${block(arr)}</section>`).join('');
  };

  // La frise ne s'ouvre qu'avec le tri « Par année »
  const yearsBox = $('#cat-years');
  const paintYears = () => { const on = f.sort === 'year'; yearsBox.classList.toggle('open', on); yearsBox.inert = !on; };
  let reveal = false;
  const update = () => {
    const list = filterItems(f);
    paintYears(); paintFrise(); paintBar(list.length); paintResults(list);
    writeFilters(f); setTab();
    if (reveal) {
      // on vient de choisir « Par année » : on remonte pour voir la frise s'ouvrir
      reveal = false;
      if (board.getBoundingClientRect().top < 0) scrollTo({ top: board.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav')) - 16, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    } else if (wrap.classList.contains('stuck')) {
      // barre collée en haut : on remonte au début des résultats
      scrollTo(0, board.getBoundingClientRect().bottom + scrollY - parseFloat(getComputedStyle(wrap).top));
    }
    paintHeader();
  };

  // ── Glisser sur la frise ──
  const yearAt = (x) => { const r = frise.getBoundingClientRect(); return Y0 + Math.max(0, Math.min(SPAN - 1, Math.floor((x - r.left) / r.width * SPAN))); };
  frise.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const r = frise.getBoundingClientRect(), xOf = (y) => r.left + (y - Y0) / SPAN * r.width;
    let a = lo(), b = hi(), moved = false;
    const start = yearAt(e.clientX), sx = e.clientX;
    const grab = e.target.closest('.cat-h')?.dataset.h
      || (Math.abs(e.clientX - xOf(a)) < 14 ? 'from' : Math.abs(e.clientX - xOf(b + 1)) < 14 ? 'to' : 'brush');
    frise.setPointerCapture(e.pointerId);
    frise.classList.add('drag');
    const move = (ev) => {
      if (Math.abs(ev.clientX - sx) > 4) moved = true;
      const y = yearAt(ev.clientX);
      if (grab === 'from') a = Math.min(y, b);
      else if (grab === 'to') b = Math.max(y, a);
      else if (moved) { a = Math.min(start, y); b = Math.max(start, y); }
      paintFrise(a, b);
    };
    const up = () => {
      frise.removeEventListener('pointermove', move); frise.removeEventListener('pointerup', up); frise.removeEventListener('pointercancel', up);
      frise.classList.remove('drag');
      if (grab === 'brush' && !moved) { a = Math.floor(start / 10) * 10; b = a + 9; } // un clic : la décennie
      if (grab !== 'brush' && !moved) return paintFrise();
      setRange(a, b);
    };
    frise.addEventListener('pointermove', move); frise.addEventListener('pointerup', up); frise.addEventListener('pointercancel', up);
  });
  // Au clavier : flèches (± 1 an), Maj + flèches (± 10 ans), Début / Fin
  $$('.cat-h', range).forEach(h => h.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key] * (e.shiftKey ? 10 : 1);
    const isFrom = h.dataset.h === 'from';
    let a = lo(), b = hi();
    if (step) { if (isFrom) a += step; else b += step; }
    else if (e.key === 'Home') { if (isFrom) a = Y0; else b = a; }
    else if (e.key === 'End') { if (isFrom) a = b; else b = Y1; }
    else return;
    e.preventDefault();
    setRange(Math.min(a, b), Math.max(a, b));
    $(`.cat-h[data-h="${h.dataset.h}"]`).focus();
  }));
  $('#cat-all').addEventListener('click', () => setRange(Y0, Y1));

  // ── Genres, type, tri, affichage, pastilles ──
  $('.cat-genres').addEventListener('click', (e) => {
    const b = e.target.closest('[data-g]');
    if (b) { f.genre = f.genre === b.dataset.g ? '' : b.dataset.g; update(); $(`.cat-gt[data-g="${CSS.escape(b.dataset.g)}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' }); }
  });
  $('#cat-gall').addEventListener('click', () => { f.genre = ''; update(); });
  // le genre choisi en arrivant (lien depuis l'accueil) est ramené dans la ligne
  if (f.genre) requestAnimationFrame(() => { const t = $('.cat-gt[aria-pressed="true"]'); if (t) t.parentElement.scrollLeft = t.offsetLeft - 40; });
  wrap.addEventListener('click', (e) => {
    const t = e.target.closest('[data-type], [data-sort], [data-clear]');
    if (!t) return;
    if (t.dataset.type !== undefined) f.type = t.dataset.type;
    else if (t.dataset.sort) { reveal = t.dataset.sort === 'year' && f.sort !== 'year'; f.sort = t.dataset.sort; }
    else clearFilter(t.dataset.clear);
    update();
  });
  const clearFilter = (k) => {
    if (k === 'years' || k === 'all') { f.from = ''; f.to = ''; }
    if (k === 'genre' || k === 'all') f.genre = '';
    if (k === 'q' || k === 'all') f.q = '';
  };
  $('#results').addEventListener('click', (e) => {
    const c = e.target.closest('[data-clear]');
    if (c) { clearFilter(c.dataset.clear); update(); }
  });
  update();
};

// ─── COLLECTIONS ──────────────────────────────────────────────────────────────
// Liens « Réalisé par » : chaque nom renvoie à une recherche dans le catalogue
const directorLinks = (names) => names.split(/\s*,\s*/).filter(Boolean)
  .map(n => `<a href="/catalogue?q=${encodeURIComponent(n)}" data-link><b>${esc(n)}</b></a>`).join(', ');

// ─── RÉALISATEURS ET ACTEURS ──────────────────────────────────────────────────
// Données : outils/personnes.js (TMDB). S.people : id → { nom, g, ne, mort, photo, real, avec, titles }
const personUrl = (p) => `/personne/${p.id}`;
const initials = (n) => String(n).split(/\s+/).map(w => w[0] || '').slice(0, 2).join('');
// le visage : les initiales dessous, la photo par-dessus quand elle arrive
const personFace = (p, mini) => `<span class="pp-ini" aria-hidden="true">${esc(initials(p.nom))}</span>` +
  (p.photo ? `<img src="/images/${mini ? 'min/' : ''}${esc(p.photo)}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ok')" onerror="this.remove()">` : '');
const personJob = (p) => {
  const f = p.g === 1;
  const real = !p.real.length ? '' : p.real.every(it => it.kind === 'serie') ? (f ? 'Créatrice' : 'Créateur') : (f ? 'Réalisatrice' : 'Réalisateur');
  const act = p.avec.length ? (f ? 'Actrice' : 'Acteur') : '';
  return real && act ? `${real} et ${act.toLowerCase()}` : real || act;
};
const titlesCount = (list) => {
  const n = list.length, w = list.every(it => it.kind === 'film') ? 'film' : list.every(it => it.kind === 'serie') ? 'série' : 'titre';
  return `${n} ${w}${n > 1 ? 's' : ''}`;
};
const lifeYears = (p) => p.ne ? p.ne.slice(0, 4) + (p.mort ? ' – ' + p.mort.slice(0, 4) : '') : '';
const personLinks = (ids) => ids.map(id => S.people.get(id)).filter(Boolean)
  .map(p => `<a href="${personUrl(p)}" data-link><b>${esc(p.nom)}</b></a>`).join(', ');

// Catalogue : titres ou réalisateurs et acteurs
const catSwitch = (on) => `<nav class="cat-switch" aria-label="Catalogue">
    <a href="/catalogue" data-link${on === 'titres' ? ' aria-current="page"' : ''}>Films et séries</a>
    <a href="/catalogue/personnes" data-link${on === 'personnes' ? ' aria-current="page"' : ''}>Réalisateurs et acteurs</a></nav>`;

// Fiche d'un titre : la rangée « Distribution » (réalisation d'abord, puis les rôles)
const castRow = (it) => {
  if (!it.equipe) return '';
  const seen = new Set(), ppl = [];
  for (const id of it.equipe.real) if (S.people.has(id) && !seen.has(id)) { seen.add(id); ppl.push([S.people.get(id), it.kind === 'serie' ? 'Création' : 'Réalisation', true]); }
  for (const [id, role] of it.equipe.avec || []) if (S.people.has(id) && !seen.has(id)) { seen.add(id); ppl.push([S.people.get(id), role, false]); }
  if (!ppl.length) return '';
  return `<section class="row cast">${rowHead('Distribution', `${ppl.length} personnes`)}${rail(ppl.map(([p, role, dir]) =>
    `<a class="pp${dir ? ' dir' : ''}" href="${personUrl(p)}" data-link>
      <span class="pp-ph">${personFace(p)}${p.titles.length > 1 ? `<span class="pp-n" title="${titlesCount(p.titles)} sur le disque">${p.titles.length}</span>` : ''}</span>
      <b>${esc(p.nom)}</b><small>${esc(role)}</small></a>`).join(''))}</section>`;
};

// Page d'une personne : ses titres sur une frise, du plus ancien au plus récent
const viewPerson = (id) => {
  const p = S.people.get(+id);
  if (!p) {
    view.innerHTML = `<div class="page"><div class="empty"><b>Personne introuvable</b>Elle n'apparaît dans aucun titre du disque.<br>
      <a class="btn glass" href="/catalogue/personnes" data-link>${icon('left')}Réalisateurs et acteurs</a></div></div>`;
    return;
  }
  document.title = p.nom + ' · WATCHIT';
  const roles = new Map(p.avec.map(([it, r]) => [it, r]));
  const bgs = p.titles.filter(it => it.backdrop).sort((a, b) => (b.rating || 0) - (a.rating || 0)).slice(0, 4);
  let prev = null;
  const frise = p.titles.map(it => {
    const y = yearOf(it), gap = prev && y && y - prev >= 8 ? `<span class="pz-gap">${y - prev} ans plus tard</span>` : '';
    if (y) prev = y;
    const role = p.real.includes(it) ? (it.kind === 'serie' ? 'Création' : 'Réalisation') : roles.get(it) || '';
    return gap + `<a class="pz-f" href="/${it.kind}/${esc(it.id)}" data-link title="${esc(it.title)}${role ? ' — ' + esc(role) : ''}">
      <span class="pz-po">${posterHtml(it.poster)}</span><b>${esc(it.year || '?')}</b></a>`;
  }).join('');
  const kicker = [personJob(p), lifeYears(p), titlesCount(p.titles) + ' sur le disque'].filter(Boolean).join(' · ');
  const size = p.nom.length > 22 ? ' xl' : p.nom.length > 15 ? ' l' : '';
  view.innerHTML = `<div class="page pz">
    <div class="pz-bg" aria-hidden="true">${bgs.map(it => `<span>${thumbTag(it.backdrop)}</span>`).join('')}</div>
    <header class="pz-h"><span class="pz-av">${personFace(p)}</span>
      <div><p class="pz-k">${esc(kicker)}</p><h1 class="pz-n${size}">${esc(p.nom)}</h1></div></header>
    <div class="pz-bio" id="pz-bio" data-id="${p.id}"></div>
    <div class="pz-tl" role="list" aria-label="Titres sur le disque">${frise}</div>
  </div>`;
  // la biographie arrive à part ; à défaut, le lieu et la date de naissance
  fetch('/api/personne/' + p.id).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(d => {
    const box = $('#pz-bio');
    if (!box || box.dataset.id !== String(p.id)) return;
    const born = p.ne ? new Date(p.ne + 'T12:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const text = d.bio || (d.lieu || born ? `${p.g === 1 ? 'Née' : 'Né'}${d.lieu ? ' à ' + d.lieu : ''}${born ? ' le ' + born : ''}.` : '');
    if (!text) return box.remove();
    box.innerHTML = `<div class="pz-bt">${text.split(/\n+/).filter(Boolean).map(t => `<p>${esc(t)}</p>`).join('')}</div>
      <button class="pz-more" type="button" hidden>Lire la suite</button>`;
    const bt = $('.pz-bt', box), more = $('.pz-more', box);
    more.hidden = bt.scrollWidth <= bt.clientWidth + 2 && bt.scrollHeight <= bt.clientHeight + 2;
    more.addEventListener('click', () => { const open = box.classList.toggle('open'); more.textContent = open ? 'Réduire' : 'Lire la suite'; });
  });
};

// Catalogue des réalisateurs et acteurs
const viewPeople = () => {
  document.title = 'Réalisateurs et acteurs · WATCHIT';
  const qs = new URLSearchParams(location.search);
  const st = { who: ['real', 'act'].includes(qs.get('qui')) ? qs.get('qui') : '', q: qs.get('q') || '', sort: qs.get('tri') === 'az' ? 'az' : 'n' };
  const all = [...S.people.values()].filter(p => p.titles.length);
  const isReal = (p) => p.real.length > 0, isAct = (p) => p.avec.length > 0;
  const WHO = [['', 'Tous', all.length], ['real', 'Réalisateurs', all.filter(isReal).length], ['act', 'Acteurs', all.filter(isAct).length]];
  view.innerHTML = `<div class="page pk">
    <header class="page-head"><div><h1 class="page-title">Catalogue</h1>
      <p class="page-sub">${all.length.toLocaleString('fr-FR')} personnes au générique</p></div>${catSwitch('personnes')}</header>
    <div class="cat-wrap"><div class="cat-bar">
      <div class="cat-seg" id="pk-who" role="group" aria-label="Qui">${WHO.map(([v, l, n]) => `<button type="button" data-who="${v}">${l}<small>${n.toLocaleString('fr-FR')}</small></button>`).join('')}</div>
      <label class="pk-q">${icon('search')}<input id="pk-q" type="search" placeholder="Chercher un nom" autocomplete="off" spellcheck="false" value="${esc(st.q)}"></label>
      <span class="cat-n" id="pk-n" aria-live="polite"></span>
      <div class="cat-seg cat-sort" id="pk-sort" role="group" aria-label="Trier"><button type="button" data-sort="n">Les plus présents</button><button type="button" data-sort="az">A – Z</button></div>
    </div></div>
    <section class="pk-res" id="pk-res"></section></div>`;

  const dirCard = (p) => {
    const bg = p.real.find(it => it.backdrop) || p.titles.find(it => it.backdrop);
    return `<a class="pk-d" href="${personUrl(p)}" data-link>${bg ? `<span class="pk-bg">${thumbTag(bg.backdrop)}</span>` : ''}
      <span class="pk-av">${personFace(p, true)}</span>
      <span class="pk-t"><b>${esc(p.nom)}</b><small>${[titlesCount(p.real), lifeYears(p)].filter(Boolean).join(' · ')}</small></span>
      <span class="pk-ps">${p.real.slice(0, 3).map(it => `<span class="pk-po">${thumbTag(it.poster)}</span>`).join('')}</span></a>`;
  };
  const actCard = (p) => `<a class="pk-a" href="${personUrl(p)}" data-link><span class="pk-ph">${personFace(p)}</span>
      <b>${esc(p.nom)}</b><small>${titlesCount(p.titles)}</small></a>`;
  const PAGE = 96;
  let shown = PAGE;

  const paint = () => {
    const k = norm(st.q);
    const by = st.sort === 'az' ? (a, b) => a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' })
      : (key) => (a, b) => b[key].length - a[key].length || b.titles.length - a.titles.length || a.nom.localeCompare(b.nom, 'fr');
    const sortBy = (key) => st.sort === 'az' ? by : by(key);
    const match = all.filter(p => !k || norm(p.nom).includes(k));
    const dirs = match.filter(isReal).sort(sortBy('real')), acts = match.filter(isAct).sort(sortBy('avec'));
    const head = (t, sub, more) => `<div class="pk-h"><h2>${t}</h2><span>${sub}</span>${more ? `<button type="button" class="pk-all" data-who="${more}">Tout voir</button>` : ''}</div>`;
    let html = '';
    if (!dirs.length && !acts.length) html = `<div class="empty"><b>Personne ne s'appelle ainsi</b>Essaie une autre orthographe.</div>`;
    else if (!st.who) {
      // un aperçu de chaque famille (tout, quand on cherche un nom)
      const d = k ? dirs : dirs.slice(0, 8), a = k ? acts : acts.slice(0, 24);
      if (d.length) html += `<section class="pk-sec">${head('Réalisateurs', `${dirs.length} personne${dirs.length > 1 ? 's' : ''}`, !k && dirs.length > d.length && 'real')}<div class="pk-dirs">${d.map(dirCard).join('')}</div></section>`;
      if (a.length) html += `<section class="pk-sec">${head('Acteurs', `${acts.length.toLocaleString('fr-FR')} personne${acts.length > 1 ? 's' : ''}`, !k && acts.length > a.length && 'act')}<div class="pk-acts">${a.map(actCard).join('')}</div></section>`;
    } else {
      const list = st.who === 'real' ? dirs : acts;
      html = `<section class="pk-sec">${st.who === 'real' ? `<div class="pk-dirs">${list.slice(0, shown).map(dirCard).join('')}</div>` : `<div class="pk-acts">${list.slice(0, shown).map(actCard).join('')}</div>`}
        ${list.length > shown ? `<button type="button" class="btn glass pk-plus" id="pk-plus">Afficher plus (${(list.length - shown).toLocaleString('fr-FR')})</button>` : ''}</section>`;
    }
    $('#pk-res').innerHTML = html;
    const n = st.who === 'real' ? dirs.length : st.who === 'act' ? acts.length : match.length;
    $('#pk-n').textContent = `${n.toLocaleString('fr-FR')} personne${n > 1 ? 's' : ''}`;
    $$('#pk-who [data-who]').forEach(b => b.setAttribute('aria-pressed', b.dataset.who === st.who));
    $$('#pk-sort [data-sort]').forEach(b => b.setAttribute('aria-pressed', b.dataset.sort === st.sort));
    moveSegs();
    const q = new URLSearchParams();
    if (st.who) q.set('qui', st.who); if (st.q) q.set('q', st.q); if (st.sort === 'az') q.set('tri', 'az');
    history.replaceState(history.state, '', '/catalogue/personnes' + (q.toString() ? '?' + q : ''));
  };
  view.addEventListener('click', function pick(e) {
    if (!$('#pk-res')) return view.removeEventListener('click', pick);
    const t = e.target.closest('[data-who], [data-sort], #pk-plus');
    if (!t) return;
    if (t.id === 'pk-plus') { shown += PAGE * 2; return paint(); }
    if (t.dataset.who !== undefined) { st.who = t.dataset.who; shown = PAGE; if (t.classList.contains('pk-all')) scrollTo(0, 0); }
    else st.sort = t.dataset.sort;
    paint();
  });
  let timer;
  $('#pk-q').addEventListener('input', (e) => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value.trim(); shown = PAGE; paint(); }, 120); });
  paint();
};

// ─── RÉGLAGES ─────────────────────────────────────────────────────────────────
// Gardés dans le navigateur (localStorage). Pour l'instant : la lumière au survol.
const viewSettings = () => {
  document.title = 'Réglages · WATCHIT';
  const withPoster = S.items.filter(it => it.poster);
  // une affiche colorée pour montrer chaque lumière
  const best = [...withPoster].sort((a, b) => (b.rating || 0) - (a.rating || 0));
  const sample = ['Animation', 'Fantastique', 'Aventure', 'Comédie', 'Romance'].map(g => best.find(it => it.genres.includes(g))).find(Boolean) || best[0];
  const demo = (k) => sample ? `<span class="set-demo set-demo-${k}" aria-hidden="true" style="--pimg:${bgUrl(sample.poster)}"><i></i><img src="${esc(sample.poster)}" alt=""></span>` : '';
  // une miniature de chaque écran de veille
  const vxSample = withPoster.filter(it => it.backdrop && it.logo).slice(0, 1)[0] || sample;
  const vxDemo = (k) => k === 'plein'
    ? `<span class="set-demo set-vx set-vx-plein" aria-hidden="true" style="--pimg:${vxSample && vxSample.backdrop ? bgUrl(vxSample.backdrop) : 'none'}"><i></i><span class="set-vx-clk">21:04</span>${vxSample && vxSample.logo ? `<img src="${esc(vxSample.logo)}" alt="">` : ''}</span>`
    : `<span class="set-demo set-vx set-vx-mur" aria-hidden="true"><span class="set-vx-wall">${withPoster.slice(0, 40).map(it => `<img src="${esc(thumbUrl(it.poster))}" alt="">`).join('')}</span><span class="set-vx-clk">21:04</span></span>`;
  // une miniature du site dans chaque apparence
  const themeDemo = (k) => `<span class="set-demo set-theme set-theme-${k}" aria-hidden="true">
      <span class="st-nav"><span></span><span></span><span></span></span>
      <span class="st-scr"${sample && sample.backdrop ? ` style="--pimg:${bgUrl(sample.backdrop)}"` : ''}></span>
      <span class="st-row"><span></span><span></span><span></span><span></span></span></span>`;
  view.innerHTML = `<div class="page set">
    <header class="page-head"><div><h1 class="page-title">Réglages</h1>
      <p class="page-sub">Gardés dans ce navigateur, sur cet ordinateur.</p></div></header>
    <section class="set-sec" aria-labelledby="set-theme">
      <div class="set-h"><h2 id="set-theme">Apparence</h2>
        <p>Le site en sombre ou en clair.</p></div>
      <div class="set-opts" role="radiogroup" aria-labelledby="set-theme">
        ${Object.entries(THEMES).map(([k, [label, text]]) => `<button class="set-opt" type="button" role="radio" aria-checked="${k === theme}" tabindex="${k === theme ? 0 : -1}" data-theme-k="${k}">
          ${themeDemo(k)}<span class="set-tx"><b>${esc(label)}</b><small>${esc(text)}</small></span><span class="set-ck" aria-hidden="true">${icon('check')}</span></button>`).join('')}
      </div>
    </section>
    <section class="set-sec${veille.on ? '' : ' off'}" id="set-vx" aria-labelledby="set-veille">
      <div class="set-h"><h2 id="set-veille">Écran de veille</h2>
        <p>Quand le site reste ouvert sans un geste, des films défilent en grand. La souris ou une touche, et tout revient.</p></div>
      <div class="set-row"><span class="set-lb" id="set-vx-on">Activé</span>
        <div class="set-pills" role="radiogroup" aria-labelledby="set-vx-on">
          ${[[1, 'Oui'], [0, 'Non']].map(([v, l]) => `<button type="button" role="radio" aria-checked="${!!v === veille.on}" tabindex="${!!v === veille.on ? 0 : -1}" data-vx-on="${v}">${l}</button>`).join('')}</div></div>
      <div class="set-row"><span class="set-lb" id="set-vx-min">Après</span>
        <div class="set-pills" role="radiogroup" aria-labelledby="set-vx-min">
          ${VEILLE_MIN.map(m => `<button type="button" role="radio" aria-checked="${m === veille.min}" tabindex="${m === veille.min ? 0 : -1}" data-vx-min="${m}">${m} min</button>`).join('')}</div></div>
      <div class="set-opts" role="radiogroup" aria-label="Style de l’écran de veille">
        ${Object.entries(VEILLE_STYLES).map(([k, [label, text]]) => `<button class="set-opt" type="button" role="radio" aria-checked="${k === veille.style}" tabindex="${k === veille.style ? 0 : -1}" data-vx-style="${k}">
          ${vxDemo(k)}<span class="set-tx"><b>${esc(label)}</b><small>${esc(text)}</small></span><span class="set-ck" aria-hidden="true">${icon('check')}</span></button>`).join('')}
      </div>
      <button class="btn glass set-try" type="button" data-vx-try>Voir l’écran de veille</button>
    </section>
    <section class="set-sec" aria-labelledby="set-light">
      <div class="set-h"><h2 id="set-light">Lumière au survol</h2>
        <p>Ce qui éclaire une affiche quand la souris passe dessus, puis l’aperçu qui s’ouvre.</p></div>
      <div class="set-opts" role="radiogroup" aria-labelledby="set-light">
        ${Object.entries(LIGHTS).map(([k, [label, text]]) => `<button class="set-opt" type="button" role="radio" aria-checked="${k === lightMode}" tabindex="${k === lightMode ? 0 : -1}" data-light="${k}">
          ${demo(k)}<span class="set-tx"><b>${esc(label)}</b><small>${esc(text)}</small></span><span class="set-ck" aria-hidden="true">${icon('check')}</span></button>`).join('')}
      </div>
      ${canHover.matches ? '' : '<p class="set-note">Sur un écran tactile il n’y a pas de survol : ce réglage ne change rien ici.</p>'}
    </section>
  </div>`;
  // chaque groupe se comporte comme des boutons radio (clic, flèches du clavier)
  const group = (sel, onPick) => {
    const opts = $$(sel, view);
    const pick = (b) => {
      onPick(b);
      opts.forEach(x => { x.setAttribute('aria-checked', String(x === b)); x.tabIndex = x === b ? 0 : -1; });
    };
    opts.forEach((b, i) => {
      b.addEventListener('click', () => pick(b));
      b.addEventListener('keydown', (e) => {
        const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (!d) return;
        e.preventDefault();
        const n = opts[(i + d + opts.length) % opts.length];
        pick(n); n.focus();
      });
    });
  };
  group('[data-theme-k]', b => setTheme(b.dataset.themeK));
  group('[data-light]', b => setLightMode(b.dataset.light));
  // la démonstration « Film » montre les couleurs choisies
  const accDemo = () => { const d = $('.set-demo-film', view), im = d && $('img', d); if (!im) return;
    const go = () => d.style.setProperty('--pimg', (accents && im.naturalWidth && accentOf(im)) || bgUrl(im.src));
    if (im.complete) go(); else im.addEventListener('load', go, { once: true }); };
  accDemo();
  group('[data-vx-on]', b => { veille.on = b.dataset.vxOn === '1'; saveVeille(); $('#set-vx')?.classList.toggle('off', !veille.on); });
  group('[data-vx-min]', b => { veille.min = +b.dataset.vxMin; saveVeille(); });
  group('[data-vx-style]', b => { veille.style = b.dataset.vxStyle; saveVeille(); });
  $('[data-vx-try]', view)?.addEventListener('click', () => startVeille(true));
};

const viewCollections = () => {
  document.title = 'Collections · WATCHIT';
  const n = S.collections.length, films = S.collections.reduce((k, c) => k + c.films.length, 0);
  view.innerHTML = `<div class="page">
    <header class="page-head"><div><h1 class="page-title">Collections</h1>
      <p class="page-sub">${n} collection${n > 1 ? 's' : ''}, ${films} films à voir dans l'ordre</p></div></header>
    ${n ? `<div class="cs-grid">${colLayout(S.collections).map(x => colSlices(x.c, x.w)).join('')}</div>` : `<div class="empty"><b>Aucune collection pour l'instant</b></div>`}
  </div>`;
  // ▶ lance le film suivant de la collection ; le reflet de la carte prend la couleur de sa première scène
  $$('.cs-go', view).forEach(b => b.addEventListener('click', () => {
    const c = S.collections.find(x => x.id === b.dataset.col);
    if (c) openPlayer(colNext(c).film, null);
  }));
  $$('.cs', view).forEach(el => {
    const img = $('.sl img', el);
    if (img) whenLoaded(img, () => { const t = img.isConnected && tintOf(img); if (t) el.style.setProperty('--tint', t); });
  });
};

// Fiche : l'image du film en grand, le texte en bas à gauche
const detailHero = ({ bg, crumb, title, logo, logoTone, meta, extra = '', synopsis, actions, after = '' }) => `<section class="detail">
    ${bg ? `<div class="detail-bg"><img src="${esc(bg)}" alt="" fetchpriority="high"></div>` : ''}
    <div class="glow" aria-hidden="true"></div>
    <div class="detail-in">
      ${crumb}
      ${titleHtml('detail-title', title, logo, logoTone)}
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
  document.title = c.title + ' · WATCHIT';
  // Le film à lancer : le premier pas encore terminé, dans l'ordre de la collection
  const nextIdx = Math.max(0, c.films.findIndex(f => progressPct(f.id) < 90));
  const next = c.films[nextIdx], started = progressPct(next.id) > 0;

  view.innerHTML = detailHero({
    bg: c.backdrop,
    crumb: `<a class="crumb" href="/collections" data-link>${icon('left')}Collections</a>`,
    title: c.title,
    meta: metaHtml(null, [`${c.films.length} films`, c.years, c.minutes ? fmtShort(c.minutes) + ' en tout' : '']),
    extra: c.dirIds.length ? `<p class="by">Réalisé par ${personLinks(c.dirIds)}</p>` : c.director ? `<p class="by">Réalisé par ${directorLinks(c.director)}</p>` : '',
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
  document.title = it.title + ' · WATCHIT';
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
    title: it.title, logo: it.logo, logoTone: it.logoTone,
    meta: metaHtml(it.rating, [it.year, kind === 'film' ? fmtShort(it.duration) : seriesLine(it)], it.genres),
    extra: (it.equipe && it.equipe.real.some(id => S.people.has(id))
        ? `<p class="by">${kind === 'serie' ? 'Créé par' : 'Réalisé par'} ${personLinks(it.equipe.real)}</p>`
        : it.director ? `<p class="by">Réalisé par ${directorLinks(it.director)}</p>` : '') +
      (!castRow(it) && cast.length ? `<p class="by">Avec ${cast.map(n => `<a href="/catalogue?q=${encodeURIComponent(n)}" data-link><b>${esc(n)}</b></a>`).join(', ')}</p>` : ''),
    synopsis: it.description,
    actions: `<button class="btn play" id="play-btn" type="button">${icon('play')}${esc(playLabel)}</button>`,
    after: (resume ? `<div class="resume"><span class="pb"><i style="width:${resume.pct}%"></i></span><span>${esc(resume.text)}</span></div>` : '') +
      inCols.map(c => `<a class="in-col" href="/collection/${esc(c.id)}" data-link>${icon('grid')}Fait partie de la collection <b>${esc(c.title)}</b></a>`).join('<br>'),
  }) + `<div class="fiche-body">
      ${kind === 'serie' ? `<section class="eps" id="episodes-zone"></section>` : ''}
      ${castRow(it)}
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
  document.title = 'Fermé · WATCHIT';
  $('#offline').hidden = true;
  document.body.classList.add('closed');
  stopHero();
  // « Fin de séance » : où l'on s'est arrêté, pour savoir où reprendre la prochaine fois
  const last = resumeEntries()[0];
  let card = '', bg = '';
  if (last) {
    const { it, ep, p } = last;
    const img = (ep && imgUrl(ep.thumb)) || it.backdrop || it.poster;
    const pct = Math.min(100, Math.round(p.ts / p.duration * 100));
    bg = it.backdrop ? `<div class="closed-bg" aria-hidden="true">${thumbTag(it.backdrop)}</div>` : '';
    card = `<div class="closed-last"><span class="closed-th">${placeholder()}${thumbTag(img)}</span>
      <span><small>Tu t'es arrêté à</small><b>${esc(it.title)}</b>${ep ? `<span class="closed-ep">${esc(epLabel(ep, it))}</span>` : ''}
        <span class="closed-pg"><i><u style="width:${pct}%"></u></i><em>${esc(fmtLeft(p.duration - p.ts))}</em></span></span></div>`;
  }
  view.innerHTML = `<div class="closed-screen">${bg}
    <div class="closed-wm">${logoMark()}<span>WATCHIT</span></div>
    <h1 class="display">La séance est terminée</h1>
    <p>Le site est arrêté : tu peux fermer cet onglet et éjecter le disque.</p>
    ${card}
    <p class="closed-hint">Pour revenir, double-clique sur <b>▶ WATCH</b> tout en haut du disque</p>
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
    count.textContent = !words.length ? `${items.length} titres`
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

// ─── ÉCRAN DE VEILLE ──────────────────────────────────────────────────────────
// Après quelques minutes sans un geste, des films défilent en grand ; la souris ou une touche, et tout revient.
// Deux styles : le plein écran (une scène qui avance lentement, son logo, l'heure) ou le mur d'affiches qui dérive.
// Rien pendant une vidéo ni pendant le ticket d'entrée. Réglages : marche/arrêt, délai, style (localStorage mpf-veille).
const VEILLE_STYLES = {
  plein: ['Plein écran', 'Une scène en grand qui avance lentement, puis le film suivant, avec son logo et l’heure.'],
  mur: ['Mur d’affiches', 'Tout le catalogue en mur d’affiches qui dérive ; de temps en temps, une affiche s’allume.'],
};
const VEILLE_MIN = [1, 2, 5, 10, 15];
const veille = { on: true, min: 5, style: 'plein' };
try { Object.assign(veille, JSON.parse(localStorage.getItem('mpf-veille') || '{}')); } catch (e) { /* réglages par défaut */ }
if (!VEILLE_STYLES[veille.style]) veille.style = 'plein';
const saveVeille = () => { try { localStorage.setItem('mpf-veille', JSON.stringify(veille)); } catch (e) { /* le temps de la visite */ } };
let veilleEl = null, lastAct = Date.now();
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const vxClock = (el) => {
  const d = new Date(), b = $('.vx-clk b', el), s = $('.vx-clk small', el);
  if (b) b.textContent = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (s) s.textContent = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
};
const vxLoad = (src) => new Promise(res => { const i = new Image(); i.onload = i.onerror = () => res(i); i.src = src; });
// la couleur moyenne d'une image (pour le halo de l'affiche allumée)
const vxTint = (img) => { try { const c = document.createElement('canvas'); c.width = c.height = 8; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 8, 8);
  const d = g.getImageData(0, 0, 8, 8).data; let r = 0, gg = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
  return `${r / 64 | 0},${gg / 64 | 0},${b / 64 | 0}`; } catch (e) { return '255,255,255'; } };

const veillePlein = (el) => {
  const list = shuffle(S.items.filter(it => it.backdrop)); let k = -1, cur = 0;
  el.innerHTML = `<div class="vx-sl"><img alt=""></div><div class="vx-sl"><img alt=""></div><div class="vx-shade"></div>
    <div class="vx-clk"><b></b><small></small></div>
    <div class="vx-info"><div class="vx-t"></div><div class="vx-k"></div><i class="vx-bar"><i></i></i></div>
    <span class="vx-mark">${logoMark()}</span>`;
  const sl = $$('.vx-sl', el), info = $('.vx-info', el);
  const next = async () => {
    k = (k + 1) % list.length; const it = list[k], img = await vxLoad(it.backdrop);
    if (!el.isConnected) return;
    cur = 1 - cur; const a = sl[cur], b = sl[1 - cur], im = $('img', a);
    im.src = img.src;
    // un lent travelling, dans une direction différente à chaque film
    const dx = (Math.random() * 2 - 1) * 2.4, dy = (Math.random() * 2 - 1) * 1.6;
    a.style.setProperty('--x1', dx + '%'); a.style.setProperty('--y1', dy + '%'); a.style.setProperty('--x2', -dx + '%'); a.style.setProperty('--y2', -dy + '%');
    a.classList.remove('on'); void a.offsetWidth; a.classList.add('on'); b.classList.remove('on');
    info.classList.add('out');
    setTimeout(() => {
      if (!el.isConnected) return;
      $('.vx-t', el).innerHTML = it.logo ? `<img class="title-logo" src="${esc(it.logo)}" alt="${esc(it.title)}" onload="mpfTone(this)">` : `<b>${esc(it.title)}</b>`;
      $('.vx-k', el).textContent = [it.year, it.director || (it.kind === 'serie' ? 'Série' : '')].filter(Boolean).join(' · ');
      const bar = $('.vx-bar', el); bar.classList.remove('go'); void bar.offsetWidth; bar.classList.add('go');
      info.classList.remove('out');
    }, 650);
  };
  next(); el._t = setInterval(next, 12000);
};

const veilleMur = (el) => {
  const ps = shuffle(S.items.filter(it => it.poster)); let cells = ps;
  while (cells.length < 132) cells = cells.concat(shuffle(ps));
  cells = cells.slice(0, 132);
  const grid = `<div class="vx-grid">${cells.map(it => `<span data-k="${esc(it.key)}"><img src="${esc(thumbUrl(it.poster))}" alt="" decoding="async"></span>`).join('')}</div>`;
  el.innerHTML = `<div class="vx-wall"><div class="vx-track">${grid}${grid}</div></div><div class="vx-shade"></div>
    <div class="vx-clk vx-low"><b></b><small></small><span class="vx-now"></span></div><span class="vx-mark">${logoMark()}</span>`;
  // de temps en temps, l'affiche la plus proche du centre s'allume
  const light = () => {
    if (!el.isConnected) return;
    $('.vx-grid .lit', el)?.classList.remove('lit');
    let best = null, bd = 1e12; const cx = innerWidth * .62, cy = innerHeight * .44;
    for (const s of $$('.vx-grid span', el)) { const r = s.getBoundingClientRect(), dx = r.left + r.width / 2 - cx, dy = r.top + r.height / 2 - cy, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = s; } }
    if (!best) return;
    const it = S.byKey.get(best.dataset.k), im = $('img', best);
    best.style.setProperty('--glow', im && im.complete && im.naturalWidth ? vxTint(im) : '255,255,255');
    best.classList.add('lit');
    $('.vx-now', el).textContent = it ? [it.title, it.year].filter(Boolean).join(' · ') : '';
  };
  setTimeout(light, 1200); el._t = setInterval(light, 6500);
};

const busyForVeille = () => !$('#player').hidden || !!document.querySelector('.tk-ov') || document.hidden;
const startVeille = (force) => {
  if (veilleEl || (!force && busyForVeille()) || !S.items.length) return;
  const el = document.createElement('div');
  el.className = `vx vx-${veille.style}`; el.setAttribute('aria-hidden', 'true');
  (veille.style === 'mur' ? veilleMur : veillePlein)(el);
  vxClock(el); el._c = setInterval(() => vxClock(el), 10000);
  document.body.append(el); veilleEl = el;
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  setTimeout(() => { el.dataset.ready = '1'; }, 900);   // un tout petit mouvement juste après l'apparition ne la ferme pas
};
const stopVeille = () => {
  const el = veilleEl; if (!el) return;
  veilleEl = null; lastAct = Date.now();
  clearInterval(el._t); clearInterval(el._c); el.classList.remove('on');
  setTimeout(() => el.remove(), 700);
};
['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(ev => addEventListener(ev, (e) => {
  if (veilleEl) {
    if (!veilleEl.dataset.ready) return;
    if (ev === 'keydown' || ev === 'pointerdown' || ev === 'wheel') { e.preventDefault(); e.stopPropagation(); }   // le geste réveille seulement
    stopVeille(); return;
  }
  lastAct = Date.now();
}, { capture: true, passive: false }));
setInterval(() => { if (veille.on && !veilleEl && Date.now() - lastAct > veille.min * 60000) startVeille(); }, 5000);

// ─── L'ENTRÉE SUR LE SITE ─────────────────────────────────────────────────────
// Quand la pile de cartes du chargement s'efface (js/arrivee.js) : la barre descend du haut (le logo apparaît
// sur place), l'écran du film monte en grandissant un peu, son texte arrive ligne à ligne, les points sous
// l'écran apparaissent un à un, puis les rangées. Une seule fois, à l'arrivée.
let entered = false;
const entrance = () => {
  if (entered) return; entered = true;
  if (calm.matches || !document.body.animate) return;
  const E = (el, kf, delay, dur = 800, easing = 'cubic-bezier(.2,.8,.2,1)') => el?.animate(kf, { duration: dur, delay: delay * 1000, easing, fill: 'backwards' });
  const DROP = [{ opacity: 0, translate: '0 -96px' }, { opacity: 1, translate: '0 0' }], BOUNCE = 'cubic-bezier(.22,1.12,.36,1)';
  E($('#header .logo'), [{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }], .15, 800);
  E($('#header .nav'), DROP, .12, 950, BOUNCE);
  E($('#header .hd-act'), DROP, .2, 950, BOUNCE);
  const hero = $('#hero');
  if (!hero) { E(view, [{ opacity: 0, translate: '0 24px' }, { opacity: 1, translate: '0 0' }], .3); return; }
  E(hero, [{ opacity: 0, translate: '0 40px', scale: '.96' }, { opacity: 1, translate: '0 0', scale: '1' }], .25, 1100);
  $$('#hero-copy > *').forEach((el, i) => E(el, [{ opacity: 0, translate: '0 18px' }, { opacity: 1, translate: '0 0' }], .62 + i * .07, 700));
  $$('#hero .th').forEach((el, i) => E(el, [{ opacity: 0, scale: '.3' }, { opacity: 1, scale: '1' }], .95 + i * .06, 600, 'cubic-bezier(.34,1.4,.64,1)'));
  E($('#view > .rows'), [{ opacity: 0, translate: '0 30px' }, { opacity: 1, translate: '0 0' }], 1.05, 900);
};
addEventListener('mpf-arrivee-out', entrance, { once: true });

// ─── DÉMARRAGE ────────────────────────────────────────────────────────────────
const init = async () => {
  const data = await api('/api/data');
  if (data.error) {
    view.innerHTML = `<div class="wrap"><p class="empty">${esc(data.error)}. <a class="link-u" href="/">Réessayer →</a></p></div>`;
    window.mpfPret?.();
    return;
  }
  loadData(data);
  connect();
  render();
  // sans animation de chargement (déjà vue dans cet onglet), l'entrée se joue tout de suite
  if (!document.querySelector('.arrivee')) entrance();
  // l'écran d'arrivée (js/arrivee.js) peut s'effacer (ces chiffres servaient au ticket d'entrée, mis de côté)
  window.mpfPret?.({ films: (data.films || []).length, series: (data.series || []).length, episodes: S.episodes.length, collections: S.collections.length });
};
init();
})();
