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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = (fs.readFileSync(path.join(ROOT, 'astro.config.mjs'), 'utf8').match(/site:\s*'([^']+)'/) ?? [])[1];
const NOTE_RE = new RegExp(`^${VAULT_DIR}/(${SECTIONS.join('|')})/.+\\.md$`);
const ALLOWED = [NOTE_RE, /^public\/widgets\/[a-z0-9][a-z0-9-]*\.html$/, /^vault\/attachments\/[^/]+\.(png|jpe?g|gif|webp|svg)$/i];

const git = (...args) => execFileSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8' }).trim();
const tryGit = (...args) => spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, encoding: 'utf8' });
const lines = (s) => s.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
const fail = (msg) => {
	console.error(`오류: ${msg}`);
	process.exit(1);
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

function scan(p) {
	const errors = [];
	const warnings = [];
	if (!/\.(md|html|svg)$/i.test(p)) {
		warnings.push('이미지 첨부: 직접 만든 것인지, 논문 그림이 아닌지 확인');
		return { errors, warnings };
	}
	const text = fs.readFileSync(path.join(ROOT, p), 'utf8');
	const rules = /\.(html|svg)$/i.test(p) ? [...ERRORS, ...WIDGET_ERRORS] : ERRORS;
	for (const [label, re] of rules) {
		const m = re.exec(text);
		// Line number only: the match may be a secret, and this output ends up in chat logs.
		if (m) errors.push(`${label} (${lineOf(text, m.index)}줄)`);
	}
	for (const [label, re] of WARNINGS) {
		const m = re.exec(text);
		if (m) warnings.push(`${label} (${lineOf(text, m.index)}줄: ${m[0]})`);
	}
	if (p.endsWith('.md')) {
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
		if (!ALLOWED.some((re) => re.test(p))) fail(`허용되지 않은 경로: ${p} (vault/{sessions,concepts,essays}/*.md, public/widgets/*.html, vault/attachments/*.{png,jpg,gif,webp,svg}만 가능)`);
	}
	return out;
}

function noteUrlOf(p) {
	const m = p.match(new RegExp(`^${VAULT_DIR}/(.+)\\.md$`));
	return m && SITE ? new URL(noteUrl(noteId(`${m[1]}.md`)), SITE).href : null;
}

function requireMain() {
	if (git('rev-parse', '--abbrev-ref', 'HEAD') !== 'main') fail('main 브랜치가 아닙니다.');
	if (tryGit('rev-parse', '--abbrev-ref', '@{u}').stdout.trim() !== 'origin/main') fail('main이 origin/main을 따라가지 않습니다.');
}

const ahead = () => Number(tryGit('rev-list', '--count', '@{u}..HEAD').stdout.trim() || 0);

// Pushing a commit publishes everything before it too. Only earlier commits of these same
// files (a publish whose push failed) may go out; any other unpushed commit stops the publish.
function refuseOtherCommits(paths, rev = 'HEAD') {
	const files = git('log', '-m', '--no-renames', '--format=', '--name-only', '-z', `@{u}..${rev}`).split('\0').filter(Boolean);
	const other = [...new Set(files.map((s) => s.normalize('NFC')))].filter((p) => !paths.includes(p));
	if (other.length) fail(`push 안 된 커밋에 이번 경로가 아닌 파일이 있어 공개하지 않습니다. 사용자에게 확인하세요: ${other.join(', ')}`);
}

function sync() {
	requireMain();
	const err = pull();
	if (err) fail(`최신 내용을 받지 못했습니다. 사용자에게 보여 주고 멈추세요.\n${err}`);
	console.log(`저장소: ${ROOT}`);
	console.log(`오늘(KST): ${today()}`);
	if (ahead()) console.log(`push 안 된 커밋 ${ahead()}개: 같은 파일을 다시 publish할 때만 함께 올라갑니다. 다른 파일이 들어 있으면 publish가 멈춥니다.`);
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

function push(paths) {
	// Push this exact commit, so anything committed after the check stays local.
	const pushHead = () => {
		const commit = git('rev-parse', 'HEAD');
		refuseOtherCommits(paths, commit);
		return tryGit('push', '-q', 'origin', `${commit}:refs/heads/main`);
	};
	let r = pushHead();
	if (r.status !== 0) {
		// The other computer pushed meanwhile: rebase once and retry.
		const err = pull();
		if (err) return `push 거부 후 다시 받기 실패:\n${err}`;
		r = pushHead();
	}
	return r.status === 0 ? null : `${r.stdout}${r.stderr}`;
}

function publish(paths) {
	requireMain();
	for (const p of paths) if (!fs.existsSync(path.join(ROOT, p))) fail(`파일이 없습니다: ${p}`);
	if (tryGit('diff', '--cached', '--quiet').status !== 0) fail('이미 스테이징된 다른 변경이 있습니다. 사용자에게 확인하세요.');
	if (tryGit('fetch', '-q').status !== 0) fail('원격 상태를 확인하지 못했습니다. 네트워크와 로그인을 확인한 뒤 다시 실행하세요.');
	refuseOtherCommits(paths);
	const notes = paths.filter((p) => NOTE_RE.test(p));
	const changed = paths.filter(isChanged);

	if (changed.length === 0) {
		// Nothing new: maybe an earlier publish committed but failed to push.
		if (!ahead()) fail('바뀐 내용이 없습니다.');
		if (!check(paths)) process.exit(1);
	} else {
		if (!check(paths)) process.exit(1);
		// Pull and build while drafts are still locked; unlock only for the commit itself.
		const err = pull();
		if (err) fail(`최신 내용을 받지 못했습니다.\n${err}`);
		if (!build()) fail('빌드 실패. 위 로그를 보고 고치세요(다른 초안 때문일 수도 있음).');
		const updating = notes.some(isTracked);
		const title = notes.map(titleOf).find(Boolean) ?? path.basename(paths[0]);
		undraft(paths);
		try {
			git('add', '--', ...changed);
			const staged = lines(git('diff', '--cached', '--name-only')).map((s) => s.normalize('NFC'));
			const want = new Set(changed);
			if (staged.length !== want.size || staged.some((s) => !want.has(s))) {
				throw new Error(`스테이징된 파일이 예상과 다릅니다.\n예상: ${changed.join(', ')}\n실제: ${staged.join(', ')}`);
			}
			git('commit', '-q', '-m', `${updating ? 'Update' : 'Add'} study note: ${title}`);
		} catch (e) {
			tryGit('reset', '-q', '--', ...changed);
			draft(paths.filter((p) => !isTracked(p)));
			fail(`커밋하지 못했습니다. 초안 잠금을 되돌렸습니다.\n${e.stderr ?? e.message}`);
		}
	}
	const err = push(paths);
	if (err) fail(`커밋은 로컬에 있지만 push 실패. 사용자에게 보여 주세요. 원인을 해결한 뒤 같은 publish를 다시 실행하면 올라갑니다.\n${err}`);
	console.log(`공개 완료: ${git('rev-parse', '--short', 'HEAD')}`);
	for (const p of notes) console.log(`URL: ${noteUrlOf(p)}`);
}

function discard(paths) {
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
	const title = titleOf(p);
	const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
	const want = title ? [title, esc(title)] : [];
	for (let i = 0; i < 20; i++) {
		try {
			const res = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
			const body = res.ok ? await res.text() : '';
			if (res.ok && (want.length === 0 || want.some((v) => body.includes(v)))) {
				console.log(`배포 확인: ${url}`);
				return;
			}
		} catch {}
		await new Promise((r) => setTimeout(r, 15000));
	}
	fail(`5분 안에 배포를 확인하지 못했습니다: ${url} (Cloudflare Pages 배포 상태를 확인하세요)`);
}

const [cmd, ...args] = process.argv.slice(2);
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
