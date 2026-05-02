import sharp from "sharp";

/**
 * Central image-processing helper for any user-uploaded image that
 * targets a known display surface (partner-logo strip, org-logo grid,
 * coach roster card, player card, leaderboard corner badge, etc).
 *
 * Each use case has a hard recipe — width, height, fit policy,
 * background colour. Callers hand in the raw upload buffer and receive
 * a PNG buffer ready to write to Storage. This means upload actions
 * never need to babysit dimensions: the recipe is the contract.
 *
 * Adding a new use case: append an entry to `RECIPES`, expose its key
 * via the `ImageUseCase` union, and wire the calling action to use it.
 *
 * Why fixed dimensions: the overlay HTML positions assets via CSS that
 * assumes specific aspect ratios (600×300 strip cells, 800×800 org
 * tiles). Letting users upload arbitrary sizes and "trusting" CSS to
 * `object-fit` was the cause of the 2026-04-26 strip-misalignment
 * incident. Resize on intake = the canvas always matches.
 */

export type ImageUseCase =
  | "partner-strip" // sponsor strip cell — 600x300, transparent bg
  | "org-logo" // /admin/people/orgs roster + h2h-2/3/5 + 15-orgs — 800x800
  | "coach-photo" // 16-coaches roster card — 512x512, cover-fit
  | "player-photo" // 14-top-scorers / 15-orgs / etc. — 512x512, cover-fit
  | "leaderboard-corner"; // 7-leaderboard corner badge — 200x200

type Recipe = {
  w: number;
  h: number;
  fit: "contain" | "cover";
  bg: { r: number; g: number; b: number; alpha: number };
};

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 } as const;

/**
 * Recipe registry. Keep widths/heights in lock-step with the overlay
 * CSS that ultimately renders them — when you add or change a recipe,
 * also walk the overlay HTMLs that read from the same surface.
 */
const RECIPES: Record<ImageUseCase, Recipe> = {
  "partner-strip": { w: 600, h: 300, fit: "contain", bg: TRANSPARENT },
  "org-logo": { w: 800, h: 800, fit: "contain", bg: TRANSPARENT },
  "coach-photo": { w: 512, h: 512, fit: "cover", bg: TRANSPARENT },
  "player-photo": { w: 512, h: 512, fit: "cover", bg: TRANSPARENT },
  "leaderboard-corner": { w: 200, h: 200, fit: "contain", bg: TRANSPARENT },
};

/**
 * Pull the recipe for a given use case. Useful when callers need to
 * report the target dimensions back to the user (e.g. UI hint copy,
 * "image will be resized to 800×800") without re-running sharp.
 */
export function recipeFor(useCase: ImageUseCase): Recipe {
  return RECIPES[useCase];
}

/**
 * Process an uploaded image buffer through the recipe for the given
 * use case. Returns a PNG buffer (compression level 9 — small files,
 * fast Storage I/O, no JPEG artifacts on logos with sharp edges).
 *
 * SVG inputs are NOT pre-converted; pass them through Storage as-is
 * since rasterising via sharp would lose the vector. Callers should
 * detect `image/svg+xml` MIME and skip processImage entirely for that
 * branch.
 */
export async function processImage(
  buffer: Buffer,
  useCase: ImageUseCase,
): Promise<Buffer> {
  const recipe = RECIPES[useCase];
  return sharp(buffer)
    .resize(recipe.w, recipe.h, {
      fit: recipe.fit,
      background: recipe.bg,
    })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
