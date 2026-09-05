-- =============================================================================
-- 0190 — add `signup_bonus` to the Aura reason enum.
--
-- ALONE IN ITS OWN MIGRATION, DELIBERATELY. PostgreSQL will not let a newly
-- added enum value be USED in the same transaction that adds it ("unsafe use of
-- new value of enum type"), and every migration here is applied inside one. So
-- this migration adds the value and nothing else; 0191 builds the index, the
-- signup award and the exclusions on top of it, in a later transaction where
-- the value is committed and safe to reference.
--
-- Adding a value does not touch a single existing row.
-- =============================================================================

alter type public.aura_reason add value if not exists 'signup_bonus';
