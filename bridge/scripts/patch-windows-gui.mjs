import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'dist');
async function executables(folder) {
  const result = [];
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) result.push(...await executables(file));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) result.push(file);
  }
  return result;
}
for (const file of await executables(root)) {
  const data = await fs.readFile(file), pe = data.readUInt32LE(0x3c);
  if (data.toString('ascii', pe, pe + 4) !== 'PE\0\0') throw new Error(`${file} is not a Windows PE executable.`);
  const subsystem = pe + 4 + 20 + 68;
  data.writeUInt16LE(2, subsystem); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  await fs.writeFile(file, data);
  console.log(`Configured ${path.basename(file)} to run without a console window.`);
}
