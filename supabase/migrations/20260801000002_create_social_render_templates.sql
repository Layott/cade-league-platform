-- Plan 54 — Broadcast Social Media (Wave 1A, migration 2/6).
--
-- `social_render_templates` is the catalog of renderable templates.
-- One row per template_key (`leaderboard`, `top-scorers`, etc.).
-- The admin UI lists active rows in `sort_order` then `label` order;
-- de-listing a template is a flip of `active=false`, not a DELETE
-- (preserves historical job rows referencing the key).
--
-- `data_endpoint` carries an `{sessionId}` placeholder the renderer
-- substitutes at call time. `default_supports_size` enumerates the
-- canvases a template supports. `scene_path` is required for `format
-- in ('video','both')` (it points at the overlay HTML the headless
-- worker boots) and may be NULL for image-only templates that render
-- via @vercel/og or a static React tree.
--
-- No `deleted_at` — `active` flag covers the lifecycle. No audit
-- trigger — config-only table, mutations are infrequent and the
-- admin UI itself records the change via the calling Server Action's
-- audit context.
--
-- Spec: docs/superpowers/specs/2026-05-05-broadcast-social-media.md §4

create table public.social_render_templates (
  template_key            text primary key,
  label                   text not null,
  description             text,
  format                  text not null
    check (format in ('image','video','both')),
  data_endpoint           text not null,
  default_supports_size   text[] not null default array['1080x1920'],
  scene_path              text,
  active                  boolean not null default true,
  sort_order              int not null default 100,
  created_at              timestamptz not null default now()
);
