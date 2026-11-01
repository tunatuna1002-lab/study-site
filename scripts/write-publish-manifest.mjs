import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS, readFrontmatter } from '../src/lib/vault.mjs';
import { fileHash, safeFile } from '../src/lib/file-safety.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {};
for (const folder of [...SECTIONS.map((s) => `vault/${s}`), 'public/widgets', 'vault/attachments']) {
  const dir = path.join(root, folder);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir, { recursive: true })) {
    const relative = `${folder}/${name.split(path.sep).join('/')}`;
    if (!/\.(md|html|png|jpe?g|gif|webp|svg)$/i.test(name)) continue;
    const file = safeFile(root, relative);
    const data = fs.readFileSync(file);
    if (name.endsWith('.md') && readFrontmatter(data.toString('utf8')).publish !== true) continue;
    files[relative.normalize('NFC')] = fileHash(relative, data);
  }
}
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/study-log-manifest.json'), JSON.stringify({ version: 1, files }) + '\n');
