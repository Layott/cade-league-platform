import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { DownloadButtons } from "./DownloadButtons";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // jsdom doesn't ship URL.createObjectURL — stub it.
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:mock"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

function mockFetchOk(body = "binary") {
  const blob = new Blob([body]);
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    blob: async () => blob,
  });
}

describe("DownloadButtons", () => {
  it("renders one button per default variant", () => {
    render(<DownloadButtons />);
    expect(screen.getByTestId("download-leaderboard-xlsx")).toBeTruthy();
    expect(screen.getByTestId("download-leaderboard-docx")).toBeTruthy();
    expect(screen.getByTestId("download-metrics-xlsx")).toBeTruthy();
  });

  it("renders only the requested variants", () => {
    render(<DownloadButtons variants={["leaderboard-xlsx"]} />);
    expect(screen.getByTestId("download-leaderboard-xlsx")).toBeTruthy();
    expect(screen.queryByTestId("download-leaderboard-docx")).toBeNull();
  });

  it("hits /api/tournament/export with the right query string", async () => {
    const fetchSpy = mockFetchOk();
    vi.stubGlobal("fetch", fetchSpy);
    render(<DownloadButtons variants={["leaderboard-docx"]} />);
    fireEvent.click(screen.getByTestId("download-leaderboard-docx"));
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/tournament/export?type=leaderboard&format=docx",
        expect.any(Object),
      ),
    );
  });

  it("shows the error label on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "internal",
      }),
    );
    render(<DownloadButtons variants={["leaderboard-xlsx"]} />);
    fireEvent.click(screen.getByTestId("download-leaderboard-xlsx"));
    await waitFor(() =>
      expect(screen.getByTestId("download-error")).toBeTruthy(),
    );
  });

  it("changes label to 'Generating...' while in flight", async () => {
    let resolveFn!: (v: { ok: true; blob: () => Blob }) => void;
    const pending = new Promise<{ ok: true; blob: () => Blob }>((resolve) => {
      resolveFn = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => pending),
    );
    render(<DownloadButtons variants={["leaderboard-xlsx"]} />);
    fireEvent.click(screen.getByTestId("download-leaderboard-xlsx"));
    await waitFor(() =>
      expect(
        screen.getByTestId("download-leaderboard-xlsx").textContent,
      ).toMatch(/Generating/),
    );
    resolveFn({
      ok: true,
      blob: () => new Blob(["ok"]),
    });
  });
});
