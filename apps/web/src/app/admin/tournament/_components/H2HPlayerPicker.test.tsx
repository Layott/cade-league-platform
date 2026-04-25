import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { H2HPlayerPicker, type PickerPlayer } from "./H2HPlayerPicker";

afterEach(() => cleanup());

const PLAYERS: PickerPlayer[] = [
  { id: "p1", name: "Alpha", gamerTag: "ALPHA" },
  { id: "p2", name: "Beta", gamerTag: "BETA" },
  { id: "p3", name: "Gamma", gamerTag: "GAMMA" },
  { id: "p4", name: "Delta", gamerTag: "DELTA" },
  { id: "p5", name: "Epsilon", gamerTag: "EPSILON" },
  { id: "p6", name: "Zeta", gamerTag: "ZETA" },
];

describe("H2HPlayerPicker", () => {
  it("renders one chip per player", () => {
    render(
      <H2HPlayerPicker players={PLAYERS} selected={[]} onChange={vi.fn()} />,
    );
    for (const p of PLAYERS) {
      expect(screen.getByTestId(`h2h-pick-${p.gamerTag}`)).toBeTruthy();
    }
  });

  it("emits onChange with the new selection on click", () => {
    const onChange = vi.fn();
    render(
      <H2HPlayerPicker players={PLAYERS} selected={[]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByTestId("h2h-pick-ALPHA"));
    expect(onChange).toHaveBeenCalledWith(["p1"]);
  });

  it("toggles a chip off when already selected", () => {
    const onChange = vi.fn();
    render(
      <H2HPlayerPicker
        players={PLAYERS}
        selected={["p1", "p2"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("h2h-pick-ALPHA"));
    expect(onChange).toHaveBeenCalledWith(["p2"]);
  });

  it("blocks adding past the max (5 default)", () => {
    const onChange = vi.fn();
    render(
      <H2HPlayerPicker
        players={PLAYERS}
        selected={["p1", "p2", "p3", "p4", "p5"]}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("h2h-pick-ZETA"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows minimum-pick hint when below min", () => {
    render(
      <H2HPlayerPicker players={PLAYERS} selected={["p1"]} onChange={vi.fn()} />,
    );
    expect(screen.getByText(/Pick at least 2/i)).toBeTruthy();
  });

  it("shows max-reached hint when at max", () => {
    render(
      <H2HPlayerPicker
        players={PLAYERS}
        selected={["p1", "p2", "p3", "p4", "p5"]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Maximum 5 reached/i)).toBeTruthy();
  });

  it("marks selected chips with data-selected=true", () => {
    render(
      <H2HPlayerPicker
        players={PLAYERS}
        selected={["p1"]}
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByTestId("h2h-pick-ALPHA").getAttribute("data-selected"),
    ).toBe("true");
    expect(
      screen.getByTestId("h2h-pick-BETA").getAttribute("data-selected"),
    ).toBe("false");
  });
});
