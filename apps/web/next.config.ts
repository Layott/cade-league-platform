import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // isomorphic-dompurify uses jsdom on the server, which loads a CSS file
  // from its own package at runtime. If Next bundles jsdom into the server
  // output, that CSS file moves/disappears and page-data collection fails
  // ("default-stylesheet.css" ENOENT). Marking it external keeps jsdom
  // loaded from node_modules at runtime, where its asset files still live.
  serverExternalPackages: ["isomorphic-dompurify", "jsdom", "fontkit", "ttf2woff2"],
  // There's a stray package-lock.json at C:\Users\Sweez\Desktop\LAYO\CLAUDE\
  // that Next 15's heuristic picks as the "workspace root". That misroutes
  // the asset-path resolution (Tailwind CSS served from the wrong public
  // prefix → browser loads the page HTML but zero CSS). Pin the root to
  // the actual repo so the lockfile detection stops wandering.
  outputFileTracingRoot: path.resolve(__dirname, "..", ".."),
  // Hide the Next.js dev "N Issues" floating badge. Overlay routes are
  // loaded into OBS/vMix as browser sources; the badge would be captured
  // on-stream. Production builds never show it anyway; this kills it in
  // dev too.
  devIndicators: false,
  // Build trigger: 2026-04-29T23:50Z — bump to force Vercel rebuild after
  // the vercel.json `Cache-Control: no-store` header change (the old
  // `ignoreCommand` did not watch `vercel.json`, so a config-only commit
  // was being skipped).
};

export default nextConfig;
