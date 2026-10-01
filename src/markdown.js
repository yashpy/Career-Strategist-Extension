// Tiny, dependency-free Markdown -> HTML renderer. Escapes HTML first, so it is
// safe to inject the result with innerHTML. Supports headings, bold, italic,
// inline code, fenced code blocks, unordered/ordered lists, hr and paragraphs.

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inline(text) {
  // inline code first so ** inside code isn't touched
  let out = escapeHtml(text);
  out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  return out;
}

export function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let html = "";
  let i = 0;
  let listType = null; // 'ul' | 'ol' | null

  const closeList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code block
    if (/^```/.test(line)) {
      closeList();
      const fenceLang = line.replace(/^```/, "").trim();
      let code = "";
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        code += lines[i] + "\n";
        i++;
      }
      i++; // skip closing fence
      html += `<pre class="code-block" data-lang="${escapeHtml(fenceLang)}"><code>${escapeHtml(code)}</code></pre>`;
      continue;
    }

    // headings
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      closeList();
      const level = h[1].length;
      html += `<h${level}>${inline(h[2])}</h${level}>`;
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      closeList();
      html += "<hr/>";
      i++;
      continue;
    }

    // unordered list
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (listType !== "ul") {
        closeList();
        html += "<ul>";
        listType = "ul";
      }
      html += `<li>${inline(ul[1])}</li>`;
      i++;
      continue;
    }

    // ordered list
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listType !== "ol") {
        closeList();
        html += "<ol>";
        listType = "ol";
      }
      html += `<li>${inline(ol[1])}</li>`;
      i++;
      continue;
    }

    // blank line
    if (/^\s*$/.test(line)) {
      closeList();
      i++;
      continue;
    }

    // paragraph
    closeList();
    html += `<p>${inline(line)}</p>`;
    i++;
  }

  closeList();
  return html;
}
