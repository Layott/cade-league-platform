import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FontFamilyPicker } from "./FontFamilyPicker";

describe("FontFamilyPicker", () => {
  it("renders curated 4 plus uploaded names", () => {
    render(
      <FontFamilyPicker
        value="Agharti"
        uploaded={[{ id: "f1", familyName: "Custom Bold" }]}
        onChange={vi.fn()}
      />,
    );
    const select = screen.getByLabelText(/font family/i);
    const opts = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(opts).toEqual(
      expect.arrayContaining(["Agharti", "Quedora", "Inter", "JetBrains Mono", "Custom Bold"]),
    );
  });

  it("emits new family on change", () => {
    const onChange = vi.fn();
    render(
      <FontFamilyPicker value="Agharti" uploaded={[]} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText(/font family/i), {
      target: { value: "Inter" },
    });
    expect(onChange).toHaveBeenCalledWith("Inter");
  });

  it("groups custom fonts under their own optgroup", () => {
    render(
      <FontFamilyPicker
        value="Agharti"
        uploaded={[
          { id: "f1", familyName: "Custom Bold" },
          { id: "f2", familyName: "Display Sans" },
        ]}
        onChange={vi.fn()}
      />,
    );
    const groups = screen.getByLabelText(/font family/i).querySelectorAll("optgroup");
    expect(groups.length).toBe(2);
    expect(groups[0].getAttribute("label")).toMatch(/curated/i);
    expect(groups[1].getAttribute("label")).toMatch(/custom/i);
  });

  it("falls back to a flat list when uploaded is empty", () => {
    render(
      <FontFamilyPicker value="Agharti" uploaded={[]} onChange={vi.fn()} />,
    );
    const select = screen.getByLabelText(/font family/i);
    expect(select.querySelectorAll("optgroup").length).toBe(0);
    expect(select.querySelectorAll("option").length).toBe(4);
  });
});
