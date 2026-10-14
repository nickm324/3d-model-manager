importScripts('/occt-import-js.js');

let runtime;
const occt = () => runtime ||= self.occtimportjs({ locateFile: name => name.endsWith('.wasm') ? '/occt-import-js.wasm' : name });

self.onmessage = async ({ data }) => {
  try {
    const result = (await occt()).ReadStepFile(new Uint8Array(data.buffer), {
      linearUnit: 'millimeter',
      linearDeflectionType: 'bounding_box_ratio',
      linearDeflection: 0.001,
      angularDeflection: 0.5
    });
    self.postMessage({ id: data.id, result });
  } catch (error) {
    self.postMessage({ id: data.id, error: error?.message || String(error) });
  }
};
