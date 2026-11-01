import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileHash } from '../src/lib/file-safety.mjs';
import { fixture, note, command, git, helper } from './helpers.mjs';

test('an unrelated local commit prevents publication and remains local', (t) => {
  const { root, remote } = fixture(t);
  fs.writeFileSync(path.join(root, 'unapproved.txt'), 'Synthetic marker');
  git(root, 'add', 'unapproved.txt');
  git(root, 'commit', '-qm', 'unapproved');
  const p = note(root, 'approved');
  helper(root, ['draft', p]);
  const result = helper(root, ['publish', p], false);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /미전송 커밋/);
  assert.notEqual(command(remote, ['git', 'cat-file', '-e', 'main:unapproved.txt'], false).status, 0);
  assert.notEqual(command(remote, ['git', 'cat-file', '-e', `main:${p}`], false).status, 0);
});

test('failed push returns to draft; discard prevents later accidental publication', (t) => {
  const { root, remote } = fixture(t);
  const head = git(root, 'rev-parse', 'HEAD').stdout;
  const hook = path.join(remote, 'hooks/pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const p = note(root, 'cancel-me');
  helper(root, ['draft', p]);
  const result = helper(root, ['publish', p], false);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /초안 상태로 되돌렸습니다/);
  assert.equal(git(root, 'rev-parse', 'HEAD').stdout, head);
  assert.equal(command(root, ['git', 'check-ignore', p], false).status, 0);
  helper(root, ['discard', p]);
  assert.equal(fs.existsSync(path.join(root, p)), false);
  fs.unlinkSync(hook);
  const next = note(root, 'next-approved');
  helper(root, ['draft', next]);
  helper(root, ['publish', next]);
  assert.notEqual(command(remote, ['git', 'cat-file', '-e', `main:${p}`], false).status, 0);
  assert.equal(command(remote, ['git', 'cat-file', '-e', `main:${next}`]).status, 0);
});

test('publication keeps unrelated dirty files private and publishes only selected paths', (t) => {
  const { root, remote } = fixture(t);
  const other = note(root, 'existing', 'UNAPPROVED EDIT');
  const p = note(root, 'approved');
  helper(root, ['draft', p]);
  helper(root, ['publish', p]);
  assert.match(fs.readFileSync(path.join(root, other), 'utf8'), /UNAPPROVED EDIT/);
  assert.doesNotMatch(git(remote, 'show', `main:${other}`).stdout, /UNAPPROVED EDIT/);
  assert.match(git(remote, 'show', `main:${p}`).stdout, /Study content/);
});

test('discard and check reject symlink parents before touching outside files', (t) => {
  const { root, base } = fixture(t);
  const outside = path.join(base, 'outside');
  fs.mkdirSync(outside);
  const target = path.join(outside, 'note.md');
  fs.writeFileSync(target, 'DO NOT DELETE');
  fs.symlinkSync(outside, path.join(root, 'vault/sessions/link'), 'junction');
  for (const operation of ['check', 'draft', 'discard', 'publish']) {
    assert.notEqual(helper(root, [operation, 'vault/sessions/link/note.md'], false).status, 0);
    assert.equal(fs.readFileSync(target, 'utf8'), 'DO NOT DELETE');
  }
});

test('Markdown executable HTML is rejected while code examples and local widgets work', (t) => {
  const { root } = fixture(t);
  const badBodies = [
    '<script src="https://example.invalid/script.js"></script>',
    '<img src="/attachments/local.png" onerror="alert(1)">',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<a href="jav&#x61;script:alert(1)">bad</a>',
    '<iframe src="https://example.invalid/"></iframe>',
  ];
  for (const [i, body] of badBodies.entries()) assert.notEqual(helper(root, ['check', note(root, `bad-${i}`, body)], false).status, 0, body);
  helper(root, ['check', note(root, 'example', '```html\n<script>alert(1)</script>\n```\n\n`<script>example</script>`')]);
  helper(root, ['check', note(root, 'widget', '<iframe src="/widgets/example.html" width="100%" height="520" style="border:0" title="Example"></iframe>')]);
});

test('deployment verification rejects old content and accepts the exact hash', (t) => {
  const { root, base } = fixture(t);
  const p = note(root, 'existing', 'New body, same title');
  const preload = path.join(base, 'fetch.mjs');
  fs.writeFileSync(preload, "globalThis.fetch=async()=>new Response('<h1>Same title</h1><p>Old body</p>'); globalThis.setTimeout=(fn)=>{fn();return 0};\n");
  const stale = command(root, [process.execPath, '--import', preload, 'scripts/study-log.mjs', 'wait', p], false);
  assert.notEqual(stale.status, 0);
  const files = { [p]: fileHash(p, fs.readFileSync(path.join(root, p))) };
  fs.writeFileSync(preload, `globalThis.fetch=async()=>new Response(${JSON.stringify(JSON.stringify({ files }))});\n`);
  const fresh = command(root, [process.execPath, '--import', preload, 'scripts/study-log.mjs', 'wait', p]);
  assert.match(fresh.stdout, /배포 확인/);
});

test('CRLF and LF notes have the same deployment identity', () => {
  assert.equal(fileHash('note.md', Buffer.from('one\r\ntwo\r\n')), fileHash('note.md', Buffer.from('one\ntwo\n')));
});

test('the existing Claude skill launcher still works through a symlink', (t) => {
  const { root, base } = fixture(t);
  const link = path.join(base, 'skill-link');
  fs.symlinkSync(path.join(root, 'skills/study-log'), link, 'junction');
  const result = command(root, [process.execPath, path.join(link, 'run.mjs'), 'root']);
  assert.equal(fs.realpathSync(result.stdout.trim()), fs.realpathSync(root));
  const p = note(root, 'skill-entry');
  command(root, [process.execPath, path.join(link, 'run.mjs'), 'draft', p]);
  assert.equal(command(root, ['git', 'check-ignore', p]).status, 0);
});
