-- Spec 11 PR 2: the app now lists "my requests" (pickup and table together) with
-- list_my_requests(p_before text). The pickup-only list, which paged on a timestamp, is no longer
-- called by anything. Dropped here, never edited in the earlier migrations.
drop function public.list_my_pickup_requests(timestamptz);
