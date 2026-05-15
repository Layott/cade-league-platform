import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Singleton browser supabase client.
 *
 * Each call to `createBrowserClient` previously returned a fresh
 * instance, so any component that called `getBrowserSupabase()` from a
 * `useEffect` (e.g. StandingsLiveRefresh, OverlayDataInjector, every
 * `useOverlay*` hook) spun up its own Realtime / GoTrue stack. Two
 * symptoms followed:
 *
 *   - `@supabase/ssr` logs a `Multiple GoTrueClient instances detected
 *     in the same browser context` warning and de-prioritises auth +
 *     realtime on the extra clients, so their `channel(...).subscribe()`
 *     could finish without ever opening a Realtime WebSocket. This is
 *     what stalled the public /standings live-refresh on 2026-05-15
 *     even though the DB broadcast was firing every recompute.
 *   - Multiple WebSockets to the same realtime topic eat the project's
 *     concurrent-connection budget faster than necessary.
 *
 * Memoising the client per-window — one Supabase client for the whole
 * tab — preserves the existing API (callers still call
 * `getBrowserSupabase()`) while keeping a single realtime + auth
 * singleton alive across hooks.
 */

declare global {
  // eslint-disable-next-line no-var
  var __cadeBrowserSupabase__: SupabaseClient | undefined;
}

export function getBrowserSupabase(): SupabaseClient {
  if (typeof window === "undefined") {
    // Tests / SSR fall through with a fresh client per call — no real
    // window to memoise against.
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  if (!globalThis.__cadeBrowserSupabase__) {
    globalThis.__cadeBrowserSupabase__ = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return globalThis.__cadeBrowserSupabase__;
}
