// Shared helpers for reading the Obsidian vault.
// Plain JS so both astro.config.mjs (remark plugin) and pages can import it.
import fs from 'node:fs';
import path from 'node:path';
import { slug } from 'github-slugger';
import { load as loadYaml } from 'js-yaml';

export const VAULT_DIR = 'vault';
export const SECTIONS = ['sessions', 'concepts', 'essays'];

const nfc = (s) => s.normalize('NFC');
const key = (s) => nfc(s).trim().toLowerCase();
const stripMd = (p) => p.replace(/\.md$/i, '');

// "concepts/딥러닝 학습 과정 지도.md" -> "concepts/딥러닝-학습-과정-지도"
export function noteId(relPath) {
	return stripMd(nfc(relPath))
		.split('/')
		.map((part) => slug(part))
		.join('/');
}

export const noteUrl = (id) => `/${id}/`;

export const stemOf = (filePath) => stripMd(path.basename(nfc(filePath)));

// "note#heading|alias" -> { target, heading, alias }. Inside tables Obsidian writes "note\|alias".
export function parseWikiTarget(raw) {
	const [ref, ...rest] = nfc(raw).split(/\\?\|/);
	const [target, heading] = ref.split('#');
	return { target: target.trim(), heading: heading?.trim() || '', alias: rest.join('|').trim() };
}

// "[[DUST]]" -> "DUST"
export const unwrapWikilink = (s) => parseWikiTarget(s.replace(/^\s*\[\[|\]\]\s*$/g, '')).target;

export const headingAnchor = (heading) => slug(nfc(heading));

// notes: { path, stem, title, url }[], where path is "concepts/DUST" (vault-relative, no extension).
// A link is looked up by vault path, then file name, then title. Notes are sorted by path so
// that every caller resolves duplicate names to the same note.
export function makeResolver(notes) {
	const sorted = [...notes].sort((a, b) => a.path.localeCompare(b.path));
	const map = new Map();
	for (const field of ['path', 'stem', 'title']) {
		for (const n of sorted) if (n[field] && !map.has(key(n[field]))) map.set(key(n[field]), n);
	}
	return (target) => (target ? (map.get(key(target)) ?? null) : null);
}

export const WIKILINK_RE = /(!?)\[\[([^[\]\n]+?)\]\]/g;

// Removes code and math, where [[...]] is not a link.
export const stripCode = (md) =>
	md
		.replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
		.replace(/`[^`\n]*`/g, '')
		.replace(/\$\$[\s\S]*?\$\$/g, '')
		.replace(/\$[^$\n]*\$/g, '');

export function readFrontmatter(text) {
	const fm = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
	if (!fm) return {};
	try {
		return loadYaml(fm) ?? {};
	} catch {
		return {};
	}
}

// Published notes read straight from disk, for code that runs outside astro:content.
export function scanVault(root = process.cwd()) {
	const notes = [];
	for (const section of SECTIONS) {
		const dir = path.join(root, VAULT_DIR, section);
		if (!fs.existsSync(dir)) continue;
		for (const rel of fs.readdirSync(dir, { recursive: true })) {
			if (!/\.md$/i.test(rel)) continue;
			const data = readFrontmatter(fs.readFileSync(path.join(dir, rel), 'utf8'));
			if (data.publish !== true) continue;
			const relPath = nfc(`${section}/${rel.split(path.sep).join('/')}`);
			notes.push({
				path: stripMd(relPath),
				stem: stemOf(relPath),
				title: typeof data.title === 'string' ? data.title : undefined,
				url: noteUrl(noteId(relPath)),
			});
		}
	}
	return notes;
}
