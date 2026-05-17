"use client";

import { useEffect, useState } from "react";

/**
 * Tiny image loader for react-konva `<Image>`. Konva's Image node needs
 * a raw HTMLImageElement, so we instantiate one and resolve into state.
 */
export function useImage(url: string | undefined | null) {
  const [img, setImg] = useState<HTMLImageElement | undefined>(undefined);
  useEffect(() => {
    if (!url) {
      setImg(undefined);
      return;
    }
    const el = new window.Image();
    el.crossOrigin = "anonymous";
    el.src = url;
    const onLoad = () => setImg(el);
    el.addEventListener("load", onLoad);
    return () => el.removeEventListener("load", onLoad);
  }, [url]);
  return img;
}
