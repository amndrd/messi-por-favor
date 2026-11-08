/* =========================================================
   Grains de popcorn — 6 styles, blanc sur noir.
   popcorn(parent, r, seed, style, clip)
     r     : rayon approximatif du grain (unités de l'élément parent)
     seed  : graine du hasard (même graine = même grain)
     style : 'nuage' | 'contour' | 'geo' | 'papillon' | 'boule' | 'minimal'
     clip  : true = seulement la silhouette (pour un masque / clipPath)
   ========================================================= */
(function () {
  const NS = 'http://www.w3.org/2000/svg';
  const BG = '#050505';
  const el = (tag, a, p) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  const rng = (seed) => { let x = (seed * 9301 + 49297) % 233280; return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; };
  const f = (n) => +n.toFixed(2);

  // les bosses d'un grain « nuage » : un centre + 4 ou 5 bosses autour
  function lobes(r, R) {
    const n = 4 + Math.floor(R() * 2), out = [[0, 0, r * .62]];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + R() * .6; out.push([Math.cos(a) * r * .5, Math.sin(a) * r * .45, r * (.42 + R() * .14)]); }
    return out;
  }
  function crease(r, R, color, w, g) {
    const a = R() * Math.PI * 2;
    el('path', { d: `M${f(Math.cos(a) * r * .55)},${f(Math.sin(a) * r * .5)} Q${f(Math.cos(a + .5) * r * .2)},${f(Math.sin(a + .5) * r * .2)} ${f(Math.cos(a + 2.2) * r * .15)},${f(Math.sin(a + 2.2) * r * .12)}`, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-linecap': 'round' }, g);
  }
  const circles = (list, g, attrs) => list.forEach(([x, y, rr]) => el('circle', Object.assign({ cx: f(x), cy: f(y), r: f(rr) }, attrs), g));

  const STYLES = {
    // 1. Nuage : bosses pleines + un pli
    nuage(g, r, R, clip) {
      const L = lobes(r, R); circles(L, g, { fill: '#fff' });
      if (!clip) crease(r, R, BG, Math.max(1.4, r * .11), g);
    },
    // 2. Contour : le même grain, dessiné au trait comme la taupe
    contour(g, r, R, clip) {
      const L = lobes(r, R), w = Math.max(1.3, r * .13);
      if (clip) return circles(L, g, { fill: '#fff' });
      circles(L, el('g', {}, g), { fill: '#fff', stroke: '#fff', 'stroke-width': w * 2 });
      circles(L, el('g', {}, g), { fill: BG });
      crease(r * .9, R, '#fff', w * .85, g);
    },
    // 3. Segments : les bosses du grain séparées par un fin trait noir (on voit chaque « pétale » éclaté)
    segments(g, r, R, clip) {
      const L = lobes(r, R);
      const ord = [[0, 0, r * .5]].concat(L.slice(1).map(([x, y, rr]) => [x * 1.08, y * 1.08, rr * .92]));
      if (clip) return circles(ord, g, { fill: '#fff' });
      circles(ord, g, { fill: '#fff', stroke: BG, 'stroke-width': Math.max(1.1, r * .085) });
    },
    // 4. Papillon : la forme réelle du popcorn, avec des « ailes » et l'enveloppe du grain
    papillon(g, r, R, clip) {
      const rot = R() * Math.PI * 2, parts = [];
      for (let i = 0; i < 3; i++) { const a = rot + i * 2.1 + (R() - .5) * .5; parts.push(['e', Math.cos(a) * r * .38, Math.sin(a) * r * .38, r * (.5 + R() * .12), r * (.34 + R() * .08), a * 180 / Math.PI]); }
      for (let i = 0; i < 4; i++) { const a = rot + 1 + i * 1.55 + R() * .4; parts.push(['c', Math.cos(a) * r * .62, Math.sin(a) * r * .55, r * (.18 + R() * .1)]); }
      parts.push(['c', 0, 0, r * .42]);
      for (const p of parts) {
        if (p[0] === 'e') el('ellipse', { cx: f(p[1]), cy: f(p[2]), rx: f(p[3]), ry: f(p[4]), transform: `rotate(${f(p[5])} ${f(p[1])} ${f(p[2])})`, fill: '#fff' }, g);
        else el('circle', { cx: f(p[1]), cy: f(p[2]), r: f(p[3]), fill: '#fff' }, g);
      }
      if (clip) return;
      const w = Math.max(1.3, r * .09);
      for (let i = 0; i < 2; i++) { const a = rot + 1.05 + i * 2.1; el('path', { d: `M${f(Math.cos(a) * r * .12)},${f(Math.sin(a) * r * .12)} Q${f(Math.cos(a + .3) * r * .32)},${f(Math.sin(a + .3) * r * .32)} ${f(Math.cos(a) * r * .55)},${f(Math.sin(a) * r * .5)}`, fill: 'none', stroke: BG, 'stroke-width': w, 'stroke-linecap': 'round' }, g); }
      const ha = rot + 3.6;
      el('ellipse', { cx: f(Math.cos(ha) * r * .5), cy: f(Math.sin(ha) * r * .45), rx: f(r * .17), ry: f(r * .1), transform: `rotate(${f(ha * 180 / Math.PI)} ${f(Math.cos(ha) * r * .5)} ${f(Math.sin(ha) * r * .45)})`, fill: BG }, g);
    },
    // 5. Boule : popcorn « champignon », bien rond, bosselé sur le dessus
    boule(g, r, R, clip) {
      const L = [[0, r * .06, r * .66]];
      for (let i = 0; i < 4; i++) { const a = -Math.PI * (.86 - i * .24) + (R() - .5) * .15; L.push([Math.cos(a) * r * .56, Math.sin(a) * r * .56, r * (.26 + R() * .06)]); }
      const rot = (R() - .5) * 60;
      const gg = el('g', { transform: `rotate(${f(rot)})` }, g);
      circles(L, gg, { fill: '#fff' });
      if (clip) return;
      const w = Math.max(1.3, r * .09);
      el('path', { d: `M${f(-r * .38)},${f(-r * .08)} Q${f(-r * .05)},${f(r * .12)} ${f(r * .32)},${f(-r * .12)}`, fill: 'none', stroke: BG, 'stroke-width': w, 'stroke-linecap': 'round' }, gg);
      el('ellipse', { cx: 0, cy: f(r * .62), rx: f(r * .2), ry: f(r * .09), fill: BG }, gg);
    },
    // 6. Minimal : une silhouette irrégulière à 3 ou 4 bosses, sans aucun détail
    minimal(g, r, R) {
      const n = 3 + Math.floor(R() * 2), rot = R() * Math.PI * 2, L = [[0, 0, r * .55]];
      for (let i = 0; i < n; i++) { const a = rot + i / n * Math.PI * 2 + (R() - .5) * .5; L.push([Math.cos(a) * r * .42, Math.sin(a) * r * .38, r * (.4 + R() * .16)]); }
      circles(L, g, { fill: '#fff' });
    },
  };


  // silhouette d'un grain en UN seul tracé (pour un clipPath, qui n'accepte pas les groupes)
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  function parseT(str) {
    let M = [1, 0, 0, 1, 0, 0];
    const re = /rotate\(([^)]+)\)/g; let m;
    while ((m = re.exec(str || ''))) {
      const [a, cx = 0, cy = 0] = m[1].split(/[ ,]+/).map(Number), c = Math.cos(a * Math.PI / 180), s = Math.sin(a * Math.PI / 180);
      M = mul(M, mul([1, 0, 0, 1, cx, cy], mul([c, s, -s, c, 0, 0], [1, 0, 0, 1, -cx, -cy])));
    }
    return M;
  }
  window.popcornSilhouette = function (r, seed, style) {
    const tmp = el('g', {});
    (STYLES[style] || STYLES.nuage)(tmp, r, rng(seed), true);
    let d = '';
    (function walk(node, M) {
      for (const ch of node.children) {
        const N = mul(M, parseT(ch.getAttribute('transform')));
        const ang = Math.atan2(N[1], N[0]) * 180 / Math.PI;
        if (ch.tagName === 'g') { walk(ch, N); continue; }
        const cx = +ch.getAttribute('cx'), cy = +ch.getAttribute('cy');
        const rx = ch.tagName === 'circle' ? +ch.getAttribute('r') : +ch.getAttribute('rx');
        const ry = ch.tagName === 'circle' ? rx : +ch.getAttribute('ry');
        const P = (x, y) => [N[0] * x + N[2] * y + N[4], N[1] * x + N[3] * y + N[5]];
        const [x1, y1] = P(cx + rx, cy), [x2, y2] = P(cx - rx, cy);
        d += `M${f(x1)},${f(y1)}A${f(rx)},${f(ry)} ${f(ang)} 1,1 ${f(x2)},${f(y2)}A${f(rx)},${f(ry)} ${f(ang)} 1,1 ${f(x1)},${f(y1)}Z`;
      }
    })(tmp, [1, 0, 0, 1, 0, 0]);
    return d;
  };
  window.POPCORN_STYLES = Object.keys(STYLES);
  window.popcorn = function (parent, r, seed, style, clip) {
    const g = el('g', {}, parent);
    (STYLES[style] || STYLES.nuage)(g, r, rng(seed), !!clip);
    return g;
  };
})();
