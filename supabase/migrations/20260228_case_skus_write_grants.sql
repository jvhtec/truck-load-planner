do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'case_skus'
      and policyname = 'Allow public write access'
  ) then
    create policy "Allow public write access"
      on public.case_skus
      for all
      using (true)
      with check (true);
  end if;
end
$$;

grant select, insert, update, delete on table public.case_skus to anon, authenticated;
