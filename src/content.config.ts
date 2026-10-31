import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { SECTIONS, noteId, unwrapWikilink } from './lib/vault.mjs';

const published = z.object({
	title: z.string(),
	type: z.enum(['session', 'concept', 'essay']),
	date: z.coerce.date(),
	minutes: z.number().int().nonnegative().optional(),
	topics: z
		.array(z.string())
		.default([])
		.transform((topics) => topics.map(unwrapWikilink)),
	stage: z.array(z.number().int().min(0).max(8)).default([]),
	status: z.enum(['todo', 'doing', 'done']).optional(),
	publish: z.literal(true),
	source: z.string().optional(),
	original: z.string().url().optional(),
});

const draft = z.object({ publish: z.literal(false) });

const notes = defineCollection({
	// Reads the Obsidian vault: only .md files, only in the published sections.
	loader: glob({
		base: './vault',
		pattern: `{${SECTIONS.join(',')}}/**/*.md`,
		generateId: ({ entry }) => noteId(entry),
	}),
	// Drafts (publish missing or not true) are reduced to { publish: false } before
	// validation, so a half-written note in Obsidian never breaks the build.
	schema: z.preprocess(
		(data: any) => (data?.publish === true ? data : { publish: false }),
		z.union([published, draft]),
	),
});

export const collections = { notes };
