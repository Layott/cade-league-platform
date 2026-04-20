import { marked } from "marked";
import DOMPurify from "isomorphic-dompurify";

// Synchronous marked config — no remote fetches, no async extensions.
// DOMPurify strips <script>, event handlers, and dangerous URL schemes.
marked.setOptions({ async: false, gfm: true, breaks: true });

export function renderMarkdownToSafeHtml(bodyMd: string): string {
  if (!bodyMd) return "";
  const rawHtml = marked.parse(bodyMd) as string;
  return DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}
