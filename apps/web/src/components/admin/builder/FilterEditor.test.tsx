import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterEditor } from "./FilterEditor";

describe("FilterEditor", () => {
  it("renders all four sliders", () => {
    render(<FilterEditor value={undefined} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/blur/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/brightness/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hue rotate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/saturate/i)).toBeInTheDocument();
  });

  it("starting blur slider from 0 stores filter.blur", () => {
    const onChange = vi.fn();
    render(<FilterEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/blur/i), { target: { value: "8" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ blur: 8 }));
  });

  it("hue rotate clamps to 0..360", () => {
    const onChange = vi.fn();
    render(<FilterEditor value={undefined} onChange={onChange} />);
    const input = screen.getByLabelText(/hue rotate/i) as HTMLInputElement;
    expect(input.max).toBe("360");
    expect(input.min).toBe("0");
  });

  it("Reset button emits undefined", () => {
    const onChange = vi.fn();
    render(<FilterEditor value={{ blur: 5 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /reset filters/i }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
