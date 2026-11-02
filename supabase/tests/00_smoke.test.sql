-- Smoke test so `supabase test db` has something to run on the empty schema.
-- Replace once spec 02 adds real RLS tests.
begin;
select plan(1);
select ok(true, 'pgTAP runs');
select * from finish();
rollback;
