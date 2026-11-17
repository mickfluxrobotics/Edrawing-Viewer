// Readers for STL, 3MF, STEP (via OpenCascade) and DXF. Each returns a plain model the viewer builds from.
// 3D models: { generic:true, title, scale (file units -> metres), unitless, root:{name,children,bodies}, warnings }
//   body: { pos:Float32Array, idx:Uint32Array, shellStart:Uint32Array|null, normals, color:[r,g,b], matrix:12 floats|null, key }
// 2D models: { is2D:true, title, scale, unitless, layers:[{name,color,prims:[{pts:[x,y,...],closed,color}]}], warnings }
var FMT = (function () {
  'use strict';

  function kind(name) {
    var m = /\.([a-z0-9]+)$/i.exec(name || ''), e = m ? m[1].toLowerCase() : '';
    if (e === 'easm' || e === 'eprt') return 'easm';
    if (e === 'stl') return 'stl';
    if (e === '3mf') return '3mf';
    if (e === 'step' || e === 'stp') return 'step';
    if (e === 'dxf') return 'dxf';
    if (e === 'dwg') return 'dwg';
    return null;
  }
  function baseName(name) { return String(name || 'Model').replace(/^.*[\\/]/, '').replace(/\.[a-z0-9]+$/i, ''); }

  // ------------------------------------------------------------------ face segmentation for plain meshes
  // STL and 3MF carry triangles only. To get CAD-like faces and edges, weld the vertices, find flat regions,
  // then group the remaining triangles wherever neighbours meet at less than the crease angle.
  function segmentFaces(pos, idx, creaseDeg) {
    var nv = pos.length / 3, nt = Math.floor(idx.length / 3), i, k;
    var minx = Infinity, miny = Infinity, minz = Infinity, maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
    for (i = 0; i < pos.length; i += 3) {
      var x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; if (z < minz) minz = z; if (z > maxz) maxz = z;
    }
    var diag = Math.hypot(maxx - minx, maxy - miny, maxz - minz) || 1, q = 1e6 / diag;
    var cap = 1; while (cap < nv * 2) cap <<= 1;
    var table = new Int32Array(cap).fill(-1), mask = cap - 1, map = new Int32Array(nv), rep = [], qx = new Int32Array(nv), qy = new Int32Array(nv), qz = new Int32Array(nv);
    for (i = 0; i < nv; i++) {
      var a = Math.round((pos[3 * i] - minx) * q), b = Math.round((pos[3 * i + 1] - miny) * q), c = Math.round((pos[3 * i + 2] - minz) * q);
      qx[i] = a; qy[i] = b; qz[i] = c;
      var h = (Math.imul(a, 73856093) ^ Math.imul(b, 19349663) ^ Math.imul(c, 83492791)) & mask;
      for (;;) {
        var j = table[h];
        if (j < 0) { table[h] = i; map[i] = rep.length; rep.push(i); break; }
        if (qx[j] === a && qy[j] === b && qz[j] === c) { map[i] = map[j]; break; }
        h = (h + 1) & mask;
      }
    }
    var W = rep.length, tv = new Int32Array(nt * 3), tn = new Float32Array(nt * 3), ok = new Uint8Array(nt);
    for (i = 0; i < nt; i++) {
      var A = idx[3 * i], B = idx[3 * i + 1], C = idx[3 * i + 2], wa = map[A], wb = map[B], wc = map[C];
      tv[3 * i] = wa; tv[3 * i + 1] = wb; tv[3 * i + 2] = wc;
      if (wa === wb || wb === wc || wa === wc) continue;
      var ux = pos[3 * B] - pos[3 * A], uy = pos[3 * B + 1] - pos[3 * A + 1], uz = pos[3 * B + 2] - pos[3 * A + 2];
      var vx = pos[3 * C] - pos[3 * A], vy = pos[3 * C + 1] - pos[3 * A + 1], vz = pos[3 * C + 2] - pos[3 * A + 2];
      var nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz);
      if (l < 1e-30) continue;
      tn[3 * i] = nx / l; tn[3 * i + 1] = ny / l; tn[3 * i + 2] = nz / l; ok[i] = 1;
    }
    var adj = new Int32Array(nt * 3).fill(-1), em = new Map();
    for (i = 0; i < nt; i++) {
      if (!ok[i]) continue;
      for (k = 0; k < 3; k++) {
        var p0 = tv[3 * i + k], p1 = tv[3 * i + (k + 1) % 3], key = p0 < p1 ? p0 * W + p1 : p1 * W + p0, o = em.get(key);
        if (o === undefined) em.set(key, i * 3 + k);
        else if (o >= 0) { adj[i * 3 + k] = Math.floor(o / 3); adj[o] = i; em.set(key, -1); }
      }
    }
    em = null;
    var region = new Int32Array(nt).fill(-1), nreg = 0, stack = [], members;
    function grow(seed, test) {
      members = [seed]; region[seed] = nreg; stack.length = 0; stack.push(seed);
      while (stack.length) {
        var t = stack.pop();
        for (var e = 0; e < 3; e++) {
          var nb = adj[t * 3 + e];
          if (nb < 0 || region[nb] !== -1 || !ok[nb]) continue;
          if (test(t, nb)) { region[nb] = nreg; members.push(nb); stack.push(nb); }
        }
      }
    }
    // pass 1: flat regions (every triangle within half a degree of the seed), at least 3 triangles
    var sx, sy, sz, cosFlat = Math.cos(0.5 * Math.PI / 180);
    var flatTest = function (t, nb) { return tn[3 * nb] * sx + tn[3 * nb + 1] * sy + tn[3 * nb + 2] * sz > cosFlat; };
    for (i = 0; i < nt; i++) {
      if (!ok[i] || region[i] !== -1) continue;
      sx = tn[3 * i]; sy = tn[3 * i + 1]; sz = tn[3 * i + 2];
      grow(i, flatTest);
      if (members.length >= 3) nreg++; else for (k = 0; k < members.length; k++) region[members[k]] = -2; // retry in pass 2
    }
    for (i = 0; i < nt; i++) if (region[i] === -2) region[i] = -1;
    // pass 2: everything else, split at creases
    var cosCrease = Math.cos((creaseDeg || 30) * Math.PI / 180);
    var creaseTest = function (t, nb) { return tn[3 * t] * tn[3 * nb] + tn[3 * t + 1] * tn[3 * nb + 1] + tn[3 * t + 2] * tn[3 * nb + 2] > cosCrease; };
    for (i = 0; i < nt; i++) { if (!ok[i] || region[i] !== -1) continue; grow(i, creaseTest); nreg++; }
    // emit: triangles grouped by region, vertices duplicated per region
    var count = new Uint32Array(nreg + 1), good = 0;
    for (i = 0; i < nt; i++) if (region[i] >= 0) { count[region[i] + 1]++; good++; }
    for (i = 0; i < nreg; i++) count[i + 1] += count[i];
    var order = new Uint32Array(good), fill = count.slice(0, nreg);
    for (i = 0; i < nt; i++) if (region[i] >= 0) order[fill[region[i]]++] = i;
    var stamp = new Int32Array(W).fill(-1), newIdx = new Int32Array(W), outPos = [], outIdx = new Uint32Array(good * 3), shellStart = new Uint32Array(nreg + 1), vcount = 0;
    for (var r = 0; r < nreg; r++) {
      shellStart[r] = count[r] * 3;
      for (k = count[r]; k < count[r + 1]; k++) {
        var t2 = order[k];
        for (var e2 = 0; e2 < 3; e2++) {
          var wv = tv[3 * t2 + e2];
          if (stamp[wv] !== r) { stamp[wv] = r; newIdx[wv] = vcount++; var src = rep[wv] * 3; outPos.push(pos[src], pos[src + 1], pos[src + 2]); }
          outIdx[k * 3 + e2] = newIdx[wv];
        }
      }
    }
    shellStart[nreg] = good * 3;
    return { pos: new Float32Array(outPos), idx: outIdx, shellStart: shellStart };
  }

  // ------------------------------------------------------------------ STL
  function parseSTL(bytes, name) {
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), pos, n, i;
    var binary = bytes.length >= 84 && 84 + dv.getUint32(80, true) * 50 === bytes.length;
    if (!binary) {
      var head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 1024)));
      if (!/^\s*solid/i.test(head) && bytes.length >= 84) binary = true; // truncated or padded binary file
    }
    if (binary) {
      n = Math.min(dv.getUint32(80, true), Math.floor((bytes.length - 84) / 50));
      pos = new Float32Array(n * 9);
      for (i = 0; i < n; i++) { var o = 84 + i * 50 + 12; for (var k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + 4 * k, true); }
    } else {
      var text = new TextDecoder('latin1').decode(bytes), re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g, m, arr = [];
      while ((m = re.exec(text))) arr.push(+m[1], +m[2], +m[3]);
      pos = new Float32Array(arr.length - arr.length % 9);
      for (i = 0; i < pos.length; i++) pos[i] = arr[i];
    }
    if (pos.length < 9) throw new Error('No triangles were found in this STL file.');
    var idx = new Uint32Array(pos.length / 3); for (i = 0; i < idx.length; i++) idx[i] = i;
    return { generic: true, title: baseName(name), scale: 0.001, unitless: true, warnings: [],
      root: { name: baseName(name), children: [], bodies: [{ pos: pos, idx: idx, shellStart: null, color: [176, 184, 191], matrix: null, key: 'stl' }] } };
  }

  // ------------------------------------------------------------------ 3MF
  var IDENT = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  function mulRV(A, B) { // row-vector 4x3 matrices: apply A, then B
    var r = new Array(12);
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) r[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
    for (j = 0; j < 3; j++) r[9 + j] = A[9] * B[j] + A[10] * B[3 + j] + A[11] * B[6 + j] + B[9 + j];
    return r;
  }
  function attr(s, name) { var m = new RegExp('(?:^|\\s)(?:[\\w.-]+:)?' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\')').exec(s); return m ? (m[1] !== undefined ? m[1] : m[2]) : null; }
  function hexColor(c) { var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c || ''); return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : null; }
  function parseTransform(s) { if (!s) return null; var a = s.trim().split(/\s+/).map(Number); return a.length === 12 && a.every(isFinite) ? a : null; }
  function parseModelXml(text) {
    var out = { unit: 'millimeter', objects: new Map(), items: [], colors: new Map() };
    var re = /<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g, m, obj = null, grp = null;
    var rx = /\sx\s*=\s*"([^"]*)"/, ry = /\sy\s*=\s*"([^"]*)"/, rz = /\sz\s*=\s*"([^"]*)"/, r1 = /\sv1\s*=\s*"([^"]*)"/, r2 = /\sv2\s*=\s*"([^"]*)"/, r3 = /\sv3\s*=\s*"([^"]*)"/;
    while ((m = re.exec(text))) {
      var close = m[1] === '/', tag = m[2].replace(/^.*:/, ''), at = m[3];
      if (tag === 'vertex' && obj && !close) { obj.pos.push(+rx.exec(at)[1], +ry.exec(at)[1], +rz.exec(at)[1]); continue; }
      if (tag === 'triangle' && obj && !close) {
        obj.idx.push(+r1.exec(at)[1], +r2.exec(at)[1], +r3.exec(at)[1]);
        if (obj.pid === null) { var tp = attr(at, 'pid'); if (tp !== null) { obj.pid = tp; obj.pindex = attr(at, 'p1') || '0'; } }
        continue;
      }
      if (close) { if (tag === 'object') obj = null; else if (tag === 'basematerials' || tag === 'colorgroup') grp = null; continue; }
      if (tag === 'model') { out.unit = attr(at, 'unit') || 'millimeter'; }
      else if (tag === 'object') { obj = { id: attr(at, 'id'), name: attr(at, 'name'), pid: attr(at, 'pid'), pindex: attr(at, 'pindex') || '0', pos: [], idx: [], comps: [] }; out.objects.set(obj.id, obj); }
      else if (tag === 'component' && obj) obj.comps.push({ objectid: attr(at, 'objectid'), path: attr(at, 'path'), transform: parseTransform(attr(at, 'transform')) });
      else if (tag === 'item') out.items.push({ objectid: attr(at, 'objectid'), path: attr(at, 'path'), transform: parseTransform(attr(at, 'transform')) });
      else if (tag === 'basematerials' || tag === 'colorgroup') { grp = []; out.colors.set(attr(at, 'id'), grp); }
      else if ((tag === 'base' || tag === 'color') && grp) grp.push(hexColor(attr(at, tag === 'base' ? 'displaycolor' : 'color')));
    }
    return out;
  }
  function parse3MF(bytes, name) {
    var files;
    try { files = fflate.unzipSync(bytes); } catch (e) { throw new Error('This 3MF file couldn’t be unzipped.'); }
    var lower = {}; Object.keys(files).forEach(function (k) { lower[k.toLowerCase().replace(/^\/+/, '')] = files[k]; });
    var dec = new TextDecoder('utf-8'), main = '3d/3dmodel.model';
    if (lower['_rels/.rels']) {
      var rels = dec.decode(lower['_rels/.rels']), rm = /<Relationship\b[^>]*3dmodel[^>]*>/i.exec(rels);
      if (rm) { var tg = attr(rm[0], 'Target'); if (tg) main = tg.replace(/^\/+/, '').toLowerCase(); }
    }
    if (!lower[main]) { var cand = Object.keys(lower).filter(function (k) { return /\.model$/.test(k); }); if (!cand.length) throw new Error('No 3D model was found inside this 3MF file.'); main = cand[0]; }
    var cache = {};
    function model(path) {
      path = (path || main).replace(/^\/+/, '').toLowerCase();
      if (!cache[path]) { if (!lower[path]) return null; cache[path] = parseModelXml(dec.decode(lower[path])); }
      return cache[path];
    }
    var top = model(main), scale = { micron: 1e-6, millimeter: 1e-3, centimeter: 1e-2, inch: 0.0254, foot: 0.3048, meter: 1 }[top.unit] || 1e-3;
    var warnings = [], count = 0;
    function color(md, o) { var g = o.pid !== null ? md.colors.get(o.pid) : null, c = g ? g[+o.pindex || 0] : null; return c || [176, 184, 191]; }
    function node(path, id, M, depth, fallback) {
      var md = model(path), o = md ? md.objects.get(id) : null;
      if (!o || depth > 12) { warnings.push('Part of this 3MF refers to an object that isn’t in the file.'); return null; }
      var nd = { name: o.name || fallback || ('Object ' + id), children: [], bodies: [] };
      if (o.idx.length) { nd.bodies.push({ pos: new Float32Array(o.pos), idx: new Uint32Array(o.idx), shellStart: null, color: color(md, o), matrix: M, key: (path || main) + '#' + id }); count++; }
      o.comps.forEach(function (c, i) {
        var ch = node(c.path || path, c.objectid, c.transform ? mulRV(c.transform, M) : M, depth + 1, 'Part ' + (i + 1));
        if (ch) nd.children.push(ch);
      });
      return nd;
    }
    var root = { name: baseName(name), children: [], bodies: [] };
    var items = top.items.length ? top.items : Array.from(top.objects.keys()).map(function (id) { return { objectid: id, path: null, transform: null }; });
    items.forEach(function (it, i) { var nd = node(it.path || null, it.objectid, it.transform || IDENT, 0, 'Object ' + (i + 1)); if (nd) root.children.push(nd); });
    if (!count) throw new Error('No meshes were found in this 3MF file.');
    if (root.children.length === 1 && !root.children[0].children.length) { root.bodies = root.children[0].bodies; root.children = []; }
    return { generic: true, title: baseName(name), scale: scale, unitless: false, root: root, warnings: warnings };
  }

  // ------------------------------------------------------------------ STEP (result of occt-import-js, read in metres)
  function fromOcct(res, name) {
    if (!res || !res.success || !res.meshes || !res.meshes.length) throw new Error('This STEP file couldn’t be converted. It may be empty or use features the converter doesn’t support.');
    var used = 0;
    function body(mi) {
      var m = res.meshes[mi], idx = new Uint32Array(m.index.array), ss = null;
      if (m.brep_faces && m.brep_faces.length) {
        ss = new Uint32Array(m.brep_faces.length + 1);
        for (var i = 0; i < m.brep_faces.length; i++) ss[i] = m.brep_faces[i].first * 3;
        ss[m.brep_faces.length] = idx.length;
      }
      var c = m.color ? [Math.round(m.color[0] * 255), Math.round(m.color[1] * 255), Math.round(m.color[2] * 255)] : [176, 184, 191];
      used++;
      return { pos: new Float32Array(m.attributes.position.array), idx: idx, shellStart: ss, normals: m.attributes.normal ? new Float32Array(m.attributes.normal.array) : null, color: c, matrix: null, key: 'step' + mi, name: m.name };
    }
    function conv(n, fallback) {
      var nd = { name: n.name || fallback, children: [], bodies: [] };
      (n.children || []).forEach(function (c, i) { nd.children.push(conv(c, 'Component ' + (i + 1))); });
      var ms = n.meshes || [];
      if (ms.length === 1 && !nd.children.length) nd.bodies.push(body(ms[0]));
      else ms.forEach(function (mi, i) { var b = body(mi); nd.children.push({ name: b.name || ('Body ' + (i + 1)), children: [], bodies: [b] }); });
      return nd;
    }
    var root = conv(res.root, baseName(name));
    while (!root.bodies.length && root.children.length === 1 && root.children[0].children.length) root = root.children[0]; // skip empty wrappers
    if (!root.name) root.name = baseName(name);
    if (!used) throw new Error('This STEP file contains no solid or surface geometry.');
    return { generic: true, title: root.name || baseName(name), scale: 1, unitless: false, root: root, warnings: [] };
  }

  // ------------------------------------------------------------------ text: Hershey single-stroke font
  // Glyph: [advance, stroke, stroke, ...]; stroke = [x,y,x,y,...]; cap height 21 units, baseline at 0.
  var FONT = {" ":[16],"!":[10,[5,21,5,7],[5,2,4,1,5,0,6,1,5,2]],"\"":[16,[4,21,4,14],[12,21,12,14]],"#":[21,[11,25,4,-7],[17,25,10,-7],[4,12,18,12],[3,6,17,6]],"$":[20,[8,25,8,-4],[12,25,12,-4],[17,18,15,20,12,21,8,21,5,20,3,18,3,16,4,14,5,13,7,12,13,10,15,9,16,8,17,6,17,3,15,1,12,0,8,0,5,1,3,3]],"%":[24,[21,21,3,0],[8,21,10,19,10,17,9,15,7,14,5,14,3,16,3,18,4,20,6,21,8,21,10,20,13,19,16,19,19,20,21,21],[17,7,15,6,14,4,14,2,16,0,18,0,20,1,21,3,21,5,19,7,17,7]],"&":[26,[23,12,23,13,22,14,21,14,20,13,19,11,17,6,15,3,13,1,11,0,7,0,5,1,4,2,3,4,3,6,4,8,5,9,12,13,13,14,14,16,14,18,13,20,11,21,9,20,8,18,8,16,9,13,11,10,16,3,18,1,20,0,22,0,23,1,23,2]],"'":[10,[5,19,4,20,5,21,6,20,6,18,5,16,4,15]],"(":[14,[11,25,9,23,7,20,5,16,4,11,4,7,5,2,7,-2,9,-5,11,-7]],")":[14,[3,25,5,23,7,20,9,16,10,11,10,7,9,2,7,-2,5,-5,3,-7]],"*":[16,[8,15,8,3],[3,12,13,6],[13,12,3,6]],"+":[26,[13,18,13,0],[4,9,22,9]],",":[8,[5,4,4,3,3,4,4,5,5,4,5,2,3,0]],"-":[26,[4,9,22,9]],".":[8,[4,5,3,4,4,3,5,4,4,5]],"/":[22,[20,25,2,-7]],"0":[20,[9,21,6,20,4,17,3,12,3,9,4,4,6,1,9,0,11,0,14,1,16,4,17,9,17,12,16,17,14,20,11,21,9,21]],"1":[20,[6,17,8,18,11,21,11,0]],"2":[20,[4,16,4,17,5,19,6,20,8,21,12,21,14,20,15,19,16,17,16,15,15,13,13,10,3,0,17,0]],"3":[20,[5,21,16,21,10,13,13,13,15,12,16,11,17,8,17,6,16,3,14,1,11,0,8,0,5,1,4,2,3,4]],"4":[20,[13,21,3,7,18,7],[13,21,13,0]],"5":[20,[15,21,5,21,4,12,5,13,8,14,11,14,14,13,16,11,17,8,17,6,16,3,14,1,11,0,8,0,5,1,4,2,3,4]],"6":[20,[16,18,15,20,12,21,10,21,7,20,5,17,4,12,4,7,5,3,7,1,10,0,11,0,14,1,16,3,17,6,17,7,16,10,14,12,11,13,10,13,7,12,5,10,4,7]],"7":[20,[17,21,7,0],[3,21,17,21]],"8":[20,[8,21,5,20,4,18,4,16,5,14,7,13,11,12,14,11,16,9,17,7,17,4,16,2,15,1,12,0,8,0,5,1,4,2,3,4,3,7,4,9,6,11,9,12,13,13,15,14,16,16,16,18,15,20,12,21,8,21]],"9":[20,[16,14,15,11,13,9,10,8,9,8,6,9,4,11,3,14,3,15,4,18,6,20,9,21,10,21,13,20,15,18,16,14,16,9,15,4,13,1,10,0,8,0,5,1,4,3]],":":[8,[4,12,3,11,4,10,5,11,4,12],[4,5,3,4,4,3,5,4,4,5]],";":[8,[4,12,3,11,4,10,5,11,4,12],[5,4,4,3,3,4,4,5,5,4,5,2,3,0]],"<":[24,[20,18,4,9,20,0]],"=":[26,[4,12,22,12],[4,6,22,6]],">":[24,[4,18,20,9,4,0]],"?":[18,[3,16,3,17,4,19,5,20,7,21,11,21,13,20,14,19,15,17,15,15,14,13,13,12,9,10,9,7],[9,2,8,1,9,0,10,1,9,2]],"@":[27,[18,13,17,15,15,16,12,16,10,15,9,14,8,11,8,8,9,6,11,5,14,5,16,6,17,8],[12,16,10,14,9,11,9,8,10,6,11,5],[18,16,17,8,17,6,19,5,21,5,23,7,24,10,24,12,23,15,22,17,20,19,18,20,15,21,12,21,9,20,7,19,5,17,4,15,3,12,3,9,4,6,5,4,7,2,9,1,12,0,15,0,18,1,20,2,21,3],[19,16,18,8,18,6,19,5]],"A":[18,[9,21,1,0],[9,21,17,0],[4,7,14,7]],"B":[21,[4,21,4,0],[4,21,13,21,16,20,17,19,18,17,18,15,17,13,16,12,13,11],[4,11,13,11,16,10,17,9,18,7,18,4,17,2,16,1,13,0,4,0]],"C":[21,[18,16,17,18,15,20,13,21,9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5]],"D":[21,[4,21,4,0],[4,21,11,21,14,20,16,18,17,16,18,13,18,8,17,5,16,3,14,1,11,0,4,0]],"E":[19,[4,21,4,0],[4,21,17,21],[4,11,12,11],[4,0,17,0]],"F":[18,[4,21,4,0],[4,21,17,21],[4,11,12,11]],"G":[21,[18,16,17,18,15,20,13,21,9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5,18,8],[13,8,18,8]],"H":[22,[4,21,4,0],[18,21,18,0],[4,11,18,11]],"I":[8,[4,21,4,0]],"J":[16,[12,21,12,5,11,2,10,1,8,0,6,0,4,1,3,2,2,5,2,7]],"K":[21,[4,21,4,0],[18,21,4,7],[9,12,18,0]],"L":[17,[4,21,4,0],[4,0,16,0]],"M":[24,[4,21,4,0],[4,21,12,0],[20,21,12,0],[20,21,20,0]],"N":[22,[4,21,4,0],[4,21,18,0],[18,21,18,0]],"O":[22,[9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5,19,8,19,13,18,16,17,18,15,20,13,21,9,21]],"P":[21,[4,21,4,0],[4,21,13,21,16,20,17,19,18,17,18,14,17,12,16,11,13,10,4,10]],"Q":[22,[9,21,7,20,5,18,4,16,3,13,3,8,4,5,5,3,7,1,9,0,13,0,15,1,17,3,18,5,19,8,19,13,18,16,17,18,15,20,13,21,9,21],[12,4,18,-2]],"R":[21,[4,21,4,0],[4,21,13,21,16,20,17,19,18,17,18,15,17,13,16,12,13,11,4,11],[11,11,18,0]],"S":[20,[17,18,15,20,12,21,8,21,5,20,3,18,3,16,4,14,5,13,7,12,13,10,15,9,16,8,17,6,17,3,15,1,12,0,8,0,5,1,3,3]],"T":[16,[8,21,8,0],[1,21,15,21]],"U":[22,[4,21,4,6,5,3,7,1,10,0,12,0,15,1,17,3,18,6,18,21]],"V":[18,[1,21,9,0],[17,21,9,0]],"W":[24,[2,21,7,0],[12,21,7,0],[12,21,17,0],[22,21,17,0]],"X":[20,[3,21,17,0],[17,21,3,0]],"Y":[18,[1,21,9,11,9,0],[17,21,9,11]],"Z":[20,[17,21,3,0],[3,21,17,21],[3,0,17,0]],"[":[14,[4,25,4,-7],[5,25,5,-7],[4,25,11,25],[4,-7,11,-7]],"\\":[14,[0,21,14,-3]],"]":[14,[9,25,9,-7],[10,25,10,-7],[3,25,10,25],[3,-7,10,-7]],"^":[16,[8,23,0,9],[8,23,16,9]],"_":[18,[0,-7,18,-7]],"`":[8,[5,16,3,14,3,12,4,11,5,12,4,13,3,12]],"a":[19,[15,14,15,0],[15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],"b":[19,[4,21,4,0],[4,11,6,13,8,14,11,14,13,13,15,11,16,8,16,6,15,3,13,1,11,0,8,0,6,1,4,3]],"c":[18,[15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],"d":[19,[15,21,15,0],[15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],"e":[18,[3,8,15,8,15,10,14,12,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],"f":[12,[10,21,8,21,6,20,5,17,5,0],[2,14,9,14]],"g":[19,[15,14,15,-2,14,-5,13,-6,11,-7,8,-7,6,-6],[15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],"h":[19,[4,21,4,0],[4,10,7,13,9,14,12,14,14,13,15,10,15,0]],"i":[8,[3,21,4,20,5,21,4,22,3,21],[4,14,4,0]],"j":[10,[5,21,6,20,7,21,6,22,5,21],[6,14,6,-3,5,-6,3,-7,1,-7]],"k":[17,[4,21,4,0],[14,14,4,4],[8,8,15,0]],"l":[8,[4,21,4,0]],"m":[30,[4,14,4,0],[4,10,7,13,9,14,12,14,14,13,15,10,15,0],[15,10,18,13,20,14,23,14,25,13,26,10,26,0]],"n":[19,[4,14,4,0],[4,10,7,13,9,14,12,14,14,13,15,10,15,0]],"o":[19,[8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3,16,6,16,8,15,11,13,13,11,14,8,14]],"p":[19,[4,14,4,-7],[4,11,6,13,8,14,11,14,13,13,15,11,16,8,16,6,15,3,13,1,11,0,8,0,6,1,4,3]],"q":[19,[15,14,15,-7],[15,11,13,13,11,14,8,14,6,13,4,11,3,8,3,6,4,3,6,1,8,0,11,0,13,1,15,3]],"r":[13,[4,14,4,0],[4,8,5,11,7,13,9,14,12,14]],"s":[17,[14,11,13,13,10,14,7,14,4,13,3,11,4,9,6,8,11,7,13,6,14,4,14,3,13,1,10,0,7,0,4,1,3,3]],"t":[12,[5,21,5,4,6,1,8,0,10,0],[2,14,9,14]],"u":[19,[4,14,4,4,5,1,7,0,10,0,12,1,15,4],[15,14,15,0]],"v":[16,[2,14,8,0],[14,14,8,0]],"w":[22,[3,14,7,0],[11,14,7,0],[11,14,15,0],[19,14,15,0]],"x":[17,[3,14,14,0],[14,14,3,0]],"y":[16,[2,14,8,0],[14,14,8,0,6,-4,4,-6,2,-7,1,-7]],"z":[17,[14,14,3,0],[3,14,14,14],[3,0,14,0]],"{":[14,[9,25,7,24,6,23,5,21,5,19,6,17,7,16,8,14,8,12,6,10],[7,24,6,22,6,20,7,18,8,17,9,15,9,13,8,11,4,9,8,7,9,5,9,3,8,1,7,0,6,-2,6,-4,7,-6],[6,8,8,6,8,4,7,2,6,1,5,-1,5,-3,6,-5,7,-6,9,-7]],"|":[8,[4,25,4,-7]],"}":[14,[5,25,7,24,8,23,9,21,9,19,8,17,7,16,6,14,6,12,8,10],[7,24,8,22,8,20,7,18,6,17,5,15,5,13,6,11,10,9,6,7,5,5,5,3,6,1,7,0,8,-2,8,-4,7,-6],[8,8,6,6,6,4,7,2,8,1,9,-1,9,-3,8,-5,7,-6,5,-7]],"~":[24,[3,6,3,8,4,11,6,12,8,12,10,11,14,8,16,7,18,7,20,8,21,10],[3,8,4,10,6,11,8,11,10,10,14,7,16,6,18,6,20,7,21,10,21,12]]};
  (function () {
    var O = FONT['O'], plus = [26, [13, 18, 13, 4], [4, 11, 22, 11], [4, 0, 22, 0]], deg = [12], c = [];
    for (var i = 0; i <= 12; i++) { var a = i / 12 * 2 * Math.PI; c.push(6 + 3.2 * Math.cos(a), 17.5 + 3.2 * Math.sin(a)); }
    deg.push(c);
    FONT['\u00d8'] = FONT['\u2205'] = O.concat([[O[0] - 3, 23, 3, -2]]);
    FONT['\u00b1'] = plus; FONT['\u00b0'] = deg;
    var alias = { '\u2013': '-', '\u2014': '-', '\u2212': '-', '\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u00d7': 'x', '\u00b5': 'u', '\u00b2': '2', '\u00b3': '3', '\u00a0': ' ', '\t': ' ' };
    Object.keys(alias).forEach(function (k) { FONT[k] = FONT[alias[k]]; });
  })();
  function glyph(ch) { return FONT[ch] || FONT['?']; }
  function textWidth(s) { var w = 0; for (var i = 0; i < s.length; i++) w += glyph(s[i])[0]; return w; }
  function percentCodes(s) {
    return s.replace(/%%([cdpCDP])/g, function (m, k) { k = k.toLowerCase(); return k === 'c' ? '\u00d8' : k === 'd' ? '\u00b0' : '\u00b1'; })
      .replace(/%%[uokUOK]/g, '').replace(/%%(\d{3})/g, function (m, n) { return String.fromCharCode(+n); }).replace(/%%%/g, '%');
  }
  function unicodeCodes(s) { return s.replace(/\\U\+([0-9A-Fa-f]{4})/g, function (m, h) { return String.fromCharCode(parseInt(h, 16)); }); }
  function mtextPlain(s) {
    s = s.replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003');
    s = s.replace(/\\P/g, '\n').replace(/\\~/g, ' ');
    s = s.replace(/\\S([^;]*);/g, function (m, a) { return a.replace(/[\^#]/, '/').replace(/\\/g, ''); });
    s = s.replace(/\\[ACcFfHhQqTtWwp][^;]*;/g, '').replace(/\\[LlOoKkNnX]/g, '');
    s = unicodeCodes(s).replace(/[{}]/g, '');
    return percentCodes(s.replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}'));
  }
  // Lay out lines of text as stroke pairs [x1,y1,x2,y2,...] in drawing units.
  // align: per-line horizontal offset factor (0 left, 0.5 centre, 1 right); top: y of the first baseline (font units, before scaling)
  function strokeText(lines, h, wf, rot, x, y, hFactor, firstBaseline, lineGap, out) {
    var s = h / 21, co = Math.cos(rot), si = Math.sin(rot);
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li], ox = -textWidth(line) * hFactor, oy = firstBaseline - li * lineGap;
      for (var i = 0; i < line.length; i++) {
        var g = glyph(line[i]);
        for (var k = 1; k < g.length; k++) {
          var st = g[k];
          for (var q = 0; q + 3 < st.length; q += 2) {
            var ax = (ox + st[q]) * s * wf, ay = (oy + st[q + 1]) * s, bx = (ox + st[q + 2]) * s * wf, by = (oy + st[q + 3]) * s;
            out.push(x + ax * co - ay * si, y + ax * si + ay * co, x + bx * co - by * si, y + bx * si + by * co);
          }
        }
        ox += g[0];
      }
    }
    return out;
  }
  function wrapLines(lines, maxW) { // maxW in font units
    if (!(maxW > 0)) return lines;
    var out = [];
    lines.forEach(function (ln) {
      var words = ln.split(' '), cur = '';
      words.forEach(function (w) {
        var t = cur ? cur + ' ' + w : w;
        if (cur && textWidth(t) > maxW) { out.push(cur); cur = w; } else cur = t;
      });
      out.push(cur);
    });
    return out;
  }

  // ------------------------------------------------------------------ DXF (2D)
  var ACI = [[0, 0, 0], [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192]];
  function aci(i) {
    if (i < 10) return ACI[i] || null;
    if (i >= 250) { var g = Math.round(51 + (i - 250) * 40.8); return [g, g, g]; }
    var hue = Math.floor((i - 10) / 10) * 15, v = [1, 0.8, 0.6, 0.5, 0.3][Math.floor(((i - 10) % 10) / 2)], s = (i % 2) ? 0.5 : 1;
    var c = v * s, hp = hue / 60, x = c * (1 - Math.abs(hp % 2 - 1)), m = v - c, r = 0, g2 = 0, b = 0;
    if (hp < 1) { r = c; g2 = x; } else if (hp < 2) { r = x; g2 = c; } else if (hp < 3) { g2 = c; b = x; } else if (hp < 4) { g2 = x; b = c; } else if (hp < 5) { r = x; b = c; } else { r = c; b = x; }
    return [Math.round((r + m) * 255), Math.round((g2 + m) * 255), Math.round((b + m) * 255)];
  }
  function arcPts(cx, cy, r, a0, a1, out) { // angles in radians, counter-clockwise from a0 to a1
    while (a1 <= a0) a1 += 2 * Math.PI;
    var n = Math.max(2, Math.ceil((a1 - a0) / (Math.PI / 36)));
    for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; out.push(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    return out;
  }
  function bulgePts(x0, y0, x1, y1, bulge, out) { // arc from p0 to p1 defined by a polyline bulge; appends points after p0
    var dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
    if (!bulge || d < 1e-12) { out.push(x1, y1); return; }
    var th = 4 * Math.atan(bulge), r = d / (2 * Math.sin(th / 2)), mx = (x0 + x1) / 2, my = (y0 + y1) / 2, h = r * Math.cos(th / 2);
    var cx = mx - h * dy / d, cy = my + h * dx / d, a0 = Math.atan2(y0 - cy, x0 - cx), n = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 36)));
    for (var i = 1; i <= n; i++) { var a = a0 + th * i / n; out.push(cx + Math.abs(r) * Math.cos(a), cy + Math.abs(r) * Math.sin(a)); }
  }
  function splinePts(deg, knots, ctrl, w) { // ctrl: [x,y,...]
    var n = ctrl.length / 2 - 1, out = [];
    if (n < 1) return out;
    if (knots.length < n + deg + 2) { for (var q = 0; q < ctrl.length; q++) out.push(ctrl[q]); return out; }
    var t0 = knots[deg], t1 = knots[n + 1], steps = Math.max(8, (n + 1) * 8);
    for (var s = 0; s <= steps; s++) {
      var t = t0 + (t1 - t0) * s / steps, k = deg;
      if (s === steps) { k = n; } else { while (k < n && t >= knots[k + 1]) k++; }
      var dx = [], dy = [], dw = [];
      for (var j = 0; j <= deg; j++) { var ci = k - deg + j, ww = w.length ? w[ci] : 1; dx.push(ctrl[2 * ci] * ww); dy.push(ctrl[2 * ci + 1] * ww); dw.push(ww); }
      for (var r = 1; r <= deg; r++) for (j = deg; j >= r; j--) {
        var den = knots[j + 1 + k - r] - knots[j + k - deg], al = den ? (t - knots[j + k - deg]) / den : 0;
        dx[j] = (1 - al) * dx[j - 1] + al * dx[j]; dy[j] = (1 - al) * dy[j - 1] + al * dy[j]; dw[j] = (1 - al) * dw[j - 1] + al * dw[j];
      }
      out.push(dx[deg] / (dw[deg] || 1), dy[deg] / (dw[deg] || 1));
    }
    return out;
  }
  function parseDXF(text, name) {
    if (text.indexOf('AutoCAD Binary DXF') === 0) throw new Error('Binary DXF files aren’t supported. Save the drawing as a normal (ASCII) DXF.');
    var lines = text.split(/\r\n|\r|\n/), codes = [], vals = [], i;
    for (i = 0; i + 1 < lines.length; i += 2) { var c = parseInt(lines[i], 10); if (isNaN(c)) { i--; continue; } codes.push(c); vals.push(lines[i + 1]); }
    if (!codes.length || vals.indexOf('SECTION') < 0) throw new Error('This doesn’t look like a DXF drawing.');
    var N = codes.length, p = 0, layers = new Map(), blocks = new Map(), ents = [], insunits = 0, warnings = [], skipped = {};
    function readEntity() { // p at a 0-code; returns {type, g: [[code,val],...]} and leaves p at the next 0-code
      var e = { type: vals[p].trim().toUpperCase(), g: [] }; p++;
      while (p < N && codes[p] !== 0) { e.g.push(codes[p], vals[p]); p++; }
      return e;
    }
    function num(e, code, def) { for (var k = 0; k < e.g.length; k += 2) if (e.g[k] === code) return parseFloat(e.g[k + 1]); return def; }
    function str(e, code, def) { for (var k = 0; k < e.g.length; k += 2) if (e.g[k] === code) return e.g[k + 1].trim(); return def; }
    function all(e, code) { var o = []; for (var k = 0; k < e.g.length; k += 2) if (e.g[k] === code) o.push(parseFloat(e.g[k + 1])); return o; }
    function entityList(stop) { // reads entities until a 0/stop record; gathers POLYLINE vertices
      var list = [];
      while (p < N) {
        if (codes[p] !== 0) { p++; continue; }
        var t = vals[p].trim().toUpperCase();
        if (t === stop || t === 'ENDSEC' || t === 'EOF') break;
        var e = readEntity();
        if (e.type === 'POLYLINE') {
          e.verts = [];
          while (p < N && codes[p] === 0) {
            var t2 = vals[p].trim().toUpperCase();
            if (t2 === 'VERTEX') e.verts.push(readEntity()); else { if (t2 === 'SEQEND') readEntity(); break; }
          }
        }
        list.push(e);
      }
      return list;
    }
    while (p < N) {
      if (codes[p] === 0 && vals[p].trim() === 'SECTION' && codes[p + 1] === 2) {
        var sec = vals[p + 1].trim().toUpperCase(); p += 2;
        if (sec === 'HEADER') {
          while (p < N && !(codes[p] === 0 && vals[p].trim() === 'ENDSEC')) { if (codes[p] === 9 && vals[p].trim() === '$INSUNITS' && codes[p + 1] === 70) insunits = parseInt(vals[p + 1], 10) || 0; p++; }
        } else if (sec === 'TABLES') {
          while (p < N && !(codes[p] === 0 && vals[p].trim() === 'ENDSEC')) {
            if (codes[p] === 0 && vals[p].trim().toUpperCase() === 'LAYER') {
              var le = readEntity(), ln = str(le, 2, '0'), lc = num(le, 62, 7), tc = num(le, 420, NaN);
              layers.set(ln, { name: ln, color: isFinite(tc) ? [(tc >> 16) & 255, (tc >> 8) & 255, tc & 255] : aci(Math.abs(lc)), off: lc < 0 || (num(le, 70, 0) & 1) === 1 });
            } else p++;
          }
        } else if (sec === 'BLOCKS') {
          while (p < N && !(codes[p] === 0 && vals[p].trim() === 'ENDSEC')) {
            if (codes[p] === 0 && vals[p].trim().toUpperCase() === 'BLOCK') {
              var be = readEntity(), bn = str(be, 2, '');
              blocks.set(bn, { name: bn, bx: num(be, 10, 0), by: num(be, 20, 0), ents: entityList('ENDBLK') });
              if (p < N && codes[p] === 0 && vals[p].trim().toUpperCase() === 'ENDBLK') readEntity();
            } else p++;
          }
        } else if (sec === 'ENTITIES') { ents = entityList('ENDSEC'); }
      } else p++;
    }
    // flatten to primitives: straight segments, arcs, circles and curves, each with its points
    var out = new Map(), primCount = 0, textCount = 0, paper = false;
    function layerOf(nm) { var L = out.get(nm); if (!L) { var d = layers.get(nm); L = { name: nm, color: d && d.color ? d.color : null, off: !!(d && d.off), prims: [] }; out.set(nm, L); } return L; }
    function emit(layer, color, pts, closed, T) { // T: [a,b,c,d,tx,ty] maps block coords to world
      if (pts.length < 4) return;
      var w = new Array(pts.length);
      for (var k = 0; k < pts.length; k += 2) { w[k] = T[0] * pts[k] + T[2] * pts[k + 1] + T[4]; w[k + 1] = T[1] * pts[k] + T[3] * pts[k + 1] + T[5]; }
      layerOf(layer).prims.push({ pts: w, closed: !!closed, color: color }); primCount++;
    }
    function emitPairs(layer, color, pairs, T) {
      if (pairs.length < 4) return;
      var w = new Array(pairs.length);
      for (var k = 0; k < pairs.length; k += 2) { w[k] = T[0] * pairs[k] + T[2] * pairs[k + 1] + T[4]; w[k + 1] = T[1] * pairs[k] + T[3] * pairs[k + 1] + T[5]; }
      layerOf(layer).prims.push({ pts: w, pairs: true, text: true, color: color }); primCount++; textCount++;
    }
    function polyline(layer, color, xs, ys, bulges, closed, T) {
      var n = xs.length; if (n < 2) return;
      for (var k = 0; k < (closed ? n : n - 1); k++) {
        var k2 = (k + 1) % n, seg = [xs[k], ys[k]];
        bulgePts(xs[k], ys[k], xs[k2], ys[k2], bulges[k] || 0, seg);
        emit(layer, color, seg, false, T);
      }
    }
    function walk(list, T, parentLayer, parentColor, depth) {
      for (var k = 0; k < list.length; k++) {
        var e = list[k]; if (num(e, 67, 0) === 1 && !paper) continue; // paper space
        var layer = str(e, 8, '0'); if (layer === '0' && parentLayer) layer = parentLayer;
        var ci = num(e, 62, 256), tc = num(e, 420, NaN), color = isFinite(tc) ? [(tc >> 16) & 255, (tc >> 8) & 255, tc & 255] : (ci === 0 ? parentColor : (ci === 256 ? null : aci(Math.abs(ci))));
        if (ci === 256 && !isFinite(tc) && parentColor && str(e, 8, '0') === '0') color = parentColor;
        var flip = num(e, 230, 1) < 0 ? -1 : 1, pts;
        switch (e.type) {
          case 'LINE': emit(layer, color, [num(e, 10, 0), num(e, 20, 0), num(e, 11, 0), num(e, 21, 0)], false, T); break;
          case 'CIRCLE': emit(layer, color, arcPts(flip * num(e, 10, 0), num(e, 20, 0), num(e, 40, 0), 0, 2 * Math.PI, []).slice(0, -2), true, T); break;
          case 'ARC': {
            var a0 = num(e, 50, 0) * Math.PI / 180, a1 = num(e, 51, 360) * Math.PI / 180;
            if (flip < 0) { var s0 = Math.PI - a1, s1 = Math.PI - a0; a0 = s0; a1 = s1; }
            emit(layer, color, arcPts(flip * num(e, 10, 0), num(e, 20, 0), num(e, 40, 0), a0, a1, []), false, T); break;
          }
          case 'ELLIPSE': {
            var mx = num(e, 11, 1), my = num(e, 21, 0), ratio = num(e, 40, 1), u0 = num(e, 41, 0), u1 = num(e, 42, 2 * Math.PI), cx = num(e, 10, 0), cy = num(e, 20, 0);
            while (u1 <= u0) u1 += 2 * Math.PI;
            var full = Math.abs(u1 - u0 - 2 * Math.PI) < 1e-6, ne = Math.max(8, Math.ceil((u1 - u0) / (Math.PI / 36))); pts = [];
            for (var q = 0; q <= ne; q++) { var u = u0 + (u1 - u0) * q / ne; pts.push(cx + mx * Math.cos(u) - my * ratio * Math.sin(u), cy + my * Math.cos(u) + mx * ratio * Math.sin(u)); }
            emit(layer, color, full ? pts.slice(0, -2) : pts, full, T); break;
          }
          case 'LWPOLYLINE': {
            var xs = [], ys = [], bs = [];
            for (var g = 0; g < e.g.length; g += 2) {
              if (e.g[g] === 10) { xs.push(flip * parseFloat(e.g[g + 1])); bs.push(0); }
              else if (e.g[g] === 20) ys.push(parseFloat(e.g[g + 1]));
              else if (e.g[g] === 42 && bs.length) bs[bs.length - 1] = flip * parseFloat(e.g[g + 1]);
            }
            polyline(layer, color, xs, ys, bs, (num(e, 70, 0) & 1) === 1, T); break;
          }
          case 'POLYLINE': {
            var fl = num(e, 70, 0); if (fl & 80) { skipped.mesh = 1; break; } // polygon / polyface meshes
            var px = [], py = [], pb = [];
            (e.verts || []).forEach(function (v) { px.push(flip * num(v, 10, 0)); py.push(num(v, 20, 0)); pb.push(flip * num(v, 42, 0)); });
            polyline(layer, color, px, py, pb, (fl & 1) === 1, T); break;
          }
          case 'SPLINE': {
            var cxs = all(e, 10), cys = all(e, 20), ctrl = [], fx = all(e, 11), fy = all(e, 21);
            for (var s = 0; s < Math.min(cxs.length, cys.length); s++) ctrl.push(cxs[s], cys[s]);
            if (ctrl.length >= 4) pts = splinePts(num(e, 71, 3), all(e, 40), ctrl, all(e, 41).length === ctrl.length / 2 ? all(e, 41) : []);
            else { pts = []; for (s = 0; s < Math.min(fx.length, fy.length); s++) pts.push(fx[s], fy[s]); }
            emit(layer, color, pts, false, T); break;
          }
          case 'INSERT': case 'DIMENSION': {
            var b = blocks.get(str(e, 2, '')); if (!b || depth > 8) break;
            var T2 = T;
            if (e.type === 'INSERT') {
              var sx = num(e, 41, 1), sy = num(e, 42, sx), rot = num(e, 50, 0) * Math.PI / 180, ix = flip * num(e, 10, 0), iy = num(e, 20, 0), co = Math.cos(rot), si = Math.sin(rot);
              var L = [co * sx, si * sx, -si * sy, co * sy, ix - (co * sx * b.bx - si * sy * b.by), iy - (si * sx * b.bx + co * sy * b.by)]; // block -> parent
              T2 = [T[0] * L[0] + T[2] * L[1], T[1] * L[0] + T[3] * L[1], T[0] * L[2] + T[2] * L[3], T[1] * L[2] + T[3] * L[3], T[0] * L[4] + T[2] * L[5] + T[4], T[1] * L[4] + T[3] * L[5] + T[5]];
            }
            walk(b.ents, T2, layer, color, depth + 1); break;
          }
          case 'TEXT': case 'ATTRIB': {
            if (e.type === 'ATTRIB' && (num(e, 70, 0) & 1)) break; // invisible attribute
            var tx = percentCodes(unicodeCodes(str(e, 1, ''))); if (!tx) break;
            var th = num(e, 40, 1), twf = num(e, 41, 1) || 1, trot = num(e, 50, 0) * Math.PI / 180, hj = num(e, 72, 0), vj = num(e, e.type === 'ATTRIB' ? 74 : 73, 0);
            var ax = flip * num(e, 10, 0), ay = num(e, 20, 0), bxp = num(e, 11, NaN), byp = num(e, 21, NaN), hasB = isFinite(bxp) && isFinite(byp);
            if (hasB) bxp *= flip;
            if ((hj === 3 || hj === 5) && hasB) { // aligned / fit between the two points
              var dl = Math.hypot(bxp - ax, byp - ay), tw = textWidth(tx) * th / 21;
              trot = Math.atan2(byp - ay, bxp - ax);
              if (tw > 0 && dl > 0) { if (hj === 3) th *= dl / tw / twf; else twf = dl / tw; }
              hj = 0; vj = 0;
            } else if ((hj || vj) && hasB) { ax = bxp; ay = byp; }
            var hf = hj === 1 || hj === 4 ? 0.5 : hj === 2 ? 1 : 0, base = hj === 4 ? -10.5 : vj === 1 ? 7 : vj === 2 ? -10.5 : vj === 3 ? -21 : 0;
            emitPairs(layer, color, strokeText([tx], th, twf, trot, ax, ay, hf, base, 0, []), T); break;
          }
          case 'MTEXT': {
            var raw = ''; for (var g3 = 0; g3 < e.g.length; g3 += 2) if (e.g[g3] === 3) raw += e.g[g3 + 1]; raw += str(e, 1, '');
            var mt = mtextPlain(raw); if (!mt.trim()) break;
            var mh = num(e, 40, 1), att = num(e, 71, 1), dx2 = num(e, 11, NaN), dy2 = num(e, 21, NaN);
            var mrot = isFinite(dx2) && isFinite(dy2) && (dx2 || dy2) ? Math.atan2(dy2, flip * dx2) : num(e, 50, 0);
            var refw = num(e, 41, 0), lines2 = wrapLines(mt.split('\n'), refw > 0 ? refw / (mh / 21) * 1.02 : 0);
            var gap = 21 * 5 / 3 * (num(e, 44, 1) || 1), col = (att - 1) % 3, rowi = Math.floor((att - 1) / 3), blockH = 21 + (lines2.length - 1) * gap;
            var top = rowi === 0 ? 0 : rowi === 1 ? blockH / 2 : blockH;
            emitPairs(layer, color, strokeText(lines2, mh, 1, mrot, flip * num(e, 10, 0), num(e, 20, 0), col * 0.5, top - 21, gap, []), T); break;
          }
          case 'SOLID': case 'TRACE': {
            var c0 = [flip * num(e, 10, 0), num(e, 20, 0)], c1 = [flip * num(e, 11, 0), num(e, 21, 0)], c2 = [flip * num(e, 12, 0), num(e, 22, 0)], c3 = [flip * num(e, 13, c2[0] * flip), num(e, 23, c2[1])];
            emit(layer, color, [c0[0], c0[1], c1[0], c1[1], c3[0], c3[1], c2[0], c2[1]], true, T); break;
          }
          case 'LEADER': {
            var lx = all(e, 10), ly = all(e, 20), lb = [];
            for (var q2 = 0; q2 < lx.length; q2++) lb.push(0);
            polyline(layer, color, lx.map(function (v) { return flip * v; }), ly, lb, false, T); break;
          }
          case 'ATTDEF': break;
          case 'HATCH': skipped.hatch = (skipped.hatch || 0) + 1; break;
          case '3DFACE': case 'IMAGE': case 'VIEWPORT': case 'POINT': case 'MLEADER': skipped.other = 1; break;
          default: break;
        }
      }
    }
    walk(ents, [1, 0, 0, 1, 0, 0], null, null, 0);
    if (!primCount) { // nothing in model space: show the paper space layout instead
      paper = true; out.clear();
      walk(ents.filter(function (x) { return num(x, 67, 0) === 1; }), [1, 0, 0, 1, 0, 0], null, null, 0);
      blocks.forEach(function (b, nm) { if (/^\*paper_space/i.test(nm)) walk(b.ents, [1, 0, 0, 1, 0, 0], null, null, 0); });
      if (primCount) warnings.push('This drawing has nothing in model space, so its paper space layout is shown.');
    }
    if (!primCount) throw new Error('No lines, arcs, circles or text were found in this drawing.');
    if (skipped.hatch) warnings.push('Hatch patterns and fills aren’t drawn (' + skipped.hatch + ' hatch' + (skipped.hatch > 1 ? 'es' : '') + ').');
    var unit = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 8: 0.0000000254, 9: 0.0000254, 10: 0.9144, 13: 1e-6, 14: 0.1 }[insunits];
    return { is2D: true, title: baseName(name), scale: unit || 0.001, unitless: !unit, layers: Array.from(out.values()).filter(function (L) { return L.prims.length; }), warnings: warnings, primCount: primCount, textCount: textCount };
  }

  function decodeText(bytes) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (e) { return new TextDecoder('windows-1252').decode(bytes); }
  }
  // SolidWorks writes Y-up coordinates; most other CAD tools and all 3D printing files are Z-up.
  function upGuess(kindName, bytes) {
    if (kindName === '3mf') return 'z';
    var head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 4096))).toLowerCase();
    if (kindName === 'step') return /onshape|catia|unigraphics|siemens nx|\bnx\b|solid edge|rhino|freecad|sketchup/.test(head) ? 'z' : 'y';
    return /solidworks|solid works/.test(head) ? 'y' : 'z';
  }
  return { decodeText: decodeText, upGuess: upGuess, kind: kind, baseName: baseName, segmentFaces: segmentFaces, parseSTL: parseSTL, parse3MF: parse3MF, fromOcct: fromOcct, parseDXF: parseDXF };
})();
if (typeof module !== 'undefined') module.exports = FMT;
