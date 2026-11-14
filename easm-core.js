// eDrawings .easm reader: ZIP container -> HOOPS Stream (HSF) eModel -> segment tree + shells.
// Reverse-engineered from SolidWorks eDrawings files (HSF V20.x). No geometry leaves the browser.
var EASM = (function () {
  'use strict';

  function unpack(bytes) {
    var files;
    try { files = fflate.unzipSync(bytes); }
    catch (e) { throw new Error('This file isn’t a ZIP-based eDrawings file (.easm or .eprt).'); }
    var names = Object.keys(files);
    var em = null, preview = null;
    for (var i = 0; i < names.length; i++) {
      var n = names[i].toLowerCase();
      if (n === 'emodel') em = files[names[i]];
      if (n === 'preview.jpg') preview = files[names[i]];
    }
    if (!em) throw new Error('No 3D model data (eModel) was found inside this file.');
    return { eModel: em, preview: preview };
  }

  function inflateModel(em) {
    var head = new TextDecoder('latin1').decode(em.subarray(0, 16));
    if (head.indexOf(';; HSF') !== 0) throw new Error('The model data isn’t in the HOOPS stream format this viewer reads.');
    var lim = Math.min(em.length - 3, 65536);
    for (var i = 0; i < lim; i++) {
      if (em[i] === 0x5a && em[i + 1] === 0x78) {
        var b = em[i + 2];
        if (b === 0x01 || b === 0x5e || b === 0x9c || b === 0xda) {
          return fflate.inflateSync(em.subarray(i + 3));
        }
      }
    }
    throw new Error('This file uses an uncompressed model stream, which this viewer doesn’t read yet.');
  }

  function normPath(cur, name) {
    var base = name.charAt(0) === '/' ? name : (cur === '/' ? '/' + name : cur + '/' + name);
    var out = [];
    var parts = base.toLowerCase().split('/');
    for (var i = 0; i < parts.length; i++) {
      var x = parts[i];
      if (x === '..') { if (out.length) out.pop(); }
      else if (x !== '' && x !== '.') out.push(x);
    }
    return '/' + out.join('/');
  }

  function parse(d) {
    var dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    var N = d.length;
    var latin = new TextDecoder('latin1');
    var segs = new Map();
    var tags = [];
    var warnings = [];
    function seg(path) {
      var s = segs.get(path);
      if (s) return s;
      s = { path: path, name: path.slice(path.lastIndexOf('/') + 1), matrix: null, color: null,
            includes: [], shells: [], opts: '', vis: null, kids: [] };
      segs.set(path, s);
      if (path !== '/') {
        var par = path.slice(0, path.lastIndexOf('/')) || '/';
        seg(par).kids.push(path);
      }
      return s;
    }
    seg('/');
    var stack = ['/'];
    var last = null;
    var p = 0, shellCount = 0, stopInfo = null;
    var u16 = function (q) { return dv.getUint16(q, true); };
    var i32 = function (q) { return dv.getInt32(q, true); };
    try {
      while (p < N) {
        var st = p, c = d[p++], cur = stack[stack.length - 1], L, path, name;
        switch (c) {
          case 0x28: // ( open segment
            L = d[p]; name = latin.decode(d.subarray(p + 1, p + 1 + L)); p += 1 + L;
            path = normPath(cur, name); seg(path); stack.push(path); last = { k: 'seg', path: path }; break;
          case 0x29: // ) close segment
            last = { k: 'seg', path: stack.pop() }; if (!stack.length) stack.push('/'); break;
          case 0x00: case 0x01: case 0x5d: break;
          case 0x5b: p += 4 + i32(p); break; // [ user data
          case 0x55: // U user options
            L = u16(p); var txt = latin.decode(d.subarray(p + 2, p + 2 + L)); p += 2 + L;
            var sg = segs.get(cur); if (!sg.opts) sg.opts = txt; break;
          case 0x16: p += 2 + 2 * u16(p); break; // unicode options
          case 0x7d: p += 46; p += 1 + d[p]; break; // } view
          case 0x68: p += 1; break; // h handedness
          case 0x4a: p += 1 + d[p]; p += 2 + u16(p); break; // J line style
          case 0x48: var hm = u16(p); p += 4 + ((hm & 4) ? 1 : 0); break; // H heuristics
          case 0x56: // V visibility
            if (d[p] & 0x80) { segs.get(cur).vis = [u16(p), i32(p + 2)]; p += 6; }
            else { segs.get(cur).vis = [d[p], d[p + 1]]; p += 2; }
            break;
          case 0x25: // % modelling matrix (flag + 12 floats, row-vector 4x3)
            var m = new Float32Array(12);
            for (var k = 0; k < 12; k++) m[k] = dv.getFloat32(p + 1 + 4 * k, true);
            segs.get(cur).matrix = m; p += 49; break;
          case 0x24: p += 48; break; // $ texture matrix
          case 0x7e: // ~ colour by RGB
            var mask = d[p++]; var sh = 8;
            while ((d[p - 1] & 0x80) && sh < 32) { mask |= d[p++] << sh; sh += 8; }
            if (mask & 1) segs.get(cur).color = [d[p], d[p + 1], d[p + 2]];
            p += 3; break;
          case 0x22: p += 2; p += 1 + d[p]; break; // " named colour
          case 0x3d: case 0x0e: p += 4; break; // line / edge weight
          case 0x07: p += 1 + d[p]; break; // callback
          case 0x3c: case 0x7b: // < include, { style
            p += 1; L = d[p]; name = latin.decode(d.subarray(p + 1, p + 1 + L)); p += 1 + L;
            if (c === 0x3c) segs.get(cur).includes.push(normPath(cur, name));
            break;
          case 0x74: p += 1 + d[p]; p += 1 + d[p]; p += 6; break; // t texture
          case 0x73: // s reopen segment by key
            var rk = i32(p); p += 4; var tg = tags[rk];
            stack.push(tg && tg.path ? tg.path : cur); break;
          case 0x71: tags.push(last); break; // q tag
          case 0x53: { // S shell
            p++; var f = d[p++], sub2 = 0, key = -1;
            if (f & 0x80) { sub2 = u16(p); p += 2; }
            if (!(f & 0x10)) { key = i32(p); p += 4; }
            p++; // lod
            if (sub2 & 2) { last = { k: 'ph', path: cur }; break; } // placeholder; geometry follows later
            if (f & 0x41) { warnings.push('Some surfaces use a compressed encoding this viewer can’t read yet.'); throw 'stop'; }
            var n = i32(p); p += 4;
            var pp = p; p += 12 * n;
            var fsch = d[p], fl = i32(p + 1), fp = p + 5; p += 5 + fl;
            if (f & 0x08) {
              for (;;) {
                var o = d[p++];
                if (o === 0x63) break;
                else if (o === 0x01) { p += 2; p += 4 + i32(p); }
                else if (o === 0x1c) { var kk = d[p]; p += 1 + 4 * kk * n; }
                else { warnings.push('Unknown surface option ' + o.toString(16)); throw 'stop'; }
              }
            }
            var t = key >= 0 ? tags[key] : null;
            var owner = (t && t.k === 'ph') ? t.path : cur;
            segs.get(owner).shells.push({ pp: pp, n: n, fp: fp, fl: fl, strips: (f & 0x04) !== 0 });
            shellCount++;
            break;
          }
          default:
            stopInfo = { op: c, at: st };
            throw 'stop';
        }
      }
    } catch (e) {
      if (e !== 'stop') stopInfo = { op: -1, at: p, err: String(e && e.message || e) };
      else if (!stopInfo) stopInfo = { op: d[p - 1], at: p };
    }
    // Recovery: if the structured read stopped before the end, scan the rest of the stream for surfaces.
    var scanned = 0;
    if (stopInfo && stopInfo.at < N) {
      var rootSeg = null;
      segs.forEach(function (s, k) { if (!rootSeg && /\/3dmodel$/.test(k)) rootSeg = k; });
      scanned = scanShells(d, dv, stopInfo.at, function (sh, key) {
        var t = key >= 0 ? tags[key] : null;
        var owner = (t && t.k === 'ph') ? t.path : (rootSeg || '/');
        segs.get(owner).shells.push(sh);
      });
      shellCount += scanned;
      if (shellCount === 0) {
        throw new Error('No 3D surfaces could be read from this file (stopped at record 0x' + (stopInfo.op >= 0 ? stopInfo.op.toString(16) : '??') +
          ', ' + Math.round(100 * stopInfo.at / N) + '% through' + (stopInfo.err ? ', ' + stopInfo.err : '') + '). Drawings (.edrw) aren’t supported.');
      }
      if (scanned) warnings.push('Part of this file used records this viewer doesn’t know, so some surfaces may be out of place.');
    }
    var root = null;
    segs.forEach(function (s, k) { if (!root && /\/3dmodel$/.test(k)) root = k; });
    var title = '';
    segs.forEach(function (s) { if (!title) { var mm = /refname=([^,]*)/.exec(s.opts); if (mm) title = mm[1]; } });
    return { data: d, dv: dv, segs: segs, root: root || '/', title: title, warnings: warnings, shellCount: shellCount, stopInfo: stopInfo, scanned: scanned };
  }

  // Find uncompressed shell records by their structure. Accepts the eDrawings layout (S 00 flags …) and plain HSF (S flags …).
  function scanShells(d, dv, from, add) {
    var N = d.length, p = from, found = 0;
    function tryAt(q) {
      var f = d[q];
      if (f & 0xC1) return null;                       // not expanded, not compressed
      var hk = (f & 0x10) ? 0 : 4;                     // first-pass shells carry no key
      var key = hk ? dv.getInt32(q + 1, true) : -1, lod = d[q + 1 + hk], n = dv.getInt32(q + 2 + hk, true);
      if (key < -1 || key > 50000000 || lod > 8 || n < 3 || n > 5000000) return null;
      var pp = q + 6 + hk, fq = pp + 12 * n;
      if (fq + 6 > N || d[fq] !== 1) return null;
      var fl = dv.getInt32(fq + 1, true), fp = fq + 5, bits = d[fp];
      if (fl < 2 || fp + fl > N || (bits !== 8 && bits !== 16 && bits !== 32)) return null;
      var first = bits === 8 ? d[fp + 1] : bits === 16 ? dv.getUint16(fp + 1, true) : dv.getInt32(fp + 1, true);
      if (first < 3 || first > 3 * n + 3) return null;
      var e = fp + fl;
      if (f & 0x08) {
        for (var guard = 0; guard < 8; guard++) {
          if (e >= N) return null;
          var o = d[e++];
          if (o === 0x63) break;
          else if (o === 0x01) { e += 2; var L = dv.getInt32(e, true); if (L < 0 || e + 4 + L > N) return null; e += 4 + L; }
          else if (o === 0x1c) { var kk = d[e]; if (kk > 8) return null; e += 1 + 4 * kk * n; }
          else return null;
        }
        if (d[e - 1] !== 0x63) return null;
      }
      for (var i = 0; i < 9; i++) { var v = dv.getFloat32(pp + 4 * i, true); if (!isFinite(v) || Math.abs(v) > 1e6) return null; }
      return { sh: { pp: pp, n: n, fp: fp, fl: fl, strips: (f & 0x04) !== 0 }, key: key, end: e };
    }
    while (p < N - 16) {
      var s = d.indexOf(0x53, p);
      if (s < 0) break;
      var r = (d[s + 1] === 0x00 ? tryAt(s + 2) : null) || tryAt(s + 1);
      if (r) { add(r.sh, r.key); found++; p = r.end; } else p = s + 1;
    }
    return found;
  }

  // Decode one shell into local positions and triangle indices.
  function decodeShell(model, s) {
    var dv = model.dv, d = model.data;
    var pos = new Float32Array(s.n * 3);
    for (var i = 0; i < s.n * 3; i++) pos[i] = dv.getFloat32(s.pp + 4 * i, true);
    var bits = d[s.fp], bytes = bits >> 3, q = s.fp + 1, end = s.fp + s.fl;
    var rd = bytes === 1 ? function (x) { return d[x]; } : bytes === 2 ? function (x) { return dv.getUint16(x, true); } : function (x) { return dv.getInt32(x, true); };
    var tri = [];
    while (q + bytes <= end) {
      var raw = rd(q); q += bytes;
      var cnt = Math.abs(raw);
      if (cnt === 0) continue;
      var v = new Array(cnt);
      for (var j = 0; j < cnt; j++) { v[j] = rd(q); q += bytes; }
      if (s.strips && raw > 0) {
        for (var k = 2; k < cnt; k++) {
          if ((k & 1) === 0) tri.push(v[k - 2], v[k - 1], v[k]);
          else tri.push(v[k - 1], v[k - 2], v[k]);
        }
      } else if (raw > 0 || s.strips) {
        for (var k2 = 2; k2 < cnt; k2++) tri.push(v[0], v[k2 - 1], v[k2]);
      }
    }
    var ok = [];
    for (var t = 0; t + 2 < tri.length; t += 3) {
      var a = tri[t], b = tri[t + 1], c = tri[t + 2];
      if (a < s.n && b < s.n && c < s.n && a !== b && b !== c && a !== c) ok.push(a, b, c);
    }
    return { pos: pos, idx: ok };
  }

  // Boundary edges of a shell (edges used by exactly one triangle) = CAD face outlines.
  function boundaryEdges(idx, n) {
    var m = new Map(), out = [];
    for (var t = 0; t < idx.length; t += 3) {
      for (var e = 0; e < 3; e++) {
        var a = idx[t + e], b = idx[t + (e + 1) % 3];
        var key = a < b ? a * n + b : b * n + a;
        m.set(key, (m.get(key) || 0) + 1);
      }
    }
    m.forEach(function (cnt, key) { if (cnt === 1) out.push(Math.floor(key / n), key % n); });
    return out;
  }

  function nameOf(opts) {
    var mm = /(?:^|,)name=([^,]*)/.exec(opts || '');
    return mm ? mm[1] : null;
  }

  return { scanShells: scanShells, unpack: unpack, inflateModel: inflateModel, parse: parse, decodeShell: decodeShell, boundaryEdges: boundaryEdges, nameOf: nameOf };
})();
if (typeof module !== 'undefined') module.exports = EASM;
