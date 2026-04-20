import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // isomorphic-dompurify uses jsdom on the server, which loads a CSS file
  // from its own package at runtime. If Next bundles jsdom into the server
  // output, that CSS file moves/disappears and page-data collection fails
  // ("default-stylesheet.css" ENOENT). Marking it external keeps jsdom
  // loaded from node_modules at runtime, where its asset files still live.
  serverExternalPackages: ["isomorphic-dompurify", "jsdom"],
};

export default nextConfig;
