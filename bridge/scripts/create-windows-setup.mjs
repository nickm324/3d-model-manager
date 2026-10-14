import fs from 'node:fs/promises';
import path from 'node:path';
import pkg from '../package.json' with { type: 'json' };

const root = path.resolve(process.argv[2] || 'dist'), source = path.join(root, '3d-model-manager-bridge.exe');
try {
  await fs.access(source);
  const target = path.join(root, `3d-model-manager-bridge-setup-${pkg.version}-windows-x64.exe`);
  await fs.copyFile(source, target);
  console.log(`Created ${path.basename(target)}.`);
} catch (error) {
  if (process.platform === 'win32') throw error;
}
