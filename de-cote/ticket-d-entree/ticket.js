/* ══════════════════════════════════════════════════════════════════════════
   WATCHIT — le ticket d'entrée
   À chaque ouverture du site (une fois par onglet), après la pile de cartes
   (js/arrivee.js) : un ticket de cinéma descend du haut de l'écran, suspendu
   à un cordon. On maintient le clic (ou le doigt) et on glisse de gauche à
   droite sur les pointillés : les ciseaux et les pointillés imprimés sont
   coupés avec le papier ; si on lâche, la coupe reste. Au bout, le talon se
   détache et tombe un peu. Une vague de lumière « velours » monte alors du
   bas : elle aspire le ticket, l'accueil en descend en se déformant dans
   l'autre sens, puis le texte, la barre et les cartes apparaissent.
   Touche Entrée : le ticket se coupe tout seul. Un clic sur le logo le ramène.

   Le ticket est dessiné dans une toile (canvas) : c'est cette image que la
   vague (WebGL) déforme, sans aucune différence avec ce qu'on voyait.
   Les chiffres viennent du catalogue : app.js les donne à mpfPret().
   ══════════════════════════════════════════════════════════════════════════ */
(() => {
  let seen = false;
  try { seen = !!sessionStorage.getItem('mpf-ticket'); } catch (e) { /* stockage indisponible : on le montre */ }
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let counts = null, current = null;

  // ─── LE DESSIN DU TICKET (340 × 640, ligne de coupe à 504) ─────────────────
  const W = 340, H = 640, Y = 504, N = 14, R = 14, XL = N, XR = W - N, L = XR - XL;
  const SAG = 20, SL = 10, PIVOT = -700;   // le talon pend en bandes de 10 px ; le cordon tient le ticket de très haut
  const scallops = () => {
    const sr = 4, step = 13, k = Math.floor((W - 2 * R) / step), g = (W - 2 * R) / k; let s = '';
    for (let i = 0; i < k; i++) { const cx = W - R - g * (i + .5); s += `L${(cx + sr).toFixed(2)},${H}A${sr},${sr} 0 0 0 ${(cx - sr).toFixed(2)},${H}`; }
    return s;
  };
  const P_MAIN = new Path2D(`M${R},0L${W - R},0A${R},${R} 0 0 1 ${W},${R}L${W},${Y - N}A${N},${N} 0 0 0 ${XR},${Y}L${XL},${Y}A${N},${N} 0 0 0 0,${Y - N}L0,${R}A${R},${R} 0 0 1 ${R},0ZM161,26A9,9 0 1 0 179,26A9,9 0 1 0 161,26Z`);
  const P_STUB = new Path2D(`M${XL},${Y}L${XR},${Y}A${N},${N} 0 0 0 ${W},${Y + N}L${W},${H - R}A${R},${R} 0 0 1 ${W - R},${H}${scallops()}L${R},${H}A${R},${R} 0 0 1 0,${H - R}L0,${Y + N}A${N},${N} 0 0 0 ${XL},${Y}Z`);
  const LOGO = ['M520.93,369.69L642.07,362.31Q680,360 680,398L680,626Q680,664 642.07,661.69L520.93,654.31Q483,652 483,614L483,410Q483,372 520.93,369.69Z', 'M463.86,344.69L594.14,333.31Q632,330 632,368L632,656Q632,694 594.14,690.69L463.86,679.31Q426,676 426,638L426,386Q426,348 463.86,344.69Z', 'M375.64,316.81L532.36,295.19Q570,290 570,328L570,696Q570,734 532.36,728.81L375.64,707.19Q338,702 338,664L338,360Q338,322 375.64,316.81Z'].map(d => new Path2D(d));
  const SCISSORS = ["M8.826 39.4095C3.539 40.8145 0 45.3755 0 50.2565C0 51.1185 0.11 51.9885 0.34 52.8545C1.874 58.6265 8.16 61.9665 14.382 60.3125C19.67 58.9075 23.208 54.3475 23.208 49.4655C23.208 48.6045 23.098 47.7335 22.868 46.8675C22.726 46.3345 22.544 45.8225 22.326 45.3325C21.947 44.4835 21.737 43.8835 21.737 43.4275C21.737 41.4335 25.737 42.2055 36.983 37.0475C35.265 35.9525 33.789 34.8685 32.621 33.7965C32.059 33.2795 31.525 32.7565 31.01 32.2505C30.816 32.0605 30.623 31.8715 30.43 31.6835C28.928 33.0245 27.162 34.3295 24.573 35.4845C19.849 37.5925 11.937 38.5825 8.826 39.4095ZM18.094 48.1375C18.226 48.6355 18.29 49.1375 18.29 49.6345C18.29 52.4465 16.251 55.0745 13.205 55.8845C9.621 56.8375 5.999 54.9135 5.116 51.5875C4.984 51.0885 4.92 50.5865 4.92 50.0905C4.92 47.2785 6.958 44.6505 10.005 43.8405C13.588 42.8875 17.21 44.8105 18.094 48.1375ZM90 11.1025L52.869 29.2995L41.041 23.5035C48.942 19.0675 60.471 14.3455 71.371 9.35754C79.868 5.47054 86.146 6.83554 90 11.1025Z","M0.34 7.88254C0.11 8.74754 0 9.61854 0 10.4795C0 15.3625 3.538 19.9215 8.826 21.3275C11.937 22.1545 19.848 23.1445 24.572 25.2535C29.295 27.3585 31.283 29.9615 33.919 32.3825C40.225 38.1725 56.395 44.5285 71.371 51.3795C79.868 55.2665 86.146 53.9015 90 49.6335L39.356 24.8155C26.294 18.4145 21.736 19.4365 21.736 17.3085C21.736 16.8525 21.945 16.2525 22.325 15.4035C22.544 14.9135 22.726 14.4015 22.867 13.8685C23.097 13.0035 23.207 12.1325 23.207 11.2705C23.207 6.38754 19.669 1.82854 14.381 0.422543C8.161 -1.22946 1.874 2.10954 0.34 7.88254ZM13.204 4.85354C16.251 5.66354 18.289 8.29054 18.289 11.1025C18.289 11.5985 18.226 12.1005 18.093 12.5995C17.209 15.9255 13.587 17.8495 10.003 16.8975C6.956 16.0865 4.918 13.4595 4.918 10.6475C4.918 10.1515 4.981 9.64954 5.114 9.15054C5.999 5.82454 9.62 3.90154 13.204 4.85354Z","M42.463 30.3685C42.463 31.4965 41.549 32.4105 40.421 32.4105C39.293 32.4105 38.38 31.4965 38.38 30.3685C38.38 29.2405 39.294 28.3275 40.422 28.3275C41.55 28.3275 42.463 29.2405 42.463 30.3685Z"].map(d => new Path2D(d));   // l'icône de ciseaux, en trois morceaux

  // un grain de papier, tiré une fois
  const grain = document.createElement('canvas'); grain.width = grain.height = 128;
  { const g = grain.getContext('2d'), im = g.createImageData(128, 128);
    for (let i = 0; i < im.data.length; i += 4) { im.data[i] = im.data[i + 1] = im.data[i + 2] = 128; im.data[i + 3] = Math.random() * 150; }
    g.putImageData(im, 0, 0); }
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const rrect = (g, x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const angGrad = (g, x, y, w, h, deg, stops) => {   // un dégradé CSS « linear-gradient(deg) » sur une boîte
    const a = deg * Math.PI / 180, vx = Math.sin(a), vy = -Math.cos(a), len = Math.abs(w * vx) + Math.abs(h * vy), cx = x + w / 2, cy = y + h / 2;
    const gr = g.createLinearGradient(cx - vx * len / 2, cy - vy * len / 2, cx + vx * len / 2, cy + vy * len / 2);
    stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr;
  };
  const drawLogo = (g, x, y, h, fill, alpha = 1) => {
    g.save(); g.translate(x, y); g.scale(h / 488, h / 488); g.translate(-318, -268); g.fillStyle = fill;
    LOGO.forEach((p, i) => { g.globalAlpha = alpha * [.25, .5, 1][i]; g.fill(p); }); g.restore();
  };
  const SUP_LS = 'letterSpacing' in CanvasRenderingContext2D.prototype;
let condFace = null;
try { condFace = new FontFace('MPF Archivo 62', 'url(/fonts/Archivo-var-latin.woff2)', { weight: '100 900', stretch: '62.5%' }); document.fonts.add(condFace); } catch (e) { /* tant pis : on resserrera le texte */ }
  const stretchKw = p => p < 56 ? 'ultra-condensed' : p < 69 ? 'extra-condensed' : p < 81 ? 'condensed' : p < 94 ? 'semi-condensed' : 'normal';
  // recopie une ligne de texte de la copie invisible (mêmes polices, même place)
  function drawText(g, el, root, mroot) {
    const cs = getComputedStyle(el), r = el.getBoundingClientRect(), x0 = r.left - root.left, y0 = r.top - root.top;
    let op = 1; for (let n = el; n && n !== mroot; n = n.parentElement) op *= +getComputedStyle(n).opacity;
    const st = parseFloat(cs.fontStretch) || 100, cond = st < 94 && condFace?.status === 'loaded';
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cond ? 'normal' : stretchKw(st)} ${cs.fontSize} ${cond ? "'MPF Archivo 62'" : cs.fontFamily}`;
    let txt = el.textContent; if (cs.textTransform === 'uppercase') txt = txt.toUpperCase();
    const ls = cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing) || 0;
    g.fillStyle = cs.color; g.globalAlpha = op; g.textAlign = 'left';
    const m = g.measureText(txt), fs = parseFloat(cs.fontSize);
    const asc = m.fontBoundingBoxAscent ?? fs * .92, desc = m.fontBoundingBoxDescent ?? fs * .24;
    let pb = el.querySelector('.q-bl'); if (!pb) { pb = document.createElement('span'); pb.className = 'q-bl'; el.append(pb); }
    const yb = pb.getBoundingClientRect().top - root.top, right = cs.textAlign === 'right' || cs.textAlign === 'end';
    // même largeur que dans la page (au cas où la police ne serait pas tout à fait la même)
    const rg = document.createRange(); rg.selectNodeContents(el); const wDom = rg.getBoundingClientRect().width;
    const wC = SUP_LS && ls ? (g.letterSpacing = ls + 'px', g.measureText(txt).width) : m.width; if (SUP_LS) g.letterSpacing = '0px';
    const fx = wDom > 0 && Math.abs(wC - wDom) / wDom > .03 ? wDom / wC : 1;
    if (fx !== 1) { g.save(); g.translate(right ? x0 + r.width - wDom : x0, yb); g.scale(fx, 1); if (SUP_LS) g.letterSpacing = ls + 'px'; g.fillText(txt, 0, 0); g.restore(); g.globalAlpha = 1; return; }
    if (!ls) g.fillText(txt, right ? x0 + r.width - m.width : x0, yb);
    else if (SUP_LS) { g.letterSpacing = ls + 'px'; const w = g.measureText(txt).width; g.fillText(txt, right ? x0 + r.width - w : x0, yb); g.letterSpacing = '0px'; }
    else { const ch = [...txt], ws = ch.map(c => g.measureText(c).width), w = ws.reduce((a, b) => a + b + ls, 0); let x = right ? x0 + r.width - w : x0; ch.forEach((c, i) => { g.fillText(c, x, yb); x += ws[i] + ls; }); }
    g.globalAlpha = 1;
  }
  // une ombre portée CSS (plusieurs couches) dessinée une fois dans une toile
  const SHADOWS = [[1, 1.5, 0, 'rgba(70,55,40,.22)'], [6, 12, -4, 'rgba(70,55,40,.18)'], [26, 42, -12, 'rgba(70,55,40,.3)'], [64, 96, -30, 'rgba(70,55,40,.34)']];
  const SHADOWS_DARK = [[1, 1.5, 0, 'rgba(0,0,0,.55)'], [6, 12, -4, 'rgba(0,0,0,.4)'], [26, 42, -12, 'rgba(0,0,0,.55)'], [64, 96, -30, 'rgba(0,0,0,.65)']];
  const SM = 140;
  function shadowCanvas(k, h, dark) {
    const c = canvas((W + 2 * SM) * k, (h + 2 * SM) * k), g = c.getContext('2d');
    for (const [oy, b, sp, col] of dark ? SHADOWS_DARK : SHADOWS) {
      g.save(); g.setTransform(k, 0, 0, k, 0, 0);
      g.shadowColor = col; g.shadowBlur = b * k; g.shadowOffsetX = -10000 * k; g.shadowOffsetY = oy * k; g.fillStyle = '#000';
      rrect(g, SM - sp + 10000, SM - sp, W + 2 * sp, h + 2 * sp, Math.max(0, R + sp)); g.fill(); g.restore();
    }
    return c;
  }

  // Monte un ticket (au démarrage, ou quand on clique sur le logo du site)
  const open = first => {
  if (current) return;
  const arrivee = first && !!document.querySelector('.arrivee');
  // l'écran du ticket suit le thème du site : site sombre → écran sombre, site clair → écran clair
  const lightSite = document.documentElement.dataset.theme === 'light', dark = !lightSite;
  document.documentElement.classList.add('tk-hide');   // l'accueil reste caché jusqu'à son apparition

  // Numéro (un de plus à chaque séance), rang et place au hasard, code-barres
  let no = 1;
  try { no = (+localStorage.getItem('mpf-ticket-n') || 0) + 1; localStorage.setItem('mpf-ticket-n', no); } catch (e) { /* n° 1 */ }
  const NO = String(no % 10000).padStart(4, '0');
  const RANG = 'ABCDEFGHJKLMN'[Math.floor(Math.random() * 13)], PLACE = String(1 + Math.floor(Math.random() * 24)).padStart(2, '0');
  const BARS = []; { let s = no * 7 + 3, x = 0; const r = () => (s = (s * 9301 + 49297) % 233280) / 233280;
    while (x < 196) { const b = 1 + Math.floor(r() * 3.2), g = 1 + Math.floor(r() * 2.6); if (x + b > 196) break; BARS.push([x, b]); x += b + g; } }

  // ─── LA PAGE ───────────────────────────────────────────────────────────────
  const ov = document.createElement('div');
  ov.className = 'tk-ov' + (dark ? ' dark' : '');
  ov.setAttribute('role', 'dialog'); ov.setAttribute('tabindex', '0');
  ov.setAttribute('aria-label', 'Ticket d’entrée : maintenez et glissez le long des pointillés, ou appuyez sur Entrée');
  ov.innerHTML = `<canvas class="tk-2d"></canvas>
    <div class="tk-tx"><b>Maintenez et glissez<br>le long des pointillés</b><kbd>ou appuyez sur <em>Entrée</em></kbd></div>
    <div class="tk-m" aria-hidden="true"><div class="q-in">
      <div class="q-hd"><i class="q-lg"></i></div>
      <div class="q-rows"><div><i class="q-t q-nb1">&nbsp;</i><i class="q-t q-nb2">&nbsp;</i><i class="q-t q-nb3">&nbsp;</i></div><div><i class="q-t q-dt"></i><i class="q-t q-hr"></i><i class="q-t">Salle 01 · Movie Stock</i></div></div>
      <div class="q-blk"><div class="q-holo"><i class="q-hl"></i></div><i class="q-t q-k">Accès complet</i><div class="q-big"><i class="q-t">Pass</i><i class="q-t">illimité</i></div></div>
      <div class="q-trio"><div><i class="q-t q-lb">Rang</i><i class="q-t q-vl">${RANG}</i></div><div><i class="q-t q-lb">Place</i><i class="q-t q-vl">${PLACE}</i></div><div><i class="q-t q-lb">Ticket</i><i class="q-t q-vl">N° ${NO}</i></div></div>
    </div><div class="q-stub"><div><i class="q-bar"></i><i class="q-t q-mono">MPF${new Date().getFullYear()} ${NO} 01${RANG}${PLACE}</i></div><div class="q-admit"><i class="q-t">Admit</i><i class="q-t">one</i></div></div></div>`;
  const $ = s => ov.querySelector(s);
  const dc = $('.tk-2d'), d = dc.getContext('2d'), tx = $('.tk-tx'), mEl = $('.tk-m');
  document.body.prepend(ov);

  // les infos en direct
  const pl = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const fill = c => {
    if (!c || c.films == null) return;
    $('.q-nb1').textContent = pl(c.films, 'film', 'films');
    $('.q-nb2').textContent = `${pl(c.series, 'série', 'séries')} · ${pl(c.episodes, 'épisode', 'épisodes')}`;
    $('.q-nb3').textContent = pl(c.collections, 'collection', 'collections');
    paintPieces();
  };
  let minute = '';
  const clock = () => {
    const dd = new Date(), hr = dd.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    $('.q-dt').textContent = dd.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    $('.q-hr').textContent = hr;
    if (minute && hr !== minute) paintPieces();
    minute = hr;
  };
  clock(); const tick = setInterval(clock, 10000);

  // ─── MISE EN PAGE ET IMAGES DU TICKET ──────────────────────────────────────
  // vw, vh : la taille de la page sans la barre de défilement (celle des toiles posées en plein écran)
  let s = 1, ox = 0, oy = 0, dpr = 1, k = 1, pieces = null, bg = null, narrow = false, vw = innerWidth, vh = innerHeight;
  function paintPieces() {
    if (!fontsOk) return;
    const root = mEl.getBoundingClientRect(), rel = el => { const r = el.getBoundingClientRect(); return { x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height }; };
    const out = {};
    for (const part of ['main', 'stub']) {
      const c = canvas(W * k, H * k), g = c.getContext('2d'); g.scale(k, k);
      g.save(); g.clip(part === 'main' ? P_MAIN : P_STUB, part === 'main' ? 'evenodd' : 'nonzero');
      g.fillStyle = '#FDFBF6'; g.fillRect(0, 0, W, H);
      // logo, lignes pointillées, bloc noir et bande holographique
      const lg = rel($('.q-lg')); drawLogo(g, lg.x, lg.y, lg.h, '#151515');
      const rw = rel($('.q-rows')), c1 = rel($('.q-rows > div'));
      g.save(); g.strokeStyle = 'rgba(0,0,0,.3)'; g.lineWidth = 1; g.setLineDash([3, 2]); g.beginPath();
      g.moveTo(rw.x, rw.y + .5); g.lineTo(rw.x + rw.w, rw.y + .5); g.moveTo(rw.x, rw.y + rw.h - .5); g.lineTo(rw.x + rw.w, rw.y + rw.h - .5);
      g.moveTo(c1.x + c1.w - .5, rw.y); g.lineTo(c1.x + c1.w - .5, rw.y + rw.h); g.stroke(); g.restore();
      const bk = rel($('.q-blk')); g.save(); rrect(g, bk.x, bk.y, bk.w, bk.h, 4); g.fillStyle = '#111'; g.fill(); g.clip();
      const ho = rel($('.q-holo'));
      g.fillStyle = angGrad(g, ho.x, ho.y, ho.w, ho.h, 170, [[0, '#f3a6c1'], [.22, '#d9d7e6'], [.4, '#7fa6d6'], [.56, '#c7f0e0'], [.74, '#ffd59a'], [1, '#f3a6c1']]);
      g.fillRect(ho.x, ho.y, ho.w, ho.h);
      g.save(); g.beginPath(); g.rect(ho.x, ho.y, ho.w, ho.h); g.clip(); g.globalCompositeOperation = 'overlay'; g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1;
      { const a = 115 * Math.PI / 180, vx = Math.sin(a), vy = -Math.cos(a), cx = ho.x + ho.w / 2, cy = ho.y + ho.h / 2; g.beginPath();
        for (let t = -200; t <= 200; t += 4) { const px = cx + vx * t, py = cy + vy * t; g.moveTo(px + vy * 300, py - vx * 300); g.lineTo(px - vy * 300, py + vx * 300); } g.stroke(); }
      g.restore();
      const hl = rel($('.q-hl')); drawLogo(g, hl.x, hl.y, hl.h, '#fff', .55);
      g.restore();
      for (const el of mEl.querySelectorAll('.q-t')) drawText(g, el, root, mEl);
      const br = rel($('.q-bar')); g.fillStyle = '#151515'; for (const [x, w] of BARS) g.fillRect(br.x + x, br.y, w, br.h);
      // ciseaux et pointillés imprimés : la coupe les partage entre le ticket et le talon
      g.save(); g.translate(19, Y - 6.75); g.scale(20 / 90, 20 / 90); g.fillStyle = '#151515'; SCISSORS.forEach(p => g.fill(p)); g.restore();
      g.fillStyle = 'rgba(21,21,21,.55)'; for (let x = 44; x < XR - 2; x += 11) g.fillRect(x, Y - .8, Math.min(6, XR - 2 - x), 1.6);
      // grain et lumière du papier
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = .07; g.globalCompositeOperation = 'multiply'; g.fillStyle = g.createPattern(grain, 'repeat'); g.fillRect(0, 0, c.width, c.height); g.restore();
      g.fillStyle = angGrad(g, 0, 0, W, H, 170, [[0, 'rgba(255,255,255,.35)'], [.35, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,.04)']]); g.fillRect(0, 0, W, H);
      g.restore();
      out[part] = c;
    }
    out.shMain = shadowCanvas(k, Y, dark); out.shStub = shadowCanvas(k, H - Y, dark);
    pieces = out; go();
  }
  function layout() {
    vw = document.documentElement.clientWidth || innerWidth; vh = document.documentElement.clientHeight || innerHeight;
    narrow = vw < 760;
    ov.classList.toggle('narrow', narrow);
    s = Math.min(1, (vh - (narrow ? 170 : 72)) / H, (vw - 32) / W);
    dpr = Math.min(devicePixelRatio || 1, 2); k = dpr * s;
    ox = (vw - W * s) / 2; oy = (vh - H * s) / 2 - (narrow ? 46 * s : 0);
    dc.width = Math.round(vw * dpr); dc.height = Math.round(vh * dpr);
    // le fond clair, dessiné une fois
    bg = canvas(dc.width, dc.height); const g = bg.getContext('2d');
    g.save(); g.translate(dc.width * .5, dc.height * .46); g.scale(dc.width * .6, dc.height * .72);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1); (dark ? [[0, '#2A2826'], [.6, '#181716'], [1, '#0D0D0C']] : [[0, '#ECEAE5'], [.6, '#E0DDD6'], [1, '#D3D0C8']]).forEach(([o, c]) => gr.addColorStop(o, c));
    g.fillStyle = gr; g.fillRect(-2, -2, 4, 4); g.restore();
    tx.style.left = narrow ? '50%' : `${ox - 28}px`; tx.style.top = `${narrow ? oy + (H + 30) * s : oy + Y * s}px`;
    if (gl) { gw = Math.round(vw * dpr * .6); gh = Math.round(vh * dpr * .6); cv.width = gw; cv.height = gh; tc.width = gw; tc.height = gh; }
    paintPieces(); go();
  }

  // ─── LA LUMIÈRE ET LA VAGUE (WebGL, sans bibliothèque) ──────────────────────
  const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uR; uniform float uT,uF,uGlow,uFill,uFlash,uB,uL,uMode,uHA,uHD; uniform sampler2D uS,uH;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*noise(p);p=p*2.03+vec2(1.7,9.2);a*=.5;}return s;}
vec3 pal(float t){t=clamp(t,0.,1.);
  vec3 c1=vec3(.29,.02,.07),c2=vec3(.70,.05,.19),c3=vec3(1.,.23,.23),c4=vec3(1.,.48,.23),c5=vec3(1.,.72,.42),c6=vec3(1.,.95,.86);
  if(t<.16)return c1*(t/.16); if(t<.34)return mix(c1,c2,(t-.16)/.18); if(t<.52)return mix(c2,c3,(t-.34)/.18);
  if(t<.68)return mix(c3,c4,(t-.52)/.16); if(t<.84)return mix(c4,c5,(t-.68)/.16); return mix(c5,c6,(t-.84)/.16);}
vec3 blurS(vec2 u,float br,float ch){if(br<.0004)return texture2D(uS,u).rgb;vec3 s=vec3(0.);
  for(int i=0;i<12;i++){float a=float(i)*2.39996,r=sqrt((float(i)+.5)/12.);vec2 o=vec2(cos(a),sin(a)*1.6)*r*br;
    s+=vec3(texture2D(uS,u+o+vec2(ch,0.)).r,texture2D(uS,u+o).g,texture2D(uS,u+o-vec2(ch,0.)).b);}return s/12.;}
vec3 blurH(vec2 u,float br,float ch){if(br<.0004)return texture2D(uH,u).rgb;vec3 s=vec3(0.);
  for(int i=0;i<12;i++){float a=float(i)*2.39996,r=sqrt((float(i)+.5)/12.);vec2 o=vec2(cos(a),sin(a)*1.6)*r*br;
    s+=vec3(texture2D(uH,u+o+vec2(ch,0.)).r,texture2D(uH,u+o).g,texture2D(uH,u+o-vec2(ch,0.)).b);}return s/12.;}
void main(){
  vec2 uv=gl_FragCoord.xy/uR; float x=uv.x,y=uv.y,t=uT;
  float surge=smoothstep(-.06,.25,uF)*(1.-smoothstep(1.15,1.5,uF));
  float wob=(.012*sin(x*6.+t*2.6)+.008*sin(x*11.-t*3.7)+.03*(fbm(vec2(x*2.2,t*.6))-.5))*(1.+1.6*surge);
  float yf=uF+.12*surge*(1.-pow(abs(x-.5)*2.,2.))+wob;
  float d=y-yf;
  float n=fbm(vec2(x*2.2+t*.12,y*1.6-t*.35));
  float on=smoothstep(-.06,.04,uF);
  float band=exp(-pow(d/.11,2.))*on;
  float fill=(d<0.?exp(d/.3):0.)*uFill*on;
  float low=exp(-pow(max(y,0.)/.17,1.25))*uGlow;
  float L=(band+fill+low*.85)*uFlash;
  vec3 lc=pal(.56+.44*clamp(L,0.,1.)+.1*(n-.5));
  float la=clamp(L*.95,0.,1.);
  if(uMode<.5){gl_FragColor=vec4(lc*la,la);return;}
  if(d>0.){ // devant : le ticket est soulevé et aspiré vers la vague
    float k=exp(-d/.18);
    vec3 s=blurS(uv-vec2((x-.5)*.07*k,uL+.12*k*k),uB+.012*k*k,.0025*k);
    s=mix(s,pal(.55+.3*n),k*k*.45);
    gl_FragColor=vec4(s*(1.-la)+lc*la,1.);return;
  }
  // derrière : l'accueil est aspiré vers la lumière, dans l'autre sens, puis se relâche
  float k2=exp(d/.26)*uHD;
  vec3 h=blurH(uv-vec2((x-.5)*.12*k2,.24*k2*k2),.018*k2*k2,.0045*k2);
  h=mix(h,pal(.55+.3*n),k2*k2*.5);
  vec3 col=h*uHA*(1.-la)+lc*la;
  gl_FragColor=vec4(col,uHA+la*.3*(1.-uHA));
}`;
  let cv = null, gl = null, gw = 1, gh = 1; const U = {}; let TS, TH;
  const tc = canvas(1, 1), tg = tc.getContext('2d');   // la scène à la taille de la toile WebGL
  if (!calm) {
    try {
      cv = document.createElement('canvas'); cv.className = 'tk-gl';
      gl = cv.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, depth: false });
      if (!gl) throw 0;
      const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(o); return o; };
      const pr = gl.createProgram();
      gl.attachShader(pr, sh(gl.VERTEX_SHADER, 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}'));
      gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(pr); gl.useProgram(pr);
      gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      for (const n of ['uR', 'uT', 'uF', 'uGlow', 'uFill', 'uFlash', 'uB', 'uL', 'uMode', 'uHA', 'uHD', 'uS', 'uH']) U[n] = gl.getUniformLocation(pr, n);
      const mk = unit => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
        for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); return t; };
      TS = mk(0); TH = mk(1); gl.uniform1i(U.uS, 0); gl.uniform1i(U.uH, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      document.body.append(cv);
    } catch (e) { gl = null; cv = null; /* pas de WebGL : un simple fondu à la fin */ }
  }
  const upload = (unit, tex, src) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); };
  const drawGL = (mode, o) => {
    gl.viewport(0, 0, gw, gh); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uR, gw, gh); gl.uniform1f(U.uMode, mode);
    for (const n of ['uT', 'uF', 'uGlow', 'uFill', 'uFlash', 'uB', 'uL', 'uHA', 'uHD']) gl.uniform1f(U[n], o[n] ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // l'accueil redessiné tel qu'il est sous le ticket (image du hero, ses deux voiles et sa lueur), pour la vague
  function homeImage() {
    const c = canvas(gw, gh), g = c.getContext('2d'), q = gw / vw;
    const VC = lightSite ? '240,239,235' : '6,6,7', vc = x => `rgba(${VC},${x})`;   // la couleur des voiles du hero selon le thème du site
    g.scale(q, q); g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#060607'; g.fillRect(0, 0, vw, vh);
    const hero = document.getElementById('hero'), slide = hero?.querySelector('.slide.on'), img = slide?.querySelector('img');
    if (!slide) return c;
    const ok = img && img.complete && img.naturalWidth;
    // une image « object-fit: cover » dans une boîte, avec son cadrage et son zoom du moment
    const cover = (box, pos = [.5, .5], z = 1) => {
      const sc = Math.max(box.width / img.naturalWidth, box.height / img.naturalHeight), iw = img.naturalWidth * sc, ih = img.naturalHeight * sc;
      g.save(); g.translate(box.left + box.width / 2, box.top + box.height / 2); g.scale(z, z); g.translate(-box.width / 2, -box.height / 2);
      g.drawImage(img, (box.width - iw) * pos[0], (box.height - ih) * pos[1], iw, ih); g.restore();
    };
    // le halo : la même toile que celle de la page (js/app.js, paintHalo), dans la même boîte
    const amb = hero.querySelector('.hero-amb canvas.on');
    if (amb && amb.width > 1) {
      const a = amb.getBoundingClientRect(), box = hero.querySelector('.hero-amb').getBoundingClientRect();
      g.save(); g.beginPath(); g.rect(box.left, box.top, box.width, box.height); g.clip();
      g.globalAlpha = .6; g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(amb, a.left, a.top, a.width, a.height); g.restore();
    }
    // l'ombre de l'écran, lue sur son calque
    const scr = slide.getBoundingClientRect(), srad = parseFloat(getComputedStyle(slide).borderTopLeftRadius) || 0, shEl = hero.querySelector('.hero-sh');
    const bs = shEl && getComputedStyle(shEl).boxShadow.match(/(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px\s+(-?[\d.]+)px/);
    if (bs) {
      const [, col, sx, sy, bl, sp] = bs, s2 = +sp;
      g.save(); g.shadowColor = col; g.shadowBlur = +bl * q; g.shadowOffsetX = (+sx - 10000) * q; g.shadowOffsetY = +sy * q; g.fillStyle = '#000';
      rrect(g, scr.left - s2 + 10000, scr.top - s2, scr.width + 2 * s2, scr.height + 2 * s2, Math.max(0, srad + s2)); g.fill(); g.restore();
    }
    // l'écran arrondi, son image et ses deux voiles
    const r = slide.getBoundingClientRect(), rad = parseFloat(getComputedStyle(slide).borderTopLeftRadius) || 0;
    g.save(); rrect(g, r.left, r.top, r.width, r.height, rad); g.clip();
    if (ok) {
      const cs = getComputedStyle(img), pos = cs.objectPosition.split(' ').map(v => parseFloat(v) / 100);
      const m = cs.transform === 'none' ? null : new DOMMatrix(cs.transform);
      cover(r, pos.length === 2 && !pos.some(isNaN) ? pos : [.5, .22], m ? m.a : 1);
    }
    const phone = vw <= 760;
    g.fillStyle = angGrad(g, r.left, r.top, r.width, r.height, 90, phone ? [[0, vc(.6)], [.8, vc(0)]] : [[0, vc(.78)], [.42, vc(.3)], [.66, vc(0)]]); g.fillRect(r.left, r.top, r.width, r.height);
    g.fillStyle = angGrad(g, r.left, r.top, r.width, r.height, 0, phone ? [[0, vc(.85)], [.34, vc(.5)], [.66, vc(0)]] : [[0, vc(.75)], [.46, vc(0)]]); g.fillRect(r.left, r.top, r.width, r.height);
    g.restore();
    return c;
  }
  // puis les éléments de l'accueil : le texte, la barre de navigation, les cartes
  function homeIn() {
    const q = s => document.querySelector(s), hero = !!document.getElementById('hero');
    const RISE = [{ opacity: 0, translate: '0 22px', filter: 'blur(8px)' }, { opacity: 1, translate: '0 0', filter: 'blur(0)' }];
    const DROP = [{ opacity: 0, translate: '0 -96px' }, { opacity: 1, translate: '0 0' }];   // la barre descend du haut de l'écran
    const FADE = [{ opacity: 0, filter: 'blur(6px)' }, { opacity: 1, filter: 'blur(0)' }];  // le logo apparaît sur place
    const list = [
      ...(hero ? [[q('.hero-copy'), RISE, 0]] : []),
      [q('#header .logo'), FADE, .12], [q('#header .nav'), DROP, .12], [q('#header .hd-act'), DROP, .2],
      ...(hero ? [[q('.hero-next'), RISE, .3], ...[...document.querySelectorAll('#view > :not(#hero)')].map(e => [e, RISE, .4])] : [[q('#view'), RISE, .2]]),
    ];
    if (!calm) for (const [el, kf, delay] of list) el?.animate?.(kf, kf === DROP
      ? { duration: 950, delay: delay * 1000, easing: 'cubic-bezier(.22,1.12,.36,1)', fill: 'backwards' }   // se pose avec un très léger rebond
      : { duration: 800, delay: delay * 1000, easing: 'cubic-bezier(.33,1,.68,1)', fill: 'backwards' });
    document.documentElement.classList.remove('tk-hide');
  }

  // ─── LE MOUVEMENT ──────────────────────────────────────────────────────────
  let phase = 'tear', xp = XL, xT = XL, pressed = false, auto = false, shown = false, fontsOk = false;
  let tShow = 0, tCut = 0, T_TOP = 9, homeDone = false, waveOn = false, raf = 0, last = 0, I = 0;
  const cl = v => Math.max(0, Math.min(1, v)), so = u => 1 - Math.pow(1 - u, 3);
  const ease = u => { const a = .35; return u < a ? .5 * Math.pow(u / a, 4) : 1 - .5 * Math.pow(1 - (u - a) / (1 - a), 4); };
  const T_SHARP = .5, T_BURST = .62, D_BURST = 1.35;   // secondes après la coupe
  const frontAt = tc2 => -.06 + 1.26 * ease(cl((tc2 - T_BURST) / D_BURST));
  const go = () => { if (!raf && raf !== -1) { last = performance.now(); raf = requestAnimationFrame(frame); } };

  function drawScene(t) {
    d.setTransform(1, 0, 0, 1, 0, 0); d.drawImage(bg, 0, 0);
    if (!pieces || !shown) return;
    // l'arrivée : un ressort amorti qui part à l'arrêt, chute, se tend, rebondit une fois et s'immobilise de lui-même
    const ts = Math.max(0, t - tShow), D = calm ? 0 : oy / s + H + 80, lam = 4.6, wd = 5;
    const dy = ts > 5 ? 0 : -D * Math.exp(-lam * ts) * (Math.cos(wd * ts) + lam / wd * Math.sin(wd * ts));
    const sw = calm || ts > 6 ? 0 : 1.0 * Math.exp(-ts / .9) * Math.sin(ts * 3.6);
    d.setTransform(dpr, 0, 0, dpr, 0, 0); d.translate(ox, oy + dy * s); d.scale(s, s);
    d.translate(170, PIVOT); d.rotate(sw * Math.PI / 180); d.translate(-170, -PIVOT);
    d.drawImage(pieces.shMain, -SM, -SM, W + 2 * SM, Y + 2 * SM);
    d.drawImage(pieces.main, 0, 0, W, H);
    // le talon : il pend pendant la coupe, puis tombe un peu et continue de glisser doucement
    const fall = phase === 'tear' ? 0 : t - tCut, relax = cl(fall / .25), gF = 1 - Math.exp(-fall / .5);
    d.save();
    if (fall > 0) { d.translate(170, 572); d.translate(-8 * gF - 4 * fall, 58 * gF + 14 * fall); d.rotate((-5 * gF - 1.4 * fall) * Math.PI / 180); d.translate(-170, -572); }
    d.drawImage(pieces.shStub, -SM, Y - SM, W + 2 * SM, H - Y + 2 * SM);
    for (let x0 = 0; x0 < W; x0 += SL) {
      const x1 = Math.min(W, x0 + SL), c = (x0 + x1) / 2, u = Math.max(0, (xp - c) / L) * (1 - relax);
      d.save(); d.translate(c, Y);
      if (u > 0) { d.translate(0, SAG * u * u); d.rotate(-Math.atan(2 * SAG * u / L)); }
      d.translate(-c, -Y); d.beginPath(); d.rect(x0 - .5, Y - 3, x1 - x0 + 1, H - Y + 6); d.clip();
      d.drawImage(pieces.stub, 0, 0, W, H); d.restore();
    }
    d.restore();
    // le cordon noir et son œillet
    d.lineCap = 'round'; d.strokeStyle = dark ? '#5C5853' : '#161616'; d.lineWidth = 2.4; d.beginPath();
    d.moveTo(150, -1400); d.lineTo(166, 10); d.moveTo(190, -1400); d.lineTo(174, 10); d.stroke();
    d.fillStyle = dark ? '#4A4643' : '#111'; d.beginPath(); d.ellipse(170, -7, 4.6, 6.5, 0, 0, Math.PI * 2); d.fill();
    d.lineWidth = 3; d.beginPath(); d.moveTo(170, -2); d.lineTo(170, 18); d.stroke();
    d.strokeStyle = '#1b1b1b'; d.lineWidth = 4; d.beginPath(); d.arc(170, 26, 11, 0, Math.PI * 2); d.stroke();
    d.strokeStyle = 'rgba(255,255,255,.18)'; d.lineWidth = .8; d.beginPath(); d.arc(170, 26, 12.6, 0, Math.PI * 2); d.stroke();
    return ts;
  }

  function detach(t) {
    phase = 'drop'; tCut = t; auto = false; pressed = false;
    ov.classList.add('done'); ov.classList.remove('drag');
    if (gl) { for (let u = 0; u < 3; u += 1 / 240) if (frontAt(u) >= 1.02) { T_TOP = u; break; } return; }
    // sans WebGL (ou animations réduites) : un fondu, puis l'accueil
    setTimeout(() => { homeIn(); ov.style.transition = 'opacity .5s'; ov.style.opacity = '0'; setTimeout(end, 520); }, calm ? 250 : 650);
  }
  function end() {
    try { sessionStorage.setItem('mpf-ticket', '1'); } catch (e) { /* rien */ }
    cancelAnimationFrame(raf); raf = -1; clearInterval(tick);
    removeEventListener('resize', layout); removeEventListener('keydown', key, true);
    document.documentElement.classList.remove('tk-hide');
    ov.remove(); cv?.remove(); current = null;
  }

  function frame(nowMs) {
    raf = 0;
    const t = nowMs / 1000, dt = Math.min(.1, (nowMs - last) / 1000); last = nowMs;
    if (phase === 'tear') {
      if (auto) xT = Math.min(XR, xT + dt * 420);
      xp += (xT - xp) * (1 - Math.exp(-dt * 16));   // le papier résiste un peu
      if (xT - xp < .3) xp = xT;
      if (xT >= XR && xp > XR - 2) { xp = XR; detach(t); }
    }
    const ts = drawScene(t) ?? 0;
    const P = cl((xp - XL) / L);
    tx.style.opacity = shown ? String(cl((ts - 1.15) / .4) * (P > 0 || pressed || auto || phase !== 'tear' ? 0 : 1)) : '0';
    let busy = shown && ts < 3.2;
    if (gl) {
      const tc2 = phase === 'tear' ? -1 : t - tCut;
      const glow = cl(P / .12) * (.35 + .4 * P) + (tc2 > 0 ? .35 * so(cl(tc2 / .5)) : 0);
      I += (glow - I) * (1 - Math.exp(-dt * 8));
      if (phase === 'tear') {
        if (I > .003) drawGL(0, { uT: t, uGlow: I, uFlash: 1, uF: -1 }); else { gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
        busy = busy || pressed || auto || Math.abs(xT - xp) > .01 || I > .003;
      } else {
        if (!waveOn) { waveOn = true; upload(1, TH, homeImage()); ov.classList.add('wave'); }
        tg.drawImage(dc, 0, 0, gw, gh); upload(0, TS, tc);
        const F = frontAt(tc2);
        if (!homeDone && tc2 >= T_TOP + .5) { homeDone = true; homeIn(); }
        drawGL(1, { uT: t, uF: F, uGlow: I * (1 - so(cl((F + .06) / .4))), uFill: 1 - so(cl((tc2 - T_BURST - .35) / .9)), uFlash: 1 - so(cl((tc2 - T_TOP) / .7)),
          uB: .0032 * so(cl(tc2 / .45)) * (1 - so(cl((tc2 - T_SHARP) / .12))), uL: .3 * Math.pow(cl(F), 1.3),
          // l'accueil se relâche jusqu'à être exactement à sa place… puis seulement la vraie page prend le relais
          uHD: 1 - so(cl((tc2 - T_TOP + .1) / .55)), uHA: 1 - so(cl((tc2 - T_TOP - .45) / .3)) });
        if (tc2 > T_TOP + .8) { end(); return; }
        busy = true;
      }
    } else busy = busy || pressed || auto || Math.abs(xT - xp) > .01;
    if (busy) raf = requestAnimationFrame(frame);
  }

  // ─── LA COUPE À LA SOURIS OU AU DOIGT ──────────────────────────────────────
  const local = e => [(e.clientX - ox) / s, (e.clientY - oy) / s];
  const onLine = (x, y) => Math.abs(y - Y) < 46 && x > -10 && x < xT + 70;
  ov.addEventListener('pointerdown', e => {
    if (!shown || phase !== 'tear' || e.button > 0 || performance.now() / 1000 - tShow < .8) return;
    const [x, y] = local(e);
    if (!onLine(x, y)) return;
    e.preventDefault(); pressed = true; ov.setPointerCapture?.(e.pointerId);
    ov.classList.add('drag'); go();
  });
  ov.addEventListener('pointermove', e => {
    const [x, y] = local(e);
    if (!pressed) { ov.classList.toggle('grab', shown && phase === 'tear' && onLine(x, y)); return; }
    if (x > xT) xT = Math.min(XR, x);
    if (xT > XR - 6) xT = XR;
    go();
  });
  const up = () => { if (!pressed) return; pressed = false; ov.classList.remove('drag'); go(); };
  ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up); ov.addEventListener('lostpointercapture', up);
  ov.addEventListener('wheel', e => e.preventDefault(), { passive: false });
  ov.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
  // tant que le ticket est là, le clavier n'atteint pas le site ; Entrée coupe le ticket
  function key(e) {
    e.stopPropagation();
    if (!shown || phase !== 'tear') return;
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); auto = true; go(); }
  }
  addEventListener('keydown', key, true);
  addEventListener('resize', layout);

  // ─── L'APPARITION ──────────────────────────────────────────────────────────
  const fontsReady = Promise.all([condFace?.load(), document.fonts?.ready, ...['800 54px Archivo', '650 14px Archivo', '600 17px Archivo', '500 10px Inter', '400 9px Inter', '600 9px Inter'].map(f => document.fonts?.load(f))].map(p => Promise.resolve(p).catch(() => {})));
  fontsReady.then(() => { fontsOk = true; clock(); fill(counts); layout(); });
  layout();
  const show = () => {
    if (shown) return;
    fontsReady.then(() => { shown = true; tShow = performance.now() / 1000; ov.classList.add('on'); ov.focus({ preventScroll: true }); go(); });
  };
  current = { fill, show, arrivee };
  if (!first) show();
  else {
    if (arrivee) addEventListener('mpf-arrivee-out', show, { once: true });
    setTimeout(show, 7000);   // filet de sécurité si l'accueil ne se charge pas
  }
  };

  const prev = window.mpfPret;
  window.mpfPret = c => { prev?.(c); counts = c || counts; if (current) { current.fill(counts); if (!current.arrivee) current.show(); } };
  // un clic sur le logo du site ramène le ticket (l'accueil s'affiche dessous)
  document.addEventListener('click', e => {
    if (!e.target.closest?.('a.logo') || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    open(false);
  }, true);
  if (!seen) open(true);
})();
