/*
 * game.js — KEY HUNTER (first-person)
 * Jelajahi labirin, hindari penjaga, tembak kalau perlu, kumpulkan kunci, keluar.
 */
(function () {
  'use strict';

  var Maze = window.Maze;
  var Ray = window.Raycaster;
  var Sound = window.Sound;
  var Sentinel = window.Sentinel;

  var STORE = 'keyhunter.v1';
  var STORE_OLD = 'labirin.fps.v2';
  var MAX_SIZE = 19;

  var CORRIDOR = 2;                 // lebar lorong dalam blok
  var STEP = CORRIDOR + 1;          // jarak antar pusat sel
  var CELL_CENTER = 1 + CORRIDOR / 2;

  var SPEED = 2.75;
  var TURN = 2.1;
  var MOUSE_SENS = 0.0024;
  var RADIUS = 0.32;
  var MAX_DIST = 12;

  var AMMO_MAX = 30;
  var RELOAD_MS = 2000;
  var FIRE_COOLDOWN = 100;
  var SHOT_ALERT = 18;

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('view');
  var overlay = document.getElementById('overlay');
  var minimap = document.getElementById('minimap');
  var mmctx = minimap.getContext('2d');
  var objectiveEl = document.getElementById('objective');
  var stickEl = document.getElementById('stick');
  var knobEl = document.getElementById('knob');
  var hintEl = document.getElementById('hint');
  var dangerEl = document.getElementById('danger');
  var crosshair = document.getElementById('crosshair');

  var el = {
    level: document.getElementById('hud-level'),
    time: document.getElementById('hud-time'),
    best: document.getElementById('hud-best'),
    keys: document.getElementById('keys-row'),
    mute: document.getElementById('btn-mute'),
    restart: document.getElementById('btn-restart'),
    ammo: document.getElementById('ammo'),
    ammoCount: document.getElementById('ammo-count'),
    ammoFill: document.getElementById('ammo-fill'),
    ammoTag: document.getElementById('ammo-tag'),
    ghost: document.getElementById('btn-ghost'),
    fire: document.getElementById('fire-btn')
  };

  /* ---------------- profil ---------------- */

  var profile = loadProfile();
  Sound.setMuted(!!profile.muted);
  el.mute.textContent = profile.muted ? '🔇' : '🔊';

  function loadProfile() {
    var def = { maxLevel: 1, best: {}, muted: false };
    try {
      var raw = localStorage.getItem(STORE);
      // migrasi dari nama lama supaya rekor tidak hilang
      if (!raw) raw = localStorage.getItem(STORE_OLD);
      return raw ? Object.assign(def, JSON.parse(raw)) : def;
    } catch (err) {
      return def;
    }
  }

  function saveProfile() {
    try { localStorage.setItem(STORE, JSON.stringify(profile)); } catch (err) { /* noop */ }
  }

  /* ---------------- state ---------------- */

  var G = {
    mode: 'title',
    level: 1,
    maze: null,
    grid: null,
    gw: 0,
    gh: 0,
    px: 2,
    py: 2,
    vx: 0,
    vy: 0,
    yaw: 0,
    pitch: 0,
    bobPhase: 0,
    bob: 0,
    keysLeft: new Set(),
    totalKeys: 0,
    items: [],
    sentinels: [],
    seen: null,
    steps: 0,
    dist: 0,
    startAt: 0,
    elapsed: 0,
    newRecord: false,
    time: 0,
    keys: {},
    locked: false,
    isTouch: false,
    stickInput: null,
    footAt: 0,
    hiddenAt: 0,
    exitHint: 0,
    ammo: AMMO_MAX,
    reloading: false,
    reloadEnd: 0,
    fireAt: 0,
    trigger: false,
    flash: 0,
    shake: 0,
    danger: 0,
    chasePulse: 0,
    caughtAt: 0,
    kick: 0,
    muzzle: 0,
    tracer: 0,
    sway: 0,
    decals: [],
    ghost: false,
    seenBlocks: null,
    mmBase: null,
    mmDirty: true,
    mmUnit: 1,
    mmOx: 0,
    mmOy: 0
  };

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  function fmt(ms) {
    if (!ms || ms < 0) return '0.0';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1);
    var m = Math.floor(s / 60);
    return m + ':' + (s % 60).toFixed(1).padStart(4, '0');
  }

  function fmtUnit(ms) {
    if (!ms || ms < 0) return '—';
    var s = ms / 1000;
    if (s < 60) return s.toFixed(1) + 's';
    return Math.floor(s / 60) + ':' + (s % 60).toFixed(1).padStart(4, '0');
  }

  function toCell(v) { return (v - CELL_CENTER) / STEP; }

  /* ---------------- level ---------------- */

  function levelConfig(level) {
    var size = Math.min(MAX_SIZE, 8 + Math.floor((level - 1) * 0.8));
    var keys = Math.min(6, 2 + Math.floor((level - 1) / 2));
    var foes = Math.min(5, 1 + Math.floor((level - 1) / 2));
    return { cols: size, rows: size, keys: keys, foes: foes };
  }

  function startLevel(level, opts) {
    opts = opts || {};
    var cfg = levelConfig(level);
    var seed = opts.seed != null ? opts.seed : (Math.random() * 0xffffff) >>> 0;
    var maze = Maze.generate({
      cols: cfg.cols,
      rows: cfg.rows,
      seed: seed,
      keyCount: cfg.keys,
      braid: 0.22
    });

    G.level = level;
    G.maze = maze;

    var world = Maze.toBlockGrid(maze, CORRIDOR);
    G.grid = world.grid;
    G.gw = world.W;
    G.gh = world.H;

    var spawn = cellToWorld(maze.start);
    G.px = spawn.x;
    G.py = spawn.y;
    G.vx = 0;
    G.vy = 0;
    G.pitch = 0;
    G.bob = 0;
    G.bobPhase = 0;

    var bits = maze.cells[maze.start];
    var openings = [];
    if (bits & 1) openings.push(-Math.PI / 2);
    if (bits & 2) openings.push(0);
    if (bits & 4) openings.push(Math.PI / 2);
    if (bits & 8) openings.push(Math.PI);
    G.yaw = openings.length ? openings[(Math.random() * openings.length) | 0] : 0;

    G.keysLeft = new Set(maze.keys);
    G.totalKeys = maze.keys.length;
    G.seen = new Uint8Array(maze.cols * maze.rows);
    G.seenBlocks = new Uint8Array(world.W * world.H);
    G.mmDirty = true;
    G.steps = 0;
    G.dist = 0;
    G.startAt = 0;
    G.elapsed = 0;
    G.newRecord = false;
    G.mode = 'play';
    G.flash = 0;
    G.shake = 0;
    G.danger = 0;
    G.caughtAt = 0;
    G.kick = 0;
    G.muzzle = 0;
    G.tracer = 0;
    G.decals = [];

    G.items = [];
    maze.keys.forEach(function (idx) {
      var p = cellToWorld(idx);
      G.items.push({ kind: 'key', idx: idx, x: p.x, y: p.y, r: 255, g: 186, b: 76 });
    });
    var ep = cellToWorld(maze.exit);
    G.items.push({ kind: 'exit', x: ep.x, y: ep.y, r: 60, g: 230, b: 210 });

    G.sentinels = spawnSentinels(cfg.foes, level);

    if (level > profile.maxLevel) {
      profile.maxLevel = level;
      saveProfile();
    }

    G.ammo = AMMO_MAX;
    G.reloading = false;
    G.trigger = false;
    updateAmmoHud();

    reveal();
    renderKeys();
    updateHud();
    hideOverlay();
  }

  function cellToWorld(idx) {
    var cols = G.maze.cols;
    var x = idx % cols;
    var y = Math.floor(idx / cols);
    return { x: x * STEP + CELL_CENTER, y: y * STEP + CELL_CENTER };
  }

  function spawnSentinels(count, level) {
    var world = { grid: G.grid, gw: G.gw, gh: G.gh };
    var startBlock = G.gw + 1;
    var dist = Maze.bfsBlocks(G.grid, G.gw, G.gh, startBlock);

    var minDist = 14;
    var cands = [];
    for (var i = 0; i < dist.length; i++) {
      if (dist[i] >= minDist) cands.push(i);
    }
    // labirin kecil: turunkan syarat jarak
    while (cands.length < count * 3 && minDist > 6) {
      minDist -= 2;
      cands = [];
      for (var j = 0; j < dist.length; j++) if (dist[j] >= minDist) cands.push(j);
    }

    // acak
    for (var k = cands.length - 1; k > 0; k--) {
      var r = (Math.random() * (k + 1)) | 0;
      var tmp = cands[k];
      cands[k] = cands[r];
      cands[r] = tmp;
    }

    var sight = 6.2 + Math.min(2.4, (level - 1) * 0.22);
    var hear = 4.6 + Math.min(2, (level - 1) * 0.18);

    var out = [];
    for (var c = 0; c < cands.length && out.length < count; c++) {
      var bx = cands[c] % G.gw;
      var by = Math.floor(cands[c] / G.gw);
      var ok = true;
      for (var o = 0; o < out.length; o++) {
        if (Math.hypot(out[o].x - (bx + 0.5), out[o].y - (by + 0.5)) < 6) { ok = false; break; }
      }
      if (!ok) continue;
      out.push(Sentinel.create({
        x: bx + 0.5,
        y: by + 0.5,
        sight: sight,
        hear: hear,
        hp: 3
      }));
    }

    // kalau masih kurang, longgarkan
    for (var d = 0; d < cands.length && out.length < count; d++) {
      var bx2 = cands[d] % G.gw;
      var by2 = Math.floor(cands[d] / G.gw);
      var dup = out.some(function (s) {
        return Math.hypot(s.x - (bx2 + 0.5), s.y - (by2 + 0.5)) < 2;
      });
      if (!dup) out.push(Sentinel.create({ x: bx2 + 0.5, y: by2 + 0.5, sight: sight, hear: hear, hp: 3 }));
    }

    void world;
    return out;
  }

  function reveal() {
    var m = G.maze;
    if (!m) return;
    var mx = toCell(G.px);
    var my = toCell(G.py);
    var R = 2.5;
    var r = Math.ceil(R);
    var added = false;
    for (var y = Math.max(0, Math.floor(my) - r); y <= Math.min(m.rows - 1, Math.ceil(my) + r); y++) {
      for (var x = Math.max(0, Math.floor(mx) - r); x <= Math.min(m.cols - 1, Math.ceil(mx) + r); x++) {
        var dx = x - mx;
        var dy = y - my;
        if (dx * dx + dy * dy > R * R) continue;
        var idx = y * m.cols + x;
        if (!G.seen[idx]) { G.seen[idx] = 1; added = true; }
      }
    }
    if (added) rebuildSeenBlocks();
  }

  function revealAll() {
    if (!G.seen) return;
    G.seen.fill(1);
    rebuildSeenBlocks();
  }

  /** Tandai blok labirin yang sudah terlihat, untuk denah di minimap. */
  function rebuildSeenBlocks() {
    var m = G.maze;
    if (!m || !G.seenBlocks) return;
    var step = CORRIDOR + 1;
    var openW = CORRIDOR;

    for (var by = 0; by < G.gh; by++) {
      for (var bx = 0; bx < G.gw; bx++) {
        var i = by * G.gw + bx;
        if (G.grid[i]) { G.seenBlocks[i] = 0; continue; }

        var lx = (bx - 1) % step;
        var ly = (by - 1) % step;
        var cx = Math.floor((bx - 1) / step);
        var cy = Math.floor((by - 1) / step);

        var seen = false;
        var spanX = lx < openW ? 1 : 2;
        var spanY = ly < openW ? 1 : 2;

        for (var dx = 0; dx < spanX && !seen; dx++) {
          for (var dy = 0; dy < spanY && !seen; dy++) {
            var tx = cx + dx;
            var ty = cy + dy;
            if (tx < 0 || ty < 0 || tx >= m.cols || ty >= m.rows) continue;
            if (G.seen[ty * m.cols + tx]) seen = true;
          }
        }
        G.seenBlocks[i] = seen ? 1 : 0;
      }
    }
    G.mmDirty = true;
  }

  function blocked(x, y) {
    if (G.ghost) return false;
    var x0 = Math.floor(x - RADIUS);
    var x1 = Math.floor(x + RADIUS);
    var y0 = Math.floor(y - RADIUS);
    var y1 = Math.floor(y + RADIUS);
    for (var gy = y0; gy <= y1; gy++) {
      for (var gx = x0; gx <= x1; gx++) {
        if (gx < 0 || gy < 0 || gx >= G.gw || gy >= G.gh) return true;
        if (G.grid[gy * G.gw + gx]) return true;
      }
    }
    return false;
  }

  /* ---------------- senjata ---------------- */

  function updateAmmoHud() {
    el.ammoCount.textContent = String(G.ammo);
    el.ammoFill.style.width = Math.max(0, Math.min(100, (G.ammo / AMMO_MAX) * 100)) + '%';
    el.ammo.classList.toggle('reloading', G.reloading);
    el.ammo.classList.toggle('empty', G.ammo === 0 && !G.reloading);
    el.ammoTag.textContent = G.reloading ? 'RELOAD' : 'AK-47';
  }

  function startReload() {
    if (G.mode !== 'play' || G.reloading || G.ammo === AMMO_MAX) return;
    G.reloading = true;
    G.reloadEnd = performance.now() + RELOAD_MS;
    Sound.reload();
    updateAmmoHud();
  }

  function fire() {
    if (G.mode !== 'play') return;
    var now = performance.now();
    if (G.reloading || now < G.fireAt) return;

    if (G.ammo <= 0) {
      Sound.dry();
      startReload();
      return;
    }

    G.ammo--;
    G.fireAt = now + FIRE_COOLDOWN;
    G.flash = 1;
    G.kick = 1;
    G.muzzle = 1;
    G.tracer = 1;
    G.shake = 5;
    Sound.shoot();
    updateAmmoHud();

    var dirX = Math.cos(G.yaw);
    var dirY = Math.sin(G.yaw);
    var wall = Maze.rayWallDistance(G.grid, G.gw, G.gh, G.px, G.py, dirX, dirY, 30);

    var best = null;
    var bestDist = 1e9;

    for (var i = 0; i < G.sentinels.length; i++) {
      var s = G.sentinels[i];
      var dx = s.x - G.px;
      var dy = s.y - G.py;
      var fwd = dx * dirX + dy * dirY;
      if (fwd <= 0.15 || fwd >= wall) continue;

      var lat = Math.abs(-dx * dirY + dy * dirX);
      var tol = 0.30 + fwd * 0.028;      // toleransi sudut tumbuh sedikit dengan jarak
      if (lat > tol) continue;

      if (!Maze.losClear(G.grid, G.gw, G.gh, G.px, G.py, s.x, s.y)) continue;

      if (fwd < bestDist) { bestDist = fwd; best = s; }
    }

    if (best) hitEnemy(best);
    else addDecal(dirX, dirY, wall);

    // tembakan terdengar jauh — semua penjaga menuju sumber suara
    for (var j = 0; j < G.sentinels.length; j++) {
      var e = G.sentinels[j];
      if (e === best) continue;
      if (Math.hypot(e.x - G.px, e.y - G.py) > SHOT_ALERT) continue;
      e.state = 'alert';
      e.lastKnown = { x: G.px, y: G.py };
      e.lostT = 0;
      e.hasTarget = false;
    }

    if (G.ammo === 0) startReload();
  }

  function addDecal(dirX, dirY, wallDist) {
    var d = Math.min(wallDist, 26) - 0.07;
    if (d <= 0.1) return;
    G.decals.push({ x: G.px + dirX * d, y: G.py + dirY * d, life: 1 });
    if (G.decals.length > 28) G.decals.shift();
  }

  function hitEnemy(s) {
    s.hp -= 1;
    G.hitAt = performance.now();
    crosshair.classList.add('hit');
    setTimeout(function () { crosshair.classList.remove('hit'); }, 110);

    if (s.hp <= 0) {
      var idx = G.sentinels.indexOf(s);
      if (idx >= 0) G.sentinels.splice(idx, 1);
      Sound.kill();
      G.shake = 9;
      G.flash = 1;
      flashObjective('PENJAGA HANCUR');
      if (G.sentinels.length === 0) {
        setTimeout(function () {
          if (G.mode === 'play') flashObjective('AREA BERSIH — AMBIL KUNCINYA');
        }, 900);
      }
    } else {
      Sound.hit();
      s.state = 'chase';
      s.lastKnown = { x: G.px, y: G.py };
      s.lostT = 0;
      flashObjective('PENJAGA TERLUKA');
    }
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    G.time += dt / 1000;
    var dts = dt / 1000;

    if (G.mode === 'play') {
      var fwd = 0;
      var strafe = 0;
      var k = G.keys;

      if (k.w || k.arrowup) fwd += 1;
      if (k.s || k.arrowdown) fwd -= 1;
      if (k.a) strafe -= 1;
      if (k.d) strafe += 1;
      if (G.stickInput) {
        fwd -= G.stickInput.y;
        strafe += G.stickInput.x;
      }
      if (k.arrowleft) G.yaw -= TURN * dts;
      if (k.arrowright) G.yaw += TURN * dts;

      var mag = Math.hypot(fwd, strafe);
      if (mag > 1) { fwd /= mag; strafe /= mag; }

      var dirX = Math.cos(G.yaw);
      var dirY = Math.sin(G.yaw);
      var tvx = (dirX * fwd - dirY * strafe) * SPEED;
      var tvy = (dirY * fwd + dirX * strafe) * SPEED;

      var acc = 1 - Math.exp(-dts * 15);
      G.vx += (tvx - G.vx) * acc;
      G.vy += (tvy - G.vy) * acc;

      var movX = G.vx * dts;
      var movY = G.vy * dts;
      if (!blocked(G.px + movX, G.py)) G.px += movX;
      else G.vx *= 0.4;
      if (!blocked(G.px, G.py + movY)) G.py += movY;
      else G.vy *= 0.4;

      var speed = Math.hypot(G.vx, G.vy);
      G.dist += speed * dts;

      G.bobPhase += speed * dts * 6.2;
      G.bob = Math.sin(G.bobPhase) * 0.007 * Math.min(1, speed / SPEED);

      if (speed > 0.6) {
        var now = performance.now();
        if (now - G.footAt > 400) {
          G.footAt = now;
          Sound.step();
        }
        if (!G.startAt && !G.ghost) G.startAt = now;
      }

      if (G.reloading && performance.now() >= G.reloadEnd) {
        G.reloading = false;
        G.ammo = AMMO_MAX;
        updateAmmoHud();
      }

      if (G.trigger) fire();

      reveal();
      checkPickups();
      updateSentinels(dts, speed);

      if (G.startAt && G.mode === 'play') G.elapsed = performance.now() - G.startAt;
    }

    G.flash = Math.max(0, G.flash - dts * 6);
    if (!G.holdFx) {
      G.kick = Math.max(0, G.kick - dts * 9);
      G.muzzle = Math.max(0, G.muzzle - dts * 14);
      G.tracer = Math.max(0, G.tracer - dts * 12);
    }
    G.sway = Math.sin(G.time * 1.7) * 0.006 + G.bob * 0.5;

    for (var i = G.decals.length - 1; i >= 0; i--) {
      G.decals[i].life -= dts * 0.06;
      if (G.decals[i].life <= 0) G.decals.splice(i, 1);
    }

    if (G.shake > 0.2) G.shake *= 0.86;
    else G.shake = 0;

    updateHud();
  }

  function updateSentinels(dts, playerSpeed) {
    var chasing = false;
    var nearest = 1e9;

    for (var i = G.sentinels.length - 1; i >= 0; i--) {
      var s = G.sentinels[i];
      var prevX = s.x;
      var prevY = s.y;

      var ev = Sentinel.update(s, dts, {
        grid: G.grid,
        gw: G.gw,
        gh: G.gh,
        px: G.px,
        py: G.py,
        playerSpeed: playerSpeed,
        ghost: G.ghost
      });

      var moved = s.x !== prevX || s.y !== prevY;
      s.walkT = (s.walkT || 0) + (moved ? dts * 7 : 0);
      s.frame = moved ? Math.floor(s.walkT) % 4 : 0;
      s.bob = Sentinel.bob(s, G.time);

      if (ev.spottedNow) {
        Sound.alert();
        flashObjective('TERDETEKSI — LARI ATAU TEMBAK');
      }

      if (Sentinel.isChasing(s)) {
        chasing = true;
        var d = Math.hypot(s.x - G.px, s.y - G.py);
        if (d < nearest) nearest = d;
      }

      if (ev.caught && !G.ghost && G.mode === 'play') {
        caught();
        return;
      }
    }

    var target = chasing ? clamp(1.15 - nearest / 12, 0.35, 1) : 0;
    G.danger += (target - G.danger) * Math.min(1, dts * 6);
    dangerEl.style.opacity = (G.danger * 0.8).toFixed(3);

    if (chasing) {
      var now = performance.now();
      if (now - G.chasePulse > 640) {
        G.chasePulse = now;
        Sound.chase();
      }
    }
  }

  function checkPickups() {
    if (G.ghost) return;
    var i;
    for (i = G.items.length - 1; i >= 0; i--) {
      var it = G.items[i];
      if (it.kind !== 'key') continue;
      var d = Math.hypot(it.x - G.px, it.y - G.py);
      if (d < 0.6) collectKey(it, i);
    }

    for (i = 0; i < G.items.length; i++) {
      var ex = G.items[i];
      if (ex.kind !== 'exit') continue;
      var de = Math.hypot(ex.x - G.px, ex.y - G.py);
      if (de < 0.55) {
        if (G.keysLeft.size > 0) {
          if (!G.exitHint || performance.now() - G.exitHint > 1400) {
            G.exitHint = performance.now();
            flashObjective('PINTU TERKUNCI — SISA ' + G.keysLeft.size + ' KUNCI');
          }
        } else {
          win();
        }
      }
    }
  }

  function collectKey(item, index) {
    G.keysLeft.delete(item.idx);
    G.items.splice(index, 1);
    Sound.key();
    renderKeys();
    updateObjective();
    if (G.keysLeft.size === 0) {
      var exitItem = G.items.filter(function (x) { return x.kind === 'exit'; })[0];
      if (exitItem) { exitItem.r = 255; exitItem.g = 200; exitItem.b = 90; }
      flashObjective('SEMUA KUNCI DIDAPAT — CARI PINTU KELUAR');
    } else {
      flashObjective('KUNCI ' + (G.totalKeys - G.keysLeft.size) + '/' + G.totalKeys + ' DIDAPAT');
    }
  }

  function win() {
    G.mode = 'clear';
    G.elapsed = performance.now() - G.startAt;
    var prev = profile.best[G.level];
    G.newRecord = !prev || G.elapsed < prev;
    if (G.newRecord) {
      profile.best[G.level] = G.elapsed;
      saveProfile();
    }
    Sound.win();
    showClear();
  }

  function caught() {
    G.mode = 'caught';
    G.elapsed = G.startAt ? performance.now() - G.startAt : 0;
    G.danger = 1;
    dangerEl.style.opacity = '1';
    Sound.caught();
    showCaught();
  }

  /* ---------------- render ---------------- */

  function render() {
    Ray.render({
      grid: G.grid,
      gw: G.gw,
      gh: G.gh,
      px: G.px,
      py: G.py,
      yaw: G.yaw,
      pitch: G.pitch,
      bob: G.bob,
      maxDist: MAX_DIST,
      items: G.items,
      enemies: G.sentinels,
      decals: G.decals,
      flash: G.flash,
      weapon: {
        kick: G.kick,
        muzzle: G.muzzle,
        tracer: G.tracer,
        sway: G.sway,
        reload: G.reloading ? 1 : 0
      },
      time: G.time
    });
    drawMinimap();
  }

  function drawMinimap() {
    var W = minimap.width;
    var H = minimap.height;
    mmctx.clearRect(0, 0, W, H);
    mmctx.fillStyle = 'rgba(8, 16, 22, 0.5)';
    mmctx.fillRect(0, 0, W, H);
    if (!G.maze || !G.seenBlocks) return;

    if (G.mmDirty) buildMinimapBase();
    mmctx.drawImage(G.mmBase, 0, 0);

    var unit = G.mmUnit;
    var ox = G.mmOx;
    var oy = G.mmOy;

    // kunci
    G.items.forEach(function (it) {
      if (it.kind !== 'key') return;
      var cx = ox + it.x * unit;
      var cy = oy + it.y * unit;
      var s = Math.max(2.6, unit * 1.7);
      mmctx.save();
      mmctx.translate(cx, cy);
      mmctx.rotate(Math.PI / 4);
      mmctx.fillStyle = '#ffb84c';
      mmctx.fillRect(-s / 2, -s / 2, s, s);
      mmctx.restore();
    });

    // pintu keluar
    var exitItem = null;
    for (var e = 0; e < G.items.length; e++) {
      if (G.items[e].kind === 'exit') { exitItem = G.items[e]; break; }
    }
    if (exitItem) {
      var r = Math.max(3, unit * 2.4);
      mmctx.strokeStyle = G.keysLeft.size === 0 ? '#ffd166' : '#00d9c0';
      mmctx.lineWidth = 1.4;
      mmctx.strokeRect(ox + exitItem.x * unit - r / 2, oy + exitItem.y * unit - r / 2, r, r);
    }

    // penjaga
    G.sentinels.forEach(function (s) {
      var d = Math.hypot(s.x - G.px, s.y - G.py);
      if (!(d < 6.5 || Sentinel.isChasing(s) || G.ghost)) return;
      mmctx.fillStyle = Sentinel.isChasing(s) ? '#ff4655' : 'rgba(255, 120, 120, 0.7)';
      mmctx.beginPath();
      mmctx.arc(ox + s.x * unit, oy + s.y * unit, Math.max(1.6, unit * 0.85), 0, Math.PI * 2);
      mmctx.fill();
    });

    // pemain
    var px = ox + G.px * unit;
    var py = oy + G.py * unit;
    var size = Math.max(4, unit * 2.2);
    mmctx.save();
    mmctx.translate(px, py);
    mmctx.rotate(G.yaw);
    mmctx.fillStyle = G.ghost ? '#7fe9ff' : '#ff4655';
    mmctx.beginPath();
    mmctx.moveTo(size * 0.85, 0);
    mmctx.lineTo(-size * 0.5, size * 0.55);
    mmctx.lineTo(-size * 0.5, -size * 0.55);
    mmctx.closePath();
    mmctx.fill();
    mmctx.restore();
  }

  /** Denah labirin: gambar blok yang sudah terlihat, bukan kotak per sel. */
  function buildMinimapBase() {
    var W = minimap.width;
    var H = minimap.height;
    if (!G.mmBase || G.mmBase.width !== W || G.mmBase.height !== H) {
      G.mmBase = document.createElement('canvas');
      G.mmBase.width = W;
      G.mmBase.height = H;
    }
    var c = G.mmBase.getContext('2d');
    c.clearRect(0, 0, W, H);

    var span = Math.max(G.gw, G.gh);
    var unit = (W - 8) / span;
    var ox = (W - G.gw * unit) / 2;
    var oy = (H - G.gh * unit) / 2;

    G.mmUnit = unit;
    G.mmOx = ox;
    G.mmOy = oy;

    c.fillStyle = G.ghost ? 'rgba(150, 235, 255, 0.28)' : 'rgba(236, 232, 225, 0.22)';
    for (var by = 0; by < G.gh; by++) {
      for (var bx = 0; bx < G.gw; bx++) {
        var i = by * G.gw + bx;
        if (!G.seenBlocks[i]) continue;
        c.fillRect(ox + bx * unit, oy + by * unit, unit + 0.7, unit + 0.7);
      }
    }

    G.mmDirty = false;
  }

  /* ---------------- HUD ---------------- */

  function updateHud() {
    el.level.textContent = String(G.level).padStart(2, '0');
    el.time.textContent = fmt(G.elapsed);
    el.best.textContent = profile.best[G.level] ? fmtUnit(profile.best[G.level]) : '—';
  }

  function updateObjective() {
    if (!G.maze) return;
    if (G.ghost) {
      objectiveEl.textContent = 'MODE HANTU — PETA TERBUKA';
      objectiveEl.classList.add('open');
      return;
    }
    if (G.keysLeft.size === 0) {
      objectiveEl.textContent = 'CARILAH PINTU KELUAR';
      objectiveEl.classList.add('open');
    } else {
      objectiveEl.textContent = 'AMBIL ' + G.keysLeft.size + ' KUNCI LAGI';
      objectiveEl.classList.remove('open');
    }
  }

  var flashTimer = 0;
  function flashObjective(text) {
    objectiveEl.textContent = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () {
      if (G.mode === 'play') updateObjective();
    }, 1600);
  }

  function renderKeys() {
    var html = '';
    for (var i = 0; i < G.totalKeys; i++) {
      html += '<div class="key-slot' + (i < G.totalKeys - G.keysLeft.size ? ' got' : '') + '"></div>';
    }
    el.keys.innerHTML = html;
    updateObjective();
  }

  function updateHint() {
    if (G.isTouch) {
      hintEl.textContent = 'STIK KIRI GERAK · GESER KANAN LIHAT · ◎ TEMBAK';
    } else if (G.ghost) {
      hintEl.textContent = 'MODE HANTU · G UNTUK KEMBALI NORMAL · WASD GERAK';
    } else if (G.locked) {
      hintEl.textContent = 'SPASI / KLIK TEMBAK · R RELOAD · G HANTU · BACKSPACE ULANGI';
    } else {
      hintEl.textContent = 'KLIK UNTUK KUNCI KURSOR · WASD GERAK · SPASI TEMBAK';
    }
  }

  /* ---------------- overlay ---------------- */

  function hideOverlay() {
    overlay.classList.remove('show');
    overlay.innerHTML = '';
  }

  function showTitle() {
    G.mode = 'title';
    var resume = profile.maxLevel > 1;
    var bestKey = Object.keys(profile.best).sort(function (a, b) { return Number(b) - Number(a); })[0];
    overlay.innerHTML =
      '<div class="panel">' +
        '<div class="brandline"><span class="sq"></span>PROTOKOL 02</div>' +
        '<h1>KEY<br><em>HUNTER</em></h1>' +
        '<p class="lede">Penjaga berpatroli di lorong. Mereka melihat sejauh garis pandang, dan mendengar langkahmu. AK-47 di tanganmu punya tiga puluh butir — cukup untuk semua orang, asal kamu tidak terjebak di jalan buntu.</p>' +
        '<div class="metrics">' +
          '<div class="metric"><span>LEVEL TERTINGGI</span><b>' + String(profile.maxLevel).padStart(2, '0') + '</b></div>' +
          '<div class="metric"><span>REKOR TERBAIK</span><b>' + (bestKey ? fmtUnit(profile.best[bestKey]) : '—') + '</b></div>' +
        '</div>' +
        '<button class="btn primary" data-act="' + (resume ? 'resume' : 'start') + '">' +
          (resume ? 'LANJUT LEVEL ' + profile.maxLevel : 'MULAI MISI') +
        '</button>' +
        (resume ? '<button class="btn ghost" data-act="start">MULAI DARI LEVEL 01</button>' : '') +
        '<div class="controls">' +
          '<b>Gerak</b><span><kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> · stik kiri di HP</span>' +
          '<b>Lihat</b><span>gerakkan mouse · geser kanan di HP</span>' +
          '<b>Tembak</b><span>tahan <kbd>Spasi</kbd> / klik mouse · ◎ di HP</span>' +
          '<b>Reload</b><span><kbd>R</kbd> · atau tap panel amunisi</span>' +
          '<b>Hantu</b><span><kbd>G</kbd> tembus dinding & lihat seluruh denah</span>' +
          '<b>Lainnya</b><span><kbd>Backspace</kbd> ulangi · <kbd>M</kbd> suara</span>' +
        '</div>' +
      '</div>';
    overlay.classList.add('show');
  }

  function showClear() {
    var best = profile.best[G.level];
    var next = G.level + 1;
    overlay.innerHTML =
      '<div class="panel">' +
        '<div class="brandline"><span class="sq"></span>MISI SELESAI</div>' +
        (G.newRecord ? '<div class="badge">REKOR BARU</div>' : '') +
        '<div class="big">' + fmt(G.elapsed) + '<small>s</small></div>' +
        '<div class="subline">LEVEL ' + String(G.level).padStart(2, '0') + ' · JARAK ' + Math.round(G.dist) + 'M · REKOR ' + fmtUnit(best) + '</div>' +
        '<button class="btn primary" data-act="next">LEVEL ' + String(next).padStart(2, '0') + '</button>' +
        '<div class="row2">' +
          '<button class="btn ghost" data-act="replay">ULANGI</button>' +
          '<button class="btn ghost" data-act="share">BAGIKAN</button>' +
        '</div>' +
      '</div>';
    overlay.classList.add('show');
  }

  function showCaught() {
    overlay.innerHTML =
      '<div class="panel">' +
        '<div class="brandline"><span class="sq"></span>SINYAL HILANG</div>' +
        '<div class="badge">TERTANGKAP</div>' +
        '<div class="big">' + fmt(G.elapsed) + '<small>s</small></div>' +
        '<div class="subline">LEVEL ' + String(G.level).padStart(2, '0') + ' · ' + G.keysLeft.size + ' KUNCI TERSISA</div>' +
        '<p class="lede">Penjaga menyentuhmu. Lorongnya sama — sekarang kamu tahu di mana mereka lewat.</p>' +
        '<button class="btn primary" data-act="retry">COBA LAGI</button>' +
        '<button class="btn ghost" data-act="menu">KEMBALI KE MENU</button>' +
      '</div>';
    overlay.classList.add('show');
  }

  overlay.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    Sound.click();

    if (act === 'start') startLevel(1);
    else if (act === 'resume') startLevel(profile.maxLevel);
    else if (act === 'next') startLevel(G.level + 1);
    else if (act === 'replay') startLevel(G.level, { seed: G.maze.seed });
    else if (act === 'retry') startLevel(G.level, { seed: G.maze.seed });
    else if (act === 'share') { shareResult(); return; }
    else if (act === 'menu') {
      startLevel(Math.max(1, profile.maxLevel));
      G.mode = 'title';
      showTitle();
      return;
    }

    hideOverlay();
    lockPointer();
  });

  function shareResult() {
    var text = 'KEY HUNTER — Level ' + G.level + ' selesai dalam ' + fmt(G.elapsed) + 's. Bisa lebih cepat?';
    var url = /^https?:/.test(location.href) ? location.href : '';

    if (navigator.share) {
      navigator.share({ text: text, url: url || undefined }).catch(function () {});
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text + (url ? ' ' + url : '')).then(function () {
        flashObjective('HASIL DISALIN');
      }).catch(function () {
        flashObjective('SALIN GAGAL — ' + text);
      });
    } else {
      flashObjective(text);
    }
  }

  /* ---------------- input ---------------- */

  function lockPointer() {
    if (G.isTouch) return;
    if (document.pointerLockElement === canvas) return;
    try { canvas.requestPointerLock(); } catch (err) { /* diabaikan */ }
  }

  document.addEventListener('pointerlockchange', function () {
    G.locked = document.pointerLockElement === canvas;
    updateHint();
  });

  document.addEventListener('mousemove', function (e) {
    if (G.mode !== 'play' || G.isTouch) return;
    var mx = e.movementX || 0;
    var my = e.movementY || 0;
    if (!mx && !my) return;
    G.yaw += mx * MOUSE_SENS;
    G.pitch = clamp(G.pitch - my * 0.0016, -0.28, 0.28);
  });

  canvas.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') {
      Sound.unlock();
      if (!G.locked) {
        lockPointer();
        return;
      }
      if (e.button === 0) {
        G.trigger = true;
        fire();
      }
      return;
    }
    handleTouchStart(e);
  });

  window.addEventListener('pointerup', function () { G.trigger = false; });
  window.addEventListener('pointercancel', function () { G.trigger = false; });

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') return;
    handleTouchMove(e);
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
    canvas.addEventListener(evt, function (e) {
      if (e.pointerType === 'mouse') return;
      handleTouchEnd(e);
    });
  });

  var stickId = null;
  var lookId = null;
  var stickOrigin = { x: 0, y: 0 };
  var lookPrev = { x: 0, y: 0 };

  function handleTouchStart(e) {
    Sound.unlock();
    if (e.clientX < window.innerWidth * 0.45 && stickId === null) {
      stickId = e.pointerId;
      stickOrigin = { x: e.clientX, y: e.clientY };
      G.stickInput = { x: 0, y: 0 };
      stickEl.style.left = (e.clientX - 52) + 'px';
      stickEl.style.bottom = 'auto';
      stickEl.style.top = (e.clientY - 52) + 'px';
      moveKnob(0, 0);
    } else if (lookId === null) {
      lookId = e.pointerId;
      lookPrev = { x: e.clientX, y: e.clientY };
    }
  }

  function handleTouchMove(e) {
    if (e.pointerId === stickId) {
      var dx = e.clientX - stickOrigin.x;
      var dy = e.clientY - stickOrigin.y;
      var len = Math.hypot(dx, dy);
      var max = 46;
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max; }
      moveKnob(dx, dy);
      G.stickInput = { x: dx / max, y: dy / max };
    } else if (e.pointerId === lookId) {
      var lx = e.clientX - lookPrev.x;
      var ly = e.clientY - lookPrev.y;
      lookPrev = { x: e.clientX, y: e.clientY };
      G.yaw += lx * 0.005;
      G.pitch = clamp(G.pitch - ly * 0.004, -0.28, 0.28);
    }
  }

  function handleTouchEnd(e) {
    if (e.pointerId === stickId) {
      stickId = null;
      G.stickInput = null;
      moveKnob(0, 0);
    }
    if (e.pointerId === lookId) lookId = null;
  }

  function moveKnob(dx, dy) {
    knobEl.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
  }

  el.fire.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    Sound.unlock();
    G.trigger = true;
    fire();
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (evt) {
    el.fire.addEventListener(evt, function () { G.trigger = false; });
  });

  el.ammo.addEventListener('click', function () { startReload(); });

  window.addEventListener('keydown', function (e) {
    var k = e.key.toLowerCase();

    if (k === 'm') {
      toggleMute();
      return;
    }
    if (k === 'g') {
      toggleGhost();
      return;
    }
    if (k === 'r') {
      startReload();
      return;
    }
    if (k === 'backspace') {
      e.preventDefault();
      if (G.maze) {
        startLevel(G.level, { seed: G.maze.seed });
        flashObjective('LEVEL DIULANG');
      }
      return;
    }
    if (e.key === 'Enter' && overlay.classList.contains('show')) {
      var primary = overlay.querySelector('.btn.primary');
      if (primary) { primary.click(); e.preventDefault(); }
      return;
    }

    if (k === ' ' || k === 'spacebar') {
      e.preventDefault();
      Sound.unlock();
      if (!e.repeat) {
        G.trigger = true;
        fire();
      }
      return;
    }

    G.keys[k] = true;
    if (k.indexOf('arrow') === 0) e.preventDefault();
  });

  window.addEventListener('keyup', function (e) {
    var k = e.key.toLowerCase();
    if (k === ' ' || k === 'spacebar') G.trigger = false;
    G.keys[k] = false;
  });

  window.addEventListener('blur', function () {
    G.keys = {};
    G.trigger = false;
    G.stickInput = null;
  });

  el.restart.addEventListener('click', function () {
    if (!G.maze) return;
    startLevel(G.level, { seed: G.maze.seed });
    flashObjective('LEVEL DIULANG');
  });

  function toggleGhost() {
    G.ghost = !G.ghost;
    document.body.classList.toggle('ghost', G.ghost);
    el.ghost.classList.toggle('on', G.ghost);
    G.trigger = false;

    if (G.ghost) {
      if (G.startAt) G.elapsed = performance.now() - G.startAt;
      G.startAt = 0;
      revealAll();
      G.danger = 0;
      dangerEl.style.opacity = '0';
      flashObjective('MODE HANTU — TEMBUS DINDING');
      Sound.click();
    } else {
      if (G.mode === 'play') G.startAt = performance.now() - G.elapsed;
      flashObjective('MODE NORMAL');
    }
    updateObjective();
    updateHint();
  }

  el.ghost.addEventListener('click', toggleGhost);

  function toggleMute() {
    profile.muted = !profile.muted;
    Sound.setMuted(profile.muted);
    el.mute.textContent = profile.muted ? '🔇' : '🔊';
    saveProfile();
    if (!profile.muted) Sound.click();
    flashObjective(profile.muted ? 'SUARA DIMATIKAN' : 'SUARA DIHIDUPKAN');
  }

  el.mute.addEventListener('click', toggleMute);

  /* ---------------- loop ---------------- */

  var lastT = 0;

  function frame(now) {
    if (!lastT) lastT = now;
    var dt = Math.min(64, now - lastT);
    lastT = now;

    update(dt);
    render();

    requestAnimationFrame(frame);
  }

  /* ---------------- boot ---------------- */

  function resizeAll() {
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    Ray.resize(rect.width, rect.height, dpr);
    minimap.width = 150;
    minimap.height = 150;
    mmctx = minimap.getContext('2d');
  }

  if (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
    G.isTouch = true;
    document.body.classList.add('touch');
  }
  window.addEventListener('touchstart', function once() {
    G.isTouch = true;
    document.body.classList.add('touch');
    updateHint();
    window.removeEventListener('touchstart', once);
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      G.hiddenAt = performance.now();
    } else if (G.hiddenAt && G.startAt) {
      G.startAt += performance.now() - G.hiddenAt;
      G.hiddenAt = 0;
      G.keys = {};
    }
  });

  window.addEventListener('resize', function () { resizeAll(); });

  Ray.init(canvas);
  resizeAll();
  updateHint();
  updateHud();
  updateAmmoHud();

  // mode pratinjau / screenshot
  if (/[?&]shot=4/.test(location.search)) {
    startLevel(1, { seed: 12345 });
    G.px = 4 * STEP + CELL_CENTER;
    G.py = 4 * STEP + CELL_CENTER;
    G.yaw = 0;
    toggleGhost();
    updateHint();
  } else if (/[?&]shot=3/.test(location.search)) {
    startLevel(1, { seed: 12345 });
    G.px = 4 * STEP + CELL_CENTER;
    G.py = 4 * STEP + CELL_CENTER;
    G.yaw = 0;
    G.sentinels = [];
    reveal();
    var wd = Maze.rayWallDistance(G.grid, G.gw, G.gh, G.px, G.py, 1, 0, 30);
    G.decals.push({ x: G.px + wd - 0.07, y: G.py, life: 1 });
    G.muzzle = 1;
    G.tracer = 1;
    G.kick = 0.6;
    G.holdFx = true;
    updateHint();
  } else if (/[?&]shot=2/.test(location.search)) {
    startLevel(1, { seed: 12345 });
    G.px = 4 * STEP + CELL_CENTER;
    G.py = 4 * STEP + CELL_CENTER;
    G.yaw = 0;
    G.sentinels = [Sentinel.create({ x: G.px + 3, y: G.py, sight: 8, hear: 6, hp: 2 })];
    G.sentinels[0].state = 'chase';
    reveal();
    updateHint();
  } else if (/[?&]shot/.test(location.search)) {
    startLevel(1, { seed: 12345 });
    G.px = 4 * STEP + CELL_CENTER;
    G.py = 4 * STEP + CELL_CENTER;
    G.yaw = 0;
    reveal();
    updateHint();
  } else {
    startLevel(Math.max(1, profile.maxLevel));
    G.mode = 'title';
    showTitle();
  }

  if (/[?&]debug/.test(location.search)) {
    window.__KEYHUNTER = {
      G: G,
      startLevel: startLevel,
      update: update,
      render: render,
      fire: fire,
      startReload: startReload,
      toggleGhost: toggleGhost,
      rebuildSeenBlocks: rebuildSeenBlocks,
      buildMinimapBase: buildMinimapBase,
      cellToWorld: cellToWorld,
      blocked: blocked,
      reveal: reveal
    };
  }

  requestAnimationFrame(frame);
})();
