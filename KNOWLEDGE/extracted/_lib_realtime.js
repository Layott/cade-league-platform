// CommonJS mirror of `apps/web/src/server/fcdb/realtime.ts`.
// Keep channel name + event name + payload shape in lock-step with the
// SSR module so the iframe subscriber receives the same broadcast.

const FCDB_CHANNEL = "public:fcdb";
const FCDB_REFRESHED_EVENT = "fcdb.refreshed";

/**
 * Fire `fcdb.refreshed` on the global `public:fcdb` channel.
 *
 * Triggers the 19-player-squads overlay (subscribed in
 * OverlayDataInjector) to re-fetch its initial-state payload, so chem
 * totals reflect the just-written club/league/alt_positions data
 * without operator intervention.
 *
 * Best-effort: a dropped broadcast is harmless. Operators can always
 * re-trigger the overlay manually from the broadcast control panel.
 */
async function publishFcdbRefreshed(sb, payload = {}) {
  try {
    const channel = sb.channel(FCDB_CHANNEL);
    await channel.send({
      type: "broadcast",
      event: FCDB_REFRESHED_EVENT,
      payload: {
        ...payload,
        at: new Date().toISOString(),
      },
    });
    try {
      await sb.removeChannel(channel);
    } catch {
      // best-effort
    }
  } catch (err) {
    console.error(
      `[fcdb] publishFcdbRefreshed failed: ${err && err.message ? err.message : err}`,
    );
  }
}

module.exports = {
  FCDB_CHANNEL,
  FCDB_REFRESHED_EVENT,
  publishFcdbRefreshed,
};
