import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { BuilderLibrary } from "./BuilderLibrary";
import type { Design } from "@/server/overlays/builder/types";

const designs: Design[] = [
  {
    id: "d1",
    slug: "scoreboard",
    title: "Scoreboard",
    mode: "single",
    status: "published",
    canvasWidth: 1920,
    canvasHeight: 1080,
    updatedAt: "2026-05-15T12:00:00Z",
    scenes: [],
  } as Design,
  {
    id: "d2",
    slug: "intro",
    title: "Intro Sequence",
    mode: "sequence",
    status: "draft",
    canvasWidth: 1920,
    canvasHeight: 1080,
    updatedAt: "2026-05-14T12:00:00Z",
    scenes: [],
  } as Design,
  {
    id: "d3",
    slug: "outro",
    title: "Outro",
    mode: "single",
    status: "draft",
    canvasWidth: 1920,
    canvasHeight: 1080,
    updatedAt: "2026-05-13T12:00:00Z",
    scenes: [],
  } as Design,
];

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

// createDesignAction accepts FormData — mock returns { id, slug }
const createDesignActionMock = vi.fn();
vi.mock("@/app/admin/broadcast/v2/builder/actions", () => ({
  createDesignAction: (...args: unknown[]) => createDesignActionMock(...args),
}));

describe("BuilderLibrary", () => {
  it("renders one card per design with title + status badge", () => {
    render(<BuilderLibrary designs={designs} />);
    expect(screen.getByText("Scoreboard")).toBeTruthy();
    expect(screen.getByText("Intro Sequence")).toBeTruthy();
    expect(screen.getByText("Outro")).toBeTruthy();
    expect(screen.getAllByText(/draft/i)).toHaveLength(2);
    expect(screen.getAllByText(/published/i)).toHaveLength(1);
  });

  it("clicking New Design opens the modal", () => {
    render(<BuilderLibrary designs={designs} />);
    fireEvent.click(screen.getByRole("button", { name: /new design/i }));
    expect(screen.getByLabelText("Title")).toBeTruthy();
    expect(screen.getByLabelText("Single")).toBeTruthy();
    expect(screen.getByLabelText("Sequence")).toBeTruthy();
  });

  it("submitting modal calls createDesignAction then pushes to edit route", async () => {
    createDesignActionMock.mockResolvedValueOnce({ id: "new-id", slug: "brand-new" });
    render(<BuilderLibrary designs={designs} />);
    fireEvent.click(screen.getByRole("button", { name: /new design/i }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Brand New" },
    });
    fireEvent.click(screen.getByLabelText("Sequence"));
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => {
      expect(createDesignActionMock).toHaveBeenCalled();
      // action receives FormData — verify slug-based redirect
      expect(pushMock).toHaveBeenCalledWith(
        "/admin/broadcast/v2/builder/brand-new/edit",
      );
    });
  });
});
