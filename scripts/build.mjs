import { build } from 'esbuild-wasm';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public', { recursive: true });
await build({ entryPoints: ['./src/app.js'], outfile: 'public/app.js', tsconfigRaw: {}, bundle: true, minify: true, sourcemap: false, format: 'esm', target: 'es2022' });
for (const name of ['index.html', 'style.css', 'favicon.svg', 'file-open.js']) await copyFile(`src/${name}`, `public/${name}`);
console.log('3D Model Manager browser assets built.');
