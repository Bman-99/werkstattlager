/* Werkstattlager – kleine 3D-Engine: erzeugt Bauteile aus Normmaßen und rendert sie als SVG-Pfade. */
(function (root) {
  'use strict';
  var TAU = Math.PI * 2;
  var MAT = {
    ox: { c: [88, 92, 100], s: 0.4 }, ss: { c: [186, 191, 198], s: 0.55 }, zn: { c: [198, 199, 188], s: 0.45 },
    brass: { c: [205, 163, 74], s: 0.55 }, chrome: { c: [204, 208, 214], s: 0.65 }, shield: { c: [132, 139, 149], s: 0.3 },
    nickel: { c: [208, 211, 217], s: 0.6 }, plain: { c: [168, 172, 178], s: 0.3 }, black: { c: [52, 54, 58], s: 0.2 },
    alu: { c: [200, 204, 210], s: 0.4 }, nylon: { c: [70, 110, 190], s: 0.2 }
  };
  function tint(m, f) { return { c: m.c.map(function (v) { return v * f; }), s: m.s }; }
  function ring(r, n) { var p = []; for (var i = 0; i < n; i++) { var t = i / n * TAU; p.push([Math.cos(t) * r, Math.sin(t) * r]); } return p; }
  function hexRing(sw, n) { var a = sw / 2, p = []; for (var i = 0; i < n; i++) { var t = i / n * TAU; var u = ((t + Math.PI / 6) % (Math.PI / 3)) - Math.PI / 6; p.push([Math.cos(t) * a / Math.cos(u), Math.sin(t) * a / Math.cos(u)]); } return p; }
  function knurl(r1, r2, n) { var p = []; for (var i = 0; i < n; i++) { var t = i / n * TAU, r = i % 2 ? r2 : r1; p.push([Math.cos(t) * r, Math.sin(t) * r]); } return p; }
  function segN(a, b, outward) {
    var dx = b[0] - a[0], dz = b[1] - a[1], nx = dz, nz = -dx, L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
    var d = nx * (a[0] + b[0]) / 2 + nz * (a[1] + b[1]) / 2; if ((d < 0) === outward) { nx = -nx; nz = -nz; } return [nx, 0, nz];
  }
  function prism(out, inn, y0, y1, col, o) {
    o = o || {}; var F = [], n = out.length;
    for (var i = 0; i < n; i++) {
      var a = out[i], b = out[(i + 1) % n];
      if (!o.noSide) F.push({ p: [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], n: segN(a, b, true), c: col });
      if (inn) {
        var ia = inn[i], ib = inn[(i + 1) % n];
        if (!o.noInner) F.push({ p: [[ia[0], y0, ia[1]], [ib[0], y0, ib[1]], [ib[0], y1, ib[1]], [ia[0], y1, ia[1]]], n: segN(ia, ib, false), c: o.innerCol || col });
        if (!o.noTop) F.push({ p: [[a[0], y1, a[1]], [b[0], y1, b[1]], [ib[0], y1, ib[1]], [ia[0], y1, ia[1]]], n: [0, 1, 0], c: col });
        if (!o.noBot) F.push({ p: [[a[0], y0, a[1]], [b[0], y0, b[1]], [ib[0], y0, ib[1]], [ia[0], y0, ia[1]]], n: [0, -1, 0], c: col });
      }
    }
    if (!inn) {
      if (!o.noTop) F.push({ p: out.map(function (q) { return [q[0], y1, q[1]]; }), n: [0, 1, 0], c: o.topCol || col });
      if (!o.noBot) F.push({ p: out.map(function (q) { return [q[0], y0, q[1]]; }), n: [0, -1, 0], c: col });
    }
    return F;
  }
  // Kegelstumpf-Mantel von r0 (y0) zu r1 (y1)
  function frustum(r0, r1, y0, y1, n, col) {
    var F = [], h = y1 - y0;
    for (var i = 0; i < n; i++) {
      var t0 = i / n * TAU, t1 = (i + 1) / n * TAU, tm = (t0 + t1) / 2;
      var nx = Math.cos(tm) * h, ny = -(r1 - r0), nz = Math.sin(tm) * h, L = Math.hypot(nx, ny, nz) || 1;
      F.push({ p: [[Math.cos(t0) * r0, y0, Math.sin(t0) * r0], [Math.cos(t1) * r0, y0, Math.sin(t1) * r0], [Math.cos(t1) * r1, y1, Math.sin(t1) * r1], [Math.cos(t0) * r1, y1, Math.sin(t0) * r1]], n: [nx / L, ny / L, nz / L], c: col });
    }
    return F;
  }
  function floor(pts, y, col) { return { p: pts.map(function (q) { return [q[0], y, q[1]]; }), n: [0, 1, 0], c: col }; }

  function geom(part, hi) {
    var p = part.params || {}, type = part.type, fin = MAT[part.finish] || null;
    var n = hi ? 24 : 12, F = [];
    function add(a) { F = F.concat(a); }
    if (type === 'shcs' || type === 'button' || type === 'csk') {
      var m = fin || MAT[type === 'button' ? 'ss' : 'ox'], dk = tint(m, 0.8), r = p.d / 2, R = p.dk / 2, L = p.L, pitch = p.pitch || 0.5;
      var bands = Math.max(2, Math.min(80, Math.round(L / (pitch * (hi ? 1 : 3))))), bh = L / bands;
      for (var j = 0; j < bands; j++) add(prism(ring(r, n), null, j * bh, (j + 1) * bh, j % 2 ? dk : m, { noTop: true, noBot: j !== 0 }));
      if (type === 'shcs') {
        var t = p.k * 0.55;
        add(prism(ring(R, n), null, L, L + p.k - t, m, { topCol: tint(m, 0.5) }));
        add(prism(ring(R, n), hexRing(p.s, n), L + p.k - t, L + p.k, m, { noBot: true, innerCol: tint(m, 0.7) }));
      } else if (type === 'button') {
        var Ly = 4;
        for (var i = 0; i < Ly; i++) {
          var y0 = L + i * p.k / Ly, y1 = y0 + p.k / Ly, rr = R * Math.sqrt(1 - 0.85 * Math.pow(i / Ly, 2));
          if (i < Ly - 1) add(prism(ring(rr, n), null, y0, y1, m, { noBot: i !== 0 }));
          else { add(prism(ring(rr, n), hexRing(p.s, n), y0, y1, m, { noBot: true, innerCol: tint(m, 0.7) })); F.push(floor(hexRing(p.s, n), y0 + 0.02, tint(m, 0.45))); }
        }
      } else {
        var hk = p.k * 0.82;
        add(frustum(r, R, L, L + hk, n, m));
        add(prism(ring(R, n), hexRing(p.s, n), L + hk, L + p.k, m, { noBot: true, innerCol: tint(m, 0.7) }));
        F.push(floor(hexRing(p.s, n), L + p.k * 0.35, tint(m, 0.45)));
      }
    } else if (type === 'nut' || type === 'nyloc') {
      var mn = fin || MAT.zn, hi2 = type === 'nyloc' ? p.m * 0.72 : p.m;
      add(prism(hexRing(p.s, n), ring(p.d / 2 * 0.86, n), 0, hi2, mn, { innerCol: tint(mn, 0.7), noTop: type === 'nyloc' }));
      if (type === 'nyloc') {
        add(prism(hexRing(p.s, n), ring(p.d / 2 * 0.86, n), hi2 - 0.001, hi2, mn, { noSide: true, noInner: true, noBot: true }));
        add(prism(ring(p.s * 0.47, n), ring(p.d / 2 * 0.86, n), hi2, p.m, mn, { innerCol: MAT.nylon }));
      }
    } else if (type === 'washer') {
      var nw = hi ? 32 : 16; add(prism(ring(p.d2 / 2, nw), ring(p.d1 / 2, nw), 0, p.h, fin || MAT.zn));
    } else if (type === 'bearing') {
      var N = hi ? 40 : 16, Ro = p.D / 2, Ri = p.d / 2, w = Ro - Ri, r1 = Ro - w * 0.2, r2 = Ri + w * 0.2;
      add(prism(ring(Ro, N), ring(r1, N), 0, p.B, MAT.chrome));
      add(prism(ring(r1, N), ring(r2, N), p.B * 0.06, p.B * 0.94, MAT.shield, { noSide: true, noInner: true }));
      add(prism(ring(r2, N), ring(Ri, N), 0, p.B, MAT.chrome));
    } else if (type === 'insert') {
      var nk = hi ? 36 : 16; add(prism(knurl(p.D / 2, p.D / 2 - 0.3, nk), ring(p.d / 2 * 0.82, nk), 0, p.L, fin || MAT.brass, { innerCol: tint(MAT.brass, 0.7) }));
    } else if (type === 'magnet') {
      add(prism(ring(p.D / 2, hi ? 32 : 16), null, 0, p.H, fin || MAT.nickel));
    } else {
      var ds = (p.dims || []).map(function (x) { return +x.value || 0; }).filter(function (v) { return v > 0; });
      var D = ds[0] || 10, H = ds[1] || D * 0.6;
      add(prism(ring(D / 2, hi ? 32 : 12), ring(D / 5, hi ? 32 : 12), 0, H, fin || MAT.plain));
    }
    return F;
  }

  function render(F, yaw, pitch, W, H) {
    if (!F.length) return [];
    var cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    var minY = 1e9, maxY = -1e9, maxR = 0;
    F.forEach(function (f) { f.p.forEach(function (q) { if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1]; var rr = Math.hypot(q[0], q[2]); if (rr > maxR) maxR = rr; }); });
    var cm = (minY + maxY) / 2, ext = Math.hypot(2 * maxR, maxY - minY) || 1, sc = Math.min(W, H) * 0.8 / ext;
    var Lx = -0.45, Ly = 0.75, Lz = -0.5, ll = Math.hypot(Lx, Ly, Lz); Lx /= ll; Ly /= ll; Lz /= ll;
    var Hx = Lx, Hy = Ly, Hz = Lz - 1, hl = Math.hypot(Hx, Hy, Hz); Hx /= hl; Hy /= hl; Hz /= hl;
    function rot(x, y, z) { var x1 = x * cy - z * sy, z1 = x * sy + z * cy; return [x1, y * cp - z1 * sp, y * sp + z1 * cp]; }
    var out = [];
    F.forEach(function (f) {
      var nn = rot(f.n[0], f.n[1], f.n[2]); if (nn[2] > -0.001) return;
      var depth = 0, d = '';
      f.p.forEach(function (q, k) { var r3 = rot(q[0], q[1] - cm, q[2]); depth += r3[2]; d += (k ? 'L' : 'M') + (W / 2 + r3[0] * sc).toFixed(1) + ' ' + (H / 2 - r3[1] * sc).toFixed(1); });
      var lam = Math.max(0, nn[0] * Lx + nn[1] * Ly + nn[2] * Lz), spec = Math.pow(Math.max(0, nn[0] * Hx + nn[1] * Hy + nn[2] * Hz), 24) * f.c.s, sh = 0.32 + 0.68 * lam;
      out.push({ z: depth / f.p.length, d: d + 'Z', fill: 'rgb(' + f.c.c.map(function (v) { return Math.round(Math.min(255, v * sh + 255 * spec)); }).join(',') + ')' });
    });
    out.sort(function (a, b) { return b.z - a.z; });
    return out;
  }
  function toSvgPaths(faces, sw) {
    return faces.map(function (f) { return '<path d="' + f.d + '" fill="' + f.fill + '" stroke="' + f.fill + '" stroke-width="' + (sw || 0.5) + '" stroke-linejoin="round"/>'; }).join('');
  }
  root.WL_GEOM = { geom: geom, render: render, toSvgPaths: toSvgPaths };
})(this);
