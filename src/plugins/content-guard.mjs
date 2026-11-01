// Build-time safety checks for note content. A note that fails stops the build,
// so it can never be published (study-log runs the build before every publish).
// - remarkImageGuard: Markdown images may only point at files in vault/attachments/.
//   It runs before Astro collects images, so a bad path is never imported.
// - rehypeHtmlGuard: every element (from Markdown or raw HTML) must be on an allowlist,
//   with safe links, local images and widget iframes only. Runs after rehype-raw.
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ATTACHMENTS = path.join(ROOT, 'vault', 'attachments');
const WIDGETS = path.join(ROOT, 'public', 'widgets');
const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i;
export const WIDGET_SRC = /^\/widgets\/([a-z0-9][a-z0-9-]*)\.html$/;

const fail = (file, msg) => {
	throw new Error(`${file ? path.relative(ROOT, file) : 'note'}: ${msg}`);
};

// `target` is a regular file inside `dir`, and no path component from the repository root
// down to it (the allowed directory itself included) is a symlink.
function insideWithoutLinks(dir, target) {
	const rel = path.relative(dir, target);
	if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return false;
	let current = ROOT;
	for (const part of path.relative(ROOT, target).split(path.sep)) {
		current = path.join(current, part);
		if (!existsSync(current) || lstatSync(current).isSymbolicLink()) return false;
	}
	return lstatSync(target).isFile();
}

// Decide the format from the bytes, not the file name: an SVG named .png would otherwise
// be emitted by Astro as an executable .svg asset.
function isRaster(file) {
	const b = readFileSync(file).subarray(0, 16);
	const ascii = (from, to) => b.subarray(from, to).toString('latin1');
	return (
		b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ||
		(b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
		/^GIF8[79]a$/.test(ascii(0, 6)) ||
		// WEBP also needs its VP8/VP8L/VP8X chunk, as Astro's detector does; otherwise Astro
		// falls through and may detect an embedded SVG.
		(ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP' && /^VP8[ LX]$/.test(ascii(12, 16)))
	);
}

export function checkImage(src, file) {
	if (typeof src !== 'string' || !src) fail(file, '빈 그림 주소');
	if (/^[a-z][a-z0-9+.-]*:|^\/|^\\|[?#\\\u0000-\u001f\u007f]/i.test(src))
		fail(file, `그림은 vault/attachments/ 안의 파일을 상대 경로로만 넣을 수 있습니다: ${src}`);
	if (!IMAGE_EXT.test(src)) fail(file, `그림은 png, jpg, gif, webp만 쓸 수 있습니다: ${src}`);
	if (!file) fail(file, `노트 위치를 알 수 없어 그림을 확인하지 못했습니다: ${src}`);
	let target;
	try {
		target = path.resolve(path.dirname(file), decodeURI(src));
	} catch {
		fail(file, `그림 주소를 해석할 수 없습니다: ${src}`);
	}
	if (!insideWithoutLinks(ATTACHMENTS, target)) fail(file, `그림 파일이 vault/attachments/ 안에 없습니다: ${src}`);
	if (!isRaster(target)) fail(file, `그림 파일 내용이 png, jpg, gif, webp가 아닙니다: ${src}`);
}

export function remarkImageGuard() {
	return (tree, vfile) => {
		const definitions = new Map();
		const walk = (node, fn) => {
			fn(node);
			for (const child of node.children ?? []) walk(child, fn);
		};
		// The first definition wins, as in CommonMark and Astro's image collector.
		walk(tree, (n) => n.type === 'definition' && !definitions.has(n.identifier) && definitions.set(n.identifier, n.url));
		walk(tree, (n) => {
			if (n.type === 'image') checkImage(n.url, vfile.path);
			if (n.type === 'imageReference' && definitions.has(n.identifier)) checkImage(definitions.get(n.identifier), vfile.path);
			// Astro only processes Markdown images; an HTML <img> would ship a broken relative path.
			// (The HTML parser also turns <image> into <img>.)
			if (n.type === 'html' && /<im(?:g|age)\b/i.test(n.value)) fail(vfile.path, '그림은 HTML <img> 대신 Markdown ![설명](../attachments/파일)로 넣으세요');
		});
	};
}

const TAGS = new Set(
	'a abbr b blockquote br caption code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i iframe img input kbd li mark ol p pre s samp section small span strong sub summary sup table tbody td tfoot th thead tr u ul'.split(
		' ',
	),
);
// hast property names (camelCase).
const PROPS = new Set(
	'className id title lang dir role tabIndex style href rel target src alt width height loading align colSpan rowSpan scope start reversed open type checked disabled dataFootnotes dataFootnoteRef dataFootnoteBackref dataLanguage'.split(
		' ',
	),
);
const SAFE_HREF = /^(?:https?:\/\/|mailto:|#|\.{0,2}\/(?!\/)|[^:/?#]+(?:[/?#]|$))/i;
// Inline styles: a few plain properties (widget iframe border, Shiki code colours) with
// simple values only. No functions, quotes or escapes, so nothing can load a resource.
const STYLE_DECL = /^\s*(?:--[a-z0-9-]+|color|background-color|border|width|height|font-style|font-weight|text-decoration|text-align|overflow-x)\s*:\s*[#a-z0-9.%\s-]+$/i;
const safeStyle = (v) => String(v).split(';').every((d) => !d.trim() || STYLE_DECL.test(d));

export function rehypeHtmlGuard() {
	return (tree, vfile) => {
		const file = vfile.path;
		const walk = (node) => {
			if (node.type === 'element') {
				const { tagName: tag, properties: props = {} } = node;
				if (!TAGS.has(tag)) fail(file, `허용하지 않는 HTML 태그 <${tag}>`);
				for (const [name, value] of Object.entries(props)) {
					if (value === undefined || value === null || value === false) continue;
					if (!PROPS.has(name) && !/^aria[A-Z]/.test(name)) fail(file, `허용하지 않는 HTML 속성 ${name} (<${tag}>)`);
					if (name === 'style' && !safeStyle(value)) fail(file, `허용하지 않는 인라인 스타일 (<${tag}>)`);
				}
				if (props.href !== undefined) {
					const href = String(props.href);
					// Whitespace, control characters and backslashes (browsers read \ as /, so \\host is //host).
					if (/[\u0000- \u007f\\]/.test(href) || !SAFE_HREF.test(href)) fail(file, `안전하지 않은 링크: ${href.slice(0, 80)}`);
				}
				if (tag === 'img') checkImage(String(props.src ?? ''), file);
				else if (props.src !== undefined && tag !== 'iframe') fail(file, `<${tag}>에는 src를 쓸 수 없습니다`);
				if (tag === 'iframe') {
					const m = WIDGET_SRC.exec(String(props.src ?? ''));
					if (!m) fail(file, `iframe은 /widgets/<이름>.html만 넣을 수 있습니다: ${props.src}`);
					if (!insideWithoutLinks(WIDGETS, path.join(WIDGETS, `${m[1]}.html`))) fail(file, `위젯 파일이 없습니다: ${props.src}`);
				}
				if (tag === 'input' && !(props.type === 'checkbox' && props.disabled)) fail(file, '체크박스(disabled) 외의 <input>은 쓸 수 없습니다');
			} else if (node.type === 'raw' || node.type === 'doctype') {
				fail(file, '해석되지 않은 HTML이 남았습니다');
			}
			for (const child of node.children ?? []) walk(child);
		};
		walk(tree);
	};
}
