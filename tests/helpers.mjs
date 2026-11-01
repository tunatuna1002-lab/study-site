import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: os.platform() === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0' };
export function command(cwd, args, ok = true) {
  const result = spawnSync(args[0], args.slice(1), { cwd, env, encoding: 'utf8', timeout: 30000 });
  if (ok) assert.equal(result.status, 0, result.stdout + result.stderr);
  return result;
}
export const git = (root, ...args) => command(root, ['git', ...args]);
export const helper = (root, args, ok = true) => command(root, [process.execPath, 'scripts/study-log.mjs', ...args], ok);
export function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'study-log-test-'));
  const root = path.join(base, 'repo');
  const remote = path.join(base, 'remote.git');
  fs.mkdirSync(root);
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  for (const dir of ['scripts', 'src/lib', 'skills/study-log']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
    for (const name of fs.readdirSync(path.join(source, dir))) {
      if (name.endsWith('.mjs')) fs.copyFileSync(path.join(source, dir, name), path.join(root, dir, name));
    }
  }
  for (const dir of ['vault/sessions', 'vault/concepts', 'public/widgets']) fs.mkdirSync(path.join(root, dir), { recursive: true });
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(root, 'node_modules'), 'junction');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { build: 'node -e "process.exit(0)"' } }));
  fs.writeFileSync(path.join(root, 'astro.config.mjs'), "export default { site: 'https://example.invalid' };\n");
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\nvault/drafts/\n');
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.name', 'Study Test');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'commit.gpgsign', 'false');
  note(root, 'existing', 'Original body');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'baseline');
  git(root, 'init', '--bare', '-q', remote);
  git(root, 'remote', 'add', 'origin', remote);
  git(root, 'push', '-qu', 'origin', 'main');
  return { root, remote, base };
}
export function note(root, name, body = 'Study content', extra = '') {
  const relative = `vault/sessions/${name}.md`;
  fs.writeFileSync(path.join(root, relative), `---\ntitle: "Same title"\ntype: session\ndate: 2026-11-01\npublish: true\n${extra}---\n${body}\n`);
  return relative;
}
