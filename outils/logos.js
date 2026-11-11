#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   Va chercher le logo (le titre dessiné) de chaque film et série du catalogue,
   sur TMDB — la base d'images que des sites comme Movix affichent.

     TMDB_KEY=ta_clé node outils/logos.js          (seulement ceux qui n'en ont pas)
     TMDB_KEY=ta_clé node outils/logos.js --tout   (tout refaire)

   La clé est gratuite : themoviedb.org › Paramètres › API (clé v3 ou jeton v4).

   Choix du logo : celui de la VO quand elle s'écrit en alphabet latin ; sinon
   l'anglais (pour coller au titre affiché sur le site), puis la VO, puis un logo
   sans langue. Parmi eux, le mieux noté, de préférence large et lisible.
   Le logo est allégé en WebP (900 px de large au plus, transparence gardée),
   rangé dans images/ sous « <Titre>-logo.webp », et noté dans catalogue.json
   (champ "logo"). Les titres introuvables sont listés à la fin.
   ══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process'), os = require('os');
const ROOT = path.join(__dirname, '..'), CAT = path.join(ROOT, 'catalogue.json'), IMG = path.join(ROOT, 'images');
const { api, find, need } = require('./tmdb');
const ALL = process.argv.includes('--tout');
need('logos.js');
const LATIN = new Set(['en', 'fr', 'it', 'es', 'de', 'pt', 'nl', 'sv', 'da', 'no', 'nb', 'fi', 'pl', 'cs', 'hu', 'ro', 'tr', 'ca', 'is', 'et', 'lv', 'lt', 'sk', 'sl', 'hr', 'id', 'ms', 'tl', 'vi']);

// le meilleur logo : la bonne langue, puis la note, puis un format large et lisible
function pick(logos, orig) {
  const order = LATIN.has(orig) ? [orig, 'en', null] : ['en', orig, null];
  for (const lang of order) {
    const list = logos.filter(l => (l.iso_639_1 || null) === lang && l.aspect_ratio > 1.2 && l.width >= 300);
    if (!list.length) continue;
    return list.sort((a, b) => (b.vote_average - a.vote_average) || (b.vote_count - a.vote_count) || (b.width - a.width))[0];
  }
  return logos.filter(l => l.aspect_ratio > 1.2).sort((a, b) => b.vote_average - a.vote_average)[0] || null;
}

(async () => {
  const cat = JSON.parse(fs.readFileSync(CAT, 'utf8'));
  const items = [...(cat.films || []).map(it => [it, it.section === 'series' ? 'tv' : 'movie']), ...(cat.series || []).map(it => [it, 'tv'])];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mpf-logo-'));
  let ok = 0; const missing = [];
  for (let [it, kind] of items) {
    if (it.logo && !ALL && fs.existsSync(path.join(IMG, it.logo))) continue;
    try {
      if (it.tmdb) kind = it.tmdb.split('/')[0];                    // déjà retrouvé (outils/personnes.js) : on s'y fie
      const hit = it.tmdb ? { id: it.tmdb.split('/')[1] } : await find(it, kind);
      if (!hit) { missing.push(`${it.title} (${it.year}) : introuvable sur TMDB`); continue; }
      const det = await api(`/${kind}/${hit.id}`);
      const orig = det.original_language || hit.original_language || 'en';
      const imgs = await api(`/${kind}/${hit.id}/images`, { include_image_language: [orig, 'en', 'null'].join(',') });
      let logo = pick(imgs.logos || [], orig);
      if (!logo) { const all = (await api(`/${kind}/${hit.id}/images`)).logos || []; logo = pick(all.filter(l => l.iso_639_1 === 'fr'), 'fr'); }   // sinon le français (la langue du site), rien d'autre
      if (!logo) { missing.push(`${it.title} (${it.year}) : pas de logo sur TMDB`); continue; }
      const r = await fetch('https://image.tmdb.org/t/p/original' + logo.file_path);
      if (!r.ok) throw new Error('téléchargement ' + r.status);
      const ext = path.extname(logo.file_path).toLowerCase() || '.png', raw = path.join(tmp, 'logo' + ext);
      fs.writeFileSync(raw, Buffer.from(await r.arrayBuffer()));
      const name = `${it.title.replace(/[\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim()}-logo.webp`, out = path.join(IMG, name);
      // en WebP, 900 px de large au plus, transparence gardée
      let src = raw;
      if (ext === '.svg') { src = path.join(tmp, 'logo.png'); execFileSync('sips', ['-s', 'format', 'png', '--resampleWidth', '900', raw, '--out', src], { stdio: 'ignore' }); }
      execFileSync('cwebp', ['-quiet', '-q', '90', '-alpha_q', '100', ...(logo.width > 900 ? ['-resize', '900', '0'] : []), src, '-o', out], { stdio: 'ignore' });
      it.logo = name; ok++;
      console.log(`✓ ${it.title} — logo ${logo.iso_639_1 || 'sans langue'} (VO : ${orig})`);
    } catch (e) { missing.push(`${it.title} (${it.year}) : ${e.message}`); }
  }
  fs.writeFileSync(CAT + '.tmp', JSON.stringify(cat, null, 1)); fs.renameSync(CAT + '.tmp', CAT);
  console.log(`\n${ok} logos ajoutés.` + (missing.length ? `\nSans logo (${missing.length}) :\n  ` + missing.join('\n  ') : ''));
})();
