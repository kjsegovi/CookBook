-- Menus: reusable sets of recipes (for example a holiday dinner), stored as a
-- record collection like recipes. Recipes gain rating, categories, images,
-- related and nutrition inside their existing JSON, so they need no change here.
begin;
alter table public.cookbook_records drop constraint cookbook_records_collection_check;
alter table public.cookbook_records add constraint cookbook_records_collection_check
    check (collection in ('recipes','pantry','plan','batches','shopping','ingredients','drafts','movements','menus'));
create or replace function cookbook_private.collections() returns text[] language sql immutable set search_path = '' as $$
    select array['recipes','pantry','plan','batches','shopping','ingredients','drafts','movements','menus']
$$;
revoke all on function cookbook_private.collections() from public, anon, authenticated;
commit;
