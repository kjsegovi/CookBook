\o /dev/null
create function pg_temp.check_true(condition boolean, message text) returns void language plpgsql as $$ begin if condition is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute statement; exception when others then get stacked diagnostics actual_state = returned_sqlstate; end;
  if actual_state is distinct from expected_state then raise exception 'Expected %, received % for %', expected_state, actual_state, statement; end if;
end $$;
set role anon;
select pg_temp.expect_error('select public.create_household(''Anonymous'')','42501');
select pg_temp.expect_error('select * from public.households','42501');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000004';
select pg_temp.expect_error('select public.create_household(''Unconfirmed'')','42501');
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000005';
select public.create_household('Other kitchen') as other_kitchen \gset
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select public.create_household('Our kitchen') as owner_kitchen \gset
select pg_temp.check_true(public.create_household('Duplicate') = :'owner_kitchen'::uuid, 'creation is duplicate-safe');
select pg_temp.check_true((select count(*) from public.households) = 1, 'owner reads only their household');
select pg_temp.check_true((select count(*) from public.households where id = :'other_kitchen') = 0, 'other household hidden');
select pg_temp.expect_error('update public.households set revision = 999','42501');
select pg_temp.expect_error('update public.household_members set role = ''owner''','42501');
select pg_temp.expect_error('select * from public.household_invitations','42501');
select public.invite_to_household('MEMBER@example.test') as invite_code \gset
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select pg_temp.check_true((select count(*) from public.households) = 0, 'nonmember cannot read');
select set_config('test.invite', :'invite_code', false);
select pg_temp.expect_error('select public.accept_household_invitation(current_setting(''test.invite''))','42501');
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000002';
select pg_temp.check_true(public.accept_household_invitation(:'invite_code') = :'owner_kitchen'::uuid, 'matching confirmed email joins');
select pg_temp.check_true((select count(*) from public.households) = 1, 'member reads shared kitchen');
select pg_temp.check_true((select count(*) from public.household_members) = 1, 'membership policy has no recursive household lookup');
select pg_temp.expect_error('select public.invite_to_household(''another@example.test'')','42501');
select pg_temp.expect_error('select public.accept_household_invitation(current_setting(''test.invite''))','P0001');
reset role;
select pg_temp.check_true((select count(*) from public.household_invitations) = 0, 'invitation was consumed exactly once');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select public.invite_to_household('expired@example.test') as expired_code \gset
reset role;
update public.household_invitations set expires_at = now() - interval '1 minute';
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000006';
select set_config('test.expired', :'expired_code', false);
select pg_temp.expect_error('select public.accept_household_invitation(current_setting(''test.expired''))','42501');
reset role;
select pg_temp.check_true((select public from storage.buckets where id = 'cookbook-photos') = false, 'photo bucket stays private');
