import { type CollectionEntry, getCollection } from 'astro:content';
import { WIKILINK_RE, makeResolver, noteUrl, parseWikiTarget, stemOf, stripCode } from './vault.mjs';

type Entry = CollectionEntry<'notes'>;
type Published = Extract<Entry['data'], { publish: true }>;
export type Note = Omit<Entry, 'data'> & { data: Published };

export const urlOf = (note: Note) => noteUrl(note.id);
export const sectionOf = (note: Note) => note.id.split('/')[0];

const kstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' });

// "2026-10-31" in Korea time. A date without a time (UTC midnight) keeps its day;
// a date with a time is counted on its Korean calendar day, wherever the build runs.
export const ymd = (d: Date) => kstDate.format(d);

// Today in Korea, as "YYYY-MM-DD". Fixed at build time (the site is static).
export const todayKST = () => ymd(new Date());

/** Published notes, newest first. Notes without `publish: true` never reach a page. */
export async function getNotes(): Promise<Note[]> {
	const all = await getCollection('notes', ({ data }) => data.publish === true);
	return (all as Note[]).sort((a, b) => b.data.date.getTime() - a.data.date.getTime() || a.id.localeCompare(b.id));
}

export function makeLinker(notes: Note[]) {
	const resolve = makeResolver(
		notes.map((n) => {
			const file = (n.filePath ?? `${n.id}.md`).normalize('NFC').replace(/^vault\//, '');
			return { path: file.replace(/\.md$/i, ''), stem: stemOf(file), title: n.data.title, url: urlOf(n), note: n };
		}),
	);
	return (target: string): Note | null => resolve(target)?.note ?? null;
}

/** Notes this note points to, through `topics` or [[wikilinks]] in the body. */
export function outgoing(note: Note, link: (t: string) => Note | null): Set<Note> {
	const targets = [...note.data.topics];
	for (const m of stripCode(note.body ?? '').matchAll(WIKILINK_RE)) if (!m[1]) targets.push(parseWikiTarget(m[2]).target);
	const out = new Set<Note>();
	for (const t of targets) {
		const n = link(t);
		if (n && n.id !== note.id) out.add(n);
	}
	return out;
}

export function backlinks(target: Note, notes: Note[], link: (t: string) => Note | null): Note[] {
	return notes.filter((n) => n.id !== target.id && outgoing(n, link).has(target));
}
