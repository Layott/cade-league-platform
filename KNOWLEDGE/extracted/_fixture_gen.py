"""Generate the 78-match round-robin fixture list for the 13-player Elite 2025-2026 season.

Uses the circle method (Berger tables): fix player 0, rotate the rest. With an odd
number of players (13), we introduce a "BYE" virtual entry — whichever real player
is paired with BYE in a given round sits out that round. Total rounds = 13, matches
per round = 6, total matches = 13 * 6 = 78 = C(13, 2). Each player plays 12 matches
(everyone else exactly once) with one bye.

Match-day dates: first round on Saturday 2025-11-01, then +7 days per round.
Venue: CADE Studio, Lagos. Arrival cutoff 09:00 WAT, match start 10:00 WAT.

Run:
    py _fixture_gen.py            # prints the Python dict literal
    py _fixture_gen.py --dump     # also writes _fixture_gen.out.txt

Deterministic: player order fixed by GAMER_TAGS list below, so re-running
produces identical output.
"""
from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Fixed player ordering — also the gamer_tag values used in the seed SQL.
# Order matters: it seeds the circle-method rotation.
GAMER_TAGS: list[str] = [
    "ADEFOLA",
    "ANIFE",
    "BAJI_JNR",
    "DADABOI",
    "FARUK",
    "GURU",
    "KAYKAY",
    "KILLER_FREAK",
    "KINGNONEX",
    "MITCH",
    "MR_OGA",
    "TACTICAL",
    "WOLEVATION",
]

BYE = "__BYE__"

FIRST_MATCH_DATE = date(2025, 11, 1)  # Saturday
DAYS_BETWEEN_ROUNDS = 7


def circle_method(players: list[str]) -> list[list[tuple[str, str]]]:
    """Return list of rounds; each round is a list of pairs (home, away).

    For an odd-sized roster we append a BYE and run the classic even-sized
    circle method: fix position 0, rotate the rest. The pair containing BYE
    in a given round yields the player who rests that round — we drop it
    before returning.
    """
    roster = players[:]
    if len(roster) % 2 == 1:
        roster.append(BYE)
    n = len(roster)
    num_rounds = n - 1
    half = n // 2

    # Rotation works on indices 1..n-1 (index 0 stays fixed).
    arr = list(range(n))
    rounds: list[list[tuple[str, str]]] = []
    for _ in range(num_rounds):
        pairs: list[tuple[str, str]] = []
        for i in range(half):
            a_idx = arr[i]
            b_idx = arr[n - 1 - i]
            a = roster[a_idx]
            b = roster[b_idx]
            if a == BYE or b == BYE:
                continue
            pairs.append((a, b))
        rounds.append(pairs)
        # Rotate: keep arr[0] fixed, shift the rest clockwise.
        arr = [arr[0]] + [arr[-1]] + arr[1:-1]
    return rounds


def build_schedule() -> list[dict]:
    rounds = circle_method(GAMER_TAGS)
    schedule: list[dict] = []
    for idx, pairs in enumerate(rounds, start=1):
        match_date = FIRST_MATCH_DATE + timedelta(days=DAYS_BETWEEN_ROUNDS * (idx - 1))
        schedule.append(
            {
                "round": idx,
                "match_date": match_date.isoformat(),
                "pairs": pairs,
            }
        )
    return schedule


def validate(schedule: list[dict]) -> None:
    """Sanity-check: every player plays every other player exactly once."""
    seen: dict[frozenset[str], int] = {}
    appearances: dict[str, int] = {t: 0 for t in GAMER_TAGS}
    total_pairs = 0
    for rnd in schedule:
        round_tags: set[str] = set()
        for home, away in rnd["pairs"]:
            total_pairs += 1
            key = frozenset({home, away})
            if key in seen:
                raise AssertionError(f"Duplicate pairing {key} in round {rnd['round']}")
            seen[key] = rnd["round"]
            appearances[home] += 1
            appearances[away] += 1
            if home in round_tags or away in round_tags:
                raise AssertionError(
                    f"Player double-booked in round {rnd['round']}: {home} / {away}"
                )
            round_tags.add(home)
            round_tags.add(away)
    expected = len(GAMER_TAGS) * (len(GAMER_TAGS) - 1) // 2
    if total_pairs != expected:
        raise AssertionError(f"Got {total_pairs} pairs, expected {expected}")
    for tag, count in appearances.items():
        if count != len(GAMER_TAGS) - 1:
            raise AssertionError(f"{tag} plays {count} matches, expected 12")


def render_dict_literal(schedule: list[dict]) -> str:
    lines = ["rounds = ["]
    for rnd in schedule:
        pairs_repr = ", ".join(f'("{h}", "{a}")' for h, a in rnd["pairs"])
        lines.append(
            f'    {{"round": {rnd["round"]}, "match_date": "{rnd["match_date"]}", '
            f'"pairs": [{pairs_repr}]}},'
        )
    lines.append("]")
    return "\n".join(lines)


def main() -> int:
    schedule = build_schedule()
    validate(schedule)
    out = render_dict_literal(schedule)
    print(out)
    if "--dump" in sys.argv:
        (HERE / "_fixture_gen.out.txt").write_text(out + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
