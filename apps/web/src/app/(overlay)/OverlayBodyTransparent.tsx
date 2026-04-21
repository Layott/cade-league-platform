"use client";

import { useEffect } from "react";

/**
 * Client-side effect that toggles `.overlay-mode` on `<html>` on mount.
 * Paired with the `html.overlay-mode` rules in `globals.css` to make
 * the document background transparent so vMix browser sources can key
 * the overlay directly onto the video output.
 *
 * Renders nothing — effect-only.
 */
export function OverlayBodyTransparent() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    html.classList.add("overlay-mode");
    body.classList.add("overlay-mode");
    // Remove any pre-computed backgrounds (belt + braces with globals CSS).
    const prevHtmlBg = html.style.background;
    const prevBodyBg = body.style.background;
    html.style.background = "transparent";
    body.style.background = "transparent";
    return () => {
      html.classList.remove("overlay-mode");
      body.classList.remove("overlay-mode");
      html.style.background = prevHtmlBg;
      body.style.background = prevBodyBg;
    };
  }, []);
  return null;
}
