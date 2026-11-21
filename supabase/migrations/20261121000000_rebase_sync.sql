-- Rebase sync. Commands are applied against the current cookbook instead of
-- being rejected whenever any other change advanced the revision. Real
-- conflicts are detected per record by the domain commands (expectedUpdatedAt,
-- __expected). This migration also:
--   * moves applied operation ids out of the ever-growing meta document into a
--     pruned table (duplicate retries are still detected atomically);
--   * records a revision on every record and keeps deletion tombstones so
--     clients can fetch only what changed (read_cookbook_changes);
--   * makes favourites last-writer-wins and stops them touching updatedAt.
-- Function signatures are unchanged so open tabs and the deployed Edge
-- Function keep working until they are updated.
begin;
lock table public.cookbook_meta in access exclusive mode;

create function cookbook_private.collections() returns text[] language sql immutable set search_path = '' as $$
    select array['recipes','pantry','plan','batches','shopping','ingredients','drafts','movements']
$$;

-- Applied operations ------------------------------------------------------
create table public.cookbook_operations (
    id text primary key check (length(id) between 1 and 120),
    revision bigint not null,
    applied_at timestamptz not null default now()
);
create index cookbook_operations_applied_at on public.cookbook_operations (applied_at);
create index cookbook_operations_revision on public.cookbook_operations (revision);
-- Keep the original order so the most recent ids stay in snapshots.
insert into public.cookbook_operations (id, revision, applied_at)
select op.id, m.revision, now() - ((op.total - op.n) * interval '1 millisecond')
from public.cookbook_meta m
cross join lateral (
    select value as id, ordinality as n, count(*) over () as total
    from jsonb_array_elements_text(coalesce(m.meta->'operations','[]'::jsonb)) with ordinality
) op
on conflict (id) do nothing;
update public.cookbook_meta set meta = meta - 'operations' where singleton;

-- Per-record revisions and tombstones ---------------------------------------
alter table public.cookbook_records add column revision bigint not null default 0;
update public.cookbook_records set revision = (select revision from public.cookbook_meta where singleton);
create index cookbook_records_revision on public.cookbook_records (collection, revision);
alter table public.cookbook_records add constraint cookbook_records_size check (octet_length(data::text) <= 524288) not valid;
create table public.cookbook_deletions (
    collection text not null,
    id text not null,
    revision bigint not null,
    deleted_at timestamptz not null default now(),
    primary key (collection, id)
);
create index cookbook_deletions_revision on public.cookbook_deletions (revision);
-- Clients older than history_floor receive a full snapshot instead of changes.
alter table public.cookbook_meta add column history_floor bigint not null default 0;
update public.cookbook_meta set history_floor = revision where singleton;

alter table public.cookbook_operations enable row level security;
alter table public.cookbook_deletions enable row level security;
revoke all on public.cookbook_operations, public.cookbook_deletions from public, anon, authenticated;
grant all on public.cookbook_operations, public.cookbook_deletions to service_role;

-- The most recent operation ids let clients and the Edge Function recognise
-- their own retries without a second request. Older ids are checked by the
-- writers below.
create function cookbook_private.recent_operations() returns jsonb language sql stable security definer set search_path = '' as $$
    select coalesce(jsonb_agg(o.id order by o.applied_at, o.id), '[]'::jsonb)
    from (select id, applied_at from public.cookbook_operations order by applied_at desc, id desc limit 200) o
$$;
create or replace function cookbook_private.snapshot() returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('householdId', m.household_id, 'revision', m.revision, 'state', (m.meta - 'operations') ||
        jsonb_build_object('operations', cookbook_private.recent_operations()) ||
        (select jsonb_object_agg(c, coalesce((select jsonb_agg(r.data order by r.position, r.id) from public.cookbook_records r where r.collection = c), '[]'::jsonb))
         from unnest(cookbook_private.collections()) c))
    from public.cookbook_meta m where singleton;
$$;

-- Occasional cleanup keeps the history tables small.
create function cookbook_private.prune_history() returns void language plpgsql security definer set search_path = '' as $$
declare cutoff bigint;
begin
    delete from public.cookbook_operations where applied_at < now() - interval '90 days';
    select max(revision) into cutoff from public.cookbook_deletions where deleted_at < now() - interval '90 days';
    if cutoff is not null then
        delete from public.cookbook_deletions where revision <= cutoff;
        update public.cookbook_meta set history_floor = greatest(history_floor, cutoff) where singleton;
    end if;
end $$;

-- Domain-validated changes from the Edge Function. expected_revision still
-- guards this single write (the function re-reads and re-applies the command
-- on a lost race). A repeated operation id returns {duplicate:true}.
create or replace function public.write_cookbook_patch(cookbook_id uuid, expected_revision bigint, patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.cookbook_meta; change record; row_data jsonb; values_patch jsonb; next_revision bigint; operation text;
begin
    select * into strict m from public.cookbook_meta where singleton for update;
    if m.household_id <> cookbook_id then raise exception 'This cookbook is not available.' using errcode = '42501'; end if;
    if m.revision <> expected_revision then return null; end if;
    if exists (select 1 from public.cookbook_operations o where o.id in (select jsonb_array_elements_text(coalesce(patch->'appendOperations','[]'::jsonb)))) then
        return jsonb_build_object('duplicate', true, 'revision', m.revision);
    end if;
    next_revision := m.revision + 1;
    -- Older functions may still send the full operation list; it now lives in its own table.
    values_patch := coalesce(patch->'values','{}'::jsonb) - 'operations';
    if jsonb_typeof(values_patch) <> 'object' or exists (select 1 from jsonb_object_keys(values_patch) k where k not in ('settings','shoppingWeek','reminders')) then raise exception 'Invalid cookbook metadata.'; end if;
    for change in select * from jsonb_each(coalesce(patch->'collections','{}'::jsonb)) loop
        if not change.key = any(cookbook_private.collections()) then raise exception 'Invalid collection.'; end if;
        insert into public.cookbook_deletions(collection,id,revision)
        select change.key, r.id, next_revision from public.cookbook_records r
        where r.collection = change.key and r.id in (select jsonb_array_elements_text(coalesce(change.value->'remove','[]'::jsonb)))
        on conflict (collection,id) do update set revision = excluded.revision, deleted_at = now();
        delete from public.cookbook_records where collection = change.key and id in (select jsonb_array_elements_text(coalesce(change.value->'remove','[]'::jsonb)));
        for row_data in select * from jsonb_array_elements(coalesce(change.value->'upsert','[]'::jsonb)) loop
            insert into public.cookbook_records(collection,id,position,data,revision) values (change.key,row_data->>'id',
                coalesce((select position from public.cookbook_records where collection = change.key and id = row_data->>'id'),
                (select coalesce(max(position)+1,0) from public.cookbook_records where collection = change.key)),row_data,next_revision)
            on conflict (collection,id) do update set data = excluded.data, revision = excluded.revision;
        end loop;
        if change.value ? 'order' then
            if (select count(*) from public.cookbook_records where collection = change.key) <> jsonb_array_length(change.value->'order') or
               (select count(distinct value) from jsonb_array_elements_text(change.value->'order')) <> jsonb_array_length(change.value->'order') or
               exists (select 1 from jsonb_array_elements_text(change.value->'order') x where not exists (select 1 from public.cookbook_records where collection = change.key and id = x)) then raise exception 'Invalid record order.'; end if;
            update public.cookbook_records r set position = ordering.ordinality - 1, revision = next_revision
            from jsonb_array_elements_text(change.value->'order') with ordinality ordering(id,ordinality)
            where r.collection = change.key and r.id = ordering.id and r.position <> ordering.ordinality - 1;
        end if;
    end loop;
    for operation in select jsonb_array_elements_text(coalesce(patch->'appendOperations','[]'::jsonb)) loop
        insert into public.cookbook_operations(id, revision) values (operation, next_revision) on conflict (id) do nothing;
    end loop;
    update public.cookbook_meta set meta = (m.meta - 'operations') || values_patch, revision = next_revision, updated_at = now() where singleton;
    if next_revision % 200 = 0 then perform cookbook_private.prune_history(); end if;
    return jsonb_build_object('revision', next_revision);
end $$;

-- Checkmarks and favourites are last-writer-wins and no longer require the
-- caller's revision (still accepted for older tabs). A favourite does not
-- change updatedAt, so it never conflicts with a recipe being edited.
create or replace function public.set_cookbook_flag(command_type text, record_id text, checked boolean, operation_id text, expected_revision bigint, expected_updated_at text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.cookbook_meta; target_collection text; item jsonb; change jsonb; next_revision bigint;
begin
    perform cookbook_private.require_login();
    if operation_id is null or operation_id !~ '^[a-zA-Z0-9_-]{8,100}$' or record_id is null or length(record_id) not between 1 and 100 or checked is null or expected_revision < 0 then raise exception 'Invalid cookbook action.' using errcode = '22023'; end if;
    select * into strict m from public.cookbook_meta where singleton for update;
    if exists (select 1 from public.cookbook_operations where id = operation_id) then return cookbook_private.snapshot(); end if;
    target_collection := case command_type when 'shopping.toggle' then 'shopping' when 'recipe.favorite' then 'recipes' else null end;
    if target_collection is null then raise exception 'This action is not available.' using errcode = '22023'; end if;
    select data into item from public.cookbook_records where collection = target_collection and id = record_id;
    if item is null then raise exception 'This item was removed. Refresh and choose another.' using errcode = 'P0002'; end if;
    if target_collection = 'shopping' then
        if coalesce((item->>'addedToPantry')::boolean,false) then raise exception 'This purchase is already in the pantry.' using errcode = '22023'; end if;
        item := jsonb_set(item,'{checked}',to_jsonb(checked));
    else
        item := jsonb_set(item,'{favorite}',to_jsonb(checked));
    end if;
    next_revision := m.revision + 1;
    update public.cookbook_records set data = item, revision = next_revision where collection = target_collection and id = record_id;
    insert into public.cookbook_operations(id, revision) values (operation_id, next_revision);
    update public.cookbook_meta set revision = next_revision, updated_at = now() where singleton;
    change := jsonb_build_object('collections',jsonb_build_object(target_collection,jsonb_build_object('upsert',jsonb_build_array(item),'remove','[]'::jsonb)),'values','{}'::jsonb,'appendOperations',jsonb_build_array(operation_id));
    return jsonb_build_object('householdId',m.household_id,'baseRevision',m.revision,'revision',next_revision,'patch',change);
end $$;

-- Everything that changed after `since`, in the same shape as a command delta.
-- Unknown, future or pruned revisions receive a full snapshot instead.
create function public.read_cookbook_changes(since bigint) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m public.cookbook_meta; changed jsonb;
begin
    perform cookbook_private.require_login();
    select * into strict m from public.cookbook_meta where singleton;
    if since is null or since < m.history_floor or since > m.revision then return cookbook_private.snapshot(); end if;
    if since = m.revision then return jsonb_build_object('householdId',m.household_id,'revision',m.revision,'unchanged',true); end if;
    select coalesce(jsonb_object_agg(c, jsonb_build_object(
        'upsert', coalesce((select jsonb_agg(r.data order by r.position, r.id) from public.cookbook_records r where r.collection = c and r.revision > since), '[]'::jsonb),
        'remove', coalesce((select jsonb_agg(d.id order by d.id) from public.cookbook_deletions d where d.collection = c and d.revision > since
                            and not exists (select 1 from public.cookbook_records r where r.collection = c and r.id = d.id)), '[]'::jsonb),
        'order', coalesce((select jsonb_agg(r.id order by r.position, r.id) from public.cookbook_records r where r.collection = c), '[]'::jsonb))), '{}'::jsonb)
    into changed
    from unnest(cookbook_private.collections()) c
    where exists (select 1 from public.cookbook_records r where r.collection = c and r.revision > since)
       or exists (select 1 from public.cookbook_deletions d where d.collection = c and d.revision > since);
    return jsonb_build_object('householdId',m.household_id,'baseRevision',since,'revision',m.revision,'patch',jsonb_build_object(
        'collections', changed,
        'values', m.meta - 'operations',
        'appendOperations', coalesce((select jsonb_agg(o.id order by o.applied_at, o.id) from public.cookbook_operations o where o.revision > since), '[]'::jsonb)));
end $$;

-- Lets the Edge Function confirm an older retry after a command no longer applies.
create function public.cookbook_operation_applied(operation_id text) returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.cookbook_operations where id = operation_id)
$$;

revoke all on all functions in schema cookbook_private from public, anon, authenticated;
revoke all on function public.read_cookbook_changes(bigint), public.cookbook_operation_applied(text) from public, anon, authenticated;
grant execute on function public.read_cookbook_changes(bigint) to authenticated, service_role;
grant execute on function public.cookbook_operation_applied(text) to service_role;
commit;
