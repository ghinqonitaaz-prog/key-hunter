/*
 * raycast.js — renderer first-person berbasis raycasting (canvas 2D, tanpa WebGL).
 *
 * Dunia memakai grid blok: tiap sel labirin jadi ruang `open` x `open` blok,
 * dengan dinding satu blok di antaranya.
 */
window.Raycaster = (function () {
  'use strict';

  var PLANE = 0.78;      // setengah lebar bidang proyeksi -> FOV ~ 76 derajat
  var MAX_STEPS = 200;

  var SPRITE_W = 96;
  var SPRITE_H = 180;
  var spriteCache = {};

  var main = null;
  var mctx = null;
  var scene = null;
  var sctx = null;

  var view = { w: 1, h: 1, dpr: 1 };
  var RW = 1;
  var RH = 1;
  var zbuf = new Float32Array(1);

  function init(canvas) {
    main = canvas;
    mctx = canvas.getContext('2d');
    scene = document.createElement('canvas');
    sctx = scene.getContext('2d');
  }

  function resize(cssW, cssH, dpr) {
    view.w = Math.max(1, Math.round(cssW));
    view.h = Math.max(1, Math.round(cssH));
    view.dpr = dpr || 1;

    main.width = Math.round(view.w * view.dpr);
    main.height = Math.round(view.h * view.dpr);

    RW = Math.round(Math.min(1000, Math.max(260, view.w)));
    RH = Math.max(140, Math.round(RW * (view.h / view.w)));

    scene.width = RW;
    scene.height = RH;
    zbuf = new Float32Array(RW);
  }

  /* ---------------- dinding ---------------- */

  function drawWalls(ctx, st, horizon, maxD) {
    var w = RW;
    var h = RH;
    var px = st.px;
    var py = st.py;
    var dirX = Math.cos(st.yaw);
    var dirY = Math.sin(st.yaw);
    var planeX = -dirY * PLANE;
    var planeY = dirX * PLANE;
    var grid = st.grid;
    var gw = st.gw;
    var gh = st.gh;

    for (var x = 0; x < w; x++) {
      var camX = (2 * x) / w - 1;
      var rx = dirX + planeX * camX;
      var ry = dirY + planeY * camX;

      var mapX = Math.floor(px);
      var mapY = Math.floor(py);
      var ddx = rx === 0 ? 1e30 : Math.abs(1 / rx);
      var ddy = ry === 0 ? 1e30 : Math.abs(1 / ry);

      var stepX, stepY, sideX, sideY;
      if (rx < 0) { stepX = -1; sideX = (px - mapX) * ddx; }
      else { stepX = 1; sideX = (mapX + 1 - px) * ddx; }
      if (ry < 0) { stepY = -1; sideY = (py - mapY) * ddy; }
      else { stepY = 1; sideY = (mapY + 1 - py) * ddy; }

      var side = 0;
      var hit = false;
      var guard = 0;

      while (guard++ < MAX_STEPS) {
        if (sideX < sideY) { sideX += ddx; mapX += stepX; side = 0; }
        else { sideY += ddy; mapY += stepY; side = 1; }

        if (mapX < 0 || mapY < 0 || mapX >= gw || mapY >= gh) break;
        if (grid[mapY * gw + mapX]) { hit = true; break; }
      }

      var dist;
      if (hit) {
        dist = side === 0
          ? (mapX - px + (1 - stepX) / 2) / (rx || 1e-6)
          : (mapY - py + (1 - stepY) / 2) / (ry || 1e-6);
        if (!(dist > 0.0001)) dist = 0.0001;
      } else {
        dist = maxD * 2;
      }

      zbuf[x] = dist;

      if (!hit || dist > maxD) continue;

      var lineH = h / dist;
      var top = horizon - lineH / 2;
      var y0 = Math.round(top);
      var y1 = Math.round(top + lineH);
      if (y1 < 0 || y0 > h) continue;

      var wallX = side === 0 ? py + dist * ry : px + dist * rx;
      wallX -= Math.floor(wallX);

      var fog = 1 - dist / maxD;
      if (fog < 0) fog = 0;
      var lum = Math.pow(fog, 1.9);
      lum = 0.03 + 1.0 * lum;
      var cone = 1 - Math.abs(camX) * Math.abs(camX) * 0.65;
      lum *= cone;
      if (side === 1) lum *= 0.76;

      var panel = ((mapX * 5 + mapY * 11) % 4) * 0.02;
      lum *= 0.95 + panel;

      var r = 64 * lum;
      var g = 82 * lum;
      var b = 104 * lum;

      var edge = wallX < 0.5 ? wallX : 1 - wallX;
      if (edge < 0.042) {
        var t = 1 - edge / 0.042;
        t *= t * 0.8;
        r += (64 - r) * t;
        g += (226 - g) * t;
        b += (214 - b) * t;
      }

      ctx.fillStyle = 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));

      var trimY = y0 + lineH * 0.17;
      ctx.fillStyle = 'rgba(198, 226, 244, ' + (0.05 + 0.12 * fog).toFixed(3) + ')';
      ctx.fillRect(x, trimY, 1, Math.max(1, lineH * 0.014));

      var midY = y0 + lineH * 0.56;
      ctx.fillStyle = 'rgba(8, 14, 20, ' + (0.06 + 0.08 * fog).toFixed(3) + ')';
      ctx.fillRect(x, midY, 1, Math.max(1, lineH * 0.005));

      var bbY = y0 + lineH * 0.85;
      ctx.fillStyle = 'rgb(' + ((r * 0.5) | 0) + ',' + ((g * 0.54) | 0) + ',' + ((b * 0.56) | 0) + ')';
      ctx.fillRect(x, bbY, 1, Math.max(1, y1 - bbY));
    }
  }

  /* ---------------- proyeksi sprite ---------------- */

  function project(it, st) {
    var sx = it.x - st.px;
    var sy = it.y - st.py;
    var dirX = Math.cos(st.yaw);
    var dirY = Math.sin(st.yaw);
    var depth = sx * dirX + sy * dirY;
    if (depth < 0.2) return null;
    var lateral = -sx * dirY + sy * dirX;
    var screenX = (RW / 2) * (1 + (lateral / depth) / PLANE);
    return { depth: depth, screenX: screenX };
  }

  /* ---------------- sprite penjaga ---------------- */

  function rr(g, x, y, w, h, r) {
    var rad = Math.min(r, w / 2, h / 2);
    g.beginPath();
    if (g.roundRect) { g.roundRect(x, y, w, h, rad); return; }
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
  }

  function paintGuard(g, state, frame) {
    var accent = state === 'chase' ? '#ff4655' : state === 'alert' ? '#ffab52' : '#4fb6cc';
    var rim = state === 'chase' ? 'rgba(255, 110, 120, 0.75)'
      : state === 'alert' ? 'rgba(255, 180, 100, 0.6)'
        : 'rgba(120, 200, 220, 0.35)';
    var body = '#101d27';
    var bodyLit = '#1d3140';

    var ph = (frame / 4) * Math.PI * 2;
    var swing = Math.sin(ph);
    var legA = swing * 9;
    var legB = -swing * 9;
    var armA = -swing * 5;
    var armB = swing * 5;
    var bob = Math.abs(swing) * 2;

    g.save();
    g.translate(0, -bob);

    // kaki
    g.fillStyle = body;
    rr(g, 34 + legA * 0.35, 108, 15, 64, 6); g.fill();
    rr(g, 47 - legA * 0.35, 108, 15, 64, 6); g.fill();
    // sepatu
    g.fillStyle = bodyLit;
    rr(g, 31 + legA * 0.35, 164, 21, 10, 4); g.fill();
    rr(g, 44 - legA * 0.35, 164, 21, 10, 4); g.fill();

    // lengan
    g.fillStyle = body;
    rr(g, 20 + armA * 0.3, 62, 14, 48, 7); g.fill();
    rr(g, 62 + armB * 0.3, 62, 14, 48, 7); g.fill();

    // badan
    g.beginPath();
    g.moveTo(28, 60);
    g.lineTo(68, 60);
    g.lineTo(64, 116);
    g.lineTo(32, 116);
    g.closePath();
    g.fillStyle = body;
    g.fill();

    // sisi terang badan
    g.beginPath();
    g.moveTo(28, 60);
    g.lineTo(40, 60);
    g.lineTo(37, 116);
    g.lineTo(32, 116);
    g.closePath();
    g.fillStyle = bodyLit;
    g.fill();

    // garis rompi
    g.strokeStyle = accent;
    g.globalAlpha = 0.55;
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(34, 78);
    g.lineTo(62, 78);
    g.stroke();
    g.globalAlpha = 1;

    // leher
    g.fillStyle = body;
    rr(g, 42, 50, 12, 12, 5); g.fill();

    // kepala
    g.beginPath();
    g.arc(48, 34, 15, 0, Math.PI * 2);
    g.fillStyle = body;
    g.fill();

    // helm: garis tepi
    g.strokeStyle = rim;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(48, 34, 15, Math.PI * 0.95, Math.PI * 1.85);
    g.stroke();

    // visor menyala
    g.save();
    g.shadowColor = accent;
    g.shadowBlur = 10;
    g.fillStyle = accent;
    rr(g, 38, 29, 20, 6, 3);
    g.fill();
    g.restore();

    // rim light di sisi kiri badan
    g.strokeStyle = rim;
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(30, 62);
    g.lineTo(33, 114);
    g.stroke();

    g.restore();
  }

  function getGuardSprite(state, frame) {
    var key = state + ':' + frame;
    if (spriteCache[key]) return spriteCache[key];
    var cv = document.createElement('canvas');
    cv.width = SPRITE_W;
    cv.height = SPRITE_H;
    var g = cv.getContext('2d');
    paintGuard(g, state, frame);
    spriteCache[key] = cv;
    return cv;
  }

  function drawGuard(ctx, it, st, horizon, maxD) {
    var p = project(it, st);
    if (!p) return;

    var hpx = RH / p.depth;
    var spriteH = Math.min(RH * 1.6, hpx * 0.95);
    if (spriteH < 3) return;
    var spriteW = spriteH * (SPRITE_W / SPRITE_H);

    var feetY = horizon + hpx * 0.5;
    var topY = feetY - spriteH;
    var left = p.screenX - spriteW / 2;

    if (left + spriteW < 0 || left > RW) return;

    var fade = 1 - p.depth / (maxD * 1.35);
    if (fade <= 0) return;
    fade *= fade;

    var img = getGuardSprite(it.state, it.frame || 0);

    var x0 = Math.max(0, Math.floor(left));
    var x1 = Math.min(RW - 1, Math.ceil(left + spriteW));

    ctx.globalAlpha = Math.min(1, 0.25 + fade * 1.1);

    // aura saat mengejar
    if (it.state === 'chase') {
      ctx.globalCompositeOperation = 'lighter';
      var gr = ctx.createRadialGradient(p.screenX, topY + spriteH * 0.4, 0, p.screenX, topY + spriteH * 0.4, spriteW * 0.9);
      gr.addColorStop(0, 'rgba(255, 60, 80, ' + (0.10 * fade).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(255, 60, 80, 0)');
      ctx.fillStyle = gr;
      ctx.fillRect(p.screenX - spriteW, topY, spriteW * 2, spriteH * 1.4);
      ctx.globalCompositeOperation = 'source-over';
    }

    for (var x = x0; x <= x1; x++) {
      if (zbuf[x] < p.depth) continue;
      var u0 = (x - left) / spriteW;
      if (u0 < 0 || u0 >= 1) continue;
      var sx0 = Math.floor(u0 * SPRITE_W);
      var sw = Math.max(1, Math.round(SPRITE_W / Math.max(1, spriteW)));
      ctx.drawImage(img, sx0, 0, Math.min(sw, SPRITE_W - sx0), SPRITE_H, x, topY, 1, spriteH);
    }

    ctx.globalAlpha = 1;
  }

  /* ---------------- objek lain ---------------- */

  function drawDisc(ctx, cx, cy, r, rgb, alpha, depth) {
    if (r < 0.4 || alpha <= 0.004) return;
    var x0 = Math.max(0, Math.floor(cx - r));
    var x1 = Math.min(RW - 1, Math.ceil(cx + r));
    if (x1 < x0) return;

    ctx.fillStyle = 'rgba(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ',' + alpha.toFixed(3) + ')';

    for (var x = x0; x <= x1; x++) {
      if (zbuf[x] < depth) continue;
      var dx = x + 0.5 - cx;
      var hh = Math.sqrt(Math.max(0, r * r - dx * dx));
      if (hh < 0.5) continue;
      ctx.fillRect(x, cy - hh, 1, hh * 2);
    }
  }

  function drawPillar(ctx, it, st, horizon, maxD) {
    var w = RW;
    var h = RH;

    var sx = it.x - st.px;
    var sy = it.y - st.py;
    var dirX = Math.cos(st.yaw);
    var dirY = Math.sin(st.yaw);

    var depth = sx * dirX + sy * dirY;
    if (depth < 0.15) return;

    var lateral = -sx * dirY + sy * dirX;
    var screenX = (w / 2) * (1 + (lateral / depth) / PLANE);

    var hpx = h / depth;
    var halfW = Math.max(0.8, hpx * 0.14);
    var x0 = Math.floor(screenX - halfW);
    var x1 = Math.ceil(screenX + halfW);
    if (x1 < 0 || x0 > w) return;

    var fade = 1 - depth / (maxD * 1.6);
    if (fade <= 0) return;
    fade *= fade;

    var topY = horizon - hpx * 0.46;
    var botY = horizon + hpx * 0.46;
    var pitchX0 = Math.max(0, x0);
    var pitchX1 = Math.min(w - 1, x1);

    for (var x = pitchX0; x <= pitchX1; x++) {
      if (zbuf[x] < depth) continue;
      var t = (x - (screenX - halfW)) / (2 * halfW);
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var a = Math.sin(Math.PI * t);
      a = a * a * fade * 0.55;
      if (a <= 0.012) continue;
      ctx.fillStyle = 'rgba(' + it.r + ',' + it.g + ',' + it.b + ',' + a + ')';
      ctx.fillRect(x, topY, 1, botY - topY);
    }

    var cx = Math.round(screenX);
    if (cx >= 0 && cx < w && zbuf[cx] > depth) {
      var ca = 0.26 + 0.42 * fade;
      ctx.fillStyle = 'rgba(' + it.r + ',' + it.g + ',' + it.b + ',' + ca + ')';
      ctx.fillRect(cx - 1, topY, 2, botY - topY);

      if (it.kind !== 'exit') {
        var size = Math.max(2, Math.min(9, hpx * 0.055));
        var pulse = 1 + 0.18 * Math.sin((st.time || 0) * 4 + it.x);
        ctx.save();
        ctx.translate(cx, horizon);
        ctx.rotate(Math.PI / 4);
        ctx.fillStyle = 'rgba(' + it.r + ',' + it.g + ',' + it.b + ',' + (0.55 + 0.35 * fade) + ')';
        ctx.fillRect(-size * pulse, -size * pulse, size * 2 * pulse, size * 2 * pulse);
        ctx.restore();
      }
    }
  }

  function drawDecal(ctx, it, st, horizon, maxD) {
    var p = project(it, st);
    if (!p) return;
    var hpx = RH / p.depth;
    var r = Math.max(1.3, hpx * 0.045);
    var fade = Math.min(1, it.life);
    var cy = horizon;

    ctx.globalCompositeOperation = 'source-over';
    drawDisc(ctx, p.screenX, cy, r, [6, 6, 8], 0.85 * fade, p.depth);

    ctx.globalCompositeOperation = 'lighter';
    drawDisc(ctx, p.screenX, cy, r * 2.2, [130, 180, 210], 0.13 * fade, p.depth);
    ctx.globalCompositeOperation = 'source-over';
  }

  /* ---------------- pistol ---------------- */

  function drawWeapon(ctx, w, h, wp) {
    var s = Math.min(w / 1000, h / 1000) * 1.32;
    var kick = wp.kick || 0;
    var reload = wp.reload || 0;
    var sway = wp.sway || 0;

    var px = w * 0.845;
    var py = h * 0.84 + kick * 16 * s + reload * 165 * s;
    var rot = 0.30 + kick * 0.09 + sway;

    var MLX = -288;
    var MLY = 2;
    var mx = px + s * (MLX * Math.cos(rot) - MLY * Math.sin(rot));
    var my = py + s * (MLX * Math.sin(rot) + MLY * Math.cos(rot));

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rot);
    ctx.scale(s, s);

    // ---- lengan kanan ----
    ctx.strokeStyle = '#16212b';
    ctx.lineWidth = 56;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(118, 128);
    ctx.lineTo(206, 268);
    ctx.stroke();

    // ---- sarung tangan kanan di grip ----
    ctx.fillStyle = '#1c2a36';
    rr(ctx, 66, 56, 58, 68, 15);
    ctx.fill();

    // ---- stok kayu ----
    ctx.fillStyle = '#5c351d';
    ctx.beginPath();
    ctx.moveTo(72, -6);
    ctx.lineTo(198, 2);
    ctx.lineTo(212, 30);
    ctx.lineTo(72, 44);
    ctx.closePath();
    ctx.fill();

    // ---- receiver ----
    ctx.fillStyle = '#232c34';
    rr(ctx, -34, -16, 118, 50, 4);
    ctx.fill();

    // dust cover
    ctx.fillStyle = '#2b3640';
    rr(ctx, -34, -25, 110, 14, 3);
    ctx.fill();

    // ---- pistol grip ----
    ctx.fillStyle = '#141c23';
    ctx.beginPath();
    ctx.moveTo(50, 32);
    ctx.lineTo(90, 36);
    ctx.lineTo(112, 112);
    ctx.lineTo(74, 120);
    ctx.closePath();
    ctx.fill();

    // ---- magasin lengkung ----
    ctx.fillStyle = '#1c252d';
    ctx.beginPath();
    ctx.moveTo(-12, 30);
    ctx.lineTo(34, 28);
    ctx.quadraticCurveTo(74, 76, 64, 118);
    ctx.lineTo(26, 126);
    ctx.quadraticCurveTo(24, 72, -12, 40);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(150, 190, 210, 0.14)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ---- pelindung pelatuk ----
    ctx.strokeStyle = '#2a3640';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(34, 34, 20, 0.05 * Math.PI, 0.95 * Math.PI);
    ctx.stroke();

    // ---- handguard bawah (kayu) ----
    ctx.fillStyle = '#6b3d1f';
    rr(ctx, -152, -4, 114, 34, 6);
    ctx.fill();
    ctx.fillStyle = '#552f16';
    rr(ctx, -140, 9, 88, 6, 3);
    ctx.fill();

    // ---- handguard atas ----
    ctx.fillStyle = '#5f361b';
    rr(ctx, -142, -23, 96, 16, 5);
    ctx.fill();

    // ---- tabung gas ----
    ctx.fillStyle = '#39454f';
    rr(ctx, -142, -15, 106, 7, 3);
    ctx.fill();

    // ---- gas block ----
    ctx.fillStyle = '#2b3640';
    rr(ctx, -166, -23, 20, 40, 3);
    ctx.fill();

    // ---- laras ----
    ctx.fillStyle = '#39454f';
    rr(ctx, -264, -4, 106, 11, 3);
    ctx.fill();

    // ---- muzzle brake ----
    ctx.fillStyle = '#232c34';
    rr(ctx, -288, -8, 26, 19, 3);
    ctx.fill();
    ctx.fillStyle = '#0b1116';
    rr(ctx, -290, -4, 8, 11, 2);
    ctx.fill();

    // ---- front sight ----
    ctx.fillStyle = '#2b3640';
    rr(ctx, -242, -34, 9, 32, 2);
    ctx.fill();
    ctx.strokeStyle = '#2b3640';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(-238, -36, 7, 0, Math.PI * 2);
    ctx.stroke();

    // ---- rear sight ----
    ctx.fillStyle = '#2b3640';
    rr(ctx, -30, -35, 24, 10, 2);
    ctx.fill();

    // ---- tangan kiri menopang handguard ----
    ctx.fillStyle = '#1c2a36';
    rr(ctx, -136, 26, 58, 36, 13);
    ctx.fill();

    // ---- kilau atas ----
    ctx.strokeStyle = 'rgba(190, 225, 255, 0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-30, -25);
    ctx.lineTo(72, -25);
    ctx.stroke();

    // ---- kilatan moncong ----
    if (wp.muzzle > 0.01) {
      var f = wp.muzzle;
      ctx.globalCompositeOperation = 'lighter';
      var gr = ctx.createRadialGradient(MLX, MLY, 0, MLX, MLY, 130 * f);
      gr.addColorStop(0, 'rgba(255, 236, 190, ' + (0.95 * f).toFixed(3) + ')');
      gr.addColorStop(0.35, 'rgba(255, 160, 60, ' + (0.5 * f).toFixed(3) + ')');
      gr.addColorStop(1, 'rgba(255, 120, 40, 0)');
      ctx.fillStyle = gr;
      ctx.beginPath();
      ctx.arc(MLX, MLY, 130 * f, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(255, 250, 230, ' + (0.9 * f).toFixed(3) + ')';
      ctx.beginPath();
      for (var i = 0; i < 8; i++) {
        var ang = (i / 8) * Math.PI * 2;
        var rad = (i % 2 === 0 ? 40 : 13) * f;
        var xx = MLX + Math.cos(ang) * rad;
        var yy = MLY + Math.sin(ang) * rad;
        if (i === 0) ctx.moveTo(xx, yy); else ctx.lineTo(xx, yy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    }

    ctx.restore();

    // jejak peluru
    if (wp.tracer > 0.01) {
      var t = wp.tracer;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255, 226, 170, ' + (0.5 * t).toFixed(3) + ')';
      ctx.lineWidth = 1.6 + 2.4 * t;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(w * 0.5, h * 0.5);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255, 255, 240, ' + (0.32 * t).toFixed(3) + ')';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
    }
  }

  /* ---------------- render ---------------- */

  function render(st) {
    if (!sctx) return;

    var w = RW;
    var h = RH;
    var ctx = sctx;
    var bob = (st.bob || 0) * h;
    var horizon = Math.round(h * 0.5 + (st.pitch || 0) * h + bob);
    if (horizon < 40) horizon = 40;
    if (horizon > h - 40) horizon = h - 40;

    var maxD = st.maxDist || 10;

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // langit-langit
    var cg = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    cg.addColorStop(0, '#060b11');
    cg.addColorStop(1, '#16273a');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 0, w, Math.max(0, horizon));

    // lantai
    var fg = ctx.createLinearGradient(0, Math.min(h, horizon), 0, h);
    fg.addColorStop(0, '#0d1a26');
    fg.addColorStop(1, '#182c3c');
    ctx.fillStyle = fg;
    ctx.fillRect(0, Math.min(h, horizon), w, h);

    drawWalls(ctx, st, horizon, maxD);

    // falloff vertikal
    var gTop = ctx.createLinearGradient(0, 0, 0, Math.max(1, horizon));
    gTop.addColorStop(0, 'rgba(3, 7, 11, 0.78)');
    gTop.addColorStop(1, 'rgba(3, 7, 11, 0)');
    ctx.fillStyle = gTop;
    ctx.fillRect(0, 0, w, Math.max(0, horizon));

    var gBot = ctx.createLinearGradient(0, Math.min(h, horizon), 0, h);
    gBot.addColorStop(0, 'rgba(3, 7, 11, 0)');
    gBot.addColorStop(1, 'rgba(3, 7, 11, 0.55)');
    ctx.fillStyle = gBot;
    ctx.fillRect(0, Math.min(h, horizon), w, h);

    ctx.fillStyle = 'rgba(56, 189, 248, 0.045)';
    ctx.fillRect(0, horizon - 1, w, 2);

    // objek bercahaya
    ctx.globalCompositeOperation = 'lighter';
    var items = st.items || [];
    for (var i = 0; i < items.length; i++) {
      drawPillar(ctx, items[i], st, horizon, maxD);
    }
    ctx.globalCompositeOperation = 'source-over';

    // lubang peluru
    var decals = st.decals || [];
    for (var d = 0; d < decals.length; d++) {
      drawDecal(ctx, decals[d], st, horizon, maxD);
    }

    // penjaga
    var foes = st.enemies || [];
    for (var j = 0; j < foes.length; j++) {
      drawGuard(ctx, foes[j], st, horizon, maxD);
    }

    // kilatan tembakan
    if (st.flash > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255, 196, 150, ' + (st.flash * 0.13).toFixed(3) + ')';
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
    }

    // senjata
    drawWeapon(ctx, w, h, st.weapon || {});

    // skala ke layar
    var dp = view.dpr;
    mctx.setTransform(dp, 0, 0, dp, 0, 0);
    mctx.imageSmoothingEnabled = true;
    mctx.drawImage(scene, 0, 0, view.w, view.h);
  }

  return {
    init: init,
    resize: resize,
    render: render,
    get width() { return RW; }
  };
})();
