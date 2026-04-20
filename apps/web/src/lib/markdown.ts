// Thin re-export so consumers can import from a generic "@/lib/markdown"
// path. The implementation lives in the announcements server module to keep
// the rendering pipeline co-located with the feature that owns the security
// surface (DOMPurify allow-list tuned for announcement content).
export { renderMarkdownToSafeHtml } from "@/server/announcements/render";
