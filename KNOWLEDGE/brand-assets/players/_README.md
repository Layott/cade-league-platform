# Player image processing

Decodes ARW/CR3/PNG sources into 4 uniformly-sized PNG variants per pose for broadcast overlays + player cards + website use.

## Re-run

```
cd KNOWLEDGE/brand-assets/players
py _process.py
```

Idempotent — overwrites `processed/`. Drop new source images here and re-run.

## Output

```
processed/
├── <slug>/
│   ├── headshot_01.png   512×512
│   ├── card_01.png       800×1200
│   ├── fullbody_01.png   (variable)×1024
│   └── wide_01.png       1920×1080   (skipped for portrait-only sources)
├── manifest.json
```

## How to read manifest

```json
{
  "players": {
    "adefola": {
      "display_name": "Adefola",
      "pose_count": 3,
      "poses": [
        {
          "pose_index": 1,
          "source": "ADEFOLA 1.ARW",
          "source_resolution": "6000x4000",
          "variants": { "headshot": "adefola/headshot_01.png", ... },
          "face_detected": true,
          "skipped_variants": [],
          "notes": null
        }
      ]
    }
  },
  "warnings": [
    { "player": "guru", "warning": "only 1 pose available ..." }
  ]
}
```

## Known limits

- Haar-cascade face detection misses strong profile + heavy hat/mask shots — flagged `face_detected: false` in manifest, falls back to centered crop.
- No ML upscale (would need `realesrgan` — not installed). LANCZOS resample used.
- `wide_*.png` skipped for portrait sources where landscape crop loses too much context.

## Overlays consuming this

`/overlay/h2h_2`, `/overlay/h2h_3`, `/overlay/h2h_5`, `/overlay/player_card`, `/overlay/up_next_bug`, `/overlay/score_bug`, `/overlay/top_scorers`, `/overlay/player_penalties`, `/overlay/lower_third`, `/overlay/coach_intros` all load from `processed/` via `manifest.json`.
