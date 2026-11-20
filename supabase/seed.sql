-- Local dev seed data. Runs after migrations on `npx supabase db reset`. `profiles` rows come from the
-- auth.users trigger, so demo users and other data are created by the /seed command.

-- Spec 16: placeholder promotion price for local development only (CAD 25.00, 7 days). The live
-- project has no row until Archan sets the real price before launch (docs/product/v1.md section 16).
insert into public.promotion_settings (price_cents, currency_code, length_days) values (2500, 'CAD', 7);
