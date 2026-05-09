/**
 * Overlay-group suspense fallback.
 *
 * OBS / vMix / Streamlabs browser sources point at /overlay/v2/<key> and key
 * the result onto the video output. The root `app/loading.tsx` renders three
 * pulsing green dots + "Loading…" copy, which leaks onto the live broadcast
 * during the brief server-render window. Returning null keeps the canvas
 * fully transparent until the iframe HTML mounts.
 */
export default function OverlayLoading() {
  return null;
}
