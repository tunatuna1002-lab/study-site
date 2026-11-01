import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { parseFragment } from 'parse5';

const parser = unified().use(remarkParse);
const tags = new Set('a abbr b blockquote br caption code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i iframe img kbd li mark ol p pre s samp small span strong sub summary sup table tbody td th thead tr ul'.split(' '));
const attributes = new Set('alt class colspan height href id lang loading open rel role rowspan scope src style target title width'.split(' '));
const imagePath = /^\/(?:attachments|vault\/attachments)\/[A-Za-z0-9_\-./%\p{L} ]+\.(?:png|jpe?g|gif|webp)$/iu;
const widgetPath = /^\/widgets\/[a-z0-9][a-z0-9-]*\.html$/;
const safeLink = (value) => !/[\u0000-\u0020\u007f]/.test(value) && /^(?:https?:\/\/|mailto:|#[^\s]*$|\/(?!\/)|\.\.?\/)/i.test(value);

// Parse Markdown first: literal HTML in code fences/inline code must remain valid examples.
// Parse HTML attributes rather than searching strings, including decoded character references.
export function markdownHtmlErrors(markdown) {
  const errors = new Set();
  function html(node, line) {
    if (node.tagName) {
      if (!tags.has(node.tagName)) errors.add(`${line}줄: 허용하지 않는 HTML <${node.tagName}>`);
      const attrs = Object.fromEntries((node.attrs ?? []).map((a) => [a.name, a.value]));
      for (const [name, value] of Object.entries(attrs)) {
        if (!attributes.has(name) && !/^aria-[a-z-]+$/.test(name)) errors.add(`${line}줄: 허용하지 않는 HTML 속성 ${name}`);
        if (name === 'href' && !safeLink(value)) errors.add(`${line}줄: 안전하지 않은 HTML 링크`);
        if (name === 'src' && !(node.tagName === 'iframe' ? widgetPath.test(value) : node.tagName === 'img' && imagePath.test(value))) errors.add(`${line}줄: 허용하지 않는 HTML 리소스`);
        if (name === 'style' && !/^\s*(?:(?:border\s*:\s*0|width\s*:\s*100%|height\s*:\s*\d+px)\s*;?\s*)*$/.test(value)) errors.add(`${line}줄: 허용하지 않는 인라인 스타일`);
      }
      if (node.tagName === 'iframe' && !widgetPath.test(attrs.src ?? '')) errors.add(`${line}줄: iframe은 /widgets/<이름>.html만 허용`);
    }
    for (const child of node.childNodes ?? []) html(child, line);
    if (node.content) html(node.content, line);
  }
  function visit(node) {
    const line = node.position?.start.line ?? 1;
    if (node.type === 'html') html(parseFragment(node.value), line);
    if (['link', 'definition'].includes(node.type) && !safeLink(node.url)) errors.add(`${line}줄: 안전하지 않은 Markdown 링크`);
    for (const child of node.children ?? []) visit(child);
  }
  visit(parser.parse(markdown));
  return [...errors];
}
