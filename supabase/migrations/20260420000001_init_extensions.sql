-- Enable extensions used across the platform.
create extension if not exists pgcrypto;     -- gen_random_uuid()
create extension if not exists pg_trgm;      -- later: fuzzy search on names
create extension if not exists citext;       -- case-insensitive emails
