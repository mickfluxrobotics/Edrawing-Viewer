// Converts STEP files to triangle meshes with OpenCascade (occt-import-js, LGPL-2.1).
importScripts('occt-import-js.js');
var occtReady = null;
onmessage = async function (ev) {
  try {
    if (!occtReady) occtReady = occtimportjs({ locateFile: function (p) { return p; } });
    var occt = await occtReady;
    var r = occt.ReadStepFile(new Uint8Array(ev.data.buffer), ev.data.params || null);
    if (!r || !r.success) { postMessage({ error: 'the file couldn’t be read as STEP' }); return; }
    var transfer = [];
    r.meshes.forEach(function (m) {
      m.attributes.position.array = new Float32Array(m.attributes.position.array); transfer.push(m.attributes.position.array.buffer);
      if (m.attributes.normal) { m.attributes.normal.array = new Float32Array(m.attributes.normal.array); transfer.push(m.attributes.normal.array.buffer); }
      m.index.array = new Uint32Array(m.index.array); transfer.push(m.index.array.buffer);
    });
    postMessage({ result: r }, transfer);
  } catch (e) {
    postMessage({ error: String((e && e.message) || e) });
  }
};
