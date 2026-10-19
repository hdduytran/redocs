// Markdown -> HTML with ReDocs extensions:
//   [text](page:chapter/page#anchor)   cross-page link (validated by check)
//   ![alt](asset:screenshots/x.png)    book asset
//   [[svc:billing]] / [[svc:billing|label]]  entity chip
//   ```redocs-embed {"artifact": "id", "height": 640, "caption": "..."} ```  artifact embed
// Headings get stable ids; h2/h3 feed the page TOC.

import MarkdownIt from 'markdown-it';
import { diagnostic } from './shared-helpers.mjs';
import { renderEmbed, renderEntityChip, resolveReference } from './render-redocs-references.mjs';
import { slugAllocator } from './site-paths-and-urls.mjs';

const ENTITY_REF = /^\[\[([a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*)(?:\|([^\]\n]+))?\]\]/;

function entityInlineRule(state, silent) {
  if (state.src.charCodeAt(state.pos) !== 0x5b || state.src.charCodeAt(state.pos + 1) !== 0x5b) return false;
  const match = ENTITY_REF.exec(state.src.slice(state.pos));
  if (!match) return false;
  if (!silent) {
    const token = state.push('redocs_entity', '', 0);
    token.meta = { id: match[1], label: match[2]?.trim() };
  }
  state.pos += match[0].length;
  return true;
}

function inlineText(token) {
  return (token.children || []).filter((c) => c.type === 'text' || c.type === 'code_inline').map((c) => c.content).join('');
}

function createMarkdown() {
  const md = new MarkdownIt({ html: true, linkify: false, typographer: false });
  md.inline.ruler.before('link', 'redocs_entity', entityInlineRule);

  md.renderer.rules.redocs_entity = (tokens, idx, _options, env) => {
    const { id, label, line } = tokens[idx].meta;
    return renderEntityChip(env.ctx, id, label, line);
  };

  // Resolve references and assign heading ids in one pass over the token stream.
  md.core.ruler.push('redocs_references', (state) => {
    const { ctx } = state.env;
    const nextSlug = slugAllocator();
    state.env.headings = [];
    state.tokens.forEach((token, index) => {
      const line = token.map ? token.map[0] + 1 : undefined;
      if (token.type === 'heading_open') {
        const text = inlineText(state.tokens[index + 1]);
        const id = nextSlug(text);
        token.attrSet('id', id);
        // `line` (0-based source line) lets the agent index cut the source into sections.
        state.env.headings.push({ level: Number(token.tag.slice(1)), text, id, line: token.map ? token.map[0] : undefined });
      }
      if (token.type !== 'inline' || !token.children) return;
      for (const child of token.children) {
        if (child.type === 'link_open') {
          const href = decodeURI(child.attrGet('href') || '');
          child.attrSet('href', resolveReference(ctx, href, line));
        } else if (child.type === 'image') {
          const src = decodeURI(child.attrGet('src') || '');
          child.attrSet('src', resolveReference(ctx, src, line));
          child.attrSet('loading', 'lazy');
        } else if (child.type === 'redocs_entity') {
          child.meta.line = line;
        }
      }
    });
  });

  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    if (token.info.trim() !== 'redocs-embed') return defaultFence(tokens, idx, options, env, self);
    const line = token.map ? token.map[0] + 1 : undefined;
    let spec;
    try {
      spec = JSON.parse(token.content);
    } catch (error) {
      env.ctx.diagnostics.push(diagnostic('RD007', 'error', `redocs-embed block is not valid JSON: ${error.message}`, { file: env.ctx.sourceFile, line }));
      return '<div class="rd-embed rd-embed--missing" role="note">Invalid embed block</div>';
    }
    return renderEmbed(env.ctx, spec, line);
  };

  // Tables scroll horizontally on small screens instead of breaking the layout.
  md.renderer.rules.table_open = () => '<div class="rd-table-wrap"><table>\n';
  md.renderer.rules.table_close = () => '</table></div>\n';
  return md;
}

let shared;

/** @returns {{html: string, headings: Array<{level:number,text:string,id:string,line?:number}>}} */
export function renderMarkdown(source, ctx) {
  shared ||= createMarkdown();
  const env = { ctx };
  const html = shared.render(source, env);
  return { html, headings: env.headings };
}
