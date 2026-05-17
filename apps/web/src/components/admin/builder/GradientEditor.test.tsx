import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { GradientEditor } from "./GradientEditor";

describe("GradientEditor", () => {
  it("renders None / Linear / Radial radio options", () => {
    render(<GradientEditor value={undefined} onChange={vi.fn()} />);
    expect(screen.getByLabelText(/none/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/linear/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/radial/i)).toBeInTheDocument();
  });

  it("emits a 2-stop linear gradient when Linear selected", () => {
    const onChange = vi.fn();
    render(<GradientEditor value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/linear/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "linear",
        angle: expect.any(Number),
        stops: expect.arrayContaining([
          expect.objectContaining({ offset: 0 }),
          expect.objectContaining({ offset: 1 }),
        ]),
      }),
    );
  });

  it("renders angle slider when value.kind === 'linear'", () => {
    render(
      <GradientEditor
        value={{
          kind: "linear",
          angle: 90,
          stops: [
            { offset: 0, color: "#000" },
            { offset: 1, color: "#fff" },
          ],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/angle/i)).toBeInTheDocument();
  });

  it("renders cx/cy/radius sliders when value.kind === 'radial'", () => {
    render(
      <GradientEditor
        value={{
          kind: "radial",
          cx: 0.5,
          cy: 0.5,
          radius: 0.5,
          stops: [
            { offset: 0, color: "#000" },
            { offset: 1, color: "#fff" },
          ],
        }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText(/^cx$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^cy$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^radius$/i)).toBeInTheDocument();
  });

  it("Add Stop adds a third stop interpolated between existing two", () => {
    const onChange = vi.fn();
    render(
      <GradientEditor
        value={{
          kind: "linear",
          angle: 0,
          stops: [
            { offset: 0, color: "#000" },
            { offset: 1, color: "#fff" },
          ],
        }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add stop/i }));
    const call = onChange.mock.calls.at(-1)![0];
    expect(call.stops.length).toBe(3);
  });

  it("setting kind back to none emits undefined", () => {
    const onChange = vi.fn();
    render(
      <GradientEditor
        value={{
          kind: "linear",
          angle: 0,
          stops: [
            { offset: 0, color: "#000" },
            { offset: 1, color: "#fff" },
          ],
        }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText(/none/i));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });
});
