/*
 * maze.js — generasi labirin deterministik (seeded).
 * Bisa dipakai di browser (window.Maze) maupun Node (module.exports) untuk testing.
 *
 * Representasi: cells[i] = bitmask bukaan dinding.
 *   N = 1, E = 2, S = 4, W = 8
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Maze = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DIRS = [
    { bit: 1, opp: 4, dx: 0, dy: -1 }, // Utara
    { bit: 2, opp: 8, dx: 1, dy: 0 },  // Timur
    { bit: 4, opp: 1, dx: 0, dy: 1 },  // Selatan
    { bit: 8, opp: 2, dx: -1, dy: 0 }  // Barat
  ];

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function popcount(v) {
    var c = 0;
    while (v) { v &= v - 1; c++; }
    return c;
  }

  function bfs(cells, cols, rows, start) {
    var total = cols * rows;
    var dist = new Int32Array(total);
    var queue = new Int32Array(total);
    for (var i = 0; i < total; i++) dist[i] = -1;
    var head = 0, tail = 0;
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      var idx = queue[head++];
      var x = idx % cols;
      var y = (idx / cols) | 0;
      var c = cells[idx];
      for (var d = 0; d < 4; d++) {
        var dir = DIRS[d];
        if (!(c & dir.bit)) continue;
        var nx = x + dir.dx;
        var ny = y + dir.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        var ni = ny * cols + nx;
        if (dist[ni] !== -1) continue;
        dist[ni] = dist[idx] + 1;
        queue[tail++] = ni;
      }
    }
    return dist;
  }

  function generate(opts) {
    opts = opts || {};
    var cols = Math.max(3, Math.floor(opts.cols === undefined ? 9 : opts.cols));
    var rows = Math.max(3, Math.floor(opts.rows === undefined ? 9 : opts.rows));
    var seed = Math.floor(Number(opts.seed) || 0) >>> 0;
    if (seed === 0) seed = 1;
    var keyCount = Math.max(1, Math.floor(opts.keyCount === undefined ? 3 : opts.keyCount));
    var braid = clamp01(opts.braid === undefined ? 0.18 : opts.braid);

    var rng = mulberry32(seed);
    var total = cols * rows;
    var cells = new Uint8Array(total);
    var visited = new Uint8Array(total);
    var stack = new Int32Array(total);
    var sp = 0;

    // Recursive backtracker (iteratif)
    stack[sp++] = 0;
    visited[0] = 1;
    while (sp > 0) {
      var idx = stack[sp - 1];
      var x = idx % cols;
      var y = (idx / cols) | 0;
      var cand = [];
      for (var d = 0; d < 4; d++) {
        var dir = DIRS[d];
        var nx = x + dir.dx;
        var ny = y + dir.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        var ni = ny * cols + nx;
        if (visited[ni]) continue;
        cand.push([dir, ni]);
      }
      if (cand.length === 0) { sp--; continue; }
      var pick = cand[(rng() * cand.length) | 0];
      cells[idx] |= pick[0].bit;
      cells[pick[1]] |= pick[0].opp;
      visited[pick[1]] = 1;
      stack[sp++] = pick[1];
    }

    // Braiding: buka sebagian jalan buntu supaya ada loop (lebih enak dijelajahi)
    if (braid > 0) {
      for (var i = 0; i < total; i++) {
        if (popcount(cells[i]) !== 1) continue;
        if (rng() > braid) continue;
        var bx = i % cols;
        var by = (i / cols) | 0;
        var options = [];
        for (var k = 0; k < 4; k++) {
          var bd = DIRS[k];
          if (cells[i] & bd.bit) continue;
          var bx2 = bx + bd.dx;
          var by2 = by + bd.dy;
          if (bx2 < 0 || by2 < 0 || bx2 >= cols || by2 >= rows) continue;
          options.push(bd);
        }
        if (options.length === 0) continue;
        var chosen = options[(rng() * options.length) | 0];
        var ci = (by + chosen.dy) * cols + (bx + chosen.dx);
        cells[i] |= chosen.bit;
        cells[ci] |= chosen.opp;
      }
    }

    var dist = bfs(cells, cols, rows, 0);

    // Pintu keluar = sel terjauh dari titik awal
    var exit = 0;
    var best = -1;
    for (var e = 0; e < total; e++) {
      if (dist[e] > best) { best = dist[e]; exit = e; }
    }
    if (exit === 0) exit = total - 1;

    // Kunci disebar: prioritaskan sel jauh, beri jarak minimal antar kunci
    var order = [];
    for (var o = 0; o < total; o++) {
      if (o === exit || o === 0) continue;
      order.push(o);
    }
    order.sort(function (a, b) { return dist[b] - dist[a] || a - b; });

    var spacing = Math.max(2, Math.floor(Math.min(cols, rows) / 3));
    var keys = [];
    for (var q = 0; q < order.length && keys.length < keyCount; q++) {
      var cellIdx = order[q];
      if (dist[cellIdx] < 2) continue;
      var ok = true;
      for (var s = 0; s < keys.length; s++) {
        var kx = keys[s] % cols, ky = (keys[s] / cols) | 0;
        var cx = cellIdx % cols, cy = (cellIdx / cols) | 0;
        if (Math.abs(kx - cx) + Math.abs(ky - cy) < spacing) { ok = false; break; }
      }
      if (ok) keys.push(cellIdx);
    }
    for (var f = 0; f < order.length && keys.length < keyCount; f++) {
      if (keys.indexOf(order[f]) === -1) keys.push(order[f]);
    }

    return {
      cols: cols,
      rows: rows,
      seed: seed,
      cells: cells,
      start: 0,
      exit: exit,
      keys: keys,
      dist: dist
    };
  }

  function clamp01(v) {
    v = Number(v) || 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /**
   * Ubah labirin sel menjadi grid blok untuk raycasting.
   * `open` = lebar lorong dalam blok (1 = lorong sempit, 2 = lega).
   * Tiap sel jadi ruang open x open, dengan dinding satu blok di antaranya.
   */
  function toBlockGrid(maze, open) {
    var o = Math.max(1, Math.min(3, Math.floor(open || 1)));
    var step = o + 1;
    var W = maze.cols * step + 1;
    var H = maze.rows * step + 1;
    var grid = new Uint8Array(W * H);
    grid.fill(1);

    for (var y = 0; y < maze.rows; y++) {
      for (var x = 0; x < maze.cols; x++) {
        var i = y * maze.cols + x;
        var gx = x * step + 1;
        var gy = y * step + 1;

        for (var dy = 0; dy < o; dy++) {
          for (var dx = 0; dx < o; dx++) grid[(gy + dy) * W + (gx + dx)] = 0;
        }

        // bukaan timur: kolom celah selebar lorong
        if (maze.cells[i] & 2) {
          for (var ey = 0; ey < o; ey++) grid[(gy + ey) * W + (gx + o)] = 0;
        }
        // bukaan selatan
        if (maze.cells[i] & 4) {
          for (var ex = 0; ex < o; ex++) grid[(gy + o) * W + (gx + ex)] = 0;
        }
      }
    }
    return { grid: grid, W: W, H: H, step: step, open: o };
  }

  /**
   * Jarak ke dinding pertama di sepanjang sinar (DDA). maxDist bila kosong.
   */
  function rayWallDistance(grid, W, H, x, y, dx, dy, maxDist) {
    var mapX = Math.floor(x);
    var mapY = Math.floor(y);
    var ddx = dx === 0 ? 1e30 : Math.abs(1 / dx);
    var ddy = dy === 0 ? 1e30 : Math.abs(1 / dy);

    var stepX, stepY, sideX, sideY;
    if (dx < 0) { stepX = -1; sideX = (x - mapX) * ddx; }
    else { stepX = 1; sideX = (mapX + 1 - x) * ddx; }
    if (dy < 0) { stepY = -1; sideY = (y - mapY) * ddy; }
    else { stepY = 1; sideY = (mapY + 1 - y) * ddy; }

    var side = 0;
    for (var guard = 0; guard < 4096; guard++) {
      if (sideX < sideY) { sideX += ddx; mapX += stepX; side = 0; }
      else { sideY += ddy; mapY += stepY; side = 1; }

      if (mapX < 0 || mapY < 0 || mapX >= W || mapY >= H) return maxDist;
      if (!grid[mapY * W + mapX]) continue;

      var d = side === 0
        ? (mapX - x + (1 - stepX) / 2) / (dx || 1e-6)
        : (mapY - y + (1 - stepY) / 2) / (dy || 1e-6);
      if (d < 0) d = 0;
      return d > maxDist ? maxDist : d;
    }
    return maxDist;
  }

  /**
   * BFS di grid blok (untuk navigasi penjaga).
   * Mengembalikan jarak tiap blok dari start; -1 bila tidak terjangkau.
   */
  function bfsBlocks(grid, W, H, start) {
    var dist = new Int32Array(W * H);
    var queue = new Int32Array(W * H);
    for (var i = 0; i < W * H; i++) dist[i] = -1;
    if (start < 0 || start >= W * H || grid[start]) return dist;

    var head = 0, tail = 0;
    dist[start] = 0;
    queue[tail++] = start;
    while (head < tail) {
      var idx = queue[head++];
      var x = idx % W;
      var y = (idx / W) | 0;
      var d = dist[idx];
      if (x > 0 && !grid[idx - 1] && dist[idx - 1] < 0) { dist[idx - 1] = d + 1; queue[tail++] = idx - 1; }
      if (x < W - 1 && !grid[idx + 1] && dist[idx + 1] < 0) { dist[idx + 1] = d + 1; queue[tail++] = idx + 1; }
      if (y > 0 && !grid[idx - W] && dist[idx - W] < 0) { dist[idx - W] = d + 1; queue[tail++] = idx - W; }
      if (y < H - 1 && !grid[idx + W] && dist[idx + W] < 0) { dist[idx + W] = d + 1; queue[tail++] = idx + W; }
    }
    return dist;
  }

  /**
   * Satu langkah blok dari (sx,sy) menuju (tx,ty) mengikuti gradien BFS.
   * null bila sudah sampai atau tidak ada jalan.
   */
  function nextBlockToward(grid, W, H, sx, sy, tx, ty) {
    var start = Math.floor(sy) * W + Math.floor(sx);
    var goal = Math.floor(ty) * W + Math.floor(tx);
    if (start === goal) return null;
    if (start < 0 || start >= W * H || goal < 0 || goal >= W * H) return null;

    var dist = bfsBlocks(grid, W, H, goal);
    if (dist[start] < 0) return null;

    var best = -1;
    var bestD = dist[start];
    var nb = [start - 1, start + 1, start - W, start + W];
    var xs = [sx - 1, sx + 1], notNeeded = 0;
    void xs; void notNeeded;

    var x = start % W;
    if (x > 0 && !grid[start - 1] && dist[start - 1] >= 0 && dist[start - 1] < bestD) { bestD = dist[start - 1]; best = start - 1; }
    if (x < W - 1 && !grid[start + 1] && dist[start + 1] >= 0 && dist[start + 1] < bestD) { bestD = dist[start + 1]; best = start + 1; }
    if (start - W >= 0 && !grid[start - W] && dist[start - W] >= 0 && dist[start - W] < bestD) { bestD = dist[start - W]; best = start - W; }
    if (start + W < W * H && !grid[start + W] && dist[start + W] >= 0 && dist[start + W] < bestD) { bestD = dist[start + W]; best = start + W; }

    void nb;
    if (best < 0) return null;
    return { x: best % W, y: (best / W) | 0 };
  }

  /**
   * Cek garis pandang antara dua titik pada grid blok.
   * true bila tidak ada dinding yang menghalangi.
   */
  function losClear(grid, W, H, x0, y0, x1, y1) {
    var dx = x1 - x0;
    var dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 0.0001) return true;

    var steps = Math.ceil(dist * 4);
    var ix = (dx / steps) * 1;
    var iy = (dy / steps) * 1;
    var x = x0;
    var y = y0;
    for (var i = 0; i < steps; i++) {
      x += ix;
      y += iy;
      var bx = Math.floor(x);
      var by = Math.floor(y);
      if (bx < 0 || by < 0 || bx >= W || by >= H) return false;
      if (grid[by * W + bx]) return false;
    }
    return true;
  }

  return {
    generate: generate,
    bfs: bfs,
    bfsBlocks: bfsBlocks,
    nextBlockToward: nextBlockToward,
    losClear: losClear,
    rayWallDistance: rayWallDistance,
    mulberry32: mulberry32,
    popcount: popcount,
    toBlockGrid: toBlockGrid,
    DIRS: DIRS
  };
});
