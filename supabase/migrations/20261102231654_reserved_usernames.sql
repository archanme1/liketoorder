-- Spec 02 review (Decision 8): usernames that could pass as staff can't be taken.
-- Keep the list in sync with RESERVED_USERNAMES in src/features/profile/schema.ts.
-- Null (profile not set up yet) stays allowed.

alter table public.profiles
  add constraint profiles_username_not_reserved
  check (username not in (
    'admin', 'administrator', 'support', 'help', 'staff',
    'moderator', 'system', 'root', 'liketoorder'
  ));
