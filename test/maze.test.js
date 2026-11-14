// Verifikasi properti labirin: keterhubungan, simetri dinding, penempatan kunci.
// Jalankan: node test/maze.test.js
'use strict';

const assert = require('node:assert');
const Maze = require('../js/maze.js');

const N = 1, E = 2, S = 4, W = 8;

function checkMaze(m, keyCount) {
  const { cols, rows, cells, start, exit, keys } = m;
  const total = cols * rows;

  // 1. semua sel terjangkau dari start
  const dist = Maze.bfs(cells, cols, rows, start);
  for (let i = 0; i < total; i++) {
    assert.ok(dist[i] >= 0, `sel ${i} tidak terjangkau (seed ${m.seed})`);
  }

  // 2. simetri bukaan + tidak menembus batas
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const c = cells[i];
      if (c & N) assert.ok(y > 0 && (cells[i - cols] & S), `dinding utara asimetris di ${x},${y}`);
      if (c & S) assert.ok(y < rows - 1 && (cells[(y + 1) * cols + x] & N), `dinding selatan asimetris di ${x},${y}`);
      if (c & W) assert.ok(x > 0 && (cells[i - 1] & E), `dinding barat asimetris di ${x},${y}`);
      if (c & E) assert.ok(x < cols - 1 && (cells[i + 1] & W), `dinding timur asimetris di ${x},${y}`);
      assert.ok(c <= 15, 'bitmask di luar jangkauan');
    }
  }

  // 3. exit = sel terjauh
  let maxD = -1, maxI = 0;
  for (let i = 0; i < total; i++) {
    if (dist[i] > maxD) { maxD = dist[i]; maxI = i; }
  }
  assert.strictEqual(exit, maxI, 'exit bukan sel terjauh');
  assert.ok(exit !== start, 'exit menumpuk di start');

  // 4. kunci valid & unik
  assert.strictEqual(keys.length, Math.min(keyCount, total - 2), 'jumlah kunci tidak sesuai');
  const seen = new Set();
  for (const k of keys) {
    assert.ok(k >= 0 && k < total, 'indeks kunci di luar peta');
    assert.ok(!seen.has(k), 'kunci duplikat');
    assert.notStrictEqual(k, exit, 'kunci menumpuk di exit');
    assert.notStrictEqual(k, start, 'kunci menumpuk di start');
    assert.ok(dist[k] >= 2, 'kunci terlalu dekat dengan start');
    seen.add(k);
  }
}

let runs = 0;
for (let seed = 1; seed <= 150; seed++) {
  const cols = 3 + (seed * 7) % 19;
  const rows = 3 + (seed * 5) % 19;
  const keyCount = 1 + (seed % 6);
  const m = Maze.generate({ cols, rows, seed, keyCount, braid: 0.2 });
  checkMaze(m, keyCount);
  runs++;
}

// determinisme
const a = Maze.generate({ cols: 15, rows: 15, seed: 4242, keyCount: 4, braid: 0.2 });
const b = Maze.generate({ cols: 15, rows: 15, seed: 4242, keyCount: 4, braid: 0.2 });
assert.deepStrictEqual(Array.from(a.cells), Array.from(b.cells));
assert.deepStrictEqual(a.keys, b.keys);

// ukuran ekstrem
checkMaze(Maze.generate({ cols: 3, rows: 3, seed: 7, keyCount: 6, braid: 0 }), 6);
checkMaze(Maze.generate({ cols: 21, rows: 21, seed: 9, keyCount: 6, braid: 0.3 }), 6);

// tanpa braid tetap valid
checkMaze(Maze.generate({ cols: 12, rows: 12, seed: 12345, keyCount: 3, braid: 0 }), 3);

/* ---------------- grid blok untuk raycaster ---------------- */

function checkBlockGrid(m, open) {
  const o = open || 1;
  const step = o + 1;
  const { grid, W, H } = Maze.toBlockGrid(m, open);
  assert.strictEqual(W, m.cols * step + 1);
  assert.strictEqual(H, m.rows * step + 1);

  // pusat tiap sel harus kosong
  for (let y = 0; y < m.rows; y++) {
    for (let x = 0; x < m.cols; x++) {
      assert.strictEqual(grid[(y * step + 1) * W + (x * step + 1)], 0, 'pusat sel harus kosong');
    }
  }

  // dinding luar harus rapat
  for (let x = 0; x < W; x++) {
    assert.strictEqual(grid[x], 1, 'dinding atas bocor');
    assert.strictEqual(grid[(H - 1) * W + x], 1, 'dinding bawah bocor');
  }
  for (let y = 0; y < H; y++) {
    assert.strictEqual(grid[y * W], 1, 'dinding kiri bocor');
    assert.strictEqual(grid[y * W + W - 1], 1, 'dinding kanan bocor');
  }

  // semua blok kosong harus saling terhubung dari blok start
  const seen = new Uint8Array(W * H);
  const startIdx = W + 1;
  const q = [startIdx];
  seen[startIdx] = 1;
  let openCount = 0;
  let reached = 0;
  for (let i = 0; i < W * H; i++) if (grid[i] === 0) openCount++;

  while (q.length) {
    const i = q.pop();
    reached++;
    const x = i % W;
    const y = (i / W) | 0;
    const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (const [nx, ny] of nb) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (seen[ni] || grid[ni] === 1) continue;
      seen[ni] = 1;
      q.push(ni);
    }
  }
  assert.strictEqual(reached, openCount, 'ada blok kosong yang terputus dari start');

  return { grid, W, H, step };
}

for (let seed = 1; seed <= 40; seed++) {
  checkBlockGrid(Maze.generate({ cols: 5 + (seed % 13), rows: 5 + (seed % 11), seed, keyCount: 3, braid: 0.2 }), 1);
  checkBlockGrid(Maze.generate({ cols: 5 + (seed % 13), rows: 5 + (seed % 11), seed, keyCount: 3, braid: 0.2 }), 2);
}

/* ---------------- navigasi penjaga ---------------- */

function openBlocks(grid, W, H) {
  const out = [];
  for (let i = 0; i < W * H; i++) if (grid[i] === 0) out.push(i);
  return out;
}

for (let seed = 1; seed <= 25; seed++) {
  const m = Maze.generate({ cols: 7 + (seed % 9), rows: 7 + (seed % 7), seed, keyCount: 3, braid: 0.2 });
  const { grid, W, H } = checkBlockGrid(m, 2);
  const opens = openBlocks(grid, W, H);

  // BFS: semua blok kosong terjangkau dari start, dinding = -1
  const dist = Maze.bfsBlocks(grid, W, H, W + 1);
  for (const i of opens) assert.ok(dist[i] >= 0, 'blok kosong tidak terjangkau BFS');
  for (let i = 0; i < W * H; i++) if (grid[i] === 1) assert.strictEqual(dist[i], -1);

  // nextBlockToward harus benar-benar sampai ke tujuan
  const from = opens[(seed * 37) % opens.length];
  const to = opens[(seed * 91) % opens.length];
  let cx = from % W;
  let cy = (from / W) | 0;
  const tx = to % W;
  const ty = (to / W) | 0;
  let guard = 0;
  while ((cx !== tx || cy !== ty) && guard++ < 400) {
    const next = Maze.nextBlockToward(grid, W, H, cx + 0.5, cy + 0.5, tx + 0.5, ty + 0.5);
    assert.ok(next, 'nextBlockToward kehabisan jalan');
    assert.strictEqual(Math.abs(next.x - cx) + Math.abs(next.y - cy), 1, 'langkah harus ke blok sebelah');
    assert.strictEqual(grid[next.y * W + next.x], 0, 'langkah tidak boleh ke dinding');
    cx = next.x;
    cy = next.y;
  }
  assert.ok(guard < 400, 'tidak sampai tujuan');

  // garis pandang vs jarak dinding harus konsisten
  for (let k = 0; k < 12; k++) {
    const a = opens[(seed * 13 + k * 7) % opens.length];
    const b = opens[(seed * 29 + k * 11) % opens.length];
    const ax = (a % W) + 0.5;
    const ay = ((a / W) | 0) + 0.5;
    const bx = (b % W) + 0.5;
    const by = ((b / W) | 0) + 0.5;
    const d = Math.hypot(bx - ax, by - ay);
    if (d < 0.01) continue;

    const clear = Maze.losClear(grid, W, H, ax, ay, bx, by);
    const wall = Maze.rayWallDistance(grid, W, H, ax, ay, (bx - ax) / d, (by - ay) / d, 60);

    assert.ok(wall >= 0 && wall <= 60, 'jarak dinding di luar batas');
    if (clear) assert.ok(wall >= d - 0.05, 'ada pandangan tapi dinding lebih dekat');
    else assert.ok(wall <= d + 0.05, 'dinding lebih jauh padahal pandangan tertutup');
  }
}

console.log(`ok — ${runs} labirin acak + 4 kasus khusus lolos semua pemeriksaan (termasuk grid blok)`);
