/**
 * Whitelisted entity types the Trash UI can read/restore.
 * Key = URL slug + permission sub-resource.
 * Value.table = exact Postgres table name under public.
 *
 * IMPORTANT: entityType is user input from the URL. Only use it as a key into
 * this record. NEVER interpolate it into SQL. The table name comes from this
 * record and is a constant string literal.
 */
export const TRASH_ENTITIES = {
  users: {
    table: "users",
    label: "Users",
    columns: [
      { key: "email", label: "Email" },
      { key: "display_name", label: "Display name" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, email, display_name, deleted_at",
  },
  players: {
    table: "players",
    label: "Players",
    columns: [
      { key: "gamer_tag", label: "Gamer tag" },
      { key: "psn_id", label: "PSN" },
      { key: "jersey_number", label: "#" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, gamer_tag, psn_id, jersey_number, deleted_at",
  },
  seasons: {
    table: "seasons",
    label: "Seasons",
    columns: [
      { key: "year_range", label: "Year" },
      { key: "status", label: "Status" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, year_range, status, deleted_at",
  },
  match_days: {
    table: "match_days",
    label: "Match days",
    columns: [
      { key: "match_date", label: "Date" },
      { key: "venue_name", label: "Venue" },
      { key: "status", label: "Status" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, match_date, venue_name, status, deleted_at",
  },
  matches: {
    table: "matches",
    label: "Matches",
    columns: [
      { key: "scheduled_time", label: "Time" },
      { key: "home_player_id", label: "Home" },
      { key: "away_player_id", label: "Away" },
      { key: "status", label: "Status" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols:
      "id, scheduled_time, home_player_id, away_player_id, status, deleted_at",
  },
  match_results: {
    table: "match_results",
    label: "Results",
    columns: [
      { key: "match_id", label: "Match" },
      { key: "home_score", label: "H" },
      { key: "away_score", label: "A" },
      { key: "result_type", label: "Type" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols:
      "id, match_id, home_score, away_score, result_type, deleted_at",
  },
  punishments: {
    // Per design spec §3.5, punishments live in disciplinary_actions.
    table: "disciplinary_actions",
    label: "Punishments",
    columns: [
      { key: "sanction_type", label: "Type" },
      { key: "magnitude", label: "Magnitude" },
      { key: "effective_from", label: "From" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, sanction_type, magnitude, effective_from, deleted_at",
  },
  announcements: {
    table: "announcements",
    label: "Announcements",
    columns: [
      { key: "title", label: "Title" },
      { key: "priority", label: "Priority" },
      { key: "published_at", label: "Published" },
      { key: "deleted_at", label: "Deleted" },
    ],
    selectCols: "id, title, priority, published_at, deleted_at",
  },
} as const;

export type TrashEntityType = keyof typeof TRASH_ENTITIES;

export const TRASH_ENTITY_KEYS: readonly TrashEntityType[] = Object.keys(
  TRASH_ENTITIES
) as TrashEntityType[];

export function isTrashEntityType(s: string): s is TrashEntityType {
  return Object.prototype.hasOwnProperty.call(TRASH_ENTITIES, s);
}
