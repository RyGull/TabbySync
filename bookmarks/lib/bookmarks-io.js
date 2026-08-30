// bookmarks-io.js — build/parse the Netscape bookmark HTML format that all
// browsers import/export. Pure (no chrome APIs), Node-testable.
//
// Model node: { type:'folder'|'bookmark', title, url?, children? }
// A root model is { type:'folder', title:'', children:[ barFolder, otherFolder ] }.

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function decode(s) {
  return String(s == null ? '' : s)
    .replace(/&quot;/gi, '"').replace(/&#0?39;/g, "'").replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
}

// --- build ------------------------------------------------------------------
export function buildHtml(rootModel) {
  const lines = [];
  function emit(children, depth) {
    const pad = '    '.repeat(depth);
    for (const n of children || []) {
      if (n.type === 'folder') {
        lines.push(`${pad}<DT><H3>${esc(n.title)}</H3>`);
        lines.push(`${pad}<DL><p>`);
        emit(n.children, depth + 1);
        lines.push(`${pad}</DL><p>`);
      } else {
        lines.push(`${pad}<DT><A HREF="${esc(n.url)}">${esc(n.title)}</A>`);
      }
    }
  }
  const head = [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
  ];
  emit(rootModel.children, 1);
  return head.join('\n') + '\n' + lines.join('\n') + '\n</DL><p>\n';
}

// --- parse ------------------------------------------------------------------
// Returns an array of top-level model nodes.
export function parseNetscape(html) {
  const root = { type: 'folder', title: '', children: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  let lastFolder = null;

  const re = /<DL[^>]*>|<\/DL>|<H3[^>]*>([\s\S]*?)<\/H3>|<A\s+([^>]*?)>([\s\S]*?)<\/A>/gi;
  let m;
  while ((m = re.exec(html))) {
    const tok = m[0];
    if (/^<DL/i.test(tok)) {
      stack.push(lastFolder || top());
      lastFolder = null;
    } else if (/^<\/DL/i.test(tok)) {
      if (stack.length > 1) stack.pop();
    } else if (m[1] !== undefined) { // <H3> folder
      const folder = { type: 'folder', title: decode(m[1]).trim(), children: [] };
      top().children.push(folder);
      lastFolder = folder;
    } else { // <A> bookmark
      const attrs = m[2] || '';
      const title = decode(m[3]).trim();
      const href = (attrs.match(/HREF\s*=\s*"([^"]*)"/i) || attrs.match(/HREF\s*=\s*'([^']*)'/i) || [])[1];
      if (href) top().children.push({ type: 'bookmark', title, url: decode(href) });
    }
  }
  return root.children;
}
