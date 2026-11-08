/* =========================================================
   Intro de Messi por favor
   La taupe sort de son trou, chauffe, explose en popcorn,
   puis l'intro s'efface en fondu sur le site.
   - se joue à l'ouverture du site (une fois par onglet)
   - se relance : clic sur le visage du menu depuis l'accueil, ou « Rejouer l'intro » dans ⌘K
   - un clic ou une touche la passe
   - rien si « Réduire les animations » est activé sur le Mac
   - aucune bibliothèque, aucune ressource internet
   Chaque élément suit une fonction f(t) (t en ms), échantillonnée
   à 60 images/s puis confiée au navigateur (Web Animations API).
   Les grains de popcorn viennent de /js/pop-styles.js (style « boule »).
   ========================================================= */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const W = '#fff', K = '#000';
  const POP_STYLE = 'boule';
  let playing = false;

  function play() {
  if (playing || !Element.prototype.animate || !document.body) return;
  playing = true;

  /* ---------- la scène ---------- */
  const css = document.createElement('style');
  css.textContent = '#intro{position:fixed;inset:0;z-index:9999;background:#000;display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-user-select:none;user-select:none}'
    + '#intro-stage{width:min(15vh,26vw);height:auto;display:block;overflow:visible}#intro-stage *{transform-box:view-box}'
    + '#intro-fx{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;overflow:visible;z-index:10000}'
    + 'html.intro-on,html.intro-on body{overflow:hidden}';
  document.head.appendChild(css);
  const ov = document.createElement('div');
  ov.id = 'intro'; ov.setAttribute('aria-hidden', 'true');
  const ARC = 'M60,326 A140,24 0 0 0 340,326 A140,24 0 0 0 60,326';
  const BODY = 'M84,440 L88,216 C88,154.1 138.1,104 200,104 C261.9,104 312,154.1 312,216 L316,440';
  ov.innerHTML = `<svg id="intro-stage" viewBox="0 60 400 330">
    <defs>
      <clipPath id="i-above"><path d="M-2000,-3000 H2400 V326 H340 A140,24 0 0 1 60,326 H-2000 Z"/></clipPath>
      <clipPath id="i-top"><rect x="-60" y="-60" width="520" height="386.6"/></clipPath>
      <clipPath id="i-bot"><rect x="-60" y="325.4" width="520" height="200"/></clipPath>
      <clipPath id="i-gap"><rect x="-60" y="329" width="520" height="200"/></clipPath>
    </defs>
    <g id="i-ringB"><g clip-path="url(#i-top)"><path class="i-draw" d="${ARC}" pathLength="1" fill="none" stroke="${W}" stroke-width="12" stroke-linecap="round"/></g></g>
    <g clip-path="url(#i-above)"><g id="i-mole"><g id="i-squash">
      <path id="i-halo" d="${BODY}" fill="none" stroke="${K}" stroke-width="28" stroke-linejoin="round"/>
      <path id="i-body" d="${BODY} Z" fill="${K}" stroke="${W}" stroke-width="12" stroke-linejoin="round"/>
      <g id="i-hair"><path d="M195,98 C194,93 191,89 187,86 M205,98 C206,93 209,89 213,86" fill="none" stroke="${W}" stroke-width="10" stroke-linecap="round"/></g>
      <g id="i-glasses"><g fill="none" stroke="${W}" stroke-width="14"><circle cx="156" cy="194" r="34"/><circle cx="244" cy="194" r="34"/></g><rect x="186" y="188" width="28" height="12" rx="3" fill="${W}"/></g>
      <g id="i-rest"><ellipse cx="200" cy="246" rx="25" ry="16" fill="${W}"/>
        <g id="i-wl" stroke="${W}" stroke-width="5" stroke-linecap="round"><path d="M166,248 L110,241 M166,259 L112,265"/></g>
        <g id="i-wr" stroke="${W}" stroke-width="5" stroke-linecap="round"><path d="M234,248 L290,241 M234,259 L288,265"/></g></g>
    </g></g></g>
    <g id="i-ringF">
      <g clip-path="url(#i-gap)"><path class="i-draw" d="${ARC}" pathLength="1" fill="none" stroke="${K}" stroke-width="26" stroke-linecap="round"/></g>
      <g clip-path="url(#i-bot)"><path class="i-draw" d="${ARC}" pathLength="1" fill="none" stroke="${W}" stroke-width="12" stroke-linecap="round"/></g>
    </g>
    <g id="i-clods"></g>
  </svg><svg id="intro-fx"></svg>`;
  document.body.appendChild(ov);
  document.documentElement.classList.add('intro-on');
  const $ = (id) => document.getElementById(id);
  const el = (tag, a, p) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); if (p) p.appendChild(e); return e; };
  const rng = (seed) => { let x = (seed * 9301 + 49297) % 233280; return () => { x = (x * 9301 + 49297) % 233280; return x / 233280; }; };

  /* ---------- outils de mouvement ---------- */
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, k) => a + (b - a) * k;
  const prog = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
  const E = {
    inOutCubic: (k) => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2,
    outCubic: (k) => 1 - Math.pow(1 - k, 3),
    inOutQuint: (k) => k < .5 ? 16 * k ** 5 : 1 - Math.pow(-2 * k + 2, 5) / 2,
    inOutSine: (k) => -(Math.cos(Math.PI * k) - 1) / 2,
    outBack: (k, s = 1.4) => 1 + (s + 1) * Math.pow(k - 1, 3) + s * Math.pow(k - 1, 2),
  };
  function spring(t, from, to, f, zeta, v0) {
    const w0 = 2 * Math.PI * f, s = t / 1000, x0 = from - to, wd = w0 * Math.sqrt(1 - zeta * zeta);
    return to + Math.exp(-zeta * w0 * s) * (x0 * Math.cos(wd * s) + (v0 + zeta * w0 * x0) / wd * Math.sin(wd * s));
  }
  const wob = (t, t0, amp, hz, tau) => t < t0 ? 0 : amp * Math.exp(-(t - t0) / tau) * Math.sin(2 * Math.PI * hz * (t - t0) / 1000);

  /* ---------- chronologie (ms) ---------- */
  const T = { draw: [180, 1020], shake: 1040, peek: [1280, 1520], dip: [1520, 1700], pop: 1700, twitch: 2120, heat: 2700, burst: 3100 };
  const FADE = [T.burst + 500, T.burst + 850];
  const TOTAL = T.burst + 1350;   // les derniers grains finissent leur vol au-dessus du site
  function moleY(t) {
    if (t < T.peek[0]) return 300;
    if (t < T.peek[1]) return lerp(300, 232, E.outCubic(prog(t, ...T.peek)));
    if (t < T.dip[1]) return lerp(232, 252, E.inOutSine(prog(t, ...T.dip)));
    return spring(t - T.pop, 252, 0, 2.05, .46, -1150);
  }
  const moleV = (t) => (moleY(t + 4) - moleY(t - 4)) / 8 * 1000;

  const anims = [];
  function track(node, fn) {
    const frames = [];
    for (let t = 0; t <= TOTAL + .1; t += 1000 / 60) frames.push(fn(t));
    anims.push(node.animate(frames, { duration: TOTAL, fill: 'both', easing: 'linear' }));
  }
  const origin = (node, x, y) => { node.style.transformOrigin = `${x}px ${y}px`; };

  /* le trou se dessine, le sol tremble */
  document.querySelectorAll('#intro .i-draw').forEach((p) => {
    p.style.strokeDasharray = '1 2';
    track(p, (t) => ({ strokeDashoffset: 1 - E.inOutQuint(prog(t, ...T.draw)), opacity: t < T.draw[0] ? 0 : 1 }));
  });
  for (const id of ['i-ringB', 'i-ringF']) track($(id), (t) => ({ transform: `translate(${wob(t, T.shake, 2.6, 26, 110) + wob(t, T.dip[0] + 40, 1.2, 30, 70)}px,0)` }));
  /* la taupe sort, s'étire avec la vitesse, chauffe et gonfle avant d'exploser */
  track($('i-mole'), (t) => ({ transform: `translate(0px,${moleY(t)}px)` }));
  origin($('i-squash'), 200, 330);
  track($('i-squash'), (t) => {
    const sy = 1 + clamp(-moleV(t) * .000075, -.07, .1);
    let tx = 0, sw = 1;
    if (t >= T.heat && t < T.burst) { const k = prog(t, T.heat, T.burst); tx = 2.6 * k * k * Math.sin(2 * Math.PI * 34 * t / 1000); sw = 1 + .045 * k * k; }
    return { transform: `translate(${tx}px,0px) scale(${sw / Math.sqrt(sy)},${sw * sy})` };
  });
  for (const id of ['i-body', 'i-halo', 'i-rest']) track($(id), (t) => ({ opacity: t < T.burst ? 1 : 0 }));
  origin($('i-hair'), 200, 99);
  track($('i-hair'), (t) => ({ opacity: t < T.burst ? 1 : 0, transform: `rotate(${wob(t, T.peek[0] + 60, 13, 4.4, 230) + wob(t, T.pop + 90, 17, 3.7, 270)}deg) scale(1,${1 + wob(t, T.pop + 40, .28, 3.2, 190)})` }));
  /* les lunettes suivent avec un temps de retard, puis tombent dans le trou */
  origin($('i-glasses'), 200, 194);
  track($('i-glasses'), (t) => {
    let y = wob(t, T.pop + 60, 9, 3.4, 190), r = 0;
    if (t >= T.burst) { const s = (t - T.burst) / 1000; y += -260 * s + 2600 * s * s; r = 70 * s; }
    return { transform: `translate(0px,${y}px) rotate(${r}deg)` };
  });
  origin($('i-wl'), 166, 252); origin($('i-wr'), 234, 252);
  const whisk = (t) => wob(t, T.pop + 60, 7, 3, 200) + wob(t, T.twitch, 8, 9, 150);
  track($('i-wl'), (t) => ({ transform: `rotate(${whisk(t)}deg)` }));
  track($('i-wr'), (t) => ({ transform: `rotate(${-whisk(t)}deg)` }));

  /* la terre qui vole quand elle sort */
  const blob = (r, seed) => {
    const R = rng(seed), n = 7, pts = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + R() * .5, rr = r * (.78 + R() * .4); pts.push([Math.cos(a) * rr, Math.sin(a) * rr * .8]); }
    let d = `M${(pts[0][0] + pts[1][0]) / 2},${(pts[0][1] + pts[1][1]) / 2}`;
    for (let i = 1; i <= n; i++) { const p = pts[i % n], q = pts[(i + 1) % n]; d += ` Q${p[0]},${p[1]} ${(p[0] + q[0]) / 2},${(p[1] + q[1]) / 2}`; }
    return d + 'Z';
  };
  [[100, 318, 26, 344, 11, 76, 1765, 570, -170, 3], [104, 320, 58, 368, 7.5, 52, 1795, 500, 130, 7], [112, 321, 104, 378, 4.5, 32, 1820, 420, -90, 11], [108, 320, 10, 366, 3.5, 60, 1850, 560, 60, 13],
   [300, 318, 372, 341, 10, 72, 1775, 570, 160, 5], [296, 320, 344, 366, 6.5, 48, 1805, 480, -110, 9], [290, 321, 304, 379, 4, 28, 1835, 400, 80, 17], [294, 320, 392, 362, 3, 56, 1860, 540, -70, 19]]
    .forEach(([x0, y0, x1, y1, r, h, t0, D, spin, seed]) => {
      const g = el('g', {}, $('i-clods')), s = el('g', {}, g);
      el('path', { d: blob(r, seed), fill: W }, s);
      track(g, (t) => {
        if (t < t0) return { transform: `translate(${x0}px,${y0}px) rotate(0deg) scale(0)`, opacity: 0 };
        const k = clamp((t - t0) / D, 0, 1);
        return { transform: `translate(${lerp(x0, x1, k)}px,${lerp(y0, y1, k) - h * 4 * k * (1 - k)}px) rotate(${spin * k}deg) scale(${E.outCubic(clamp((t - t0) / 90, 0, 1))})`, opacity: 1 };
      });
      track(s, (t) => { const tl = t - (t0 + D); if (tl < 0) return { transform: 'scale(1,1)' }; const q = Math.exp(-tl / 75) * Math.cos(2 * Math.PI * 7 * tl / 1000); return { transform: `scale(${1 + .3 * q},${1 - .38 * q})` }; });
    });
  for (let i = 0; i < 12; i++) {
    const side = i % 2 ? 1 : -1, k = (i >> 1) / 5, x0 = 200 + side * (40 + k * 85), y0 = 330 + 6 * (1 - k);
    const dx = side * (18 + k * 34), dy = -(26 + (1 - k) * 34 + (i % 3) * 8), t0 = 1720 + (i % 4) * 14, D = 360 + (i % 3) * 70;
    const c = el('circle', { cx: 0, cy: 0, r: 1.6 + (i % 3) * .6, fill: W }, $('i-clods'));
    track(c, (t) => {
      const q = clamp((t - t0) / D, 0, 1);
      if (t < t0 || q >= 1) return { transform: `translate(${x0}px,${y0}px) scale(0)`, opacity: 0 };
      const e = E.outCubic(q);
      return { transform: `translate(${x0 + dx * e}px,${y0 + dy * e + 30 * q * q}px) scale(${1 - .5 * q})`, opacity: 1 - q * q };
    });
  }

  /* l'explosion : la taupe part en grains de popcorn qui volent vers l'écran */
  const st = $('intro-stage').getBoundingClientRect(), s = st.width / 400;
  const P = (x, y) => [st.left + x * s, st.top + (y - 60) * s];
  const fx = $('intro-fx'); fx.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
  const R = rng(11), [cx, cy] = P(200, 200);
  if (window.popcorn) {
    for (let i = 0; i < 40; i++) {
      let x, y; do { x = 92 + R() * 216; y = 108 + R() * 210; } while (y < 216 && Math.hypot(x - 200, y - 216) > 108);
      const [px, py] = P(x, y), dx = px - cx, dy = py - cy, dl = Math.hypot(dx, dy) || 1, sp = 700 + R() * 1300;
      const vx = dx / dl * sp + (R() - .5) * 200, vy = dy / dl * sp - 300 - R() * 400;
      const r = (9 + R() * 10) * s * 2, z = R() < .35 ? 1.5 + R() * 3 : R() * .6, rot = (R() - .5) * 1000;
      const g = window.popcorn(fx, r, 800 + i, POP_STYLE);
      track(g, (t) => {
        if (t < T.burst) return { transform: `translate(${px}px,${py}px) scale(0)`, opacity: 0 };
        const u = (t - T.burst) / 1000;
        return { transform: `translate(${px + vx * u}px,${py + vy * u + 1300 * u * u}px) rotate(${rot * u}deg) scale(${E.outBack(clamp(u * 9, 0, 1), 2) * (1 + z * u * 1.6)})`, opacity: 1 - prog(t, T.burst + 900, T.burst + 1300) };
      });
    }
  }
  /* fondu sur le site */
  track($('intro-stage'), (t) => ({ opacity: 1 - E.inOutCubic(prog(t, ...FADE)) }));
  track(ov, (t) => ({ backgroundColor: `rgba(0,0,0,${1 - E.inOutCubic(prog(t, ...FADE))})` }));

  /* fin : on retire tout */
  let done = false;
  function end() {
    if (done) return; done = true;
    ov.remove(); css.remove(); document.documentElement.classList.remove('intro-on');
    playing = false;
    removeEventListener('keydown', skip, true);
  }
  function skip(e) { if (e && e.type === 'keydown' && e.key === 'Tab') return; anims.forEach((a) => a.finish()); end(); }
  anims[0].finished.then(end, end);
  ov.addEventListener('pointerdown', skip);
  addEventListener('keydown', skip, true);
  setTimeout(end, TOTAL + 1500); // filet de sécurité
  }

  /* relancer l'intro : window.mpfIntro() (utilisé par la recherche rapide ⌘K),
     ou un clic sur le visage du menu quand on est déjà sur l'accueil */
  window.mpfIntro = play;
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a.logo');
    if (!a || location.pathname !== '/' || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault(); e.stopImmediatePropagation();
    scrollTo(0, 0); play();
  }, true);

  /* à l'ouverture du site : une fois par onglet, sauf si « Réduire les animations » */
  let seen = false;
  try { seen = !!sessionStorage.getItem('mpf-intro'); sessionStorage.setItem('mpf-intro', '1'); } catch (e) { /* stockage indisponible : on joue quand même */ }
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!seen && !reduce) play();
})();
