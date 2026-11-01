// @ts-check

import { unified } from '@astrojs/markdown-remark';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';
import { rehypeEquations, remarkWidgetFigures } from './src/plugins/figures.mjs';
import remarkWikilinks from './src/plugins/remark-wikilinks.mjs';

// https://astro.build/config
export default defineConfig({
	site: 'https://study-site-5po.pages.dev',
	integrations: [sitemap()],
	markdown: {
		// remark/rehype pipeline (Astro 7's default processor does not run remark plugins)
		processor: unified({
			remarkPlugins: [remarkMath, remarkWikilinks, remarkWidgetFigures],
			rehypePlugins: [rehypeKatex, rehypeEquations],
		}),
		shikiConfig: {
			themes: { light: 'github-light', dark: 'github-dark' },
		},
	},
});
