// Turns Obsidian [[wikilinks]] into links to published notes.
// Links to missing or unpublished notes become plain text (class "wikilink-missing").
// Embeds (![[...]]) are left as written for now.
import { WIKILINK_RE, headingAnchor, makeResolver, parseWikiTarget, scanVault } from '../lib/vault.mjs';

export default function remarkWikilinks() {
	return (tree) => {
		const resolve = makeResolver(scanVault());
		walk(tree, resolve);
	};
}

function walk(node, resolve) {
	if (!node.children || node.type === 'link') return;
	const out = [];
	for (const child of node.children) {
		if (child.type === 'text' && child.value.includes('[[')) out.push(...split(child.value, resolve));
		else {
			walk(child, resolve);
			out.push(child);
		}
	}
	node.children = out;
}

function split(value, resolve) {
	const nodes = [];
	let last = 0;
	for (const m of value.matchAll(WIKILINK_RE)) {
		if (m.index > last) nodes.push({ type: 'text', value: value.slice(last, m.index) });
		last = m.index + m[0].length;
		if (m[1]) {
			nodes.push({ type: 'text', value: m[0] });
			continue;
		}
		const { target, heading, alias } = parseWikiTarget(m[2]);
		const label = alias || [target, heading].filter(Boolean).join(' › ');
		const note = target ? resolve(target) : null;
		const hash = heading ? `#${headingAnchor(heading)}` : '';
		if (note || !target) {
			nodes.push({
				type: 'link',
				url: (note ? note.url : '') + hash,
				data: { hProperties: { className: ['wikilink'] } },
				children: [{ type: 'text', value: label }],
			});
		} else {
			nodes.push({
				type: 'wikilinkMissing',
				data: { hName: 'span', hProperties: { className: ['wikilink-missing'] }, hChildren: [{ type: 'text', value: label }] },
			});
		}
	}
	if (last < value.length) nodes.push({ type: 'text', value: value.slice(last) });
	return nodes;
}
