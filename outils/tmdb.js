/* Accès à TMDB, partagé par les outils (logos.js, personnes.js).
   La clé vient de la variable TMDB_KEY (clé v3 ou jeton v4). */
const KEY = process.env.TMDB_KEY || '';
const bearer = KEY.startsWith('eyJ');
const need = (cmd) => { if (!KEY) { console.error(`Il faut une clé TMDB :  TMDB_KEY=ta_clé node outils/${cmd}`); process.exit(1); } };

const api = async (p, q = {}) => {
  const u = new URL('https://api.themoviedb.org/3' + p);
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  if (!bearer) u.searchParams.set('api_key', KEY);
  for (let essai = 0; essai < 5; essai++) {
    let r;
    try { r = await fetch(u, { headers: bearer ? { Authorization: 'Bearer ' + KEY, accept: 'application/json' } : { accept: 'application/json' } }); }
    catch (e) { await new Promise(s => setTimeout(s, 1000 * (essai + 1))); continue; }
    if (r.status === 429 || r.status >= 500) { await new Promise(s => setTimeout(s, 1500 * (essai + 1))); continue; }
    if (!r.ok) throw new Error(`TMDB ${r.status} sur ${p}`);
    return r.json();
  }
  throw new Error('TMDB : trop de demandes');
};
const norm = s => String(s || '').replace(/['’`]/g, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

// retrouver le film (ou la série) sur TMDB à partir du titre et de l'année
async function find(it, kind) {
  const year = parseInt(it.year, 10) || undefined;
  const title = it.title.normalize('NFC'), short = title.split(/\s+[—–-]\s+|:\s/)[0];
  const tries = kind === 'tv'
    ? [{ query: title, first_air_date_year: year, language: 'fr-FR' }, { query: title, language: 'fr-FR' }, { query: title, language: 'en-US' }]
    : [{ query: title, year, language: 'fr-FR' }, { query: title, year, language: 'en-US' }, { query: title, language: 'fr-FR' }, { query: short, year, language: 'fr-FR' }];
  for (const q of tries) {
    const res = (await api(`/search/${kind}`, { ...q, include_adult: 'false' })).results || [];
    if (!res.length) continue;
    const t = norm(q.query);
    const score = r => {
      const names = [r.title, r.name, r.original_title, r.original_name].map(norm);
      const y = parseInt((r.release_date || r.first_air_date || '').slice(0, 4), 10);
      return (names.includes(t) ? 100 : names.some(n => n && (n.includes(t) || t.includes(n))) ? 40 : 0)
        + (year && y ? Math.max(0, 30 - 15 * Math.abs(y - year)) : 0) + Math.min(20, (r.popularity || 0) / 5);
    };
    const best = res.map(r => [score(r), r]).sort((a, b) => b[0] - a[0])[0];
    if (best && best[0] >= 40) return best[1];
  }
  return null;
}
const kindOf = (it, list) => list === 'series' || it.section === 'series' ? 'tv' : 'movie';
module.exports = { api, norm, find, need, kindOf };
