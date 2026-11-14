/*
 * sentinel.js — penjaga yang berpatroli di labirin.
 *
 * Tiga keadaan:
 *   patrol  : berjalan acak menyusuri lorong
 *   alert   : mendengar langkah kaki, menuju lokasi terakhir
 *   chase   : melihat pemain, mengejar cepat
 *
 * Penjaga tidak pernah lebih cepat dari pemain, jadi selalu ada jalan keluar
 * selama kamu tidak terjebak di jalan buntu.
 */
window.Sentinel = (function () {
  'use strict';

  var PATROL_SPEED = 1.02;
  var ALERT_SPEED = 1.55;
  var CHASE_SPEED = 1.92;

  var FOV_DOT = 0.42;      // ~130 derajat total
  var CLOSE_SENSE = 1.15;  // dalam jarak ini selalu terlihat
  var LOSE_TIME = 1.9;     // detik sebelum kehilangan jejak
  var ALERT_GIVEUP = 6.5;  // detik sebelum kembali patroli
  var CATCH_DIST = 0.52;

  function create(o) {
    return {
      x: o.x,
      y: o.y,
      dirX: 1,
      dirY: 0,
      state: 'patrol',
      tx: o.x,
      ty: o.y,
      hasTarget: false,
      fromX: -1,
      fromY: -1,
      lastKnown: null,
      lostT: 0,
      sightRange: o.sight || 6.5,
      hearRange: o.hear || 5,
      phase: Math.random() * 6.283,
      hp: o.hp || 2,
      spottedAt: 0
    };
  }

  function openBlock(grid, W, H, x, y) {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    return grid[y * W + x] === 0;
  }

  function choosePatrolTarget(s, w) {
    var bx = Math.floor(s.x);
    var by = Math.floor(s.y);
    var opts = [];
    var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (var i = 0; i < 4; i++) {
      var nx = bx + dirs[i][0];
      var ny = by + dirs[i][1];
      if (!openBlock(w.grid, w.gw, w.gh, nx, ny)) continue;
      opts.push([nx, ny]);
    }
    if (opts.length === 0) { s.hasTarget = false; return; }

    if (opts.length > 1) {
      var filtered = opts.filter(function (p) {
        return !(p[0] === s.fromX && p[1] === s.fromY);
      });
      if (filtered.length) opts = filtered;
    }

    var pick = opts[(Math.random() * opts.length) | 0];
    s.fromX = bx;
    s.fromY = by;
    s.tx = pick[0] + 0.5;
    s.ty = pick[1] + 0.5;
    s.hasTarget = true;
  }

  function retarget(s, w) {
    if (!s.lastKnown) { s.hasTarget = false; return; }
    var next = Maze.nextBlockToward(w.grid, w.gw, w.gh, s.x, s.y, s.lastKnown.x, s.lastKnown.y);
    if (!next) { s.hasTarget = false; return; }
    s.tx = next.x + 0.5;
    s.ty = next.y + 0.5;
    s.hasTarget = true;
  }

  /** dt dalam detik. Mengembalikan kejadian penting untuk pemanggil. */
  function update(s, dt, w) {
    var out = { spottedNow: false, caught: false, state: s.state };

    var dx = w.px - s.x;
    var dy = w.py - s.y;
    var d = Math.sqrt(dx * dx + dy * dy);

    // ---- persepsi ----
    var seen = false;
    if (!w.ghost && d <= s.sightRange) {
      var facing = d > 0.001 ? (dx / d) * s.dirX + (dy / d) * s.dirY : 1;
      if (d < CLOSE_SENSE || facing >= FOV_DOT) {
        seen = Maze.losClear(w.grid, w.gw, w.gh, s.x, s.y, w.px, w.py);
      }
    }

    if (seen) {
      if (s.state !== 'chase') out.spottedNow = true;
      s.state = 'chase';
      s.lastKnown = { x: w.px, y: w.py };
      s.lostT = 0;
    } else if (s.state === 'chase') {
      s.lostT += dt;
      if (s.lostT > LOSE_TIME) {
        s.state = 'alert';
        s.lostT = 0;
        s.hasTarget = false;
      }
    } else {
      var heard = !w.ghost && w.playerSpeed > 0.9 && d < s.hearRange;
      if (heard) {
        // lokasi suara tidak presisi
        s.state = 'alert';
        s.lastKnown = {
          x: w.px + (Math.random() - 0.5) * 2.2,
          y: w.py + (Math.random() - 0.5) * 2.2
        };
        s.lostT = 0;
        s.hasTarget = false;
      } else if (s.state === 'alert') {
        s.lostT += dt;
        if (s.lostT > ALERT_GIVEUP) {
          s.state = 'patrol';
          s.lostT = 0;
          s.hasTarget = false;
        }
      }
    }

    // ---- gerak ----
    var speed = s.state === 'chase' ? CHASE_SPEED
      : s.state === 'alert' ? ALERT_SPEED
        : PATROL_SPEED;

    if (!s.hasTarget) {
      if (s.state === 'patrol') choosePatrolTarget(s, w);
      else retarget(s, w);
    }

    if (s.hasTarget) {
      var mx = s.tx - s.x;
      var my = s.ty - s.y;
      var md = Math.sqrt(mx * mx + my * my);

      if (md < 0.06) {
        s.hasTarget = false;
        if (s.state === 'patrol') choosePatrolTarget(s, w);
        else retarget(s, w);
      } else {
        var step = Math.min(md, speed * dt);
        s.x += (mx / md) * step;
        s.y += (my / md) * step;
        var k = 0.18;
        s.dirX += ((mx / md) - s.dirX) * k;
        s.dirY += ((my / md) - s.dirY) * k;
        var len = Math.sqrt(s.dirX * s.dirX + s.dirY * s.dirY) || 1;
        s.dirX /= len;
        s.dirY /= len;
      }
    }

    // ---- tangkap ----
    var ddx = w.px - s.x;
    var ddy = w.py - s.y;
    if (ddx * ddx + ddy * ddy < CATCH_DIST * CATCH_DIST) out.caught = true;

    out.state = s.state;
    return out;
  }

  function isChasing(s) { return s.state === 'chase'; }

  function bob(s, time) {
    return Math.sin(time * 2.4 + s.phase);
  }

  return { create: create, update: update, isChasing: isChasing, bob: bob };
})();
