alter table public.case_skus
add column if not exists tilt_allowed boolean not null default false;
