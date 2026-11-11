#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   Allège les images du site (dossier images/) et fabrique leurs miniatures.
   À relancer après l'ajout de films :  node outils/images.js
   (sips est fourni avec macOS ; cwebp sert pour les quelques images .webp)

   • Affiches (…-cover) : 1000 px de large au plus ; miniature 420 px.
   • Arrière-plans (…-backdrop) : 2560 px de large au plus ; miniature 640 px.
   • Images d'épisodes (… S01E01) : 1280 px de large au plus ; miniature 480 px.
   • Recompression JPEG soignée (qualité 82) ; l'original n'est remplacé que si
     le résultat est plus léger. Les miniatures vont dans images/min/, sous le
     même nom : les cartes du site les utilisent (js/app.js, thumbUrl).
   • Les logos (…-logo) et les icônes ne sont pas touchés.
   ══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process'), os = require('os');
const DIR = path.join(__dirname, '..', 'images'), MIN = path.join(DIR, 'min');
const RULES = { cover: { max: 1000, thumb: 420, heavy: 260e3 }, backdrop: { max: 2560, thumb: 640, heavy: 520e3 }, episode: { max: 1280, thumb: 480, heavy: 200e3 } };
const Q = 82, QT = 76;
fs.mkdirSync(MIN, { recursive: true });
// les images déjà allégées (nom → taille) : on ne recompresse jamais deux fois la même image
const DONE_FILE = path.join(MIN, 'deja-allegees.json');
const done = fs.existsSync(DONE_FILE) ? JSON.parse(fs.readFileSync(DONE_FILE, 'utf8')) : {};
const tmp = path.join(os.tmpdir(), 'mpf-img');
fs.mkdirSync(tmp, { recursive: true });

const width = f => { try { return +execFileSync('sips', ['-g', 'pixelWidth', f], { encoding: 'utf8' }).match(/pixelWidth: (\d+)/)[1]; } catch (e) { return 0; } };
const jpeg = (src, out, w, q) => execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(q), ...(w ? ['--resampleWidth', String(w)] : []), src, '--out', out], { stdio: 'ignore' });
const webp = (src, out, w, q) => execFileSync('cwebp', ['-quiet', '-q', String(q), ...(w ? ['-resize', String(w), '0'] : []), src, '-o', out], { stdio: 'ignore' });

let before = 0, after = 0, thumbs = 0, lighter = 0, n = 0;
for (const name of fs.readdirSync(DIR).sort()) {
  const m = name.match(/(?:-(cover|backdrop)| S\d+E\d+)\.(jpe?g|png|webp)$/i);
  const src = path.join(DIR, name);
  if (!m || !fs.statSync(src).isFile()) continue;
  const rule = RULES[m[1] || 'episode'], isWebp = /webp/i.test(m[2]), size = fs.statSync(src).size, w = width(src);
  before += size; n++;
  // l'original, allégé
  if (done[name] !== size && (w > rule.max || size > rule.heavy)) {
    const out = path.join(tmp, name);
    try {
      (isWebp ? webp : jpeg)(src, out, w > rule.max ? rule.max : 0, Q);
      if (fs.statSync(out).size < size) { fs.copyFileSync(out, src); lighter++; }
      fs.unlinkSync(out);
    } catch (e) { console.warn('  (passée) ' + name); }
  }
  after += fs.statSync(src).size; done[name] = fs.statSync(src).size;
  // la miniature
  const mini = path.join(MIN, name);
  if (!fs.existsSync(mini) || fs.statSync(mini).mtimeMs < fs.statSync(src).mtimeMs) {
    try { (isWebp ? webp : jpeg)(src, mini, Math.min(rule.thumb, width(src) || rule.thumb), QT); thumbs++; } catch (e) { console.warn('  (miniature passée) ' + name); }
  }
}
fs.writeFileSync(DONE_FILE, JSON.stringify(done));
const mb = b => (b / 1048576).toFixed(1) + ' Mo';
const minSize = fs.readdirSync(MIN).reduce((s, f) => s + fs.statSync(path.join(MIN, f)).size, 0);
console.log(`${n} images : ${mb(before)} → ${mb(after)} (${lighter} allégées) ; ${thumbs} miniatures faites, ${mb(minSize)} en tout dans images/min/`);
