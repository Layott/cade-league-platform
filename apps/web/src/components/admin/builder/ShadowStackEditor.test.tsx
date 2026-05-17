import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShadowStackEditor } from "./ShadowStackEditor";

describe("ShadowStackEditor", () => {
  it("renders empty-state when no shadows", () => {
    render(<ShadowStackEditor value={undefined} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /add shadow/i })).toBeInTheDocument();
  });

  it("Add Shadow seeds first entry", () => {
    const onChange = vi.fn();
    render(<ShadowStackEditor value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add shadow/i }));
    const arg = onChange.mock.calls.at(-1)![0];
    expect(Array.isArray(arg)).toBe(true);
    expect((arg as unknown[]).length).toBe(1);
  });

  it("Remove deletes a shadow at index", () => {
    const onChange = vi.fn();
    render(
      <ShadowStackEditor
        value={[
          { offsetX: 2, offsetY: 2, blur: 4, color: "#000", opacity: 0.5 },
          { offsetX: -2, offsetY: -2, blur: 4, color: "#fff", opacity: 0.5 },
        ]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /remove/i })[0]);
    const arg = onChange.mock.calls.at(-1)![0] as unknown[];
    expect(arg.length).toBe(1);
  });

  it("blocks adding more than 8 shadows", () => {
    const onChange = vi.fn();
    const filled = Array.from({ length: 8 }, () => ({
      offsetX: 0, offsetY: 0, blur: 4, color: "#000", opacity: 0.5,
    }));
    render(<ShadowStackEditor value={filled} onChange={onChange} />);
    const addBtn = screen.getByRole("button", { name: /add shadow/i });
    expect(addBtn).toBeDisabled();
  });

  it("changing offsetX patches the right shadow index", () => {
    const onChange = vi.fn();
    render(
      <ShadowStackEditor
        value={[{ offsetX: 0, offsetY: 0, blur: 4, color: "#000", opacity: 0.5 }]}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText(/shadow 1 offset x/i), {
      target: { value: "10" },
    });
    const arg = onChange.mock.calls.at(-1)![0] as Array<{ offsetX: number }>;
    expect(arg[0].offsetX).toBe(10);
  });
});
