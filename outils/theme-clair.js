#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════════
   Fabrique css/clair.css, le thème clair du site, à partir de css/style.css.
   À relancer après chaque changement de style.css :  node outils/theme-clair.js

   Pour chaque règle qui contient des gris (noirs, blancs, gris en dur), on écrit
   la même règle sous :root[data-theme="light"] avec les gris inversés vers des
   tons papier chauds. Les couleurs vives (or, vert, teintes des films) restent ;
   les ombres restent des ombres, plus douces. Le lecteur vidéo, l'écran du
   ticket et l'arrivée ne sont pas touchés.
   La partie écrite à la main (en haut de clair.css, avant le repère) est gardée.
   ══════════════════════════════════════════════════════════════════════════ */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'css/style.css'), OUT = path.join(ROOT, 'css/clair.css');
const MARK = '/* ═══ À partir d\'ici : généré par outils/theme-clair.js, ne pas modifier à la main ═══ */';
const PAPER = [246, 245, 241], INK = [20, 20, 23];
const SKIP_SECTION = /LECTEUR|EN-TÊTE/;                               // le lecteur et la barre de navigation restent sombres
const SKIP_SELECTOR = new RegExp([
  /\.tk-|\.arrivee|\.ar-st|\.set-theme|^:root|\.hd-|\.nav\b|\.header|\.title-logo|\.vx|\.set-vx/.source,   // ticket, arrivée, aperçus du réglage, barre, logos des films (réglés à la main)
  // ce qui est une image garde son voile sombre et son texte blanc : l'écran de l'accueil, les vignettes, les tranches des collections, les cartes des réalisateurs
  /\.hero\b(?!-next)|\.detail::after|\.cp \.(im::before|badge|num)|\.prog\b|\.cl\b|\.cs\b|\.cs-|\.pk-(d|t|po|av)\b|\.ep-(thumb|play)/.source,
  // les barres de boutons restent en verre fumé, comme la barre de navigation (couleurs dans la partie écrite à la main)
  /\.cat-(board|years|fh|gh|per|all|frise|bars|range|h\b|dec|genres|grail|gt|bar|seg|act|pill|clear|sep|n\b|sort|switch)|\.seg-ind|\.pk-q|\.set-pills|\.seasons/.source,
].join('|'));
const PREFIX = ':root[data-theme="light"]';

const css = fs.readFileSync(SRC, 'utf8');

// ─── lecture de la feuille de style (règles, @media, sections) ──────────────
function parse(text) {
  const rules = []; let i = 0, section = '';
  const skipSpace = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); const c = text.slice(i, e); if (c.includes('══')) section = c; i = e + 2; continue; }
      return;
    }
  };
  const blockEnd = from => { let d = 0, q = null; for (let k = from; k < text.length; k++) {
    const ch = text[k];
    if (!q && text.startsWith('/*', k)) { k = text.indexOf('*/', k + 2) + 1; continue; }   // les commentaires (et leurs apostrophes) ne comptent pas
    if (q) { if (ch === q && text[k - 1] !== '\\') q = null; continue; }
    if (ch === '"' || ch === "'") q = ch; else if (ch === '{') d++; else if (ch === '}') { if (d === 0) return k; d--; } } return text.length; };
  function block(media) {
    for (;;) {
      skipSpace();
      if (i >= text.length) return;
      if (text[i] === '}') { i++; return; }
      let j = i; while (j < text.length && text[j] !== '{' && text[j] !== ';') j++;
      const prelude = text.slice(i, j).trim();
      if (text[j] === ';') { i = j + 1; continue; }      // @import, @charset…
      i = j + 1;
      if (/^@(media|supports)/.test(prelude)) { block(media ? `${media} and ${prelude.replace(/^@media\s*/, '')}` : prelude); continue; }
      const end = blockEnd(i);
      if (!prelude.startsWith('@')) rules.push({ sel: prelude, body: text.slice(i, end), media, section });
      i = end + 1;
    }
  }
  block('');
  return rules;
}
const splitTop = (s, sep) => { const out = []; let d = 0, q = null, last = 0;
  for (let k = 0; k < s.length; k++) { const ch = s[k];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch; else if (ch === '(') d++; else if (ch === ')') d--;
    else if (ch === sep && d === 0) { out.push(s.slice(last, k)); last = k + 1; } }
  out.push(s.slice(last)); return out; };

// ─── les couleurs ───────────────────────────────────────────────────────────
const hex = h => { h = h.slice(1); if (h.length <= 4) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(k => parseInt(h.slice(k, k + 2), 16)).concat(h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1); };
const fmt = (r, g, b, a) => a >= 1 ? '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${+a.toFixed(3)})`;
function convert(r, g, b, a, shadow) {
  if (Math.max(r, g, b) - Math.min(r, g, b) > 28) return null;   // une vraie couleur : on la garde
  const t = (r + g + b) / 765;                                     // 0 = noir … 1 = blanc
  if (shadow) return t < .5 ? [52, 40, 30, a * .42] : [...INK, a];  // ombre plus douce ; liseré clair → liseré sombre
  return [0, 1, 2].map(k => PAPER[k] + (INK[k] - PAPER[k]) * t).concat(a);
}
function convValue(prop, value) {
  const shadow = /shadow/.test(prop) || (/filter/.test(prop) && /drop-shadow/.test(value));
  let changed = false;
  const v = value.replace(/#[0-9a-fA-F]{3,8}\b|rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/g, (m, r, g, b, a) => {
    const c = m[0] === '#' ? hex(m) : [+r, +g, +b, a === undefined ? 1 : +a];
    const n = convert(...c, shadow); if (!n) return m;
    changed = true; return fmt(...n);
  });
  return changed ? v : null;
}

// ─── écriture ───────────────────────────────────────────────────────────────
const prefixSel = sel => splitTop(sel, ',').map(s => s.trim()).filter(Boolean)
  .map(s => /^html\b/.test(s) ? s.replace(/^html/, 'html[data-theme="light"]') : `${PREFIX} ${s}`).join(',\n');
let out = '', n = 0;
for (const r of parse(css)) {
  if (SKIP_SECTION.test(r.section) || SKIP_SELECTOR.test(r.sel)) continue;
  const decls = [];
  for (const d of splitTop(r.body.replace(/\/\*[\s\S]*?\*\//g, ''), ';')) {
    const k = d.indexOf(':'); if (k < 0) continue;
    const prop = d.slice(0, k).trim(), value = d.slice(k + 1).trim();
    if (!prop || prop.startsWith('--') && !/#|rgb/.test(value)) continue;
    const nv = convValue(prop, value); if (nv) decls.push(`  ${prop}: ${nv};`);
  }
  if (!decls.length) continue;
  const rule = `${prefixSel(r.sel)} {\n${decls.join('\n')}\n}`;
  out += r.media ? `${r.media} {\n${rule}\n}\n` : rule + '\n'; n++;
}
const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
const manual = prev.includes(MARK) ? prev.slice(0, prev.indexOf(MARK)) : '/* Thème clair : partie écrite à la main */\n\n';
fs.writeFileSync(OUT, `${manual}${MARK}\n${out}`);
console.log(`css/clair.css : ${n} règles générées`);
