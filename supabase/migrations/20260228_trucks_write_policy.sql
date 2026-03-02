-- Allow public write access for truck CRUD operations.
-- This fixes 42501 RLS failures when creating truck records from the app.
drop policy if exists "Allow public write access" on public.trucks;

create policy "Allow public write access"
on public.trucks
for all
using (true)
with check (true);
