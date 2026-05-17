import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ManualBindEditor } from "./ManualBindEditor";

describe("ManualBindEditor", () => {
  it("renders feed dropdown with 7 options", () => {
    render(<ManualBindEditor value={null} onChange={vi.fn()} onClear={vi.fn()} />);
    const select = screen.getByLabelText(/feed/i);
    expect(select.querySelectorAll("option").length).toBe(7);
  });

  it("renders empty fieldPath input when no binding", () => {
    render(<ManualBindEditor value={null} onChange={vi.fn()} onClear={vi.fn()} />);
    const input = screen.getByLabelText(/field path/i) as HTMLInputElement;
    expect(input.value).toBe("");
  });

  it("typing valid path emits new Binding with same feed", () => {
    const onChange = vi.fn();
    render(
      <ManualBindEditor
        value={{ feed: "standings", fieldPath: "" }}
        onChange={onChange}
        onClear={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/field path/i), {
      target: { value: "[0].name" },
    });
    expect(onChange).toHaveBeenLastCalledWith({
      feed: "standings",
      fieldPath: "[0].name",
    });
  });

  it("invalid templateString surfaces inline error", () => {
    const onChange = vi.fn();
    render(
      <ManualBindEditor
        value={{ feed: "standings", fieldPath: "[0].name" }}
        onChange={onChange}
        onClear={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/template string/i), {
      target: { value: "${eval(alert(1))}" },
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("Clear binding triggers onClear", () => {
    const onClear = vi.fn();
    render(
      <ManualBindEditor
        value={{ feed: "standings", fieldPath: "[0].name" }}
        onChange={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /clear binding/i }));
    expect(onClear).toHaveBeenCalled();
  });

  it("shows resolved preview from mock data", () => {
    render(
      <ManualBindEditor
        value={{
          feed: "standings",
          fieldPath: "[0].name",
          templateString: "RANK 1: ${standings[0].name}",
        }}
        onChange={vi.fn()}
        onClear={vi.fn()}
      />,
    );
    // Mock data shape exposed by the editor includes a sample first
    // standings name; preview should non-emptily render.
    const preview = screen.getByTestId("manual-bind-preview");
    expect(preview.textContent ?? "").toMatch(/RANK 1/);
  });
});
