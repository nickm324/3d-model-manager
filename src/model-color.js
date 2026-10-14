export const DEFAULT_MODEL_COLOR = [0xee / 255, 0xb3 / 255, 0x6e / 255];

export function stepModelColor(value) {
  if (!Array.isArray(value) || value.length < 3) return DEFAULT_MODEL_COLOR;
  const components = value.slice(0, 3).map(Number);
  if (!components.every(Number.isFinite)) return DEFAULT_MODEL_COLOR;

  // occt-import-js returns STEP colors as normalized 0..1 components. Keep
  // compatibility with any older 0..255 result while avoiding double scaling.
  const scale = Math.max(...components) > 1 ? 255 : 1;
  const color = components.map(component => Math.min(1, Math.max(0, component / scale)));
  const luminance = (0.2126 * color[0]) + (0.7152 * color[1]) + (0.0722 * color[2]);
  return luminance < 0.08 ? DEFAULT_MODEL_COLOR : color;
}
