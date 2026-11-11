/* ══════════════════════════════════════════════════════════════════════════
   WATCHIT — l'arrivée sur le site
   La pile de cartes du logo, en blanc : les cartes se posent l'une sur l'autre,
   la carte de devant en dernier, le temps du chargement.
   Une fois par onglet. app.js appelle mpfPret() quand l'accueil est prêt :
   l'écran s'efface alors (au plus tôt 1,5 s après l'arrivée).
   Rien ne bouge si « réduire les animations » est activé.
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  let seen = false;
  try { seen = !!sessionStorage.getItem('mpf-arrivee'); sessionStorage.setItem('mpf-arrivee', '1'); } catch (e) { /* stockage indisponible : on la joue */ }
  if (seen) { window.mpfPret = () => {}; return; }
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Une carte vue en perspective : quadrilatère aux coins arrondis (même dessin que le logo)
  const card = (P, r = 38) => {
    const n = P.length, o = P.map((p1, i) => {
      const p0 = P[(i - 1 + n) % n], p2 = P[(i + 1) % n];
      const d1 = Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), d2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
      const k1 = Math.min(r, d1 / 2) / d1, k2 = Math.min(r, d2 / 2) / d2;
      return { a: [p1[0] + (p0[0] - p1[0]) * k1, p1[1] + (p0[1] - p1[1]) * k1], c: p1, b: [p1[0] + (p2[0] - p1[0]) * k2, p1[1] + (p2[1] - p1[1]) * k2] };
    });
    let d = `M${o[0].b}`;
    for (let i = 1; i <= n; i++) { const q = o[i % n]; d += `L${q.a}Q${q.c} ${q.b}`; }
    return d + 'Z';
  };
  const B2 = card([[483, 372], [680, 360], [680, 664], [483, 652]]);
  const B1 = card([[426, 348], [632, 330], [632, 694], [426, 676]]);
  const F = card([[338, 322], [570, 290], [570, 734], [338, 702]]);
  // trois cartes blanches, comme le logo du site : celles de derrière en blanc transparent
  const svg = `<svg viewBox="318 268 386 488" xmlns="http://www.w3.org/2000/svg">
    <g class="ar-c ar-b2"><path d="${B2}" fill="#fff" fill-opacity=".28"/></g>
    <g class="ar-c ar-b1"><path d="${B1}" fill="#fff" fill-opacity=".52"/></g>
    <g class="ar-c ar-f"><path d="${F}" fill="#fff"/></g>
  </svg>`;

  const el = document.createElement('div');
  el.className = 'arrivee'; el.setAttribute('aria-hidden', 'true');
  el.innerHTML = `<div class="ar-st">${svg}</div>`;
  document.body.prepend(el);
  const t0 = performance.now();
  // les cartes se posent l'une sur l'autre, la plus lointaine d'abord
  if (!calm && el.animate) {
    [['.ar-b2', 0], ['.ar-b1', 140], ['.ar-f', 280]].forEach(([s, delay]) => el.querySelector(s).animate(
      [{ opacity: 0, transform: 'translate(150px, 0) scale(.84)' }, { opacity: 1, transform: 'none' }],
      { duration: 780, delay, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
  }
  let gone = false;
  const leave = () => {
    if (gone) return; gone = true;
    setTimeout(() => {
      el.classList.add('out');
      window.dispatchEvent(new Event('mpf-arrivee-out')); // le ticket d'entrée (js/ticket.js) peut apparaître
      setTimeout(() => el.remove(), 650);
    }, calm ? 0 : Math.max(0, 1500 - (performance.now() - t0)));
  };
  window.mpfPret = leave;
  setTimeout(leave, 6000); // filet de sécurité si l'accueil ne se charge pas
})();
