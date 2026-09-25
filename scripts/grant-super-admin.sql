-- Grant the platform super_admin role to an existing user.
-- Run ONLY in the Supabase SQL editor (service role). There is no API to self-assign this role.
-- Replace the email below with the platform administrator's account email.
insert into public.platform_admins (user_id, granted_by)
select id, 'sql-editor' from auth.users where lower(email) = lower('abdullahfah2030@hotmail.com')
on conflict (user_id) do nothing;
