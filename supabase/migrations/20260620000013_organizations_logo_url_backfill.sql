-- Backfill `organizations.logo_url` for the 11 Elite season orgs so the
-- 15-orgs broadcast overlay renders logos instead of placeholder cards.
--
-- File source: `KNOWLEDGE/brand-assets/Orgs/` (committed in 6ea4d4c2),
-- mirrored to `apps/web/public/overlays/v2/_assets/Orgs/` by the v2 sync
-- script at prebuild time. URL-encoded (spaces → `%20`, parens kept literal
-- as Postgres + Vercel both accept them in URL paths).
--
-- For orgs with multiple logo variants (color/black/white/blue/red), the
-- broadcast overlay uses the WHITE-on-dark variant for legibility on the
-- pitch-black 15-orgs background — except where only one variant exists.
-- Producers can swap to a different variant later via /admin/people/orgs/<id>.
--
-- Idempotent: only updates rows where `logo_url IS NULL`. Re-running this
-- migration after an admin-set logo will NOT clobber it.

update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/cade%20esport%20-%20ADEFOLA.png'
where name = 'CADE Esports' and logo_url is null;

update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/GameEvo%20Esports%20White%20-%20BAJI%20JNR.png'
where name = 'GameEvo Esports' and logo_url is null;

update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/BREAKING%20GAMING%20BARRIERS%20LOGO%20-%20WOLEVATION.jpeg'
where name = 'Breaking Gaming Barriers' and logo_url is null;

update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/PHOENIX%20ESPORTS%20-%20MITCH.png'
where name = 'Phoenix Esports' and logo_url is null;

-- "OUTLAWS (WHITE0 - DADABOI.png" — note the literal typo "WHITE0" in the
-- filename (committed in 6ea4d4c2 as-is). DO NOT rename the file without
-- updating this migration; renaming the asset will break the URL.
update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/OUTLAWS%20(WHITE0%20-%20DADABOI.png'
where name = 'Outlaws' and logo_url is null;

update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/LUMO%20LABS%20(WHITE)%20-%20KAYKAY.png'
where name = 'Lumo Labs' and logo_url is null;

update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/FUNQUEST%20ESPORTS%20-%20TACTICAL.jpeg'
where name = 'Funquest Esports' and logo_url is null;

update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/SOLAR%20FLARE%20-%20KING%20NONEX.png'
where name = 'Solar Flare' and logo_url is null;

update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/YAKABU%20GLOBAL%20ENTERPRISE%20LIMITED%20-%20GURU.jpg'
where name = 'Yakabu Global' and logo_url is null;

update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/AFROPANDA%20ESPORTS%20-%20ANIFE.jpeg'
where name = 'Afropanda Esports' and logo_url is null;

update public.organizations
set logo_url = '/overlays/v2/_assets/Orgs/OAS%20ESPORTS%20PLAIN%20-%20FARUK.png'
where name = 'OAS Esports' and logo_url is null;
