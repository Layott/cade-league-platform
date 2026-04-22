import { describe, expect, it, vi } from "vitest";
import { fetchSofifa, fetchSofifaPage, parseSofifaHtml } from "./sofifa";

const SAMPLE_ROW = (id: number, name: string, rating: number, pos = "CAM") => `
  <tr data-player="${id}">
    <td><a href="/player/${id}/l-messi/25_0000">${name}</a></td>
    <td><span class="pos pos-CAM">${pos}</span></td>
    <td>${rating}</td>
    <td><a href="/team/240/inter-miami">Inter Miami</a></td>
    <td><img src="/flags/ar.png" alt="Argentina"></td>
  </tr>
`;

describe("parseSofifaHtml", () => {
  it("parses a single row into NormalizedFCRow shape", () => {
    const html = `<table>${SAMPLE_ROW(158023, "L. Messi", 94)}</table>`;
    const rows = parseSofifaHtml(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      source_dataset: "sofifa.com",
      source_row_id: "158023",
      name: "L. Messi",
      slug: "l_messi",
      rating: 94,
      position: "CAM",
      club: "Inter Miami",
      nation: "Argentina",
      item_type: "normal",
    });
  });

  it("parses multiple rows + drops broken ones silently", () => {
    const html = `
      <table>
        ${SAMPLE_ROW(1, "A Player", 88)}
        <tr data-player="2"><td>broken row no anchor</td></tr>
        ${SAMPLE_ROW(3, "Third", 76)}
      </table>
    `;
    const rows = parseSofifaHtml(html);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.source_row_id)).toEqual(["1", "3"]);
  });

  it("returns [] on empty / malformed HTML", () => {
    expect(parseSofifaHtml("")).toEqual([]);
    expect(parseSofifaHtml("<html><body>no rows</body></html>")).toEqual([]);
  });
});

describe("fetchSofifaPage", () => {
  it("issues a GET with a sofifa UA and returns text", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response("<html>raw</html>", { status: 200 }),
    );
    const html = await fetchSofifaPage(0, 60, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(html).toBe("<html>raw</html>");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("offset=0&limit=60");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/CADE-FC26-Refresh/);
  });

  it("throws on non-2xx", async () => {
    const fetchImpl = vi.fn(
      async (_url: string, _init?: RequestInit) => new Response("nope", { status: 503 }),
    );
    await expect(
      fetchSofifaPage(0, 60, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/HTTP 503/);
  });
});

describe("fetchSofifa (top-level)", () => {
  it("walks pages + stops early on empty page", async () => {
    const pages = [
      SAMPLE_ROW(1, "One", 80),
      SAMPLE_ROW(2, "Two", 81),
      "",
    ];
    let page = 0;
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      const body = `<table>${pages[page]}</table>`;
      page += 1;
      return new Response(body, { status: 200 });
    });
    const sleepImpl = vi.fn(async (_ms: number) => {});
    const out = await fetchSofifa({
      pages: 3,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleepImpl,
    });
    if (!out.skipped) {
      // Pages 1 & 2 yielded rows; page 3 (index 2) empty → loop stops.
      expect(out.rows).toHaveLength(2);
    }
    // Between 3 requests there are 2 inter-request sleeps.
    expect(sleepImpl).toHaveBeenCalledTimes(2);
  });
});
