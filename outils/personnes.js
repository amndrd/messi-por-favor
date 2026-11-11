#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   Va chercher sur TMDB, pour chaque film et série du catalogue, qui l'a réalisé
   (ou créé, pour une série) et ses dix premiers rôles, puis la fiche de chacune
   de ces personnes : photo, dates, lieu de naissance, biographie.

     TMDB_KEY=ta_clé node outils/personnes.js          (seulement ce qui manque)
     TMDB_KEY=ta_clé node outils/personnes.js --fiches (relire les fiches des personnes, sans retélécharger les photos)
     TMDB_KEY=ta_clé node outils/personnes.js --tout   (tout refaire)

   • catalogue.json : chaque titre reçoit "tmdb" (ex. "movie/603") et "equipe" :
       { "real": [id, …], "avec": [[id, "personnage"], …] }
   • personnes.json : les personnes, par identifiant TMDB :
       { nom, g (1 femme, 2 homme), metier, ne, mort, lieu, photo, bio }
   • Photos en WebP dans images/personnes/<id>.webp (400 px de large) et leur
     miniature dans images/min/personnes/<id>.webp (180 px).
   ══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process'), os = require('os');
const { api, find, need, kindOf } = require('./tmdb');
need('personnes.js');
const ROOT = path.join(__dirname, '..'), CAT = path.join(ROOT, 'catalogue.json'), PEOPLE = path.join(ROOT, 'personnes.json');
const PH = path.join(ROOT, 'images/personnes'), PH_MIN = path.join(ROOT, 'images/min/personnes');
const ALL = process.argv.includes('--tout'), FICHES = process.argv.includes('--fiches'), CAST = 10;
const NON_LATIN = /[^\u0000-\u024F\u1E00-\u1EFF\u2018-\u201F]/;
fs.mkdirSync(PH, { recursive: true }); fs.mkdirSync(PH_MIN, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpf-pers-'));

// ─── mise au propre : lieu de naissance en français, biographie sans les noms en écriture d'origine ───
const PAYS = [
  ['États-Unis', /\b(usa|u\.s\.?a?\.?|united states|america|california|new york|new jersey|nj|texas|oregon|illinois|ohio|pennsylvania|massachusetts|michigan|georgia, usa|florida|iowa|nevada|washington|virginia|missouri|minnesota|wisconsin|indiana|kentucky|tennessee|louisiana|arizona|colorado|utah|oklahoma|maryland|connecticut|hawaii)\b/],
  ['Porto Rico', /puerto rico/], ['Corée du Nord', /north korea/], ['Corée du Sud', /korea|韩国|corée/], ['Japon', /japan|japon|日本/],
  ['Hong Kong', /hong kong|british crown colony/], ['Taïwan', /taiwan/], ['Chine', /china|chine|青岛|beijing|manchuria/],
  ['Royaume-Uni', /\b(uk|united kingdom|england|scotland|wales|yorkshire|london)\b/], ['Irlande', /ireland/],
  ['URSS', /ussr|soviet/], ['Russie', /russia/], ['Ukraine', /ukrain/], ['Géorgie', /georgia/], ['Lituanie', /lithuania/], ['Lettonie', /latvia/], ['Estonie', /estonia/], ['Arménie', /armenia/], ['Ouzbékistan', /uzbek/],
  ['Autriche-Hongrie', /austria-hungary/], ['Autriche', /austria/], ['Hongrie', /hungary/], ['Tchécoslovaquie', /czechoslovakia/], ['Yougoslavie', /yugoslavia/], ['Croatie', /croatia/], ['Kosovo', /kosovo/],
  ['Allemagne', /german|allemagne|deutschland/], ['Empire ottoman', /ottoman/], ['Macao', /maca[ou]/], ['Pologne', /poland|polska|pologne/], ['Suède', /sweden|sverige|suède/], ['Danemark', /denmark|danmark/], ['Norvège', /norway/],
  ['Pays-Bas', /netherlands|holland/], ['Belgique', /belgium/], ['Suisse', /switzerland/], ['Italie', /italy|italia|italie/], ['Espagne', /spain|españa/], ['Portugal', /portugal/], ['Grèce', /greece/], ['Roumanie', /romania/], ['Turquie', /turkey/],
  ['France', /france|francia/], ['Guadeloupe', /guadeloupe/], ['Martinique', /martinique/],
  ['Canada', /canada/], ['Mexique', /mexico/], ['Cuba', /cuba/], ['Jamaïque', /jamaica/], ['Honduras', /honduras/], ['Guatemala', /guatemala/], ['Costa Rica', /costa rica/], ['Colombie', /colombia/], ['Brésil', /brazil/], ['Argentine', /argentina/],
  ['Australie', /australia/], ['Nouvelle-Zélande', /new zealand/], ['Inde', /india/], ['Iran', /iran/], ['Israël', /israel/], ['Palestine', /palestine|west bank/], ['Liban', /lebanon/],
  ['Singapour', /singapore/], ['Malaisie', /malaysia/], ['Viêt Nam', /vietnam/], ['Philippines', /philippines/],
  ['Égypte', /egypt/], ['Algérie', /algeria|algérie/], ['Tunisie', /tunisia/], ['Sénégal', /senegal/], ['Côte d’Ivoire', /côte d.ivoire|ivory coast/], ['Cameroun', /cameroon/], ['Nigeria', /nigeria/], ['Ghana', /ghana/], ['Tanzanie', /tanzania/],
];
const FR = new Set(PAYS.map(p => p[0]));
const CJK = /[぀-ヿ㐀-鿿가-힯]/;
function lieuFr(raw) {
  if (!raw) return null;
  const bare = raw.replace(/\s*[\[(][^\])]*[\])]?/g, ''), parts = bare.split(/\s*(?:[,，.]| - )\s*/).map(x => x.trim()).filter(Boolean);
  const last = parts[parts.length - 1];
  if (parts.length && FR.has(last)) return parts.length > 1 && parts[0] !== last ? `${parts[0]}, ${last}` : last;   // déjà en français
  const low = bare.toLowerCase(), hit = PAYS.find(([, re]) => re.test(low));
  const pays = hit ? hit[0] : parts[parts.length - 1], ville = parts.length > 1 && !CJK.test(parts[0]) ? parts[0] : '';
  return [ville !== pays && ville, pays].filter(Boolean).join(', ') || null;
}
const bioClean = (b) => String(b || '')
  .replace(/([(（])\s*[^,，()（）]*[぀-ヿ㐀-鿿가-힯][^,，()（）]*[,，]\s*/g, '$1')   // « (黒澤 明, Kurosawa Akira) » → « (Kurosawa Akira) »
  .replace(/\s*[(（][^()（）]*[぀-ヿ㐀-鿿가-힯][^()（）]*[)）]/g, '')               // parenthèses qui ne contiennent que l'écriture d'origine
  .trim();

const pool = async (list, n, fn) => { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; await fn(list[k], k); } })); };
const writeJson = (f, data, indent) => { fs.writeFileSync(f + '.tmp', JSON.stringify(data, null, indent)); fs.renameSync(f + '.tmp', f); };

(async () => {
  const cat = JSON.parse(fs.readFileSync(CAT, 'utf8'));
  const people = fs.existsSync(PEOPLE) ? JSON.parse(fs.readFileSync(PEOPLE, 'utf8')) : {};
  people._lisezmoi = 'Fabriqué par outils/personnes.js (données TMDB). Les titres y renvoient par leur champ "equipe" dans catalogue.json.';
  const gens = people.gens = people.gens || {};
  const items = [...(cat.films || []).map(it => [it, kindOf(it, 'films')]), ...(cat.series || []).map(it => [it, kindOf(it, 'series')])];
  const found = new Map(), missing = [];

  // 1. l'équipe de chaque titre
  let done = 0;
  await pool(items, 6, async ([it, kind]) => {
    if (it.equipe && !ALL) return;
    try {
      let ref = it.tmdb;
      if (!ref || ALL) { const hit = await find(it, kind); if (!hit) { missing.push(`${it.title} (${it.year}) : introuvable`); return; } ref = `${kind}/${hit.id}`; }
      const [k, id] = ref.split('/');
      let real = [], avec = [];
      if (k === 'movie') {
        const c = await api(`/movie/${id}/credits`, { language: 'fr-FR' });
        real = (c.crew || []).filter(p => p.job === 'Director').map(p => p.id);
        avec = (c.cast || []).sort((a, b) => a.order - b.order).slice(0, CAST).map(p => [p.id, p.character || '']);
      } else {
        const [d, c] = await Promise.all([api(`/tv/${id}`, { language: 'fr-FR' }), api(`/tv/${id}/aggregate_credits`, { language: 'fr-FR' })]);
        real = (d.created_by || []).map(p => p.id);
        avec = (c.cast || []).sort((a, b) => a.order - b.order).slice(0, CAST).map(p => [p.id, (p.roles && p.roles[0] && p.roles[0].character) || '']);
      }
      found.set(it.id, { tmdb: ref, equipe: { real: [...new Set(real)], avec } });
      if (++done % 25 === 0) console.log(`  ${done} titres…`);
    } catch (e) { missing.push(`${it.title} (${it.year}) : ${e.message}`); }
  });
  for (const [it] of items) if (found.has(it.id)) Object.assign(it, found.get(it.id));

  // 2. les fiches des personnes
  const ids = new Set();
  for (const [it] of items) if (it.equipe) { it.equipe.real.forEach(i => ids.add(i)); it.equipe.avec.forEach(([i]) => ids.add(i)); }
  const todo = [...ids].filter(i => ALL || FICHES || !gens[i] || NON_LATIN.test(gens[i].nom));   // un nom non latin : on retente
  console.log(`${found.size} titres lus ; ${ids.size} personnes, dont ${todo.length} à chercher.`);
  let n = 0, photos = 0;
  await pool(todo, 6, async (pid) => {
    try {
      const p = await api(`/person/${pid}`, { language: 'fr-FR', append_to_response: 'translations' });
      const tr = (p.translations && p.translations.translations) || [];
      const bioOf = l => ((tr.find(t => t.iso_639_1 === l && t.data && t.data.biography) || {}).data || {}).biography || '';
      // le nom en alphabet latin (TMDB donne parfois celui de la langue d'origine : 中島哲也, Ειρήνη Παππά…)
      const latin = n => n && !NON_LATIN.test(n);
      const nom = [p.name, ...['fr', 'en'].map(l => ((tr.find(t => t.iso_639_1 === l && t.data && t.data.name) || {}).data || {}).name), ...(p.also_known_as || [])].find(latin) || p.name;
      const g = { nom, g: p.gender || 0, metier: p.known_for_department || '', ne: p.birthday || null, mort: p.deathday || null,
        lieu: lieuFr(p.place_of_birth), photo: null, bio: bioClean(p.biography || bioOf('fr') || bioOf('en')) };
      // la photo
      const out = path.join(PH, pid + '.webp');
      if (p.profile_path) {
        if (!fs.existsSync(out) || ALL) {
          const r = await fetch('https://image.tmdb.org/t/p/h632' + p.profile_path);
          if (r.ok) {
            const raw = path.join(tmp, pid + path.extname(p.profile_path));
            fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
            execFileSync('cwebp', ['-quiet', '-q', '80', '-resize', '400', '0', raw, '-o', out], { stdio: 'ignore' });
            execFileSync('cwebp', ['-quiet', '-q', '74', '-resize', '180', '0', raw, '-o', path.join(PH_MIN, pid + '.webp')], { stdio: 'ignore' });
            fs.unlinkSync(raw); photos++;
          }
        }
        if (fs.existsSync(out)) g.photo = `personnes/${pid}.webp`;
      }
      gens[pid] = g;
      if (++n % 100 === 0) console.log(`  ${n} personnes…`);
    } catch (e) { missing.push(`personne ${pid} : ${e.message}`); }
  });

  for (const g of Object.values(gens)) { g.lieu = lieuFr(g.lieu); g.bio = bioClean(g.bio); }   // (sans effet sur ce qui est déjà propre)

  // les personnes qui ne figurent plus dans aucun titre s'en vont, avec leurs photos
  for (const pid of Object.keys(gens)) if (!ids.has(+pid)) {
    delete gens[pid];
    for (const f of [path.join(PH, pid + '.webp'), path.join(PH_MIN, pid + '.webp')]) fs.rmSync(f, { force: true });
  }

  // 3. écriture : on relit le catalogue (il a pu changer entre-temps) et on n'y pose que nos champs
  const fresh = JSON.parse(fs.readFileSync(CAT, 'utf8'));
  for (const list of ['films', 'series']) for (const it of fresh[list] || []) if (found.has(it.id)) Object.assign(it, found.get(it.id));
  writeJson(CAT, fresh, 1);
  writeJson(PEOPLE, people);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${Object.keys(gens).length} personnes en tout, ${photos} photos ajoutées.` + (missing.length ? `\nProblèmes (${missing.length}) :\n  ` + missing.join('\n  ') : ''));
})();
