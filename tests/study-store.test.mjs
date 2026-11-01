import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createStudyStore } from '../scripts/study-store.mjs';
import { fixture, git, command } from './helpers.mjs';

const sample = { title: '논문 공부 시험', slug: 'paper-reading', date: '2026-11-01', minutes: 30, body: '## 이해한 점\n모델의 핵심 가정을 공부했습니다.\n\n## 남은 질문\n다음에 실험 조건을 확인합니다.' };

test('saving persists private Obsidian notes without a commit or public target', async (t) => {
  const { root, remote } = fixture(t);
  const store = createStudyStore(root);
  const before = git(root, 'rev-parse', 'HEAD').stdout;
  const saved = await store.save(sample);
  assert.equal(saved.status, 'draft');
  assert.equal(saved.errors.length, 0);
  assert.match(fs.readFileSync(path.join(root, saved.obsidian_path), 'utf8'), /publish: false/);
  assert.equal(git(root, 'rev-parse', 'HEAD').stdout, before);
  assert.equal(git(root, 'status', '--porcelain').stdout, '');
  for (const p of saved.target_paths) {
    assert.equal(fs.existsSync(path.join(root, p)), false);
    assert.notEqual(command(remote, ['git', 'cat-file', '-e', `main:${p}`], false).status, 0);
  }
  assert.equal(store.get(saved.draft_id).revision, saved.revision);
});

test('edited drafts require the new revision and publish only that version', async (t) => {
  const { root, remote } = fixture(t);
  const store = createStudyStore(root);
  const saved = await store.save(sample);
  const changed = await store.save({ ...sample, body: 'Revised explanation', draft_id: saved.draft_id, expected_revision: saved.revision });
  assert.notEqual(changed.revision, saved.revision);
  await assert.rejects(store.publish(saved.draft_id, saved.revision), /버전이 바뀌었습니다/);
  const published = await store.publish(changed.draft_id, changed.revision);
  assert.equal(published.status, 'published');
  const remoteText = git(remote, 'show', `main:${published.target_paths[0]}`).stdout;
  assert.match(remoteText, /Revised explanation/);
  assert.match(remoteText, /source: chatgpt/);
  const firstCommit = published.publication.commit;
  assert.equal((await store.publish(changed.draft_id, changed.revision)).publication.commit, firstCommit);
});

test('cancelled private draft cannot be published and unrelated drafts stay private', async (t) => {
  const { root, remote } = fixture(t);
  const store = createStudyStore(root);
  const cancelled = await store.save(sample);
  await store.discard(cancelled.draft_id, cancelled.revision);
  await assert.rejects(store.publish(cancelled.draft_id, cancelled.revision), /취소된/);
  const other = await store.save({ ...sample, slug: 'another' });
  await store.publish(other.draft_id, other.revision);
  assert.notEqual(command(remote, ['git', 'cat-file', '-e', `main:${cancelled.target_paths[0]}`], false).status, 0);
  assert.equal(fs.existsSync(path.join(root, cancelled.obsidian_path)), true);
});

test('Obsidian edits and unsafe HTML block publication without losing the draft', async (t) => {
  const { root } = fixture(t);
  const store = createStudyStore(root);
  const saved = await store.save(sample);
  fs.appendFileSync(path.join(root, saved.obsidian_path), '\nLocal edit\n');
  assert.equal(store.get(saved.draft_id).obsidian_changed, true);
  await assert.rejects(store.publish(saved.draft_id, saved.revision), /Obsidian/);
  const unsafe = await store.save({ ...sample, body: '<script src="https://example.invalid/x.js"></script>' });
  assert.ok(unsafe.errors.length);
  await assert.rejects(store.publish(unsafe.draft_id, unsafe.revision), /검사 실패/);
  assert.equal(fs.existsSync(path.join(root, unsafe.target_paths[0])), false);
});

test('a rejected ChatGPT publication can be revised and then cancelled safely', async (t) => {
  const { root, remote } = fixture(t);
  const store = createStudyStore(root);
  const saved = await store.save(sample);
  const hook = path.join(remote, 'hooks/pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await assert.rejects(store.publish(saved.draft_id, saved.revision), /초안 상태로 되돌렸습니다/);
  const changed = await store.save({ ...sample, body: 'Revised after failure', draft_id: saved.draft_id, expected_revision: saved.revision });
  assert.equal(changed.status, 'draft');
  assert.equal(fs.existsSync(path.join(root, saved.target_paths[0])), false);
  await store.discard(changed.draft_id, changed.revision);
  assert.notEqual(command(remote, ['git', 'cat-file', '-e', `main:${saved.target_paths[0]}`], false).status, 0);
});

test('MCP transport exposes separate save/publication tools and creates a private draft', async (t) => {
  const { root } = fixture(t);
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'scripts/study-mcp.mjs')], stderr: 'pipe' });
  const client = new Client({ name: 'study-test', version: '1.0.0' });
  t.after(async () => { await client.close(); });
  await client.connect(transport);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 6);
  assert.equal(tools.find((tool) => tool.name === 'publish_study_draft').annotations.destructiveHint, true);
  assert.equal(tools.find((tool) => tool.name === 'read_study_draft').annotations.readOnlyHint, true);
  const response = await client.callTool({ name: 'save_study_draft', arguments: sample });
  assert.notEqual(response.isError, true, JSON.stringify(response));
  const result = response.structuredContent;
  assert.equal(result.status, 'draft');
  assert.equal(fs.existsSync(path.join(root, result.obsidian_path)), true);
  assert.equal(fs.existsSync(path.join(root, result.target_paths[0])), false);
  const listed = await client.callTool({ name: 'list_study_drafts', arguments: {} });
  assert.equal(listed.structuredContent.drafts[0].draft_id, result.draft_id);
});
