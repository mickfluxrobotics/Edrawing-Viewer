// Converts DWG to DXF with dwgdxf (acadrust compiled to WebAssembly, MIT).
import init, { convertDwgToDxf } from './dwgdxf.js';
let ready = null;
self.onmessage = async (ev) => {
  try {
    if (!ready) ready = init({ module_or_path: new URL('dwgdxf_bg.wasm', import.meta.url) });
    await ready;
    const out = convertDwgToDxf(new Uint8Array(ev.data.buffer));
    self.postMessage({ dxf: out }, [out.buffer]);
  } catch (e) {
    self.postMessage({ error: String((e && e.message) || e) });
  }
};
