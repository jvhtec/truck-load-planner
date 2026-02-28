-- Allow client-side create/update/delete on case_skus when using anon key.
-- This matches the existing permissive load_plans policy style in this project.
create policy "Allow public write access" on public.case_skus for all using (true) with check (true);
