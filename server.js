/**
 * Messi por favor — version disque dur
 *
 * Le site vit dans ce dossier, sur le disque des films. Il tourne sur l'ordi de la
 * personne qui branche le disque (http://localhost), sans compte ni internet.
 *
 * Lancé par l'app « ▶ Messi por favor » (à la racine du disque), qui ouvre le navigateur
 * quand le site est prêt et l'arrête quand on la quitte. Lancé à la main (node server.js,
 * ou le lanceur de secours), il ouvre lui-même le navigateur.
 * Si le site tourne déjà, il se contente de le rouvrir.
 *
 * Les vidéos sont lues depuis la racine du disque (le dossier parent de celui-ci).
 * Le site s'arrête tout seul quand plus aucune page n'est ouverte, pour qu'on puisse
 * éjecter le disque.
 */
'use strict';

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const APP_ID   = 'messi-por-favor';
const SITE     = __dirname;                 // ce dossier
const DISK     = path.dirname(SITE);        // la racine du disque, où sont les vidéos
const CATALOG  = path.join(SITE, 'catalogue.json');
const STATE    = path.join(SITE, 'progression.json');
const CACHE    = path.join(SITE, 'cache');  // sous-titres extraits (gardés d'une fois sur l'autre)
const FROM_APP = !!process.env.MESSI_APP;   // lancé par l'app du disque
const PORTS    = Array.from({ length: 20 }, (_, i) => 8777 + i);
const IDLE_MS  = (+process.env.MESSI_DELAI || 90) * 1000;      // arrêt 1 min 30 après la fermeture de la dernière page
const FIRST_MS = (+process.env.MESSI_DELAI || 300) * 1000;     // … ou 5 min si aucune page ne s'est jamais ouverte
const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.mkv']);

try { fs.mkdirSync(CACHE, { recursive: true }); } catch (e) {}

const log = (...a) => console.log(new Date().toLocaleTimeString('fr-FR'), ...a);
const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);
const key = (rel) => String(rel || '').normalize('NFC').toLowerCase();
// Message pour l'app du disque (écrit tout de suite, même juste avant de quitter)
const tellApp = (msg) => { try { fs.writeSync(1, msg + '\n'); } catch (e) {} };

// ─── OUTILS (FFmpeg) ──────────────────────────────────────────────────────────
// Ceux du dossier outils/ d'abord (rien à installer), sinon ceux de l'ordi
const ARCH = process.arch === 'arm64' ? 'arm64' : 'x64';
const findTool = (name) => {
  const local = process.env.MESSI_OUTILS_SYSTEME ? [] : [path.join(SITE, 'outils', `${name}-${ARCH}`)];
  for (const p of [...local, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, name]) {
    try { if (spawnSync(p, ['-version'], { stdio: 'ignore', timeout: 15000 }).status === 0) return p; } catch (e) {}
  }
  return null;
};
let FFMPEG = null, FFPROBE = null;

// ─── DÉJÀ OUVERT ? ────────────────────────────────────────────────────────────
const ping = (port) => new Promise((resolve) => {
  const req = http.get({ host: '127.0.0.1', port, path: '/api/ping', timeout: 800 }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => { try { const j = JSON.parse(body); resolve(j.app === APP_ID && j.site === SITE ? port : null); } catch (e) { resolve(null); } });
  });
  req.on('timeout', () => { req.destroy(); resolve(null); });
  req.on('error', () => resolve(null));
});
const findRunning = async () => (await Promise.all(PORTS.map(ping))).find(Boolean) || null;
const openBrowser = (port) => {
  if (process.env.NO_OPEN) return console.log('(navigateur non ouvert) http://localhost:' + port);
  spawn('open', [`http://localhost:${port}/`], { stdio: 'ignore', detached: true }).unref();
};

// ─── CATALOGUE ────────────────────────────────────────────────────────────────
let _cat = null, _catMtime = 0;
const loadCatalog = () => {
  try {
    const m = fs.statSync(CATALOG).mtimeMs;
    if (!_cat || m !== _catMtime) { _cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8')); _catMtime = m; }
  } catch (e) {
    if (!_cat) { log('[Catalogue] Illisible :', e.message); _cat = {}; }
  }
  return _cat;
};

// Toutes les vidéos du disque (hors dossiers cachés et hors ce dossier)
const SKIP_DIRS = new Set(['$RECYCLE.BIN', 'System Volume Information', 'Applications']);
const scanDisk = () => {
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') || e.name.endsWith('.app')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (full === SITE || SKIP_DIRS.has(e.name)) continue;
        walk(full, depth + 1);
      } else if (VIDEO_EXTS.has(path.extname(e.name).toLowerCase())) {
        let mtime = 0; try { mtime = fs.statSync(full).mtimeMs; } catch (err) {}
        files.push({ rel: path.relative(DISK, full).split(path.sep).join('/'), mtime });
      }
    }
  };
  walk(DISK, 0);
  return files;
};

// « Les.Salauds.Dorment.en.Paix.1080p » → « Les Salauds Dorment en Paix »
const cleanTitle = (s) => String(s)
  .replace(/\.[a-z0-9]{2,4}$/i, '')
  .replace(/[._]+/g, ' ')
  .replace(/\b(1080p|720p|2160p|4k|x264|x265|h264|h265|hevc|web-?dl|webrip|bluray|brrip|hdrip|dvdrip|vostfr|multi|truefrench|french)\b.*$/i, '')
  .replace(/\(\s*\)|\[\s*\]/g, '')
  .replace(/\s+/g, ' ').trim() || String(s);
const SXE = /^(.*?)[\s._-]*S(\d{1,2})[\s._-]*E(\d{1,3})/i;

// Ce que le site affiche : uniquement ce qui est vraiment sur le disque.
// Les vidéos sans fiche apparaissent quand même, avec leur nom de fichier.
const buildLibrary = () => {
  const cat = loadCatalog();
  const files = scanDisk();
  const onDisk = new Map(files.map(f => [key(f.rel), f]));
  const ignore = new Set((cat.ignorer || []).map(key));
  const used = new Set();
  const resolve = (ref) => {
    const f = ref && onDisk.get(key(ref));
    if (f) used.add(key(f.rel));
    return f ? f.rel : null;
  };

  const films = (cat.films || []).map(f => ({ ...f, videoRef: resolve(f.videoRef) })).filter(f => f.videoRef);
  const episodes = (cat.episodes || []).map(e => ({ ...e, videoRef: resolve(e.videoRef) })).filter(e => e.videoRef);
  const series = (cat.series || []).slice();

  // Vidéos sans fiche
  const loose = files.filter(f => !used.has(key(f.rel)) && !ignore.has(key(f.rel)));
  const byNorm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const seriesByTitle = new Map(series.map(s => [byNorm(s.title), s]));
  const seriesByFolder = new Map();
  for (const e of episodes) {
    const dir = path.posix.dirname(e.videoRef);
    if (dir !== '.') seriesByFolder.set(key(dir), e.seriesId);
  }
  const autoSeries = new Map();
  const folderCount = new Map();
  for (const f of loose) { const d = path.posix.dirname(f.rel); if (d !== '.') folderCount.set(d, (folderCount.get(d) || 0) + 1); }

  for (const f of loose) {
    const base = path.posix.basename(f.rel);
    const dir = path.posix.dirname(f.rel);
    const m = base.replace(/\.[^.]+$/, '').match(SXE);
    let seriesId = dir !== '.' ? seriesByFolder.get(key(dir)) : null;
    if (!seriesId && m && seriesByTitle.has(byNorm(cleanTitle(m[1])))) seriesId = seriesByTitle.get(byNorm(cleanTitle(m[1]))).id;
    if (!seriesId && (m || (dir !== '.' && folderCount.get(dir) > 1))) {
      const name = m && cleanTitle(m[1]) ? cleanTitle(m[1]) : cleanTitle(dir.split('/')[0]);
      const id = 'auto-' + hash('serie:' + byNorm(name));
      if (!autoSeries.has(id)) autoSeries.set(id, { id, title: name, auto: true, addedAt: 0 });
      seriesId = id;
    }
    if (seriesId) {
      const s = autoSeries.get(seriesId);
      if (s) s.addedAt = Math.max(s.addedAt, f.mtime);
      episodes.push({
        id: 'auto-' + hash(f.rel), seriesId, auto: true, videoRef: f.rel, addedAt: f.mtime,
        season: m ? +m[2] : 1, episode: m ? +m[3] : 0,
        title: m ? '' : cleanTitle(base),
      });
    } else {
      films.push({ id: 'auto-' + hash(f.rel), title: cleanTitle(base), auto: true, videoRef: f.rel, addedAt: f.mtime });
    }
  }
  // Épisodes sans numéro : dans l'ordre des noms de fichiers, après les autres
  for (const s of autoSeries.values()) {
    const eps = episodes.filter(e => e.seriesId === s.id && !e.episode)
      .sort((a, b) => a.videoRef.localeCompare(b.videoRef, 'fr', { numeric: true }));
    eps.forEach((e, i) => { e.episode = i + 1; });
  }
  series.push(...autoSeries.values());
  const withEps = new Set(episodes.map(e => e.seriesId));
  return {
    films,
    series: series.filter(s => withEps.has(s.id)),
    episodes,
    collections: cat.collections || [],
  };
};

// ─── PROGRESSION ET MA LISTE (gardées sur le disque) ──────────────────────────
let _state = null;
const loadState = () => {
  if (_state) return _state;
  try { _state = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch (e) { _state = {}; }
  if (!_state.progress || typeof _state.progress !== 'object') _state.progress = {};
  if (!Array.isArray(_state.myList)) _state.myList = [];
  return _state;
};
let saveTimer = null;
const saveState = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STATE + '.tmp', JSON.stringify(_state));
      fs.renameSync(STATE + '.tmp', STATE);
    } catch (e) { log('[Progression] Impossible d\'enregistrer :', e.message); }
  }, 300);
};

// ─── RÉPONSES ─────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json', '.woff2': 'font/woff2',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.vtt': 'text/vtt; charset=utf-8',
};
const jsonRes = (res, data, status = 200) => {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};
const readJson = (req, res, cb) => {
  let size = 0; const chunks = [];
  req.on('data', d => { size += d.length; if (size > 1e5) { req.destroy(); } else chunks.push(d); });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (e) { return jsonRes(res, { error: 'JSON invalide' }, 400); }
    if (!body || typeof body !== 'object') return jsonRes(res, { error: 'JSON invalide' }, 400);
    cb(body);
  });
};

// Lecture d'un fichier avec reprise (Range) : indispensable pour avancer dans une vidéo
let streams = 0;
const streamFile = (req, res, filePath, cache = 'no-cache') => {
  let stat;
  try { stat = fs.statSync(filePath); } catch (e) { res.writeHead(404); res.end('Introuvable'); return; }
  const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const total = stat.size;
  const headers = { 'Content-Type': mime, 'Accept-Ranges': 'bytes', 'Cache-Control': cache };
  let start = 0, end = total - 1, status = 200;
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, total - parseInt(m[2], 10)); }
    else if (m) { start = m[1] !== '' ? parseInt(m[1], 10) : NaN; if (m[2] !== '') end = parseInt(m[2], 10); }
    if (!m || isNaN(start) || start > end || start >= total) { res.writeHead(416, { 'Content-Range': `bytes */${total}` }); res.end(); return; }
    end = Math.min(end, total - 1);
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${total}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD') return res.end();
  const video = mime.startsWith('video/');
  if (video) { streams++; activity(); }
  const rs = fs.createReadStream(filePath, { start, end });
  rs.on('error', () => res.destroy());
  res.on('close', () => { rs.destroy(); if (video) { streams--; activity(); } });
  rs.pipe(res);
};

// ─── PISTES (FFprobe) ─────────────────────────────────────────────────────────
const analyzeFile = (filePath) => new Promise((resolve) => {
  const empty = { audio: [], subtitles: [] };
  if (!FFPROBE) return resolve(empty);
  const proc = spawn(FFPROBE, ['-v', 'quiet', '-print_format', 'json', '-show_streams', filePath], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  const timer = setTimeout(() => { try { proc.kill(); } catch (e) {} resolve(empty); }, 15000);
  proc.stdout.on('data', d => out += d);
  proc.on('error', () => { clearTimeout(timer); resolve(empty); });
  proc.on('close', () => {
    clearTimeout(timer);
    try {
      const streams = JSON.parse(out).streams || [];
      const audio = streams.filter(s => s.codec_type === 'audio').map((s, i) => ({
        audioIndex: i, lang: s.tags?.language || 'und', title: s.tags?.title || '', codec: s.codec_name, channels: s.channels,
      }));
      // Seuls les sous-titres texte s'affichent dans un navigateur (pas les images PGS/VobSub)
      const all = streams.filter(s => s.codec_type === 'subtitle').map((s, i) => ({
        index: i, lang: s.tags?.language || 'und', title: s.tags?.title || '', forced: s.disposition?.forced === 1, codec: s.codec_name,
      })).filter(s => !/pgs|dvd_sub|dvb_sub|xsub/.test(s.codec || ''));
      // Une piste par langue : la complète de préférence (ni « forcés », ni SDH)
      const rank = s => (s.forced || /forc/i.test(s.title) ? 2 : 0) + (/sdh|\bcc\b|malentend/i.test(s.title) ? 1 : 0);
      const best = new Map();
      for (const s of all) { const b = best.get(s.lang); if (!b || rank(s) < rank(b)) best.set(s.lang, s); }
      const subtitles = all.filter(s => best.get(s.lang) === s).map(s => ({ ...s, forced: rank(s) >= 2 }));
      resolve({ audio, subtitles });
    } catch (e) { resolve(empty); }
  });
});

// ─── SOUS-TITRES → VTT (gardés dans cache/) ───────────────────────────────────
const jobs = new Set(); // processus FFmpeg en cours, arrêtés à la fermeture
const run = (args) => {
  const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  jobs.add(ff);
  let err = '';
  ff.stderr.on('data', d => { err = (err + d).slice(-400); });
  return new Promise((resolve) => {
    ff.on('error', (e) => { jobs.delete(ff); resolve({ code: -1, err: e.message }); });
    ff.on('close', (code) => { jobs.delete(ff); resolve({ code, err }); });
  });
};
const fileTag = (filePath) => { const s = fs.statSync(filePath); return filePath + '|' + s.size + '|' + Math.round(s.mtimeMs); };

const subJobs = new Map();
const extractSubtitle = (filePath, index) => {
  const out = path.join(CACHE, `sub-${hash(fileTag(filePath) + '|' + index)}.vtt`);
  if (fs.existsSync(out)) return Promise.resolve(out);
  if (subJobs.has(out)) return subJobs.get(out);
  const tmp = out + '.tmp.vtt';
  const p = run(['-hide_banner', '-loglevel', 'error', '-i', filePath, '-map', `0:s:${index}`, '-c:s', 'webvtt', '-y', tmp])
    .then(({ code, err }) => {
      subJobs.delete(out);
      if (code === 0 && fs.existsSync(tmp)) { fs.renameSync(tmp, out); return out; }
      try { fs.unlinkSync(tmp); } catch (e) {}
      throw new Error(err.trim() || 'code ' + code);
    });
  subJobs.set(out, p);
  return p;
};

// ─── AUTRE PISTE AUDIO : copie de la vidéo avec cette piste ───────────────────
// Préparée sur l'ordi (dossier temporaire) s'il a la place, sinon sur le disque.
const AUDIO_DIRS = [path.join(os.tmpdir(), 'messi-por-favor-audio'), path.join(CACHE, 'audio')];
const clearAudio = () => AUDIO_DIRS.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
const freeBytes = (dir) => { try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch (e) { return 0; } };
const audioJobs = new Map(); // id → { status, path, error }
const prepareAudio = (filePath, idx) => {
  const id = hash(fileTag(filePath) + '|audio|' + idx);
  const job = audioJobs.get(id);
  if (job && (job.status !== 'error' || job.at > Date.now() - 10000)) return id;
  const size = fs.statSync(filePath).size;
  const dir = AUDIO_DIRS.find(d => { try { fs.mkdirSync(d, { recursive: true }); } catch (e) { return false; } return freeBytes(d) > size * 1.1 + 2e9; });
  if (!dir) { audioJobs.set(id, { status: 'error', error: 'Pas assez de place pour préparer cette piste audio', at: Date.now() }); return id; }
  if (!FFMPEG) { audioJobs.set(id, { status: 'error', error: 'FFmpeg absent', at: Date.now() }); return id; }
  const out = path.join(dir, id + '.mp4');
  audioJobs.set(id, { status: 'pending', path: out });
  log(`[Audio] Piste ${idx} de ${path.basename(filePath)}`);
  run(['-hide_banner', '-loglevel', 'error', '-i', filePath, '-map', '0:v:0', '-map', `0:a:${idx}`,
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', out])
    .then(({ code, err }) => {
      if (code === 0 && fs.existsSync(out)) audioJobs.set(id, { status: 'ready', path: out });
      else { try { fs.unlinkSync(out); } catch (e) {} audioJobs.set(id, { status: 'error', error: 'Préparation impossible', at: Date.now() }); log('[Audio] Erreur :', err.trim()); }
    });
  return id;
};

// ─── ARRÊT AUTOMATIQUE ────────────────────────────────────────────────────────
// Chaque page ouverte garde une connexion (/api/events). Quand il n'y en a plus,
// et qu'aucune vidéo n'est lue, le site s'arrête : le disque peut être éjecté.
const pages = new Set();
let everOpened = false, idleTimer = null;
const activity = () => {
  clearTimeout(idleTimer);
  if (pages.size || streams > 0 || process.env.MESSI_NO_AUTOSTOP) return;
  idleTimer = setTimeout(() => shutdown('plus aucune page ouverte'), everOpened ? IDLE_MS : FIRST_MS);
};
let closing = false;
const shutdown = (why) => {
  if (closing) return;
  closing = true;
  log(`Arrêt du site (${why}).`);
  for (const ff of jobs) { try { ff.kill('SIGKILL'); } catch (e) {} }
  if (saveTimer) {
    clearTimeout(saveTimer);
    try { fs.writeFileSync(STATE, JSON.stringify(_state)); } catch (e) {}
  }
  clearAudio();
  for (const res of pages) { try { res.end(); } catch (e) {} }
  server.close();
  setTimeout(() => process.exit(0), 300).unref();
};
process.on('SIGINT', () => shutdown('Ctrl+C'));
process.on('SIGTERM', () => shutdown('signal'));
process.on('SIGHUP', () => shutdown('fenêtre fermée'));

// ─── SERVEUR ──────────────────────────────────────────────────────────────────
const safeJoin = (root, rel) => {
  const base = path.resolve(root);
  const full = path.resolve(base, String(rel || ''));
  return full.startsWith(base + path.sep) ? full : null;
};
// Une vidéo du disque, jamais en dehors, jamais un fichier caché ou du site
const mediaPath = (rel) => {
  const full = safeJoin(DISK, rel);
  if (!full || full.startsWith(SITE + path.sep)) return null;
  if (!VIDEO_EXTS.has(path.extname(full).toLowerCase())) return null;
  if (path.relative(DISK, full).split(path.sep).some(p => p.startsWith('.'))) return null;
  return fs.existsSync(full) ? full : null;
};

const server = http.createServer((req, res) => {
  // Seulement depuis cet ordi, par son nom local (protège des sites malveillants)
  if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '')) { res.writeHead(403); res.end(); return; }
  let url, pathname;
  try { url = new URL(req.url, 'http://localhost'); pathname = decodeURIComponent(url.pathname); }
  catch (e) { res.writeHead(400); res.end(); return; }
  const q = url.searchParams;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.method === 'POST' && req.headers.origin) {
    let host = null; try { host = new URL(req.headers.origin).host; } catch (e) {}
    if (host !== req.headers.host) return jsonRes(res, { error: 'Origine refusée' }, 403);
  }

  if (pathname === '/api/ping') return jsonRes(res, { app: APP_ID, site: SITE });

  // Connexion gardée ouverte par chaque page (arrêt automatique)
  if (pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    pages.add(res); everOpened = true; activity();
    const beat = setInterval(() => res.write(': ok\n\n'), 20000);
    res.on('close', () => { clearInterval(beat); pages.delete(res); activity(); });
    return;
  }

  if (pathname === '/api/quit' && req.method === 'POST') {
    jsonRes(res, { ok: true });
    return setTimeout(() => shutdown('bouton Quitter'), 200);
  }

  if (pathname === '/api/data') {
    const st = loadState();
    return jsonRes(res, { ...buildLibrary(), progress: st.progress, myList: st.myList, tools: { ffmpeg: !!FFMPEG, ffprobe: !!FFPROBE } });
  }

  // Progression d'un film ou d'un épisode (p = null : terminé)
  if (pathname === '/api/progress' && req.method === 'POST') {
    return readJson(req, res, ({ id, p }) => {
      if (typeof id !== 'string' || !id || id.length > 120) return jsonRes(res, { error: 'Contenu invalide' }, 400);
      const st = loadState();
      if (p && typeof p === 'object' && Number.isFinite(+p.ts) && Number.isFinite(+p.duration)) {
        st.progress[id] = { ts: +p.ts, duration: +p.duration, watchedSec: Math.round(+p.watchedSec || 0),
          seriesId: typeof p.seriesId === 'string' ? p.seriesId : null, updatedAt: Date.now() };
      } else delete st.progress[id];
      saveState();
      jsonRes(res, { ok: true });
    });
  }

  if (pathname === '/api/mylist' && req.method === 'POST') {
    return readJson(req, res, ({ kind, id, on }) => {
      if (!['film', 'serie'].includes(kind) || typeof id !== 'string' || !id || id.length > 120) return jsonRes(res, { error: 'Titre invalide' }, 400);
      const st = loadState();
      st.myList = st.myList.filter(x => !(x.kind === kind && x.id === id));
      if (on) st.myList.unshift({ kind, id, at: Date.now() });
      saveState();
      jsonRes(res, { ok: true, myList: st.myList });
    });
  }

  if (pathname === '/api/tracks') {
    const f = mediaPath(q.get('rel'));
    if (!f) return jsonRes(res, { error: 'Fichier introuvable', audio: [], subtitles: [] }, 404);
    analyzeFile(f).then(t => jsonRes(res, { ok: true, ...t }));
    return;
  }

  if (pathname === '/api/subtitle') {
    const f = mediaPath(q.get('rel')), index = parseInt(q.get('index'), 10);
    if (!f || !(index >= 0)) { res.writeHead(404); res.end(); return; }
    if (!FFMPEG) { res.writeHead(503); res.end('FFmpeg absent'); return; }
    extractSubtitle(f, index)
      .then(vtt => streamFile(req, res, vtt, 'private, max-age=86400'))
      .catch(err => { log('[Sous-titres] Erreur :', err.message); res.writeHead(500); res.end(); });
    return;
  }

  if (pathname === '/api/prepare-audio') {
    const f = mediaPath(q.get('rel')), idx = parseInt(q.get('audio'), 10);
    if (!f || !(idx >= 0)) return jsonRes(res, { error: 'Piste invalide' }, 400);
    const id = prepareAudio(f, idx), job = audioJobs.get(id);
    return jsonRes(res, { ok: true, hash: id, status: job.status, error: job.error || null });
  }
  if (pathname === '/api/audio-status') {
    const job = audioJobs.get(q.get('hash') || '');
    if (!job) return jsonRes(res, { status: 'unknown' }, 404);
    return jsonRes(res, { status: job.status, error: job.error || null });
  }

  if (pathname.startsWith('/api/')) return jsonRes(res, { error: 'Introuvable' }, 404);

  // Vidéo du disque (?audio=N : la copie avec une autre piste audio, si elle est prête)
  if (pathname.startsWith('/media/')) {
    const f = mediaPath(pathname.slice('/media/'.length));
    if (!f) { res.writeHead(404); res.end('Fichier introuvable'); return; }
    if (q.has('audio')) {
      const job = audioJobs.get(hash(fileTag(f) + '|audio|' + parseInt(q.get('audio'), 10)));
      if (job && job.status === 'ready' && fs.existsSync(job.path)) return streamFile(req, res, job.path);
    }
    return streamFile(req, res, f);
  }

  // Fichiers du site
  const m = pathname.match(/^\/(css|js|fonts|images)\/(.+)$/);
  if (m) {
    const f = safeJoin(path.join(SITE, m[1]), m[2]);
    if (!f || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
    return streamFile(req, res, f, m[1] === 'images' || m[1] === 'fonts' ? 'max-age=86400' : 'no-cache');
  }
  res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  fs.createReadStream(path.join(SITE, 'index.html')).pipe(res);
});

// Premier port libre de la liste
const listen = (i = 0) => {
  const port = process.env.PORT ? +process.env.PORT : PORTS[i];
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && !process.env.PORT && i + 1 < PORTS.length) return listen(i + 1);
    console.error('Impossible de démarrer :', e.message);
    process.exit(1);
  });
  server.listen(port, '127.0.0.1', () => {
    console.log('');
    console.log('  Messi por favor est ouvert : http://localhost:' + port);
    console.log('  Vidéos lues depuis : ' + DISK);
    console.log('  FFmpeg : ' + (FFMPEG ? 'oui' : 'non (pas de sous-titres ni de changement de langue)'));
    console.log('  Le site s\'arrête tout seul quand on ferme la page.');
    console.log('');
    activity();
    if (FROM_APP) tellApp('MESSI_PRET ' + port); else openBrowser(port);
  });
};

(async () => {
  // Déjà ouvert (deuxième clic, ou lanceur de secours) : on rouvre simplement la page
  const running = await findRunning();
  if (running) {
    if (FROM_APP) tellApp('MESSI_DEJA ' + running);
    else { console.log('Messi por favor tourne déjà.'); openBrowser(running); }
    return process.exit(0);
  }
  FFMPEG = findTool('ffmpeg');
  FFPROBE = findTool('ffprobe');
  clearAudio();
  for (const f of fs.readdirSync(CACHE)) if (f.endsWith('.tmp.vtt')) { try { fs.unlinkSync(path.join(CACHE, f)); } catch (e) {} }
  listen();
})();
