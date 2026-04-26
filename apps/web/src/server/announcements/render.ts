import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

marked.setOptions({ async: false, gfm: true, breaks: true });

const SAFE_OPTS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "br", "hr",
    "strong", "em", "del", "code", "pre", "blockquote",
    "ul", "ol", "li",
    "a", "img",
    "table", "thead", "tbody", "tr", "th", "td",
    "span", "div",
  ],
  allowedAttributes: {
    a: ["href", "title", "rel", "target"],
    img: ["src", "alt", "title", "width", "height"],
    "*": ["class"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
  transformTags: {
    a: sanitizeHtml.simpleTransform("a", { rel: "noopener noreferrer", target: "_blank" }),
  },
};

export function renderMarkdownToSafeHtml(bodyMd: string): string {
  if (!bodyMd) return "";
  const rawHtml = marked.parse(bodyMd) as string;
  return sanitizeHtml(rawHtml, SAFE_OPTS);
}
