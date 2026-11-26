// eDrawings .easm reader: ZIP container -> HOOPS Stream (HSF) eModel -> segment tree + shells.
// Reverse-engineered from SolidWorks eDrawings files (HSF V20.x). No geometry leaves the browser.
var EASM = (function () {
  'use strict';

  function unpack(bytes) {
    var files;
    try { files = fflate.unzipSync(bytes); }
    catch (e) {
      // Older eDrawings files ("2008+ archive") put a short header before the ZIP data.
      // Find the first local-file signature (PK\x03\x04) and unzip from there.
      var start = -1, lim = Math.min(bytes.length - 4, 4096);
      for (var k = 1; k <= lim; k++) {
        if (bytes[k] === 0x50 && bytes[k + 1] === 0x4b && bytes[k + 2] === 0x03 && bytes[k + 3] === 0x04) { start = k; break; }
      }
      try { if (start < 0) throw e; files = fflate.unzipSync(bytes.subarray(start)); }
      catch (e2) { throw new Error('This file isn’t a ZIP-based eDrawings file (.easm or .eprt).'); }
    }
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
          var out = fflate.inflateSync(em.subarray(i + 3));
          var vm = /HSF V(\d+)\.(\d+)/.exec(head);
          out.hsfVersion = vm ? parseInt(vm[1], 10) * 100 + parseInt(vm[2], 10) : 0;
          return out;
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

  // HSF 20 and later write one extra byte in several records (views, matrices, includes, shells).
  // Older files (HSF 19, saved by earlier SolidWorks releases) don't. Try the layout the version
  // suggests, and fall back to the other one if that read isn't clean.
  function parse(d) {
    var guess = (d.hsfVersion && d.hsfVersion < 2000) ? 0 : 1, first = null, firstErr = null;
    try { first = parseWith(d, guess); } catch (e) { firstErr = e; }
    if (first && !first.scanned) return first;
    var second = null;
    try { second = parseWith(d, guess ? 0 : 1); } catch (e2) { if (!first) throw firstErr; }
    if (!first) return second;
    if (!second) return first;
    return (second.shellCount - second.scanned) > (first.shellCount - first.scanned) ? second : first;
  }
  // Record opcodes parseWith understands (used to resync after variable-length records).
  var KNOWN = (function () { var k = {}; [0x28,0x29,0x5b,0x55,0x16,0x7d,0x68,0x4a,0x48,0x56,0x25,0x24,0x46,0x2a,0x26,0x2d,0x0d,0x40,0x2b,0x52,0x7e,0x22,0x3d,0x0e,0x07,0x3c,0x7b,0x74,0x73,0x71,0x53,0x30].forEach(function (c) { k[c] = 1; }); return k; })();
  function parseWith(d, X) {
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
    var p = 0, shellCount = 0, stopInfo = null, repeats = [], shellByKey = new Map();
    var u16 = function (q) { return dv.getUint16(q, true); };
    function printable(a, b) { for (var i = a; i < b; i++) { var ch = d[i]; if (ch < 0x20 || (ch > 0x7e && ch < 0xa0)) return false; } return true; }
    // Does a run of ordinary records start at q? Used to find the end of variable-length records.
    function plausible(q) {
      for (var n = 0; n < 4; n++) {
        if (q >= N) return false;
        var c = d[q];
        if (c === 0x29 || c === 0x71) { q += 1; continue; }
        if (c === 0x28) { var L = d[q + 1]; if (!printable(q + 2, q + 2 + L)) return false; q += 2 + L; continue; }
        if (c === 0x55) { var L2 = u16(q + 1); if (L2 > 60000 || !printable(q + 3, q + 3 + L2)) return false; q += 3 + L2; continue; }
        if (c === 0x3c) { if (X && d[q + 1] !== 0) return false; var L3 = d[q + 1 + X]; if (!printable(q + 2 + X, q + 2 + X + L3)) return false; q += 2 + X + L3; continue; }
        if (c === 0x25) { q += 48 + X; continue; }
        if (c === 0x16) { var L4 = u16(q + 1); if (L4 > 30000) return false; q += 3 + 2 * L4; continue; }
        if (c === 0x53 || c === 0x52 || c === 0x56 || c === 0x7e || c === 0x48) return n > 0;
        return false;
      }
      return true;
    }
    // R: three mask/value pairs, then option data whose length depends on the masks.
    function skipRendering(q) {
      var start = q + 24;
      for (var k = 0; k <= 4096 && start + k < N; k++) if (plausible(start + k)) return start + k;
      throw 'stop';
    }
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
          case 0x7d: p += 45 + X; p += 1 + d[p]; break; // } view
          case 0x68: p += 1; break; // h handedness
          case 0x4a: p += 1 + d[p]; p += 2 + u16(p); break; // J line style
          case 0x48: var hm = u16(p); p += 4 + ((hm & 4) ? 1 : 0) + ((hm & 0x8000) ? 4 : 0); break; // H heuristics (+ extended mask/value when bit 15 is set)
          case 0x56: // V visibility
            // mask then value, each: low byte, +2 bytes if bit 7 is set, +1 more if the top bit of those is set
            var vm0 = d[p], vext = (vm0 & 0x80) ? 2 : 0, vext2 = (vext && (d[p + 2] & 0x80)) ? 1 : 0, vlen = 1 + vext + vext2;
            segs.get(cur).vis = [vm0, d[p + vlen]];
            p += 2 * vlen;
            // Some older files add a short sub-option block (e.g. 04 04) after the value; skip up to 4 bytes to the next record.
            if (!KNOWN[d[p]]) { for (var vx = 1; vx <= 4; vx++) if (KNOWN[d[p + vx]]) { p += vx; break; } }
            break;
          case 0x25: // % modelling matrix (12 floats, row-vector 4x3; HSF 20+ puts a flag byte first)
            var m = new Float32Array(12);
            for (var k = 0; k < 12; k++) m[k] = dv.getFloat32(p + X + 4 * k, true);
            segs.get(cur).matrix = m; p += 48 + X; break;
          case 0x24: p += 48; break; // $ texture matrix
          case 0x46: { // F text font: mask, value, then name / size / tolerance / transforms / rotation / slant / width scale
            var fm = d[p]; p += 2;
            if (fm & 0x80) throw 'stop'; // extended font options not handled
            if (fm & 0x01) p += 1 + d[p];
            if (fm & 0x02) p += 5;
            if (fm & 0x04) p += 5;
            if (fm & 0x08) p += 1;
            if (fm & 0x10) p += 4;
            if (fm & 0x20) p += 4;
            if (fm & 0x40) p += 4;
            break;
          }
          case 0x2a: p += 1; break; // * text alignment
          case 0x30: p += 4; break; // 0 (4-byte value seen before the 3D model segment in older files)
          case 0x26: { // & repeat an earlier surface with a transform
            var rm = new Float32Array(12);
            for (var rk2 = 0; rk2 < 12; rk2++) rm[rk2] = dv.getFloat32(p + 17 + 4 * rk2, true);
            repeats.push({ src: i32(p), key: i32(p + 8), m: rm, path: cur }); // copy surface src into placeholder key
            p += 65; break;
          }
          case 0x2d: case 0x0d: // - line pattern, \r edge pattern (same layout as the marker symbol)
          case 0x40: if (d[p] === 0xff) { p += 1; p += 1 + d[p]; } else p += 1; break; // @ marker symbol
          case 0x2b: p += 4; break; // + marker size
          case 0x52: p = skipRendering(p); break; // R rendering options
          case 0x7e: // ~ colour by RGB
            var mask = d[p++]; var sh = 8;
            while ((d[p - 1] & 0x80) && sh < 32) { mask |= d[p++] << sh; sh += 8; }
            if (mask & 1) segs.get(cur).color = [d[p], d[p + 1], d[p + 2]];
            p += 3; break;
          case 0x22: p += 2; p += 1 + d[p]; break; // " named colour
          case 0x3d: case 0x0e: p += 4; break; // line / edge weight
          case 0x07: p += 1 + d[p]; break; // callback
          case 0x3c: case 0x7b: // < include, { style
            // Older files with conditional styles also start with a 0 byte and add a condition name after the path.
            var cond = !X && d[p] === 0 && d[p + 1] > 0 && printable(p + 2, p + 2 + d[p + 1]);
            p += X || (cond ? 1 : 0); L = d[p]; name = latin.decode(d.subarray(p + 1, p + 1 + L)); p += 1 + L;
            if (cond && d[p] > 0 && d[p] < 0x80 && printable(p + 1, p + 1 + d[p]) && KNOWN[d[p + 1 + d[p]]]) p += 1 + d[p];
            if (c === 0x3c) segs.get(cur).includes.push(normPath(cur, name));
            break;
          case 0x74: p += 1 + d[p]; p += 1 + d[p]; p += 6; break; // t texture
          case 0x73: // s reopen segment by key
            var rk = i32(p); p += 4; var tg = tags[rk];
            stack.push(tg && tg.path ? tg.path : cur); break;
          case 0x71: tags.push(last); break; // q tag
          case 0x53: { // S shell
            p += X; var f = d[p++], sub2 = 0, key = -1;
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
                else if (o === 0x03) { var pk = d[p + 1]; p += 3 + 8 * pk; p += 4 + i32(p); } // quantised texture coordinates
                else { p--; break; } // no terminator: the next record starts here
              }
            }
            var t = key >= 0 ? tags[key] : null;
            var owner = (t && t.k === 'ph') ? t.path : cur;
            var shObj = { pp: pp, n: n, fp: fp, fl: fl, strips: (f & 0x04) !== 0 };
            segs.get(owner).shells.push(shObj);
            if (key >= 0) shellByKey.set(key, shObj);
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
    repeats.forEach(function (r) {
      var src = shellByKey.get(r.src); if (!src) return;
      var t2 = tags[r.key], owner2 = (t2 && t2.k === 'ph') ? t2.path : r.path;
      segs.get(owner2).shells.push({ pp: src.pp, n: src.n, fp: src.fp, fl: src.fl, strips: src.strips, xf: r.m });
      shellCount++;
    });
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
    if (!title) segs.forEach(function (s) {
      if (title) return;
      var mb = /mbd_comp_name=`([^`/]*)`/.exec(s.opts);   // a top-level component: `Name-1@Assembly`
      if (mb && mb[1].lastIndexOf('@') > 0) title = mb[1].slice(mb[1].lastIndexOf('@') + 1);
    });
    // Mass properties SolidWorks saved for the top-level model (SI units), if any.
    var mass = null;
    segs.forEach(function (s, k) {
      if (mass || !/\/massprops$/.test(k) || !/(^|,)mass=/.test(s.opts)) return;
      mass = {};
      s.opts.split(',').forEach(function (kv) {
        var i = kv.indexOf('='); if (i < 1) return;
        var v = parseFloat(kv.slice(i + 1)); if (isFinite(v)) mass[kv.slice(0, i)] = v;
      });
      if (!(mass.mass > 0)) mass = null;
    });
    return { data: d, dv: dv, segs: segs, root: root || '/', title: title, warnings: warnings, shellCount: shellCount, stopInfo: stopInfo, scanned: scanned, massProps: mass };
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
          else if (o === 0x03) { var pk = d[e + 1]; if (pk > 8) return null; e += 3 + 8 * pk; var L3 = dv.getInt32(e, true); if (L3 < 0 || e + 4 + L3 > N) return null; e += 4 + L3; }
          else { e--; break; }
        }
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
    if (s.xf) {
      var m = s.xf;
      for (var v0 = 0; v0 < s.n * 3; v0 += 3) {
        var x = pos[v0], y = pos[v0 + 1], z = pos[v0 + 2];
        pos[v0] = x * m[0] + y * m[3] + z * m[6] + m[9];
        pos[v0 + 1] = x * m[1] + y * m[4] + z * m[7] + m[10];
        pos[v0 + 2] = x * m[2] + y * m[5] + z * m[8] + m[11];
      }
    }
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
    if (mm) return mm[1];
    // Older files only carry the component path, e.g. `Sub-1@Top/Part-2@Sub`: use the last component.
    var mb = /mbd_comp_name=`([^`]*)`/.exec(opts || '');
    if (!mb) return null;
    var last = mb[1].slice(mb[1].lastIndexOf('/') + 1), at = last.lastIndexOf('@');
    return (at > 0 ? last.slice(0, at) : last) || null;
  }

  return { scanShells: scanShells, unpack: unpack, inflateModel: inflateModel, parse: parse, decodeShell: decodeShell, boundaryEdges: boundaryEdges, nameOf: nameOf };
})();
if (typeof module !== 'undefined') module.exports = EASM;
