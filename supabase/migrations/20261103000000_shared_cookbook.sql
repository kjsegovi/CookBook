-- One personal cookbook for every confirmed login. Original household documents
-- remain untouched as private migration archives. No records/photos are deleted.
-- The explicit transaction also supports migration runners that do not wrap
-- files automatically. The lock includes every already-committed legacy write.
begin;
lock table public.households in access exclusive mode;
create schema cookbook_private;
revoke all on schema cookbook_private from public, anon, authenticated;

create table public.cookbook_meta (
    singleton boolean primary key default true check (singleton),
    household_id uuid not null unique,
    revision bigint not null default 0 check (revision >= 0),
    meta jsonb not null check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 1800000),
    updated_at timestamptz not null default now()
);
create table public.cookbook_records (
    collection text not null check (collection in ('recipes','pantry','plan','batches','shopping','ingredients','drafts','movements')),
    id text not null check (length(id) between 1 and 100),
    position integer not null check (position >= 0),
    data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'id' = id),
    primary key (collection, id)
);
alter table public.cookbook_meta enable row level security;
alter table public.cookbook_records enable row level security;
revoke all on public.cookbook_meta, public.cookbook_records from public, anon, authenticated;
grant all on public.cookbook_meta, public.cookbook_records to service_role;

-- Stop rather than choose between two real collections. An operator can set
-- cookbook.migrate_household before applying this migration after reviewing data.
do $$
declare source public.households; source_id uuid; populated integer; source_state jsonb;
begin
    source_id := nullif(current_setting('cookbook.migrate_household', true), '')::uuid;
    if source_id is null then
        select count(*) into populated from public.households h where exists (
            select 1 from jsonb_each(h.state) e where e.key <> 'operations' and jsonb_array_length(case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end) > 0
        );
        if populated > 1 then raise exception 'Multiple populated cookbooks exist. Review them and set cookbook.migrate_household before migrating; no data was changed.'; end if;
        select h.id into source_id from public.households h order by
            (exists (select 1 from jsonb_each(h.state) e where e.key <> 'operations' and jsonb_array_length(case when jsonb_typeof(e.value) = 'array' then e.value else '[]'::jsonb end) > 0)) desc,
            h.updated_at, h.id limit 1;
    end if;
    if source_id is not null then
        select * into strict source from public.households where id = source_id;
        source_state := source.state;
    else
        source_id := gen_random_uuid();
        source_state := '{"recipes":[],"pantry":[],"plan":[],"batches":[],"shopping":[],"shoppingWeek":"","ingredients":[],"drafts":[],"movements":[],"operations":[],"settings":{"categories":["Breakfast","Entrées","Sauces","Sides","Snacks","Pastries & Desserts"],"servings":2,"weekStartsOn":1,"autoLeftovers":true}}'::jsonb;
    end if;
    insert into public.cookbook_meta(household_id, revision, meta)
    values (source_id, coalesce(source.revision,0), source_state - array['recipes','pantry','plan','batches','shopping','ingredients','drafts','movements']);
    insert into public.cookbook_records(collection,id,position,data)
    select e.key, item.value->>'id', item.ordinality - 1, item.value
    from jsonb_each(source_state) e cross join lateral jsonb_array_elements(
        case when e.key in ('recipes','pantry','plan','batches','shopping','ingredients','drafts','movements') then e.value else '[]'::jsonb end
    ) with ordinality as item(value, ordinality);
end $$;

-- A request from an older tab/function must not write the archived document
-- after it has been copied. It fails visibly and can be retried after reloading.
create function cookbook_private.reject_legacy_write() returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception 'The cookbook was updated. Reload the website before saving.' using errcode = '40001';
end $$;
create trigger household_archive_read_only before insert or update or delete on public.households
for each row execute function cookbook_private.reject_legacy_write();

-- A shared cookbook has no per-account creation or invitation flow.
revoke all on public.households, public.household_members, public.household_invitations from anon, authenticated;
revoke execute on function public.create_household(text), public.invite_to_household(text), public.accept_household_invitation(text) from public, anon, authenticated;

create function cookbook_private.require_login() returns void language plpgsql stable security definer set search_path = '' as $$
begin
    if current_setting('role', true) = 'service_role' then return; end if;
    if auth.uid() is null or not exists (
        select 1 from auth.users u join auth.sessions s on s.user_id = u.id
        where u.id = auth.uid() and u.email_confirmed_at is not null
          and (u.banned_until is null or u.banned_until <= now())
          and s.id = nullif(auth.jwt()->>'session_id','')::uuid
          and (s.not_after is null or s.not_after > now())
    ) then
        raise exception 'Confirm your email and sign in to open your cookbook.' using errcode = '42501';
    end if;
end $$;
create function cookbook_private.snapshot() returns jsonb language sql stable security definer set search_path = '' as $$
    select jsonb_build_object('householdId', m.household_id, 'revision', m.revision, 'state', m.meta ||
        (select jsonb_object_agg(c, coalesce((select jsonb_agg(r.data order by r.position, r.id) from public.cookbook_records r where r.collection = c), '[]'::jsonb))
         from unnest(array['recipes','pantry','plan','batches','shopping','ingredients','drafts','movements']) c))
    from public.cookbook_meta m where singleton;
$$;
create function public.read_cookbook(known_revision bigint default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare m public.cookbook_meta;
begin
    perform cookbook_private.require_login();
    select * into strict m from public.cookbook_meta where singleton;
    if known_revision = m.revision then
        return jsonb_build_object('householdId',m.household_id,'revision',m.revision,'unchanged',true);
    end if;
    return cookbook_private.snapshot();
end $$;
create function public.cookbook_info() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
    perform cookbook_private.require_login();
    return (select jsonb_build_object('householdId',household_id,'revision',revision) from public.cookbook_meta where singleton);
end $$;
create function public.cookbook_sync_allowed(cookbook_id uuid, account_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
    select exists (select 1 from public.cookbook_meta where singleton and household_id = cookbook_id)
       and exists (select 1 from auth.users where id = account_id and email_confirmed_at is not null and (banned_until is null or banned_until <= now()));
$$;

-- Domain-validated changes from the Edge Function. Browser roles cannot call
-- this raw patch writer. Only changed rows are written; the revision is atomic.
create function public.write_cookbook_patch(cookbook_id uuid, expected_revision bigint, patch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.cookbook_meta; change record; row_data jsonb; values_patch jsonb; next_meta jsonb;
begin
    select * into strict m from public.cookbook_meta where singleton for update;
    if m.household_id <> cookbook_id then raise exception 'This cookbook is not available.' using errcode = '42501'; end if;
    if m.revision <> expected_revision then return null; end if;
    values_patch := coalesce(patch->'values','{}'::jsonb);
    if jsonb_typeof(values_patch) <> 'object' or exists (select 1 from jsonb_object_keys(values_patch) k where k not in ('settings','shoppingWeek','reminders','operations')) then raise exception 'Invalid cookbook metadata.'; end if;
    for change in select * from jsonb_each(coalesce(patch->'collections','{}'::jsonb)) loop
        if change.key not in ('recipes','pantry','plan','batches','shopping','ingredients','drafts','movements') then raise exception 'Invalid collection.'; end if;
        delete from public.cookbook_records where collection = change.key and id in (select jsonb_array_elements_text(coalesce(change.value->'remove','[]'::jsonb)));
        for row_data in select * from jsonb_array_elements(coalesce(change.value->'upsert','[]'::jsonb)) loop
            insert into public.cookbook_records(collection,id,position,data) values (change.key,row_data->>'id',
                coalesce((select position from public.cookbook_records where collection = change.key and id = row_data->>'id'),
                (select coalesce(max(position)+1,0) from public.cookbook_records where collection = change.key)),row_data)
            on conflict (collection,id) do update set data = excluded.data;
        end loop;
        if change.value ? 'order' then
            if (select count(*) from public.cookbook_records where collection = change.key) <> jsonb_array_length(change.value->'order') or
               (select count(distinct value) from jsonb_array_elements_text(change.value->'order')) <> jsonb_array_length(change.value->'order') or
               exists (select 1 from jsonb_array_elements_text(change.value->'order') x where not exists (select 1 from public.cookbook_records where collection = change.key and id = x)) then raise exception 'Invalid record order.'; end if;
            update public.cookbook_records r set position = ordering.ordinality - 1
            from jsonb_array_elements_text(change.value->'order') with ordinality ordering(id,ordinality)
            where r.collection = change.key and r.id = ordering.id and r.position <> ordering.ordinality - 1;
        end if;
    end loop;
    next_meta := m.meta || values_patch;
    next_meta := jsonb_set(next_meta,'{operations}',coalesce(next_meta->'operations','[]'::jsonb) || coalesce(patch->'appendOperations','[]'::jsonb));
    update public.cookbook_meta set meta = next_meta, revision = m.revision + 1, updated_at = now() where singleton;
    return jsonb_build_object('revision',m.revision+1);
end $$;

-- Common tiny changes take one authenticated database request, without loading
-- or returning the recipe library. Other commands retain TypeScript validation.
create function public.set_cookbook_flag(command_type text, record_id text, checked boolean, operation_id text, expected_revision bigint, expected_updated_at text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare m public.cookbook_meta; target_collection text; item jsonb; change jsonb; at_text text;
begin
    perform cookbook_private.require_login();
    if operation_id is null or operation_id !~ '^[a-zA-Z0-9_-]{8,100}$' or record_id is null or length(record_id) not between 1 and 100 or checked is null or expected_revision is null or expected_revision < 0 then raise exception 'Invalid cookbook action.' using errcode = '22023'; end if;
    select * into strict m from public.cookbook_meta where singleton for update;
    if coalesce(m.meta->'operations','[]'::jsonb) ? operation_id then return cookbook_private.snapshot(); end if;
    if m.revision <> expected_revision then raise exception 'Your cookbook changed. Refresh and review before saving.' using errcode = '40001'; end if;
    target_collection := case command_type when 'shopping.toggle' then 'shopping' when 'recipe.favorite' then 'recipes' else null end;
    if target_collection is null then raise exception 'This action is not available.' using errcode = '22023'; end if;
    select data into item from public.cookbook_records where collection = target_collection and id = record_id;
    if item is null then raise exception 'This item was removed. Refresh and choose another.' using errcode = 'P0002'; end if;
    if target_collection = 'shopping' then
        if coalesce((item->>'addedToPantry')::boolean,false) then raise exception 'This purchase is already in the pantry.' using errcode = '22023'; end if;
        item := jsonb_set(item,'{checked}',to_jsonb(checked));
    else
        if expected_updated_at is null or item->>'updatedAt' <> expected_updated_at then raise exception 'This recipe changed. Load the latest version before saving.' using errcode = '40001'; end if;
        at_text := to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
        item := item || jsonb_build_object('favorite',checked,'updatedAt',at_text);
    end if;
    update public.cookbook_records set data = item where collection = target_collection and id = record_id;
    update public.cookbook_meta set revision = m.revision+1, meta = jsonb_set(m.meta,'{operations}',coalesce(m.meta->'operations','[]'::jsonb) || jsonb_build_array(operation_id)),updated_at = now() where singleton;
    change := jsonb_build_object('collections',jsonb_build_object(target_collection,jsonb_build_object('upsert',jsonb_build_array(item),'remove','[]'::jsonb)),'values','{}'::jsonb,'appendOperations',jsonb_build_array(operation_id));
    return jsonb_build_object('householdId',m.household_id,'baseRevision',m.revision,'revision',m.revision+1,'patch',change);
end $$;

revoke all on all functions in schema cookbook_private from public, anon, authenticated;
revoke all on function public.read_cookbook(bigint), public.cookbook_info(), public.set_cookbook_flag(text,text,boolean,text,bigint,text), public.write_cookbook_patch(uuid,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.cookbook_sync_allowed(uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_cookbook(bigint), public.cookbook_info(), public.set_cookbook_flag(text,text,boolean,text,bigint,text) to authenticated, service_role;
grant execute on function public.write_cookbook_patch(uuid,bigint,jsonb) to service_role;
grant execute on function public.cookbook_sync_allowed(uuid,uuid) to service_role;
commit;
