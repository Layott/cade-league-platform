import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FontUploadForm } from "./FontUploadForm";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FontUploadForm", () => {
  it("renders file input + submit button", () => {
    const action = vi.fn();
    render(<FontUploadForm action={action as never} />);
    expect(screen.getByLabelText(/font file/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload font/i })).toBeInTheDocument();
  });

  it("disables submit when no file selected", () => {
    render(<FontUploadForm action={vi.fn() as never} />);
    const btn = screen.getByRole("button", { name: /upload font/i });
    expect(btn).toBeDisabled();
  });

  it("enables submit when file selected", async () => {
    render(<FontUploadForm action={vi.fn() as never} />);
    const file = new File(["fake ttf"], "Custom.ttf", { type: "font/ttf" });
    const input = screen.getByLabelText(/font file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    const btn = screen.getByRole("button", { name: /upload font/i });
    expect(btn).not.toBeDisabled();
  });

  it("shows error when oversize file selected", () => {
    render(<FontUploadForm action={vi.fn() as never} />);
    const big = new File([new ArrayBuffer(6 * 1024 * 1024)], "huge.ttf", {
      type: "font/ttf",
    });
    const input = screen.getByLabelText(/font file/i) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [big] } });
    expect(screen.getByRole("alert").textContent).toMatch(/5\s*MB/i);
  });
});
