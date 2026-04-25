import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { WalkoverConfirmCard } from "./WalkoverConfirmCard";

afterEach(() => cleanup());

describe("WalkoverConfirmCard", () => {
  it("renders the participants and winner", () => {
    const { container } = render(
      <WalkoverConfirmCard
        matchId="m1"
        homeName="Alpha"
        awayName="Beta"
        winnerName="Beta"
        matchDate="Sat, 10 May"
        initiatedBy="ref"
        confirmAction={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Alpha");
    expect(text).toContain("Beta");
    expect(screen.getByTestId("walkover-pending-m1")).toBeTruthy();
  });

  it("calls the confirm action with the match id on click", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <WalkoverConfirmCard
        matchId="m1"
        homeName="A"
        awayName="B"
        winnerName="A"
        matchDate={null}
        initiatedBy="ref"
        confirmAction={action}
      />,
    );
    fireEvent.click(screen.getByTestId("walkover-confirm-m1"));
    await waitFor(() => expect(action).toHaveBeenCalledWith("m1"));
  });

  it("hides itself after a successful confirm", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <WalkoverConfirmCard
        matchId="m1"
        homeName="A"
        awayName="B"
        winnerName="A"
        matchDate={null}
        initiatedBy="ref"
        confirmAction={action}
      />,
    );
    fireEvent.click(screen.getByTestId("walkover-confirm-m1"));
    await waitFor(() =>
      expect(screen.queryByTestId("walkover-pending-m1")).toBeNull(),
    );
  });

  it("surfaces server errors inline", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "Boom" });
    render(
      <WalkoverConfirmCard
        matchId="m1"
        homeName="A"
        awayName="B"
        winnerName="A"
        matchDate={null}
        initiatedBy="ref"
        confirmAction={action}
      />,
    );
    fireEvent.click(screen.getByTestId("walkover-confirm-m1"));
    await waitFor(() => expect(screen.getByText("Boom")).toBeTruthy());
  });

  it("calls onConfirmed callback after success", async () => {
    const cb = vi.fn();
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <WalkoverConfirmCard
        matchId="m1"
        homeName="A"
        awayName="B"
        winnerName="A"
        matchDate={null}
        initiatedBy="ref"
        confirmAction={action}
        onConfirmed={cb}
      />,
    );
    fireEvent.click(screen.getByTestId("walkover-confirm-m1"));
    await waitFor(() => expect(cb).toHaveBeenCalledOnce());
  });
});
