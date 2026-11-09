-- Spec 10b (PR 1): fix-forward for pickup_requests_declined_note_is_other.
-- The check compared decline_reason = 'other'. For a declined row with a note and no reason that is
-- NULL, and a CHECK that evaluates to NULL passes, so such a row was accepted. IS NOT DISTINCT FROM
-- makes that comparison false instead of NULL. Found by the 10b pgTAP file.
alter table public.pickup_requests drop constraint pickup_requests_declined_note_is_other;
alter table public.pickup_requests
  add constraint pickup_requests_declined_note_is_other
    check (status <> 'declined' or response_note is null or decline_reason is not distinct from 'other');
