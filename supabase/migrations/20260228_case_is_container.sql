alter table public.case_skus
  add column if not exists is_container boolean not null default false;
