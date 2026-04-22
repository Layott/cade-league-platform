# Futbin Kaggle Search — Results

Date: 2026-04-22
Goal: find a Kaggle-hosted dataset mirroring Futbin FC26/FC25 market prices (FUT coins) so we can replace the dead-cycle FIFA23 rating-median fallback in `public.fc26_players.value_coins_estimate`.

## Search queries (Kaggle REST `/datasets/list?search=<q>&sortBy=hottest`, all via HTTPS Basic Auth w/ user `layolayott`)

| Query | Result count | Notes |
|-------|-------------:|-------|
| `eafc26 futbin` | 0 | empty |
| `eafc 26 futbin` | 0 | empty |
| `fc 26 futbin prices` | 0 | empty |
| `ea fc 26 market` | 0 | empty |
| `fc26 futbin` | 0 | empty |
| `eafc futbin` | 0 | empty |
| `futbin` | 1 | only FIFA23 era (Anas Aboreeda's `anasfullstack/fifa23-futbin-players`, already ingested in `_ingest_prices.js`) |
| `ea fc 25 futbin` | 0 | empty |
| `fc25 prices` | 0 | empty |
| `eafc 25` | 3 | jkotov ratings only, sergionefedov analytics, macmini62 — none with FUT coin prices |
| `fc 25 ultimate team` | 9 | nyagami ratings+stats, sametozturkk sofifa merge, samandar stats+analysis, etc. — all lack FUT coin price columns (only `Value_EUR` / `Wage_EUR` via SoFIFA) |
| `ea sports fc 25` | 9 | same set as above |
| `fifa 25 prices` | 0 | empty |
| `fut 25` | 0 | empty |
| `fut ultimate team prices` | 1 | `husmail/fifa-ultimate-team-fut-2016-2021` — latest is FIFA21, too old |
| `ea fc prices` | 0 | empty |
| `ea fc 24 prices` | 0 | empty |
| `ea fc 24 fut` | 1 | `mohammedessam97/ea-fc-24-fut-players-dataset` — already ingested in `_ingest_prices.js` (FC24 era, also dead-cycle now) |
| `fc25 futbin` | 0 | empty |
| `fc 24 futbin` | 0 | empty |
| `eafc prices` | 0 | empty |
| `fut market` | 14 | all about stock/commodity futures markets, not FUT; plus old FIFA10-22 dumps |
| `football ultimate team` | 20 | all pre-FC25 |
| `fc 25 database` | 2 | nyagami + mexwell — no FUT coin price columns |
| `fc 26` | 9 | 4 FC26 datasets: rovnez, justdhia, talhademirezen, yusufhanakr — none have FUT coin prices |

## FC26-era datasets inspected (headers scanned)

1. **rovnez/fc-26-fifa-26-player-data** — 18,405 rows, SoFIFA-sourced. Has `value_eur` (99.4% coverage) + `release_clause_eur` (92.2%). **No FUT coin price**. Not Futbin.
2. **justdhia/ea-sports-fc-26-player-ratings** — 3 CSVs (players / outfield / goalkeepers). Columns: ratings + six mains + sub-attributes + play-styles. **No price column at all.**
3. **talhademirezen/fc-26-player-stats** — EA's public ratings-page dump. Columns: ratings + attributes + `source_url` → ea.com. **No price column.**
4. **yusufhanakr/fc-26-premier-league-player-dataset-unofficial** — small Premier-League-only cut. Unofficial. **No price column.**

## FC25-era datasets inspected

1. **nyagami/ea-sports-fc-25-database-ratings-and-stats** — 3 CSVs (all / male / female). Rating + attribute columns only. **No price.**
2. **mexwell/ea-fc25-player-database** — scraped HTML dump; headers are raw CSS selector artifacts (`odd src`, `odd href`, `swapHeader (N)`). **Unusable** — header data does not map to clean columns.
3. **samandarabdujabbar/ea-sports-fc-25-complete-player-stats-and-analysis** — `Value_EUR` + `Wage_EUR` only. **SoFIFA EUR, not Futbin coins.**
4. **sametozturkk/ea-sports-fc-25-real-player-data-sofifa-merge** — SoFIFA merge. EUR, not coins.
5. **yusufaltunbas/fc25-players-ratings** — ratings only.
6. **mayanksinghr/fc-25-top-100-players** — top 100 only, ratings only.
7. **jkotov/all-eafc25-ratings** — ratings only.
8. **aniss7/fifa-player-data-from-sofifa-2025-06-03** — SoFIFA. EUR only.
9. **macmini62/eafc-players-top-5-leagues** — ratings only.

## Conclusion

**Zero Kaggle datasets mirror Futbin's FUT coin prices for FC26 or FC25.** The only FUT-coin Futbin dataset on Kaggle is the 2023-era FIFA23 Anas dump (`anasfullstack/fifa23-futbin-players`), which we already ingest via `_ingest_prices.js`. That data is dead-cycle (FIFA23 Futbin prices floor around 200 coins because the market collapsed when FC24 released) and provides minimal signal for the squad picker.

Best FC26-era alternative is **rovnez/fc-26-fifa-26-player-data**, which has SoFIFA `value_eur` for 18,296 of 18,405 players. This is real-world transfer market value in euros, NOT Futbin FUT coins — the two correlate but the scale differs by ~2-3 orders of magnitude and the conversion is non-trivial (top-rated stars sit at ~200-400k FUT coins vs 100-170M EUR SoFIFA, mid-gold 75-OVR sits at ~6-15k coins vs ~6M EUR — ratio roughly 600:1 but varies across the ladder, and Futbin adds rarity/meta premiums that SoFIFA does not).

## Next-step options for main thread to pick from

1. **Write a native EAFC26 Futbin scraper** and run it locally (bypasses ToS concern when scraping for personal/internal use under fair-use grounds; still needs explicit user sign-off + sensible rate limits; Futbin's anti-bot makes this non-trivial). This is the only way to get **actual** Futbin FC26 FUT coin prices.

2. **Accept SoFIFA `value_eur` as the FC26 market proxy** (via rovnez dataset, 18,405 rows, 99.4% coverage) and apply an empirical EUR→coins scaling factor (flat `/600` gets 91-OVR Mbappé to ~289k coins and 75-OVR gold median to ~10k coins, both within Futbin FC26 bands). Down-side: rarity / meta / PlayStyles+ premiums that Futbin reflects are absent — a 75-OVR Inform will cost ~5× base on Futbin but be identical to base on SoFIFA. Still **massively better** than the current dead-cycle FIFA23 fallback where Rodri is 350 coins and Dembélé is 3900.

3. **Tighten the existing rating-median fallback** with a curated override table for the top-200 most-played FC26 meta cards (hand-entered from Futbin checks). Labor-intensive but fully Futbin-faithful for the players that matter.

4. **Acknowledge squad-picker coin budgets are coarse-grained** and degrade the picker UI to a rating-based budget (e.g., "you get 2× 85+, 3× 80+, 6× 75+") instead of a coin budget. Decouples us from a live Futbin feed entirely.

My recommendation: **option 2 as an immediate, bounded upgrade** (one migration day's work, low risk, large quality delta over today's fallback) coupled with **option 1 as the longer-term path** for real Futbin fidelity.
