const ALLOWED_TAGS = new Set([
  "h2",
  "h3",
  "p",
  "strong",
  "em",
  "ul",
  "ol",
  "li",
  "blockquote",
  "a",
]);

function sanitizeHref(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "#";
  if (/^(javascript:|data:)/i.test(trimmed)) return "#";
  return trimmed;
}

export function sanitizeRichHtml(input) {
  let html = String(input || "");

  html = html
    .replace(/<!--([\s\S]*?)-->/g, "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  html = html.replace(/<\/?([a-z0-9-]+)([^>]*)>/gi, (full, rawTag, rawAttrs) => {
    const tag = String(rawTag || "").toLowerCase();
    const isClosing = full.startsWith("</");

    if (!ALLOWED_TAGS.has(tag)) {
      return "";
    }

    if (isClosing) {
      return `</${tag}>`;
    }

    if (tag !== "a") {
      return `<${tag}>`;
    }

    const attrs = String(rawAttrs || "");
    const hrefMatch = attrs.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const href = sanitizeHref(hrefMatch?.[2] || hrefMatch?.[3] || hrefMatch?.[4] || "#");

    return `<a href="${href}" target="_blank" rel="noopener noreferrer">`;
  });

  return html.trim();
}
