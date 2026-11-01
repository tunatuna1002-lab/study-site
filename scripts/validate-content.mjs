import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFrontmatter, SECTIONS } from '../src/lib/vault.mjs';
import { safeFile } from '../src/lib/file-safety.mjs';
import { scan } from './study-log.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
for (const section of SECTIONS) {
  const dir = path.join(root, 'vault', section);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir, { recursive: true })) {
    if (!name.endsWith('.md')) continue;
    const relative = `vault/${section}/${name.split(path.sep).join('/')}`;
    const file = safeFile(root, relative);
    if (readFrontmatter(fs.readFileSync(file, 'utf8')).publish !== true) continue;
    for (const error of scan(relative).errors) {
      console.error(`${relative}: ${error}`);
      failed = true;
    }
  }
}
if (failed) process.exitCode = 1;
