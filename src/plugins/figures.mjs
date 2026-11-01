// Numbered figures and equations, like a paper.
// - remarkWidgetFigures: each widget iframe that stands on its own line becomes
//   <figure class="widget"> with a caption (iframe title, else the widget's own <title>, else its name).
// - rehypeEquations: each KaTeX display equation is wrapped in <div class="eq"> so CSS can number it.
// The numbers themselves come from CSS counters (global.css).
import { existsSync, readFileSync } from 'node:fs';
import { WIDGET_SRC } from './content-guard.mjs';

// Attributes as tokens, so a '>' inside a quoted value does not end the tag.
const IFRAME_RE = /^<iframe\b((?:\s+[\w:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*>\s*<\/iframe>$/;
const SRC_RE = /(?:^|\s)src=(["'])\/widgets\/([a-z0-9][a-z0-9-]*)\.html(?:[?#][^"']*)?\1/;
const TITLE_ATTR_RE = /(?:^|\s)title=(?:"([^"]*)"|'([^']*)')/;
const DOC_TITLE_RE = /<title>([^<]*)<\/title>/;
const WIDGETS = new URL('../../public/widgets/', import.meta.url);

// Caption text is placed inside an element, so tags must not survive; entities may.
const escapeText = (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;').trim();

function widgetTitle(name, file) {
	const path = new URL(`${name}.html`, WIDGETS);
	if (!existsSync(path)) {
		console.warn(`[figures] ${file ?? 'note'}: widget not found: /widgets/${name}.html`);
		return '';
	}
	return DOC_TITLE_RE.exec(readFileSync(path, 'utf8'))?.[1] ?? '';
}

function figure(line, file) {
	const m = IFRAME_RE.exec(line);
	const src = m && SRC_RE.exec(m[1]);
	if (!src) return null;
	const attr = TITLE_ATTR_RE.exec(m[1]);
	const caption = escapeText((attr && (attr[1] ?? attr[2])) || widgetTitle(src[2], file) || src[2]);
	return `<figure class="widget">${line}<figcaption>${caption}</figcaption></figure>`;
}

export function remarkWidgetFigures() {
	return (tree, vfile) => {
		const walk = (node) => {
			for (const child of node.children ?? []) {
				if (child.type !== 'html') {
					walk(child);
					continue;
				}
				// Adjacent iframes without a blank line between them arrive as one html node.
				const lines = child.value.split('\n').map((l) => l.trim()).filter(Boolean);
				const figures = lines.map((l) => figure(l, vfile?.path));
				if (figures.every(Boolean)) child.value = figures.join('\n');
				else if (child.value.includes('src="/widgets/'))
					console.warn(`[figures] ${vfile?.path ?? 'note'}: widget iframe not numbered (put it on its own line)`);
			}
		};
		walk(tree);
	};
}

const hasClass = (node, name) => node.properties?.className?.includes(name);
const hasTag = (node) => hasClass(node, 'tag') || (node.children ?? []).some((c) => c.type === 'element' && hasTag(c));

export function rehypeEquations() {
	return (tree) => {
		const walk = (node) => {
			const children = node.children ?? [];
			for (let i = 0; i < children.length; i++) {
				const child = children[i];
				if (child.type !== 'element') continue;
				if (hasClass(child, 'katex-display')) {
					// \tag{} already prints its own number.
					if (!hasTag(child)) {
						children[i] = { type: 'element', tagName: 'div', properties: { className: ['eq'] }, children: [child] };
					}
				} else walk(child);
			}
		};
		walk(tree);
	};
}

// Widgets run in an isolated frame: the widget HTML is inlined as srcdoc with
// sandbox="allow-scripts" (no allow-same-origin), so its scripts get an opaque origin and
// cannot touch the note page, its storage or its cookies. The frame cannot be measured from
// outside, so a small script reports the widget's height; the note page listens for it.
// Runs after rehypeHtmlGuard, which has already checked every iframe src.

// The frame's own policy, placed before any widget markup: inline code and data: images only,
// so a widget cannot load anything (the inherited page policy alone still allows the font CDN).
// (base-uri and form-action do not fall back to default-src, so they are listed.)
const WIDGET_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'">`;
const REPORT_HEIGHT = `<script>(()=>{const send=()=>{const b=document.body;if(!b)return;const s=getComputedStyle(b);parent.postMessage({studyWidgetHeight:Math.ceil(b.getBoundingClientRect().height+parseFloat(s.marginTop)+parseFloat(s.marginBottom))},'*')};addEventListener('load',send);if(document.body)new ResizeObserver(send).observe(document.body)})()</script>`;

export function rehypeWidgetSandbox() {
	return (tree) => {
		const walk = (node) => {
			for (const child of node.children ?? []) {
				if (child.type === 'element' && child.tagName === 'iframe') {
					const name = WIDGET_SRC.exec(String(child.properties?.src ?? ''))?.[1];
					if (!name) throw new Error(`widget iframe without a checked src: ${child.properties?.src}`);
					const html = readFileSync(new URL(`${name}.html`, WIDGETS), 'utf8');
					const at = html.search(/<\/body\s*>(?![\s\S]*<\/body\s*>)/i);
					const withReport = at < 0 ? html + REPORT_HEIGHT : html.slice(0, at) + REPORT_HEIGHT + html.slice(at);
					// Our own doctype, then the policy: the parser opens <head> for the meta and the widget's
					// own <html>/<head> tags merge into it, so the policy precedes every widget element.
					// The widget's leading doctype is dropped (only HTML's ASCII whitespace before it);
					// anything else up front, e.g. U+00A0, now lands after the policy instead of before it.
					const body = withReport.replace(/^[\t\n\f\r ]*<!doctype[^>]*>/i, '');
					const { src, ...rest } = child.properties;
					child.properties = {
						...rest,
						srcDoc: '<!doctype html>' + WIDGET_CSP + body,
						sandbox: 'allow-scripts',
						dataWidget: name,
					};
				} else walk(child);
			}
		};
		walk(tree);
	};
}
