import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FilterEditor } from "./FilterEditor";

describe("FilterEditor", () => {
  it("renders all eight sliders", () => {
    render(<FilterEditor value={undefined} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/^blur$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/brightness/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/hue rotate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/saturate/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^contrast$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^grayscale$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^sepia$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^invert$/i)).toBeInTheDocument();
  });

  it("starting blur slider from 0 stores filter.blur", () => {
    const onChange = vi.fn();
    render(<FilterEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/^blur$/i), { target: { value: "8" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ blur: 8 }));
  });

  it("hue rotate clamps to 0..360", () => {
    const onChange = vi.fn();
    render(<FilterEditor value={undefined} onChange={onChange} />);
    const input = screen.getByLabelText(/hue rotate/i) as HTMLInputElement;
    expect(input.max).toBe("360");
    expect(input.min).toBe("0");
  });

  it("contrast clamps to 0..200", () => {
    render(<FilterEditor value={undefined} onChange={vi.fn()} />);
    const input = screen.getByLabelText(/^contrast$/i) as HTMLInputElement;
    expect(input.max).toBe("200");
    expect(input.min).toBe("0");
  });

  it("grayscale / sepia / invert clamp to 0..100", () => {
    render(<FilterEditor value={undefined} onChange={vi.fn()} />);
    for (const label of [/^grayscale$/i, /^sepia$/i, /^invert$/i]) {
      const input = screen.getByLabelText(label) as HTMLInputElement;
      expect(input.max).toBe("100");
      expect(input.min).toBe("0");
    }
  });

  it("contrast slider stores filter.contrast", () => {
    const onChange = vi.fn();
    render(<FilterEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/^contrast$/i), { target: { value: "150" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ contrast: 150 }));
  });

  it("grayscale slider stores filter.grayscale", () => {
    const onChange = vi.fn();
    render(<FilterEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/^grayscale$/i), { target: { value: "60" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ grayscale: 60 }));
  });

  it("sepia slider stores filter.sepia", () => {
    const onChange = vi.fn();
    render(<FilterEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/^sepia$/i), { target: { value: "40" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ sepia: 40 }));
  });

  it("invert slider stores filter.invert", () => {
    const onChange = vi.fn();
    render(<FilterEditor value={undefined} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/^invert$/i), { target: { value: "75" } });
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ invert: 75 }));
  });

  it("Reset button emits undefined", () => {
    const onChange = vi.fn();
    render(<FilterEditor value={{ blur: 5 }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /reset filters/i }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
