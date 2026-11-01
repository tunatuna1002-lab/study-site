#!/usr/bin/env node
// Helper for the study-log skill. Runs the same on macOS and Windows (Git Bash or PowerShell).
//   root | today | sync | build
//   check <paths...>      privacy/secret scan (exit 1 on errors)
//   draft <paths...>      keep new files out of git until published (.git/info/exclude)
//   discard <paths...>    delete new draft files, restore edited published files
//   publish <paths...>    check, pull, build, commit only these paths, push
//   wait <note path>      poll the deployed page of a note
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SECTIONS, VAULT_DIR, noteId, noteUrl, readFrontmatter } from '../src/lib/vault.mjs';
import { markdownHtmlErrors } from '../src/lib/content-safety.mjs';
import { fileHash } from '../src/lib/file-safety.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REAL_ROOT = fs.realpathSync(ROOT);
const SITE = (fs.readFileSync(path.join(ROOT, 'astro.config.mjs'), 'utf8').match(/site:\s*'([^']+)'/) ?? [])[1];
const NOTE_RE = new RegExp(`^${VAULT_DIR}/(${SECTIONS.join('|')})/.+\\.md$`);
const ALLOWED = [NOTE_RE, /^public\/widgets\/[a-z0-9][a-z0-9-]*\.html$/, /^vault\/attachments\/[^/]+\.(png|jpe?g|gif|webp|svg)$/i];

const git = (...args) => execFileSync('git', ['--literal-pathspecs', '-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8' }).trim();
const tryGit = (...args) => spawnSync('git', ['--literal-pathspecs', '-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8' });
const lines = (s) => s.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
const fail = (msg) => {
	throw new Error(msg);
};
const rel = (p) => path.relative(ROOT, path.resolve(ROOT, p)).split(path.sep).join('/').normalize('NFC');
const isTracked = (p) => tryGit('ls-files', '--error-unmatch', '--', p).status === 0;
// --ignored so locked drafts (excluded) still count as changes.
const isChanged = (p) => tryGit('status', '--porcelain', '--ignored', '--', p).stdout.trim() !== '';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const titleOf = (p) => readFrontmatter(fs.readFileSync(path.join(ROOT, p), 'utf8')).title;

function build() {
	const r = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
	return r.status === 0;
}

// fetch + pull --rebase --autostash. Returns null on success, else the reason to show the user.
function pull() {
	const f = tryGit('fetch', '-q');
	if (f.status !== 0) return `${f.stdout}${f.stderr}`;
	// Drafts are ignored files, and git silently overwrites ignored files on checkout.
	const taken = drafts().filter((p) => tryGit('cat-file', '-e', `@{u}:${p}`).status === 0);
	if (taken.length) return `다른 컴퓨터에서 같은 이름의 파일이 이미 올라왔습니다. 초안 이름을 바꾸세요: ${taken.join(', ')}`;
	const r = tryGit('pull', '--rebase', '--autostash');
	const gitPath = (p) => path.resolve(ROOT, git('rev-parse', '--git-path', p));
	if (r.status !== 0 && (fs.existsSync(gitPath('rebase-merge')) || fs.existsSync(gitPath('rebase-apply')))) tryGit('rebase', '--abort');
	// Re-applying the autostash can conflict after the rebase itself finished.
	const unmerged = lines(tryGit('diff', '--name-only', '--diff-filter=U').stdout);
	if (unmerged.length) return `보관(autostash)한 변경을 되돌리다 충돌: ${unmerged.join(', ')}. 보관본은 git stash list에 남아 있습니다. 사용자와 함께 해결하세요.`;
	return r.status === 0 ? null : `${r.stdout}${r.stderr}`;
}

// ---- privacy / secret scan ----

const ERRORS = [
	['이메일 주소', /(?<![\w.%+-])(?!git@)[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/],
	['전화번호', /(?<!\d)01[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)|\+82[-. ]?10[-. ]?\d{3,4}[-. ]?\d{4}/],
	['주민등록번호', /(?<!\d)\d{6}-[1-4]\d{6}(?!\d)/],
	['API 키', /\bsk-(ant-)?[A-Za-z0-9_-]{20,}|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{35}|\bxox[abposr]-[A-Za-z0-9-]{10,}|\bnpm_[A-Za-z0-9]{36}\b|\bhf_[A-Za-z0-9]{30,}/],
	['비밀 키', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
	['JWT 토큰', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\./],
	['비밀값 대입', /\b([a-z]+_)?(api[_-]?key|secret([_-]?access)?[_-]?key|secret|access[_-]?token|auth[_-]?token|token|password|passwd)["']?\s*[:=]\s*['"]?(?=[A-Za-z0-9_\-+=]*\d)[A-Za-z0-9_\-+=]{16,}/i],
	['계정·서명이 들어간 URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@|X-(Amz|Goog)-Signature=|[?&](sig|signature|token|access_token|api_key|apikey)=[^&\s]{16,}/i],
	['로컬 절대 경로', /(^|[\s"'(=`])(\/Users\/|\/home\/|\/c\/Users\/)[^\s]|\b[A-Za-z]:[\\/]+Users[\\/]/im],
];
const WIDGET_ERRORS = [
	['외부 리소스', /\b(src|href|srcset|action|data)\s*=\s*["']?(https?:)?\/\/|url\(\s*["']?(https?:)?\/\/|@import|<base\b|http-equiv\s*=\s*["']?refresh/i],
	['네트워크 요청', /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|\bimport\s*\(|new\s+Worker\b/],
	['부모 창 접근', /\b(parent|top|opener)\s*\.\s*(document|location|postMessage|window|frames)\b|\bwindow\s*\.\s*(parent|top|opener)\b/],
];
const WARNINGS = [['지원·채용 관련 표현', /지원서|지원 현황|서류 (합격|탈락)|최종 합격|불합격|면접 (일정|후기|결과)|채용 (공고|과정|절차)|연봉/]];

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

export function scanText(p, text) {
	const errors = [];
	const warnings = [];
	if (!/\.(md|html|svg)$/i.test(p)) {
		warnings.push('이미지 첨부: 직접 만든 것인지, 논문 그림이 아닌지 확인');
		return { errors, warnings };
	}
	const rules = /\.(html|svg)$/i.test(p) ? [...ERRORS, ...WIDGET_ERRORS] : ERRORS;
	for (const [label, re] of rules) {
		const m = re.exec(text);
		if (m) errors.push(`${label} (${lineOf(text, m.index)}줄)`);
	}
	for (const [label, re] of WARNINGS) {
		const m = re.exec(text);
		if (m) warnings.push(`${label} (${lineOf(text, m.index)}줄: ${m[0]})`);
	}
	if (p.endsWith('.md')) {
		errors.push(...markdownHtmlErrors(text));
		// Long quotations: blockquote runs longer than 5 lines or 400 characters.
		let run = [];
		for (const [i, line] of [...text.split('\n'), ''].entries()) {
			if (/^\s*>/.test(line)) run.push(line);
			else {
				const chars = run.join('').replace(/^\s*>\s?/gm, '').length;
				if (run.length > 5 || chars > 400) warnings.push(`긴 인용 (${i - run.length + 1}줄부터 ${run.length}줄, ${chars}자): 직접 쓴 설명인지 확인`);
				run = [];
			}
		}
		const fm = readFrontmatter(text);
		if (typeof fm !== 'object' || Object.keys(fm).length === 0) errors.push('프론트매터를 읽을 수 없음');
		else if (fm.publish !== true) warnings.push('publish: true가 아님: 사이트에 나오지 않음');
	}
	return { errors, warnings };
}

export function scan(p) {
	return scanText(p, /\.(md|html|svg)$/i.test(p) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '');
}

function check(paths) {
	let bad = 0;
	for (const p of paths) {
		const { errors, warnings } = scan(p);
		for (const e of errors) console.log(`[오류] ${p}: ${e}`);
		for (const w of warnings) console.log(`[경고] ${p}: ${w}`);
		bad += errors.length;
	}
	console.log(bad ? `검사 실패: 오류 ${bad}개` : '검사 통과');
	return bad === 0;
}

// ---- draft guard (.git/info/exclude, local only) ----
// Draft paths live between two marker lines (gitignore has no inline comments).

const BEGIN = '# study-log drafts begin';
const END = '# study-log drafts end';
const excludeFile = () => path.resolve(ROOT, git('rev-parse', '--git-path', 'info/exclude'));
const escapeGlob = (p) => `/${p.replace(/[\\*?[\]!#]/g, '\\$&').replace(/^(\s)|(\s)$/g, '\\$1$2')}`;

function readExclude() {
	const f = excludeFile();
	const all = fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').map((l) => l.replace(/\r$/, '')) : [];
	while (all.length && all[all.length - 1] === '') all.pop();
	const b = all.indexOf(BEGIN);
	const e = all.indexOf(END, b);
	if (b < 0 || e < 0) return { other: all, mine: [] };
	return { other: [...all.slice(0, b), ...all.slice(e + 1)], mine: all.slice(b + 1, e) };
}
function writeExclude(mine) {
	const f = excludeFile();
	const { other } = readExclude();
	fs.mkdirSync(path.dirname(f), { recursive: true });
	fs.writeFileSync(f, [...other, ...(mine.length ? [BEGIN, ...mine, END] : [])].join('\n') + '\n');
}
const drafts = () => readExclude().mine.map((l) => l.slice(1).replace(/\\(.)/g, '$1'));
function draft(paths) {
	const mine = readExclude().mine;
	for (const p of paths) {
		if (isTracked(p)) console.log(`공개된 파일이라 잠금 대상이 아님(승인 전까지 커밋하지 말 것): ${p}`);
		else if (!mine.includes(escapeGlob(p))) mine.push(escapeGlob(p));
	}
	writeExclude(mine);
}
function undraft(paths) {
	const remove = new Set(paths.map(escapeGlob));
	writeExclude(readExclude().mine.filter((l) => !remove.has(l)));
}

// ---- commands ----

function requirePaths(paths) {
	if (paths.length === 0) fail('경로를 하나 이상 주세요.');
	const out = [...new Set(paths.map(rel))];
	for (const p of out) {
		if (/[\u0000-\u001f\u007f]/.test(p)) fail('경로에 제어 문자를 사용할 수 없습니다.');
		if (!ALLOWED.some((re) => re.test(p))) fail(`허용되지 않은 경로: ${p} (vault/{sessions,concepts,essays}/*.md, public/widgets/*.html, vault/attachments/*.{png,jpg,gif,webp,svg}만 가능)`);
		// Reject links in every component, even a broken link or an in-tree alias.
		let current = REAL_ROOT;
		for (const component of p.split('/')) {
			current = path.join(current, component);
			try {
				if (fs.lstatSync(current).isSymbolicLink()) fail(`심볼릭 링크 경로는 허용하지 않습니다: ${p}`);
			} catch (e) { if (e.code !== 'ENOENT') throw e; }
		}
		if (fs.existsSync(current) && !fs.statSync(current).isFile()) fail(`일반 파일이 아닙니다: ${p}`);
	}
	return out;
}

function noteUrlOf(p) {
	const m = p.match(new RegExp(`^${VAULT_DIR}/(.+)\\.md$`));
	return m && SITE ? new URL(noteUrl(noteId(`${m[1]}.md`)), SITE).href : null;
}

function requireMain() {
	if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('main 브랜치가 아닙니다.');
}

const ahead = () => Number(tryGit('rev-list', '--count', '@{u}..HEAD').stdout.trim() || 0);

function sync() {
	requireMain();
	settlePending();
	const err = pull();
	if (err) fail(`최신 내용을 받지 못했습니다. 사용자에게 보여 주고 멈추세요.\n${err}`);
	console.log(`저장소: ${ROOT}`);
	console.log(`오늘(KST): ${today()}`);
	if (ahead()) console.log(`push 안 된 커밋 ${ahead()}개: 자동 공개를 중단합니다. 이 커밋은 별도로 확인해야 합니다.`);
	const dirty = tryGit('status', '--porcelain').stdout.trimEnd();
	console.log(`커밋 안 된 변경(사용자 것일 수 있음, 건드리지 말 것):\n${dirty || '  없음'}`);
	const d = drafts().filter((p) => fs.existsSync(path.join(ROOT, p)));
	console.log(`초안(아직 공개 안 함):\n${d.map((p) => `  ${p}`).join('\n') || '  없음'}`);
	const dir = path.join(ROOT, VAULT_DIR, 'concepts');
	const concepts = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith('.md'))
		.map((f) => readFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8')).title ?? f.replace(/\.md$/, ''));
	console.log(`개념 노트 제목: ${concepts.join(', ') || '없음'}`);
}

const statePath = (name) => path.resolve(ROOT, git('rev-parse', '--git-path', `study-log/${name}`));
function writeState(name, value) {
	const file = statePath(name);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

function publishTarget() {
	const remote = git('config', '--get', 'branch.main.remote');
	const branch = git('config', '--get', 'branch.main.merge');
	if (!remote || remote === '.' || branch !== 'refs/heads/main') fail('origin의 main 같은 원격 main 추적 설정이 필요합니다.');
	return { remote, branch };
}

// A failed/ambiguous push must never be retried by publishing an unrelated batch.
function settlePending() {
	const file = statePath('pending.json');
	if (!fs.existsSync(file)) return;
	const pending = JSON.parse(fs.readFileSync(file, 'utf8'));
	const r = tryGit('fetch', '-q', pending.remote, pending.branch);
	if (r.status !== 0) fail('이전 전송 결과를 확인할 수 없습니다. 네트워크 복구 후 같은 작업을 다시 실행하세요.');
	if (tryGit('merge-base', '--is-ancestor', pending.commit, 'FETCH_HEAD').status === 0) {
		writeState('last-publish.json', pending);
		fs.unlinkSync(file);
		return;
	}
	if (git('rev-parse', 'HEAD') !== pending.commit) fail('전송 대기 중 다른 커밋이 생겼습니다. 자동 되돌리기를 중단합니다.');
	if (tryGit('diff', '--cached', '--quiet').status !== 0) fail('전송 대기 중 다른 파일이 스테이징됐습니다. 자동 되돌리기를 중단합니다.');
	git('reset', '--mixed', pending.base);
	draft(pending.paths.filter((p) => !isTracked(p)));
	fs.unlinkSync(file);
}

function publish(paths) {
	requireMain();
	settlePending();
	const target = publishTarget();
	for (const p of paths) if (!fs.existsSync(path.join(ROOT, p))) fail(`파일이 없습니다: ${p}`);
	if (tryGit('diff', '--cached', '--quiet').status !== 0) fail('이미 스테이징된 다른 변경이 있습니다. 사용자에게 확인하세요.');
	const notes = paths.filter((p) => NOTE_RE.test(p));
	if (!check(paths)) fail('검사 실패');
	if (tryGit('fetch', '-q', target.remote).status !== 0) fail('원격 상태를 확인할 수 없습니다.');
	if (ahead()) fail('미전송 커밋이 있습니다. 이번 노트와 함께 공개하지 않습니다. 기존 커밋을 먼저 별도로 확인하세요.');
	const approved = Object.fromEntries(paths.map((p) => [p, fileHash(p, fs.readFileSync(path.join(ROOT, p)))]));
	{
		// Pull and build while drafts are still locked; unlock only for the commit itself.
		const err = pull();
		if (err) fail(`최신 내용을 받지 못했습니다.\n${err}`);
		if (ahead()) fail('동기화 중 미전송 커밋이 생겼습니다. 공개를 중단합니다.');
		const base = git('rev-parse', 'HEAD');
		const changed = paths.filter(isChanged);
		if (!changed.length) fail('바뀐 내용이 없습니다.');
		requirePaths(paths);
		if (paths.some((p) => fileHash(p, fs.readFileSync(path.join(ROOT, p))) !== approved[p])) fail('동기화 중 초안 내용이 바뀌었습니다. 다시 확인한 뒤 공개하세요.');
		if (!check(paths)) fail('동기화 후 검사 실패');
		if (!build()) fail('빌드 실패. 위 로그를 보고 고치세요(다른 초안 때문일 수도 있음).');
		if (git('rev-parse', 'HEAD') !== base) fail('빌드 중 다른 커밋이 생겼습니다. 공개를 중단합니다.');
		requirePaths(paths);
		if (paths.some((p) => fileHash(p, fs.readFileSync(path.join(ROOT, p))) !== approved[p])) fail('빌드 중 초안 내용이 바뀌었습니다. 다시 확인한 뒤 공개하세요.');
		const updating = notes.some(isTracked);
		const title = notes.map(titleOf).find(Boolean) ?? path.basename(paths[0]);
		undraft(paths);
		try {
			git('add', '--', ...changed);
			const staged = git('diff', '--cached', '--name-only', '-z').split('\0').filter(Boolean).map((s) => s.normalize('NFC'));
			const want = new Set(changed);
			if (staged.length !== want.size || staged.some((s) => !want.has(s))) {
				throw new Error(`스테이징된 파일이 예상과 다릅니다.\n예상: ${changed.join(', ')}\n실제: ${staged.join(', ')}`);
			}
			// The committed tree is checked again below, before any network publication.
			git('commit', '-q', '-m', `${updating ? 'Update' : 'Add'} study note: ${title}`);
		} catch (e) {
			tryGit('reset', '-q', '--', ...changed);
			draft(paths.filter((p) => !isTracked(p)));
			fail(`커밋하지 못했습니다. 초안 잠금을 되돌렸습니다.\n${e.stderr ?? e.message}`);
		}
		const commit = git('rev-parse', 'HEAD');
		if (git('rev-parse', `${commit}^`) !== base) fail('커밋 도중 다른 커밋이 생겼습니다. 공개를 중단합니다.');
		const committedPaths = git('diff', '--name-only', '-z', base, commit).split('\0').filter(Boolean);
		if (committedPaths.length !== changed.length || committedPaths.some((p) => !changed.includes(p))) fail('커밋 내용이 승인한 파일과 다릅니다. 공개하지 않았습니다.');
		for (const p of paths) {
			const blob = execFileSync('git', ['show', `${commit}:${p}`], { cwd: ROOT });
			if (fileHash(p, blob) !== approved[p]) fail('커밋 내용이 승인한 버전과 다릅니다. 공개하지 않았습니다.');
		}
		const receipt = { ...target, commit, base, paths, hashes: approved };
		writeState('pending.json', receipt);
		// Push this exact object only; never implicitly push HEAD or other branches.
		const pushed = tryGit('push', '-q', target.remote, `${commit}:${target.branch}`);
		if (pushed.status !== 0) {
			settlePending();
			if (git('rev-parse', 'HEAD') === base) fail('push 실패: 이번 커밋을 초안 상태로 되돌렸습니다. 취소하거나 다시 공개할 수 있습니다.');
		} else {
			writeState('last-publish.json', receipt);
			fs.rmSync(statePath('pending.json'), { force: true });
		}
	}
	console.log(`공개 완료: ${git('rev-parse', '--short', 'HEAD')}`);
	for (const p of notes) console.log(`URL: ${noteUrlOf(p)}`);
}

function discard(paths) {
	requireMain();
	settlePending();
	// Validate everything first so a bad path does not leave half the work done.
	const plan = paths.map((p) => ({ p, tracked: isTracked(p) }));
	for (const { p, tracked } of plan) if (tracked && !isChanged(p)) fail(`바뀐 것이 없는 공개 파일입니다: ${p}`);
	for (const { p, tracked } of plan) {
		if (tracked) {
			git('restore', '--source=HEAD', '--staged', '--worktree', '--', p);
			console.log(`공개된 내용으로 되돌림: ${p}`);
		} else {
			fs.rmSync(path.join(ROOT, p), { force: true });
			console.log(`삭제: ${p}`);
		}
	}
	undraft(paths);
}

async function wait(p) {
	const url = noteUrlOf(p);
	if (!url) fail(`노트 경로가 아닙니다: ${p}`);
	const expected = { [p]: fileHash(p, fs.readFileSync(path.join(ROOT, p))) };
	const receiptFile = statePath('last-publish.json');
	if (fs.existsSync(receiptFile)) {
		const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
		if (receipt.hashes?.[p] === expected[p]) Object.assign(expected, receipt.hashes);
	}
	const deadline = Date.now() + 300000;
	for (let i = 0; i < 20 && Date.now() < deadline; i++) {
		try {
			const res = await fetch(new URL(`/study-log-manifest.json?t=${Date.now()}`, SITE), { cache: 'no-store', signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))) });
			const manifest = res.ok ? await res.json() : {};
			if (res.ok && Object.entries(expected).every(([file, hash]) => manifest.files?.[file] === hash) && (await fetch(url, { signal: AbortSignal.timeout(Math.max(1, Math.min(10000, deadline - Date.now()))) })).ok) {
				console.log(`배포 확인: ${url}`);
				return;
			}
		} catch {}
		await new Promise((r) => setTimeout(r, Math.max(0, Math.min(15000, deadline - Date.now()))));
	}
	fail(`5분 안에 배포를 확인하지 못했습니다: ${url} (Cloudflare Pages 배포 상태를 확인하세요)`);
}

async function main() {
	const [cmd, ...args] = process.argv.slice(2);
	let unlock;
	if (['sync', 'draft', 'discard', 'publish'].includes(cmd)) {
		const lock = statePath('operation.lock');
		fs.mkdirSync(path.dirname(lock), { recursive: true });
		try { fs.mkdirSync(lock); } catch { fail('다른 기록 작업이 실행 중이거나 잠금이 남아 있습니다. 동시에 실행하지 마세요.'); }
		fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
		unlock = () => fs.rmSync(lock, { recursive: true, force: true });
	}
	try {
	switch (cmd) {
		case 'root':
			console.log(ROOT);
			break;
		case 'today':
			console.log(today());
			break;
		case 'sync':
			sync();
			break;
		case 'build':
			process.exit(build() ? 0 : 1);
		case 'check':
			process.exit(check(requirePaths(args)) ? 0 : 1);
		case 'draft':
			draft(requirePaths(args));
			console.log('초안 잠금: git이 새 파일을 커밋하지 않습니다.');
			break;
		case 'discard':
			discard(requirePaths(args));
			break;
		case 'publish':
			publish(requirePaths(args));
			break;
		case 'wait':
			await wait(requirePaths(args)[0]);
			break;
		default:
			console.log('사용법: study-log.mjs root|today|sync|build|check|draft|discard|publish|wait');
			process.exit(cmd ? 1 : 0);
	}
	} finally { unlock?.(); }
}
export async function runCli() {
	try { await main(); } catch (e) { console.error(`오류: ${e.message}`); process.exitCode = 1; }
}
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
	await runCli();
}
