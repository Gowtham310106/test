-- Local development seed (supabase db reset runs this after the migrations).
-- Replace the addresses with real ones before using them anywhere else.

update public.app_settings
   set allowed_email_domains = '{college.edu.in}'
 where id = 1;

-- The first admin. Sign in with this email to reach /shop and /shop/settings,
-- then add the shop staff from the Settings page.
insert into public.staff_allowlist (email, role) values
  ('admin@college.edu.in', 'admin')
on conflict (email) do nothing;
