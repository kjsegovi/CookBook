-- Private household documents. Browser roles can read their own kitchen but
-- cannot write documents directly; commands are validated in the Edge Function.
create table public.households (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id),
    name text not null check (length(name) between 1 and 80),
    revision bigint not null default 0 check (revision >= 0),
    state jsonb not null default '{"recipes":[],"pantry":[],"plan":[],"batches":[],"shopping":[],"shoppingWeek":"","ingredients":[],"drafts":[],"movements":[],"operations":[],"settings":{"categories":["Breakfast","Entrées","Sauces","Sides","Snacks","Pastries & Desserts"],"servings":2,"weekStartsOn":1}}'::jsonb,
    updated_at timestamptz not null default now(),
    constraint household_document_size check (jsonb_typeof(state) = 'object' and octet_length(state::text) <= 1800000)
);
create table public.household_members (
    user_id uuid primary key references auth.users(id) on delete cascade,
    household_id uuid not null references public.households(id) on delete cascade,
    role text not null check (role in ('owner','member')),
    joined_at timestamptz not null default now()
);
create index household_members_household on public.household_members(household_id);
create table public.household_invitations (
    token_hash text primary key,
    household_id uuid not null references public.households(id) on delete cascade,
    email text not null check (length(email) <= 254),
    expires_at timestamptz not null,
    unique (household_id, email)
);
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_invitations enable row level security;
create policy read_own_membership on public.household_members for select to authenticated using (user_id = (select auth.uid()));
create policy read_member_household on public.households for select to authenticated using (
    exists (select 1 from public.household_members m where m.household_id = households.id and m.user_id = (select auth.uid()))
);
revoke all on public.households, public.household_members, public.household_invitations from anon, authenticated;
grant select on public.households, public.household_members to authenticated;
grant all on public.households, public.household_members, public.household_invitations to service_role;

create function public.create_household(kitchen_name text) returns uuid language plpgsql security definer set search_path = '' as $$
declare kitchen_id uuid;
begin
    if auth.uid() is null or not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
        raise exception 'Confirm your email and sign in first.' using errcode = '42501';
    end if;
    if length(trim(kitchen_name)) not between 1 and 80 or kitchen_name is null then raise exception 'Enter a kitchen name between 1 and 80 characters.'; end if;
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
    select household_id into kitchen_id from public.household_members where user_id = auth.uid();
    if kitchen_id is not null then return kitchen_id; end if;
    insert into public.households(owner_id, name) values (auth.uid(), trim(kitchen_name)) returning id into kitchen_id;
    insert into public.household_members(user_id, household_id, role) values (auth.uid(), kitchen_id, 'owner');
    return kitchen_id;
end;
$$;

create function public.invite_to_household(invited_email text) returns text language plpgsql security definer set search_path = '' as $$
declare kitchen_id uuid; invitation_code text; normalized_email text := lower(trim(invited_email));
begin
    select h.id into kitchen_id from public.households h join public.household_members m on m.household_id = h.id where m.user_id = auth.uid() and h.owner_id = auth.uid() and m.role = 'owner';
    if kitchen_id is null then raise exception 'Only the household owner can create invitations.' using errcode = '42501'; end if;
    if normalized_email is null or length(normalized_email) > 254 or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Enter a valid email address.'; end if;
    invitation_code := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.household_invitations(token_hash, household_id, email, expires_at)
    values (encode(sha256(convert_to(invitation_code, 'UTF8')), 'hex'), kitchen_id, normalized_email, now() + interval '7 days')
    on conflict (household_id, email) do update set token_hash = excluded.token_hash, expires_at = excluded.expires_at;
    return invitation_code;
end;
$$;

create function public.accept_household_invitation(invitation_code text) returns uuid language plpgsql security definer set search_path = '' as $$
declare invitation public.household_invitations; user_email text;
begin
    select lower(email) into user_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
    if user_email is null then raise exception 'Confirm your email and sign in first.' using errcode = '42501'; end if;
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text, 0));
    if exists (select 1 from public.household_members where user_id = auth.uid()) then raise exception 'Your account already belongs to a household.'; end if;
    select * into invitation from public.household_invitations
    where token_hash = encode(sha256(convert_to(invitation_code, 'UTF8')), 'hex') and email = user_email and expires_at > now() for update;
    if not found then raise exception 'This invitation is invalid, expired, or belongs to another email address.' using errcode = '42501'; end if;
    insert into public.household_members(user_id, household_id, role) values (auth.uid(), invitation.household_id, 'member');
    delete from public.household_invitations where token_hash = invitation.token_hash;
    return invitation.household_id;
end;
$$;

revoke all on function public.create_household(text), public.invite_to_household(text), public.accept_household_invitation(text) from public, anon;
grant execute on function public.create_household(text), public.invite_to_household(text), public.accept_household_invitation(text) to authenticated;

-- Private images are uploaded/read only through the authenticated Edge Function.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('cookbook-photos', 'cookbook-photos', false, 5242880, array['image/jpeg','image/png','image/webp']);
