// Shared helpers for reading the Obsidian vault.
// Plain JS so both astro.config.mjs (remark plugin) and pages can import it.
import fs from 'node:fs';
import path from 'node:path';
import { slug } from 'github-slugger';

export const VAULT_DIR = 'vault';
export const SECTIONS = ['sessions', 'concepts', 'essays'];

const key = (s) => s.normalize('NFC').trim().toLowerCase();

// "concepts/딥러닝 학습 과정 지도.md" -> "concepts/딥러닝-학습-과정-지도"
export function noteId(relPath) {
	return relPath
		.normalize('NFC')
		.replace(/\.md$/i, '')
		.split('/')
		.map((part) => slug(part))
		.join('/');
}

export const noteUrl = (id) => `/${id}/`;

export const stemOf = (filePath) => path.basename(filePath.normalize('NFC'), '.md');

// "note#heading|alias" -> { target, heading, alias }
export function parseWikiTarget(raw) {
	const [ref, alias] = raw.split('|');
	const [target, heading] = ref.split('#');
	return { target: target.trim(), heading: heading?.trim() || '', alias: alias?.trim() || '' };
}

// "[[DUST]]" -> "DUST"
export const unwrapWikilink = (s) => parseWikiTarget(s.replace(/^\s*\[\[|\]\]\s*$/g, '')).target;

export const headingAnchor = (heading) => slug(heading);

// notes: { stem, title, url }[]; looks a link up by file name first, then by title.
export function makeResolver(notes) {
	const map = new Map();
	for (const n of notes) map.set(key(n.stem), n);
	for (const n of notes) if (n.title && !map.has(key(n.title))) map.set(key(n.title), n);
	return (target) => (target ? (map.get(key(target)) ?? null) : null);
}

export const WIKILINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;

// Published notes read straight from disk, for code that runs outside astro:content.
export function scanVault(root = process.cwd()) {
	const notes = [];
	for (const section of SECTIONS) {
		const dir = path.join(root, VAULT_DIR, section);
		if (!fs.existsSync(dir)) continue;
		for (const rel of fs.readdirSync(dir, { recursive: true })) {
			if (!rel.endsWith('.md')) continue;
			const text = fs.readFileSync(path.join(dir, rel), 'utf8');
			const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
			if (!/^publish:\s*true\s*$/m.test(fm)) continue;
			const title = fm.match(/^title:\s*["']?(.*?)["']?\s*$/m)?.[1];
			const relPath = `${section}/${rel.split(path.sep).join('/')}`;
			notes.push({ stem: stemOf(relPath), title, url: noteUrl(noteId(relPath)) });
		}
	}
	return notes;
}
