"""
Plan 16 prep — process raw player photos into uniformly-sized, face-centered PNG variants.

Idempotent. Re-run after dropping new source images.

Usage:
    py _process.py

Output:
    KNOWLEDGE/brand-assets/players/processed/
      <slug>/
        headshot_<NN>.png   512x512
        card_<NN>.png       800x1200
        fullbody_<NN>.png   (variable)x1024
        wide_<NN>.png       1920x1080
      manifest.json

Deps: rawpy, opencv-python-headless, numpy, Pillow.
Falls back to centered-crop when face detection fails — flagged in manifest.
"""

from __future__ import annotations
import json
import os
import re
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import cv2
import rawpy
from PIL import Image

try:
    from rembg import remove as _rembg_remove, new_session as _rembg_session  # type: ignore
    _REMBG_SESSION = _rembg_session("u2net")
    _REMBG_OK = True
except Exception as _e:
    print(f"rembg unavailable ({_e}) — background removal skipped", file=sys.stderr)
    _rembg_remove = None  # type: ignore
    _REMBG_SESSION = None
    _REMBG_OK = False

SRC_DIR = Path(__file__).parent
OUT_DIR = SRC_DIR / "processed"

RAW_EXT = {".arw", ".cr3", ".cr2", ".nef", ".dng"}
PNG_EXT = {".png", ".jpg", ".jpeg"}

HAAR = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)

VARIANTS = [
    ("headshot", 512, 512, 0.40),    # square, face_h * 2.5, centered
    ("card", 800, 1200, 0.40),       # portrait, face at y=40%
    ("fullbody", None, 1024, 0.33),  # aspect-preserving, 1024 tall, face top-third
    ("wide", 1920, 1080, 0.45),      # landscape, face slightly left of center
]


def slugify(name: str) -> str:
    s = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_").lower()
    return s


def parse_name_index(stem: str) -> tuple[str, int]:
    """
    Input: 'ADEFOLA 2' / 'BAJI JNR 3' / 'KILLER FREAK 1'
    Output: ('adefola', 2), ('baji_jnr', 3), ('killer_freak', 1)
    """
    m = re.match(r"^(.*?)\s+(\d+)$", stem.strip())
    if m:
        return slugify(m.group(1)), int(m.group(2))
    return slugify(stem), 1


def decode(path: Path) -> np.ndarray | None:
    """Return BGR uint8 array. None on failure."""
    ext = path.suffix.lower()
    try:
        if ext in RAW_EXT:
            with rawpy.imread(str(path)) as raw:
                rgb = raw.postprocess(
                    use_camera_wb=True,
                    output_bps=8,
                    no_auto_bright=False,
                    # user_flip=-1 auto-rotates from EXIF (default). Was 0
                    # previously which suppressed orientation → sideways faces.
                    user_flip=-1,
                )
            return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        elif ext in PNG_EXT:
            img = cv2.imread(str(path), cv2.IMREAD_COLOR)
            return img
    except Exception as e:
        print(f"  DECODE FAIL {path.name}: {e}", file=sys.stderr)
        return None
    return None


def detect_face(img: np.ndarray) -> tuple[int, int, int, int] | None:
    """Return (x, y, w, h) of the largest frontal face, or None."""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # Downscale large images for detection speed — scale back results.
    H, W = gray.shape[:2]
    max_side = 1600
    scale = 1.0
    if max(H, W) > max_side:
        scale = max_side / max(H, W)
        gray_d = cv2.resize(gray, (int(W * scale), int(H * scale)), interpolation=cv2.INTER_AREA)
    else:
        gray_d = gray
    faces = HAAR.detectMultiScale(
        gray_d,
        scaleFactor=1.15,
        minNeighbors=5,
        minSize=(64, 64),
    )
    if len(faces) == 0:
        # Try rotated if nothing found (portrait frames rotated by camera)
        for rot in (cv2.ROTATE_90_CLOCKWISE, cv2.ROTATE_90_COUNTERCLOCKWISE):
            rotated = cv2.rotate(gray_d, rot)
            fr = HAAR.detectMultiScale(rotated, scaleFactor=1.15, minNeighbors=5, minSize=(64, 64))
            if len(fr) > 0:
                faces = fr
                # Inverse-rotate coordinates
                rh, rw = rotated.shape[:2]
                adjusted = []
                for (x, y, w, h) in fr:
                    if rot == cv2.ROTATE_90_CLOCKWISE:
                        adjusted.append((y, rw - x - w, h, w))
                    else:
                        adjusted.append((rh - y - h, x, h, w))
                faces = np.array(adjusted)
                break
        if len(faces) == 0:
            return None
    # Largest face
    faces = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
    x, y, w, h = faces[0]
    inv = 1.0 / scale
    return (int(x * inv), int(y * inv), int(w * inv), int(h * inv))


def crop_variant(
    img: np.ndarray,
    face: tuple[int, int, int, int] | None,
    variant: tuple[str, int | None, int, float],
) -> np.ndarray | None:
    """Return BGR cropped + resized image for given variant. None if impossible."""
    H, W = img.shape[:2]
    name, target_w, target_h, face_y_frac = variant

    if face is not None:
        fx, fy, fw, fh = face
        face_cx = fx + fw // 2
        face_cy = fy + fh // 2
    else:
        face_cx = W // 2
        face_cy = int(H * 0.33)  # assume face in top third
        fw = min(W, H) // 4
        fh = fw

    if name == "headshot":
        # Square crop, side = face_h * 4.2. Includes full head (hair + chin)
        # + shoulders. Bias the crop center UP by 25% of face height so the
        # face sits in the upper-middle of the square, leaving room for the
        # forehead/hair above and shoulders below.
        side = int(fh * 4.2)
        if side < 512:
            side = min(512, H, W)
        side = min(side, H, W)
        # Shift crop center up so face occupies upper-middle band.
        cy_biased = face_cy - int(fh * 0.25)
        cx = max(side // 2, min(W - side // 2, face_cx))
        cy = max(side // 2, min(H - side // 2, cy_biased))
        x0 = cx - side // 2
        y0 = cy - side // 2
        crop = img[y0:y0 + side, x0:x0 + side]
        if crop.shape[0] == 0 or crop.shape[1] == 0:
            return None
        return cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)

    if name == "card":
        # 800x1200 = 2:3 portrait. Face in upper-third. Preserve as much
        # torso + body as possible below the face.
        ratio = target_w / target_h  # 2:3 = 0.667
        # Prefer using the whole source height, crop width to 2:3 ratio.
        src_ratio = W / H
        if src_ratio < ratio:
            # Source is narrower than 2:3 — use full width, crop height.
            crop_w = W
            crop_h = int(crop_w / ratio)
            # Place face at face_y_frac from top.
            y0 = max(0, face_cy - int(crop_h * face_y_frac))
            y0 = min(y0, H - crop_h)
            x0 = 0
        else:
            # Source is wider than 2:3 — use full height, crop width.
            crop_h = H
            crop_w = int(crop_h * ratio)
            x0 = max(0, face_cx - crop_w // 2)
            x0 = min(x0, W - crop_w)
            y0 = 0
        crop = img[y0:y0 + crop_h, x0:x0 + crop_w]
        if crop.shape[0] == 0 or crop.shape[1] == 0:
            return None
        return cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)

    if name == "fullbody":
        # Use the WHOLE source image (it's a full-body studio shot already).
        # Only crop sides if landscape to narrow toward a 2:3ish portrait.
        # Otherwise keep the entire frame — the photographer framed it.
        src_ratio = W / H
        if src_ratio > 0.95:
            # Landscape or square — narrow width around face, keep full height.
            target_ratio = 2 / 3  # portrait 2:3
            new_w = int(H * target_ratio)
            if new_w >= W:
                img_use = img
            else:
                x0 = max(0, face_cx - new_w // 2)
                x0 = min(x0, W - new_w)
                img_use = img[:, x0:x0 + new_w]
        else:
            # Already portrait — use entire frame.
            img_use = img
        h2, w2 = img_use.shape[:2]
        new_h = target_h
        new_w = int(w2 * (new_h / h2))
        return cv2.resize(img_use, (new_w, new_h), interpolation=cv2.INTER_LANCZOS4)

    if name == "wide":
        # 1920x1080 landscape. Only produce if source aspect already landscape
        # OR portrait-with-enough-headroom; else skip.
        ratio = target_w / target_h  # 16:9
        src_ratio = W / H
        if src_ratio < ratio:
            # Source is portrait — cannot produce landscape without massive
            # cropping. Skip.
            return None
        crop_h = H
        crop_w = int(crop_h * ratio)
        if crop_w > W:
            crop_w = W
            crop_h = int(crop_w / ratio)
        # Face at 45% from top, 40% from left (slightly left of center, leaves
        # room for text on right).
        y0 = max(0, face_cy - int(crop_h * face_y_frac))
        y0 = min(y0, H - crop_h)
        x0 = max(0, face_cx - int(crop_w * 0.4))
        x0 = min(x0, W - crop_w)
        crop = img[y0:y0 + crop_h, x0:x0 + crop_w]
        if crop.shape[0] == 0 or crop.shape[1] == 0:
            return None
        return cv2.resize(crop, (target_w, target_h), interpolation=cv2.INTER_LANCZOS4)

    return None


def save_png(img_bgr: np.ndarray, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    Image.fromarray(rgb).save(path, format="PNG", optimize=True)


def save_png_nobg(img_bgr: np.ndarray, path: Path) -> bool:
    """Run rembg on the BGR crop and save transparent PNG. Returns True on success."""
    if not _REMBG_OK or _rembg_remove is None:
        return False
    try:
        rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        cut = _rembg_remove(pil, session=_REMBG_SESSION)
        path.parent.mkdir(parents=True, exist_ok=True)
        cut.save(path, format="PNG", optimize=True)
        return True
    except Exception as e:
        print(f"    rembg fail {path.name}: {e}", file=sys.stderr)
        return False


def main() -> int:
    if not SRC_DIR.exists():
        print(f"Source missing: {SRC_DIR}", file=sys.stderr)
        return 1

    sources: dict[str, list[tuple[int, Path]]] = {}
    for entry in sorted(SRC_DIR.iterdir()):
        if entry.name.startswith("_") or entry.is_dir():
            continue
        ext = entry.suffix.lower()
        if ext not in RAW_EXT and ext not in PNG_EXT:
            continue
        slug, idx = parse_name_index(entry.stem)
        sources.setdefault(slug, []).append((idx, entry))

    if not sources:
        print("No source images found.")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)

    manifest = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source_dir": str(SRC_DIR.relative_to(SRC_DIR.parent.parent.parent)),
        "output_dir": str(OUT_DIR.relative_to(SRC_DIR.parent.parent.parent)),
        "players": {},
        "warnings": [],
    }

    total_variants = 0
    total_skipped = 0
    faces_detected = 0
    total_images = 0

    for slug, poses in sources.items():
        poses.sort(key=lambda t: t[0])
        display_name = slug.replace("_", " ").title()
        print(f"\n== {display_name} ({len(poses)} pose{'s' if len(poses) != 1 else ''}) ==")

        if len(poses) == 1:
            manifest["warnings"].append({
                "player": slug,
                "warning": "only 1 pose available — consider adding more for variety",
            })

        player_entry = {
            "display_name": display_name,
            "pose_count": len(poses),
            "poses": [],
        }

        for idx, src_path in poses:
            total_images += 1
            src_ext = src_path.suffix.lower()
            print(f"  pose {idx:02d}: {src_path.name} ({src_ext})", end=" ", flush=True)
            img = decode(src_path)
            if img is None:
                print("DECODE FAIL")
                player_entry["poses"].append({
                    "pose_index": idx,
                    "source": src_path.name,
                    "variants": {},
                    "face_detected": False,
                    "skipped_variants": [v[0] for v in VARIANTS],
                    "notes": "decode failed",
                })
                continue

            H, W = img.shape[:2]
            face = detect_face(img)
            face_detected = face is not None
            if face_detected:
                faces_detected += 1
                print(f"face=({face[0]},{face[1]},{face[2]}x{face[3]})", end=" ", flush=True)
            else:
                print("face=none(fallback center)", end=" ", flush=True)

            variants_out: dict[str, str] = {}
            skipped: list[str] = []
            for variant in VARIANTS:
                name = variant[0]
                try:
                    crop = crop_variant(img, face, variant)
                except Exception as e:
                    print(f"\n    crop {name} fail: {e}", file=sys.stderr)
                    crop = None
                if crop is None:
                    skipped.append(name)
                    continue
                out_path = OUT_DIR / slug / f"{name}_{idx:02d}.png"
                save_png(crop, out_path)
                rel = f"{slug}/{name}_{idx:02d}.png"
                variants_out[name] = rel
                total_variants += 1
                # Transparent background variant — useful for overlay compositing.
                nobg_path = OUT_DIR / slug / f"{name}_{idx:02d}_nobg.png"
                if save_png_nobg(crop, nobg_path):
                    variants_out[f"{name}_nobg"] = f"{slug}/{name}_{idx:02d}_nobg.png"
                    total_variants += 1
            total_skipped += len(skipped)
            print(f"-> {len(variants_out)} variants, {len(skipped)} skipped" + (f" ({','.join(skipped)})" if skipped else ""))

            player_entry["poses"].append({
                "pose_index": idx,
                "source": src_path.name,
                "source_resolution": f"{W}x{H}",
                "variants": variants_out,
                "face_detected": face_detected,
                "skipped_variants": skipped,
                "notes": None,
            })

        manifest["players"][slug] = player_entry

    with (OUT_DIR / "manifest.json").open("w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print("\n=== summary ===")
    print(f"images        : {total_images}")
    print(f"faces detected: {faces_detected}/{total_images} ({100*faces_detected/max(1,total_images):.0f}%)")
    print(f"variants out  : {total_variants}")
    print(f"variants skip : {total_skipped}")
    print(f"manifest      : {OUT_DIR / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:
        traceback.print_exc()
        sys.exit(1)
