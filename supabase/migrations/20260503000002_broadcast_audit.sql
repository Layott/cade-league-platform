-- Plan 12 — attach generic audit_row_change() trigger to every broadcast
-- table so every start/end/trigger/clear lands in audit_events. Plan 1A
-- §4 audit pattern: no per-route audit calls needed.
select public.attach_audit('public.overlay_templates');
select public.attach_audit('public.stream_sessions');
select public.attach_audit('public.overlay_events');
