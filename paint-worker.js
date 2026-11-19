// Works out which surfaces of a model are on the outside (the area a coater would paint).
// Method: fill the space with a grid of small cubes, mark every cube a surface passes through, cap hollow
// tubes that match the rule, close small gaps by growing the solid, flood the outside air from the edges,
// let the air grow back into corners, then test each triangle: is there outside air just off its outer side?
// Areas are always summed from the model's real triangles; the grid only decides inside or outside.
'use strict';

function paintCompute(inp, progress) {
  progress = progress || function () {};
  var bodies = inp.bodies, gap = Math.max(0, inp.gap || 0), capW = inp.capW || 0, capH = inp.capH || 0, minLen = inp.minLen || 0;
  var out = { bodies: [], caps: [], tubes: { capped: 0, shortOpen: 0, tooBig: 0 } };

  // ---------- per-body basics: orientation and tube detection ----------
  var bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  bodies.forEach(function (b) {
    var p = b.pos, ix = b.idx, sv = 0, i;
    for (i = 0; i < p.length; i += 3) for (var k = 0; k < 3; k++) { if (p[i + k] < bmin[k]) bmin[k] = p[i + k]; if (p[i + k] > bmax[k]) bmax[k] = p[i + k]; }
    var area = 0;
    for (i = 0; i < ix.length; i += 3) {
      var a = ix[i] * 3, c = ix[i + 1] * 3, d = ix[i + 2] * 3;
      sv += (p[a] * (p[c + 1] * p[d + 2] - p[c + 2] * p[d + 1]) - p[a + 1] * (p[c] * p[d + 2] - p[c + 2] * p[d]) + p[a + 2] * (p[c] * p[d + 1] - p[c + 1] * p[d])) / 6;
      area += triArea(p, a, c, d);
    }
    // Closed solids have a clear signed volume; tiny ones are open surfaces with no inside or outside.
    var ex = extent(p), boxVol = ex[0] * ex[1] * ex[2];
    b.orient = Math.abs(sv) > Math.max(1e-9, boxVol * 1e-4) && area > 0 ? (sv > 0 ? 1 : -1) : 0;
    b.area = area;
    b.tube = detectTube(b, capW, capH, minLen);
    if (b.tube) {
      if (b.tube.capped) out.tubes.capped++; else if (b.tube.reason === 'short') out.tubes.shortOpen++; else out.tubes.tooBig++;
    }
  });
  progress('Building the grid', 0.15);

  // ---------- the grid ----------
  var vol = Math.max(1, (bmax[0] - bmin[0]) * (bmax[1] - bmin[1]) * (bmax[2] - bmin[2]));
  var h = Math.max(inp.targetH || 3, Math.cbrt(vol / (inp.budget || 4e7)));
  var r = Math.max(1, Math.ceil(gap / (2 * h) - 1e-9));
  var margin = (r + 3) * h;
  var ox = bmin[0] - margin, oy = bmin[1] - margin, oz = bmin[2] - margin;
  var nx = Math.ceil((bmax[0] - bmin[0] + 2 * margin) / h) + 1, ny = Math.ceil((bmax[1] - bmin[1] + 2 * margin) / h) + 1, nz = Math.ceil((bmax[2] - bmin[2] + 2 * margin) / h) + 1;
  var NXY = nx * ny, N = NXY * nz;
  var G = new Uint8Array(N);   // bit 1: surface or cap; 2: grown solid; 4: outside air; 8: outside air grown back
  out.grid = { h: h, r: r, closes: Math.round(2 * r * h * 10) / 10, nx: nx, ny: ny, nz: nz };
  function vid(x, y, z) {
    var i = Math.floor((x - ox) / h), j = Math.floor((y - oy) / h), k = Math.floor((z - oz) / h);
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
    return i + j * nx + k * NXY;
  }

  // surfaces into the grid (sample each triangle at half a cube spacing)
  bodies.forEach(function (b, bi) {
    var p = b.pos, ix = b.idx;
    for (var t = 0; t < ix.length; t += 3) {
      var a = ix[t] * 3, c = ix[t + 1] * 3, d = ix[t + 2] * 3;
      var L = Math.max(dist(p, a, c), dist(p, c, d), dist(p, d, a)), ns = Math.min(800, Math.max(1, Math.ceil(L / (h * 0.5))));
      for (var i = 0; i <= ns; i++) for (var j = 0; j <= ns - i; j++) {
        var u = i / ns, v = j / ns;
        var v0 = vid(p[a] + (p[c] - p[a]) * u + (p[d] - p[a]) * v, p[a + 1] + (p[c + 1] - p[a + 1]) * u + (p[d + 1] - p[a + 1]) * v, p[a + 2] + (p[c + 2] - p[a + 2]) * u + (p[d + 2] - p[a + 2]) * v);
        if (v0 >= 0) G[v0] |= 1;
      }
    }
    if (bi % 50 === 0) progress('Building the grid', 0.15 + 0.2 * bi / bodies.length);
  });
  // tube caps: solid discs just inside each open end
  bodies.forEach(function (b) {
    var tb = b.tube; if (!tb || !tb.capped) return;
    [tb.cap0, tb.cap1].forEach(function (s) {
      var poly = tb.inner, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, i;
      for (i = 0; i < poly.length; i++) { x0 = Math.min(x0, poly[i][0]); x1 = Math.max(x1, poly[i][0]); y0 = Math.min(y0, poly[i][1]); y1 = Math.max(y1, poly[i][1]); }
      var step = h * 0.4;
      for (var x = x0 - step; x <= x1 + step; x += step) for (var y = y0 - step; y <= y1 + step; y += step) {
        if (!inPoly(poly, x, y) && distPoly(poly, x, y) > h * 0.6) continue;
        var w = tb.at(s, x, y), v0 = vid(w[0], w[1], w[2]); if (v0 >= 0) G[v0] |= 1;
      }
      var pts = []; poly.forEach(function (q) { var w2 = tb.at(s, q[0], q[1]); pts.push(w2[0], w2[1], w2[2]); });
      out.caps.push(pts);
    });
  });
  progress('Closing gaps', 0.4);

  // ---------- close gaps: grow the solid by r cubes ----------
  var T = new Uint8Array(N);
  for (var q = 0; q < N; q++) T[q] = G[q] & 1;
  dilate(T, nx, ny, nz, r);
  for (q = 0; q < N; q++) if (T[q]) G[q] |= 2;
  progress('Finding the outside', 0.55);

  // ---------- flood the outside air from the edges of the grid ----------
  var QN = Math.min(N, 1 << 24), Qa = new Int32Array(QN), head = 0, tail = 0, count = 0;
  function push(v) { if (G[v] & 6) return; if (count >= QN) throw new Error('the selection is too large for the grid; select fewer parts or use Fast'); G[v] |= 4; Qa[tail] = v; tail = (tail + 1) % QN; count++; }
  for (var k = 0; k < nz; k++) for (var j2 = 0; j2 < ny; j2++) for (var i2 = 0; i2 < nx; i2++) {
    if (i2 === 0 || j2 === 0 || k === 0 || i2 === nx - 1 || j2 === ny - 1 || k === nz - 1) push(i2 + j2 * nx + k * NXY);
  }
  while (count > 0) {
    var v = Qa[head]; head = (head + 1) % QN; count--;
    var x = v % nx, y = ((v / nx) | 0) % ny, z = (v / NXY) | 0;
    if (x > 0) push(v - 1); if (x < nx - 1) push(v + 1);
    if (y > 0) push(v - nx); if (y < ny - 1) push(v + nx);
    if (z > 0) push(v - NXY); if (z < nz - 1) push(v + NXY);
  }
  Qa = null;
  // let the outside air grow back into corners and gap mouths (never through a surface: see notes)
  for (q = 0; q < N; q++) T[q] = (G[q] & 4) ? 1 : 0;
  dilate(T, nx, ny, nz, r);
  for (q = 0; q < N; q++) if (T[q] || (G[q] & 4)) G[q] |= 8;
  T = null;
  progress('Measuring the outside surfaces', 0.75);

  // ---------- classify triangles ----------
  var total = 0, counted = 0;
  bodies.forEach(function (b, bi) {
    var p = b.pos, ix = b.idx, nt = ix.length / 3, flags = new Uint8Array(nt), bc = 0, inner = b.tube && b.tube.capped ? b.tube.innerTris : null, part = [];
    for (var t = 0; t < nt; t++) {
      var a = ix[3 * t] * 3, c = ix[3 * t + 1] * 3, d = ix[3 * t + 2] * 3, A = triArea(p, a, c, d);
      total += A;
      if (A <= 0 || (inner && inner[t])) continue;
      var ux = p[c] - p[a], uy = p[c + 1] - p[a + 1], uz = p[c + 2] - p[a + 2], wx = p[d] - p[a], wy = p[d + 1] - p[a + 1], wz = p[d + 2] - p[a + 2];
      var nxv = uy * wz - uz * wy, nyv = uz * wx - ux * wz, nzv = ux * wy - uy * wx, nl = Math.hypot(nxv, nyv, nzv); nxv /= nl; nyv /= nl; nzv /= nl;
      var dirs = b.orient === 0 ? [1, -1] : [b.orient];
      var L = Math.max(dist(p, a, c), dist(p, c, d), dist(p, d, a)), ns = Math.min(400, Math.max(1, Math.ceil(L / h)));
      var hit = 0, tot = 0;
      for (var i = 0; i <= ns; i++) for (var j = 0; j <= ns - i; j++) {
        var u = (i + 1 / 3) / (ns + 1), w = (j + 1 / 3) / (ns + 1);
        var sx = p[a] + ux * u + wx * w, sy = p[a + 1] + uy * u + wy * w, sz = p[a + 2] + uz * u + wz * w;
        tot++;
        for (var di = 0; di < dirs.length; di++) { if (probe(sx, sy, sz, nxv * dirs[di], nyv * dirs[di], nzv * dirs[di])) { hit++; break; } }
      }
      var f = tot ? hit / tot : 0;
      if (f >= 0.5) flags[t] = 1;
      // a large triangle that is only partly outside: split it up so the colouring follows the real boundary
      if (f > 0.02 && f < 0.98 && L > 3 * h) {
        flags[t] = 2;
        var n2 = Math.min(48, Math.ceil(L / (1.2 * h))), P = function (i3, j3) { var uu = i3 / n2, vv = j3 / n2; return [p[a] + ux * uu + wx * vv, p[a + 1] + uy * uu + wy * vv, p[a + 2] + uz * uu + wz * vv]; };
        for (var i4 = 0; i4 < n2; i4++) for (var j4 = 0; j4 < n2 - i4; j4++) {
          var tris = [[P(i4, j4), P(i4 + 1, j4), P(i4, j4 + 1)]];
          if (j4 < n2 - i4 - 1) tris.push([P(i4 + 1, j4), P(i4 + 1, j4 + 1), P(i4, j4 + 1)]);
          tris.forEach(function (T3) {
            var cx = (T3[0][0] + T3[1][0] + T3[2][0]) / 3, cy = (T3[0][1] + T3[1][1] + T3[2][1]) / 3, cz = (T3[0][2] + T3[1][2] + T3[2][2]) / 3, ok = false;
            for (var d2 = 0; d2 < dirs.length && !ok; d2++) ok = probe(cx, cy, cz, nxv * dirs[d2], nyv * dirs[d2], nzv * dirs[d2]);
            if (ok) part.push(T3[0][0], T3[0][1], T3[0][2], T3[1][0], T3[1][1], T3[1][2], T3[2][0], T3[2][1], T3[2][2]);
          });
        }
      }
      bc += A * f;
    }
    counted += bc;
    out.bodies.push({ id: b.id, flags: flags, part: new Float32Array(part), area: b.area, counted: bc, tube: b.tube ? { capped: b.tube.capped, reason: b.tube.reason, w: b.tube.w, h: b.tube.h, len: b.tube.len } : null });
    if (bi % 50 === 0) progress('Measuring the outside surfaces', 0.75 + 0.25 * bi / bodies.length);
  });
  function probe(x, y, z, dx, dy, dz) { // walk out from the surface; the first cube that isn't surface decides
    var maxD = (2 * r + 2) * h;
    for (var s = 0.5 * h; s <= maxD; s += 0.5 * h) {
      var v2 = vid(x + dx * s, y + dy * s, z + dz * s); if (v2 < 0) return true;
      var g = G[v2]; if (g & 1) continue;
      return (g & 8) !== 0;
    }
    return false;
  }
  out.total = total; out.counted = counted;
  return out;
}

// ---------- hollow profile detection ----------
function detectTube(b, capW, capH, minLen) {
  var p = b.pos, ix = b.idx, nt = ix.length / 3; if (nt < 16) return null;
  var C = [0, 0, 0, 0, 0, 0], t, i;   // area-weighted normal covariance
  var nrm = new Float32Array(nt * 3), cen = new Float32Array(nt * 3);
  for (t = 0; t < nt; t++) {
    var a = ix[3 * t] * 3, c = ix[3 * t + 1] * 3, d = ix[3 * t + 2] * 3;
    var ux = p[c] - p[a], uy = p[c + 1] - p[a + 1], uz = p[c + 2] - p[a + 2], wx = p[d] - p[a], wy = p[d + 1] - p[a + 1], wz = p[d + 2] - p[a + 2];
    var nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, l = Math.hypot(nx, ny, nz); if (!l) continue;
    var A = l / 2; nx /= l; ny /= l; nz /= l;
    nrm[3 * t] = nx; nrm[3 * t + 1] = ny; nrm[3 * t + 2] = nz;
    cen[3 * t] = (p[a] + p[c] + p[d]) / 3; cen[3 * t + 1] = (p[a + 1] + p[c + 1] + p[d + 1]) / 3; cen[3 * t + 2] = (p[a + 2] + p[c + 2] + p[d + 2]) / 3;
    C[0] += A * nx * nx; C[1] += A * ny * ny; C[2] += A * nz * nz; C[3] += A * nx * ny; C[4] += A * nx * nz; C[5] += A * ny * nz;
  }
  var eg = eig3(C), tr = eg.val[0] + eg.val[1] + eg.val[2]; if (!(tr > 0)) return null;
  var mi = eg.val.indexOf(Math.min.apply(null, eg.val)), ax = eg.vec[mi];
  if (eg.val[mi] / tr > 0.15) return null;                       // not prism-shaped
  var u = perp(ax), v = cross(ax, u), s0 = Infinity, s1 = -Infinity;
  for (i = 0; i < p.length; i += 3) { var s = p[i] * ax[0] + p[i + 1] * ax[1] + p[i + 2] * ax[2]; if (s < s0) s0 = s; if (s > s1) s1 = s; }
  var len = s1 - s0; if (len <= 0) return null;
  // the tube must also be long in that direction, compared with its cross-section
  var c0 = Infinity, c1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  for (i = 0; i < p.length; i += 3) { var pu = p[i] * u[0] + p[i + 1] * u[1] + p[i + 2] * u[2], pv = p[i] * v[0] + p[i + 1] * v[1] + p[i + 2] * v[2]; c0 = Math.min(c0, pu); c1 = Math.max(c1, pu); d0 = Math.min(d0, pv); d1 = Math.max(d1, pv); }
  var best = null;
  [0.5, 0.31, 0.69, 0.17, 0.83].some(function (f) {
    var sec = slice(p, ix, ax, u, v, s0 + len * f + len * 1e-4);
    if (!sec.length) return false;
    var areas = sec.map(function (l2) { return Math.abs(polyArea(l2)); }), oi = areas.indexOf(Math.max.apply(null, areas)), outer = sec[oi];
    var inn = null, ia = 0;
    sec.forEach(function (l2, k) { if (k !== oi && areas[k] > areas[oi] * 0.15 && inPoly(outer, l2[0][0], l2[0][1]) && areas[k] > ia) { inn = l2; ia = areas[k]; } });
    if (inn) { best = { outer: outer, inner: inn }; return true; }
    return false;
  });
  if (!best) return null;
  var box = minRect(best.inner), w = Math.max(box[0], box[1]), hh = Math.min(box[0], box[1]);
  var res = { len: len, w: w, h: hh, inner: best.inner, capped: false, reason: '' };
  if (w > capW + 1e-6 || hh > capH + 1e-6) { res.reason = 'big'; return res; }
  if (len < minLen) { res.reason = 'short'; return res; }
  // inner-wall triangles: side-facing, closer to the inner outline than to the outer one
  var innerTris = new Uint8Array(nt), sectors = [], ic = centroid(best.inner);
  for (i = 0; i < 24; i++) sectors.push([Infinity, -Infinity]);
  for (t = 0; t < nt; t++) {
    var ad = Math.abs(nrm[3 * t] * ax[0] + nrm[3 * t + 1] * ax[1] + nrm[3 * t + 2] * ax[2]); if (ad > 0.35) continue;
    var px = cen[3 * t], py = cen[3 * t + 1], pz = cen[3 * t + 2];
    var x2 = px * u[0] + py * u[1] + pz * u[2], y2 = px * v[0] + py * v[1] + pz * v[2];
    if (distPoly(best.inner, x2, y2) < distPoly(best.outer, x2, y2)) {
      innerTris[t] = 1;
      var sc = Math.floor(((Math.atan2(y2 - ic[1], x2 - ic[0]) + Math.PI) / (2 * Math.PI)) * 24) % 24, st = px * ax[0] + py * ax[1] + pz * ax[2];
      // use the triangle's vertices for the bore's end positions
      var a3 = ix[3 * t] * 3, b3 = ix[3 * t + 1] * 3, c3 = ix[3 * t + 2] * 3;
      [a3, b3, c3].forEach(function (q) { var sv = p[q] * ax[0] + p[q + 1] * ax[1] + p[q + 2] * ax[2]; if (sv < sectors[sc][0]) sectors[sc][0] = sv; if (sv > sectors[sc][1]) sectors[sc][1] = sv; });
    }
  }
  // caps sit where the whole bore is still enclosed (handles mitred and coped ends)
  var lo = -Infinity, hi = Infinity;
  sectors.forEach(function (sx) { if (sx[0] < Infinity) { lo = Math.max(lo, sx[0]); hi = Math.min(hi, sx[1]); } });
  if (!(hi > lo)) { res.reason = 'shape'; return res; }
  var inset = Math.min(2, (hi - lo) * 0.01);
  res.capped = true; res.innerTris = innerTris; res.cap0 = lo + inset; res.cap1 = hi - inset;
  res.at = function (s, x, y) { return [ax[0] * s + u[0] * x + v[0] * y, ax[1] * s + u[1] * x + v[1] * y, ax[2] * s + u[2] * x + v[2] * y]; };
  return res;
}

// ---------- helpers ----------
function triArea(p, a, c, d) {
  var ux = p[c] - p[a], uy = p[c + 1] - p[a + 1], uz = p[c + 2] - p[a + 2], wx = p[d] - p[a], wy = p[d + 1] - p[a + 1], wz = p[d + 2] - p[a + 2];
  return Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
}
function dist(p, a, b) { return Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]); }
function extent(p) { var mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; for (var i = 0; i < p.length; i += 3) for (var k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[i + k]); mx[k] = Math.max(mx[k], p[i + k]); } return [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function perp(a) { var t = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], c = cross(a, t), l = Math.hypot(c[0], c[1], c[2]); return [c[0] / l, c[1] / l, c[2] / l]; }
function eig3(C) { // symmetric 3x3 (xx,yy,zz,xy,xz,yz) by Jacobi rotations
  var A = [[C[0], C[3], C[4]], [C[3], C[1], C[5]], [C[4], C[5], C[2]]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (var it = 0; it < 50; it++) {
    var p = 0, q = 1, m = Math.abs(A[0][1]);
    if (Math.abs(A[0][2]) > m) { p = 0; q = 2; m = Math.abs(A[0][2]); }
    if (Math.abs(A[1][2]) > m) { p = 1; q = 2; m = Math.abs(A[1][2]); }
    if (m < 1e-14) break;
    var th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
    for (var k = 0; k < 3; k++) { var akp = A[k][p], akq = A[k][q]; A[k][p] = c * akp - s * akq; A[k][q] = s * akp + c * akq; }
    for (k = 0; k < 3; k++) { var apk = A[p][k], aqk = A[q][k]; A[p][k] = c * apk - s * aqk; A[q][k] = s * apk + c * aqk; }
    for (k = 0; k < 3; k++) { var vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
  }
  return { val: [A[0][0], A[1][1], A[2][2]], vec: [[V[0][0], V[1][0], V[2][0]], [V[0][1], V[1][1], V[2][1]], [V[0][2], V[1][2], V[2][2]]] };
}
function slice(p, ix, ax, u, v, s) { // cross-section loops (2D, in the u/v plane) at position s along ax
  var segs = [];
  for (var t = 0; t < ix.length; t += 3) {
    var P = [ix[t] * 3, ix[t + 1] * 3, ix[t + 2] * 3], d = P.map(function (q) { return p[q] * ax[0] + p[q + 1] * ax[1] + p[q + 2] * ax[2] - s; });
    var pts = [];
    for (var e = 0; e < 3; e++) {
      var i = P[e], j = P[(e + 1) % 3], di = d[e], dj = d[(e + 1) % 3];
      if ((di < 0) !== (dj < 0)) { var f = di / (di - dj), x = p[i] + (p[j] - p[i]) * f, y = p[i + 1] + (p[j + 1] - p[i + 1]) * f, z = p[i + 2] + (p[j + 2] - p[i + 2]) * f; pts.push([x * u[0] + y * u[1] + z * u[2], x * v[0] + y * v[1] + z * v[2]]); }
    }
    if (pts.length === 2) segs.push(pts);
  }
  var key = function (q) { return Math.round(q[0] * 1000) + ',' + Math.round(q[1] * 1000); }, adj = new Map();
  segs.forEach(function (sg, k) { sg.forEach(function (q) { var kk = key(q), l = adj.get(kk); if (!l) { l = []; adj.set(kk, l); } l.push(k); }); });
  var used = new Uint8Array(segs.length), loops = [];
  for (var k0 = 0; k0 < segs.length; k0++) {
    if (used[k0]) continue;
    var loop = [segs[k0][0]], cur = segs[k0][1], k = k0, guard = 0; used[k0] = 1;
    while (guard++ < 200000) {
      loop.push(cur);
      var nx = (adj.get(key(cur)) || []).filter(function (j) { return !used[j]; })[0];
      if (nx === undefined) break;
      used[nx] = 1; var sg = segs[nx]; cur = key(sg[0]) === key(cur) ? sg[1] : sg[0]; k = nx;
    }
    if (loop.length >= 4 && Math.hypot(loop[0][0] - loop[loop.length - 1][0], loop[0][1] - loop[loop.length - 1][1]) < 0.01) loops.push(loop.slice(0, -1));
  }
  return loops;
}
function polyArea(l) { var A = 0; for (var i = 0; i < l.length; i++) { var a = l[i], b = l[(i + 1) % l.length]; A += a[0] * b[1] - b[0] * a[1]; } return A / 2; }
function centroid(l) { var x = 0, y = 0; l.forEach(function (q) { x += q[0]; y += q[1]; }); return [x / l.length, y / l.length]; }
function inPoly(l, x, y) { var c = false; for (var i = 0, j = l.length - 1; i < l.length; j = i++) { var a = l[i], b = l[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; }
function distPoly(l, x, y) { var m = Infinity; for (var i = 0; i < l.length; i++) { var a = l[i], b = l[(i + 1) % l.length], vx = b[0] - a[0], vy = b[1] - a[1], L2 = vx * vx + vy * vy, t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * vx + (y - a[1]) * vy) / L2)) : 0; m = Math.min(m, Math.hypot(a[0] + vx * t - x, a[1] + vy * t - y)); } return m; }
function minRect(l) { // smallest rectangle around a loop: [width, height]
  var pts = l.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; }), cr = function (o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }, lo = [], up = [], i;
  for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
  for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
  var hull = lo.slice(0, -1).concat(up.slice(0, -1)), best = [Infinity, Infinity], ba = Infinity;
  for (i = 0; i < hull.length; i++) {
    var a = hull[i], b = hull[(i + 1) % hull.length], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy); if (!L) continue; dx /= L; dy /= L;
    var u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    hull.forEach(function (q) { var uu = q[0] * dx + q[1] * dy, vv = -q[0] * dy + q[1] * dx; u0 = Math.min(u0, uu); u1 = Math.max(u1, uu); v0 = Math.min(v0, vv); v1 = Math.max(v1, vv); });
    var ar = (u1 - u0) * (v1 - v0); if (ar < ba) { ba = ar; best = [u1 - u0, v1 - v0]; }
  }
  return best;
}
function dilate(T, nx, ny, nz, r) { // grow a 0/1 grid by r cells in x, y and z (box shape)
  var line = new Uint8Array(Math.max(nx, ny, nz)), NXY = nx * ny;
  function pass(n, count, base, stride) {
    for (var c = 0; c < count; c++) {
      var b0 = base(c), i, run = 0;
      for (i = 0; i < n; i++) line[i] = T[b0 + i * stride];
      for (i = 0; i < Math.min(r, n); i++) run += line[i];
      for (i = 0; i < n; i++) {
        if (i + r < n) run += line[i + r];
        if (i - r - 1 >= 0) run -= line[i - r - 1];
        T[b0 + i * stride] = run > 0 ? 1 : 0;
      }
    }
  }
  pass(nx, ny * nz, function (c) { return c * nx; }, 1);
  pass(ny, nx * nz, function (c) { return (c % nx) + Math.floor(c / nx) * NXY; }, nx);
  pass(nz, NXY, function (c) { return c; }, NXY);
}

if (typeof module !== 'undefined' && module.exports) module.exports = { paintCompute: paintCompute, detectTube: detectTube };
else if (typeof self !== 'undefined') {
  self.onmessage = function (ev) {
    try {
      var res = paintCompute(ev.data, function (msg, f) { self.postMessage({ progress: f, msg: msg }); });
      var tr = []; res.bodies.forEach(function (b) { tr.push(b.flags.buffer, b.part.buffer); });
      self.postMessage({ result: res }, tr);
    } catch (e) { self.postMessage({ error: String((e && e.message) || e) }); }
  };
}
