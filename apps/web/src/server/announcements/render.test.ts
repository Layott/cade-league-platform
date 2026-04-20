import { describe, it, expect } from "vitest";
import { renderMarkdownToSafeHtml } from "./render";

describe("renderMarkdownToSafeHtml", () => {
  it("renders basic markdown to HTML", () => {
    const html = renderMarkdownToSafeHtml("# Hello\n\n**bold** body.");
    expect(html).toContain("<h1");
    expect(html).toContain("Hello");
    expect(html).toContain("<strong>bold</strong>");
  });

  it("strips <script> tags", () => {
    const html = renderMarkdownToSafeHtml("Hi <script>alert('x')</script> bye");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("alert(");
  });

  it("strips javascript: URLs in links", () => {
    const html = renderMarkdownToSafeHtml("[click](javascript:alert(1))");
    expect(html).not.toMatch(/href=["']javascript:/i);
  });

  it("keeps safe links", () => {
    const html = renderMarkdownToSafeHtml("[docs](https://example.com)");
    expect(html).toMatch(/href=["']https:\/\/example\.com["']/);
  });

  it("returns empty string on empty input", () => {
    expect(renderMarkdownToSafeHtml("")).toBe("");
  });
});
