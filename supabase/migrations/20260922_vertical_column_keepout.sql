-- Loaded carts/chariots can have a real physical height while reserving the
-- whole X/Y column above them.  This is stronger than top_contact_allowed=false:
-- no unrelated cargo may bridge or float above the footprint either.

alter table public.case_skus
  add column if not exists blocks_vertical_column boolean not null default false;
