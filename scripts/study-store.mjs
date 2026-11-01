import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { dump } from 'js-yaml';
import { z } from 'zod';
import { scanText } from './study-log.mjs';
import { fileHash, safeFile } from '../src/lib/file-safety.mjs';
import { noteId, noteUrl } from '../src/lib/vault.mjs';

export const draftShape = {
  draft_id: z.string().uuid().optional().describe('수정할 기존 초안 ID. 새 기록이면 생략.'),
  expected_revision: z.string().regex(/^[a-f0-9]{64}$/).optional().describe('기존 초안을 수정할 때 마지막으로 읽은 revision.'),
  title: z.string().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, '실제 날짜가 필요합니다.').optional().describe('KST 학습 날짜. 생략하면 오늘.'),
  minutes: z.number().int().min(0).max(1440).optional().describe('실제 공부 시간. 알 수 없으면 생략하고 추정하지 않음.'),
  topics: z.array(z.string().max(150)).max(30).default([]),
  stage: z.array(z.number().int().min(0).max(8)).max(9).default([]),
  original: z.string().url().refine((value) => /^https?:\/\//.test(value), 'HTTP(S) 논문 주소만 허용').optional(),
  body: z.string().min(1).max(180000).describe('한국어 학습 노트 본문. 원문 대화 대신 이해·정정·남은 질문을 정리. 위젯 자리는 {{widget:이름}}.'),
  widgets: z.array(z.object({ name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60), html: z.string().min(1).max(200000) })).max(8).default([]),
};
export const draftSchema = z.object(draftShape).strict();
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const revisionOf = (files) => createHash('sha256').update(JSON.stringify(files)).digest('hex');

export function createStudyStore(root) {
  root = fs.realpathSync(root);
  const git = (...args) => execFileSync('git', ['--literal-pathspecs', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const state = path.resolve(root, git('rev-parse', '--git-path', 'study-log/chat-drafts'));
  fs.mkdirSync(state, { recursive: true, mode: 0o700 });
  const site = (fs.readFileSync(path.join(root, 'astro.config.mjs'), 'utf8').match(/site:\s*'([^']+)'/) ?? [])[1];
  const recordPath = (id) => {
    z.string().uuid().parse(id);
    return path.join(state, `${id}.json`);
  };
  const read = (id) => JSON.parse(fs.readFileSync(recordPath(id), 'utf8'));
  function write(record) {
    const temporary = `${recordPath(record.id)}.${randomUUID()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
    fs.renameSync(temporary, recordPath(record.id));
  }
  function inspect(record) {
    const checks = record.files.map(({ path: relative, content }) => ({ path: relative, ...scanText(relative, content) }));
    const previewFile = safeFile(root, record.previewPath, { missing: true });
    const preview = fs.existsSync(previewFile) ? fs.readFileSync(previewFile, 'utf8') : null;
    const obsidianChanged = preview === null || fileHash(record.previewPath, Buffer.from(preview)) !== record.previewHash;
    return {
      draft_id: record.id, revision: record.revision, status: record.status,
      title: record.title, date: record.date, minutes: record.minutes ?? null,
      obsidian_path: record.previewPath, target_paths: record.files.map((f) => f.path),
      preview_markdown: record.files[0].content,
      obsidian_changed: obsidianChanged,
      ...(obsidianChanged ? { obsidian_markdown: preview } : {}),
      errors: checks.flatMap((c) => c.errors.map((message) => ({ path: c.path, message }))),
      warnings: checks.flatMap((c) => c.warnings.map((message) => ({ path: c.path, message }))),
      ...(record.publication ? { publication: record.publication } : {}),
    };
  }
  // A single server process serializes writes. The on-disk lock covers multiple clients/processes.
  async function locked(action) {
    const lock = path.join(state, 'operation.lock');
    try { fs.mkdirSync(lock); } catch { throw new Error('다른 ChatGPT 기록 작업이 진행 중입니다. 잠시 후 다시 시도하세요.'); }
    try { return await action(); } finally { fs.rmSync(lock, { recursive: true, force: true }); }
  }
  function helper(...args) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(root, 'scripts/study-log.mjs'), ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      const capture = (data) => { output = (output + data.toString()).slice(-16000); };
      child.stdout.on('data', capture);
      child.stderr.on('data', capture);
      child.on('error', reject);
      child.on('close', (code) => code === 0 ? resolve(output) : reject(new Error(output || `기록 도구 종료 코드: ${code}`)));
    });
  }
  function checkRevision(record, expected) {
    if (record.revision !== expected) throw new Error('초안 버전이 바뀌었습니다. read_study_draft로 다시 보여 준 뒤 새 버전의 공개 승인을 받으세요.');
    if (record.status === 'discarded') throw new Error('취소된 초안입니다. 새 기록을 만드세요.');
  }
  return {
    get: (id) => inspect(read(id)),
    list: () => fs.readdirSync(state).filter((f) => f.endsWith('.json')).map((f) => read(f.slice(0, -5))).map((r) => ({ draft_id: r.id, revision: r.revision, title: r.title, date: r.date, status: r.status })),
    save: (raw) => locked(async () => {
      const input = draftSchema.parse(raw);
      const old = input.draft_id ? read(input.draft_id) : null;
      if (old) {
        checkRevision(old, input.expected_revision);
        if (old.status === 'materialized') {
          for (const file of old.files) {
            const target = safeFile(root, file.path, { missing: true });
            if (fs.existsSync(target) && fileHash(file.path, fs.readFileSync(target)) !== fileHash(file.path, Buffer.from(file.content))) throw new Error('공개 대기 파일에 별도 수정이 있습니다. 덮어쓰지 않습니다.');
          }
          await helper('discard', ...old.files.map((file) => file.path));
          old.status = 'draft';
        }
        if (old.status !== 'draft') throw new Error('공개 준비 중이거나 공개된 초안은 수정할 수 없습니다. 새 기록을 만드세요.');
      }
      const id = old?.id ?? randomUUID();
      const date = input.date ?? old?.date ?? today();
      const shortId = id.slice(0, 8);
      const target = old?.files[0].path ?? `vault/sessions/${date}-${input.slug}-${shortId}.md`;
      let body = input.body;
      const widgets = [];
      const names = new Set();
      for (const widget of input.widgets) {
        if (names.has(widget.name)) throw new Error('위젯 이름이 중복됩니다.');
        names.add(widget.name);
        const name = `chat-${shortId}-${widget.name}.html`;
        widgets.push({ path: `public/widgets/${name}`, content: widget.html });
        body = body.replaceAll(`{{widget:${widget.name}}}`, `<iframe src="/widgets/${name}" width="100%" height="520" loading="lazy" style="border:0" title="${widget.name}"></iframe>`);
      }
      if (/\{\{widget:/.test(body)) throw new Error('내용이 제공되지 않은 위젯 참조가 있습니다.');
      const metadata = { title: input.title, type: 'session', date, ...(input.minutes === undefined ? {} : { minutes: input.minutes }), topics: input.topics, stage: input.stage, status: 'done', publish: true, source: 'chatgpt', ...(input.original ? { original: input.original } : {}) };
      const content = `---\n${dump(metadata, { lineWidth: -1 })}---\n\n${body.trim()}\n`;
      const files = [{ path: target, content }, ...widgets];
      const previewPath = `vault/drafts/${id}/note.md`;
      const preview = safeFile(root, previewPath, { missing: true });
      // Require the committed ignore rule; never rely on a remembered configuration.
      try { execFileSync('git', ['check-ignore', '--no-index', '--', previewPath], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }); } catch { throw new Error('vault/drafts/의 Git 제외 설정이 없습니다. 저장을 중단했습니다.'); }
      fs.mkdirSync(path.dirname(preview), { recursive: true, mode: 0o700 });
      const previewContent = `---\n${dump({ ...metadata, publish: false }, { lineWidth: -1 })}---\n\n${body.trim()}\n`;
      fs.writeFileSync(preview, previewContent, { mode: 0o600 });
      for (const widget of widgets) {
        const widgetFile = safeFile(root, `vault/drafts/${id}/${path.basename(widget.path)}`, { missing: true });
        fs.writeFileSync(widgetFile, widget.content, { mode: 0o600 });
      }
      const record = { id, title: input.title, date, minutes: input.minutes, previewPath, previewHash: fileHash(previewPath, Buffer.from(previewContent)), files, revision: revisionOf(files), status: 'draft', updated_at: new Date().toISOString() };
      write(record);
      return inspect(record);
    }),
    publish: (id, expectedRevision) => locked(async () => {
      const record = read(id);
      checkRevision(record, expectedRevision);
      if (record.status === 'published') return inspect(record);
      const inspected = inspect(record);
      if (inspected.obsidian_changed) throw new Error('Obsidian에서 초안이 바뀌었습니다. read_study_draft로 변경을 읽고 save_study_draft로 반영한 뒤 다시 공개 승인을 받으세요.');
      if (inspected.errors.length) throw new Error(`공개 검사 실패: ${JSON.stringify(inspected.errors)}`);
      // Materialize only this reviewed version. Existing user files are never overwritten.
      for (const file of record.files) {
        const target = safeFile(root, file.path, { missing: true });
        if (fs.existsSync(target) && (record.status !== 'materialized' || fileHash(file.path, fs.readFileSync(target)) !== fileHash(file.path, Buffer.from(file.content)))) throw new Error(`대상 파일이 이미 있거나 바뀌었습니다: ${file.path}`);
      }
      const paths = record.files.map((f) => f.path);
      await helper('draft', ...paths);
      for (const file of record.files) {
        const target = safeFile(root, file.path, { missing: true });
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content);
      }
      record.status = 'materialized';
      write(record);
      const receiptFile = path.resolve(root, git('rev-parse', '--git-path', 'study-log/last-publish.json'));
      let receipt;
      // Recover a completed publication whose MCP response was lost before persisting status.
      if (fs.existsSync(receiptFile)) {
        const candidate = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
        if (record.files.every((f) => candidate.hashes?.[f.path] === fileHash(f.path, Buffer.from(f.content)))) receipt = candidate;
      }
      if (!receipt) {
        await helper('publish', ...paths);
        receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
      }
      record.status = 'published';
      record.publication = { commit: receipt.commit, url: new URL(noteUrl(noteId(paths[0].replace(/^vault\//, ''))), site).href, hashes: receipt.hashes, pushed_at: new Date().toISOString() };
      write(record);
      return inspect(record);
    }),
    discard: (id, expectedRevision) => locked(async () => {
      const record = read(id);
      checkRevision(record, expectedRevision);
      if (record.status === 'published') throw new Error('이미 공개한 글입니다. 취소로 삭제하지 않습니다.');
      if (record.status === 'materialized') {
        for (const file of record.files) {
          const target = safeFile(root, file.path, { missing: true });
          if (fs.existsSync(target) && fileHash(file.path, fs.readFileSync(target)) !== fileHash(file.path, Buffer.from(file.content))) throw new Error('사용자가 수정한 파일이 있어 취소를 중단했습니다.');
        }
        await helper('discard', ...record.files.map((f) => f.path));
      }
      // Keep a recoverable private copy; no public deletion is performed.
      record.status = 'discarded';
      write(record);
      return { draft_id: id, status: 'discarded', recoverable: true };
    }),
    publicationStatus: async (id) => {
      const record = read(id);
      if (!record.publication) return { draft_id: id, status: record.status, deployed: false };
      try {
        const response = await fetch(new URL(`/study-log-manifest.json?t=${Date.now()}`, site), { signal: AbortSignal.timeout(10000), cache: 'no-store' });
        const manifest = response.ok ? await response.json() : {};
        const deployed = Object.entries(record.publication.hashes).every(([name, hash]) => manifest.files?.[name] === hash);
        return { draft_id: id, status: deployed ? 'deployed' : 'awaiting_deployment', deployed, url: record.publication.url, commit: record.publication.commit };
      } catch { return { draft_id: id, status: 'deployment_check_unavailable', deployed: false, url: record.publication.url }; }
    },
  };
}
