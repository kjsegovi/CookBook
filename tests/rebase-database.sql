\o /dev/null
-- Runs after 20261121000000_rebase_sync.sql on the database prepared by shared-database.sql (revision 13).
create function pg_temp.check_true(condition boolean, message text) returns void language plpgsql as $$ begin if condition is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute statement; exception when others then get stacked diagnostics actual_state = returned_sqlstate; end;
  if actual_state is distinct from expected_state then raise exception 'Expected %, received % for %', expected_state, actual_state, statement; end if;
end $$;
select pg_temp.check_true((select revision from public.cookbook_meta) = 13, 'migration keeps the revision');
select pg_temp.check_true(not ((select meta from public.cookbook_meta) ? 'operations'), 'operation ids leave the metadata document');
select pg_temp.check_true(exists (select 1 from public.cookbook_operations where id = 'ordered-delete-1'), 'applied operations are kept');
select pg_temp.check_true((select history_floor from public.cookbook_meta) = 13, 'change history starts at the migration');
select pg_temp.check_true(cookbook_private.snapshot()->'state'->'operations' ? 'ordered-delete-1', 'snapshots carry recent operation ids');
select pg_temp.check_true(jsonb_array_length(cookbook_private.snapshot()->'state'->'pantry') = 1, 'records are unchanged');

set role anon;
select pg_temp.expect_error('select public.read_cookbook_changes(13)','42501');
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
select pg_temp.expect_error('select public.cookbook_operation_applied(''ordered-delete-1'')','42501');
select set_config('test.updated_at',public.read_cookbook()->'state'->'recipes'->0->>'updatedAt',false);
-- A favourite from a tab holding an old revision now applies, and leaves updatedAt alone.
select public.set_cookbook_flag('recipe.favorite','rice',false,'rebase-favorite-1',1) as favorite \gset
select pg_temp.check_true((:'favorite'::jsonb)->>'revision' = '14', 'old revision no longer blocks a checkmark or favourite');
select pg_temp.check_true(public.read_cookbook()->'state'->'recipes'->0->>'favorite' = 'false', 'favourite saved');
select pg_temp.check_true(public.read_cookbook()->'state'->'recipes'->0->>'updatedAt' = current_setting('test.updated_at'), 'favourite does not touch updatedAt');
select public.set_cookbook_flag('recipe.favorite','rice',false,'rebase-favorite-1',1);
select pg_temp.check_true(public.cookbook_info()->>'revision' = '14', 'retry applies once');
select public.set_cookbook_flag('recipe.favorite','rice',true,'rebase-favorite-2',null);
select pg_temp.check_true(public.cookbook_info()->>'revision' = '15', 'revision may be omitted');
-- Only changed records are returned.
select public.read_cookbook_changes(13) as changes \gset
select pg_temp.check_true((:'changes'::jsonb)->>'baseRevision' = '13' and (:'changes'::jsonb)->>'revision' = '15', 'changes report their range');
select pg_temp.check_true(jsonb_array_length((:'changes'::jsonb)->'patch'->'collections'->'recipes'->'upsert') = 1, 'changed recipe included');
select pg_temp.check_true(not ((:'changes'::jsonb)->'patch'->'collections' ? 'pantry'), 'unchanged collections omitted');
select pg_temp.check_true((:'changes'::jsonb)->'patch'->'appendOperations' ? 'rebase-favorite-2', 'new operation ids included');
select pg_temp.check_true(not ((:'changes'::jsonb)->'patch'->'values' ? 'operations'), 'metadata excludes operation ids');
select pg_temp.check_true(public.read_cookbook_changes(5) ? 'state', 'a revision before the history floor gets a full snapshot');
select pg_temp.check_true(public.read_cookbook_changes(99) ? 'state', 'a future revision gets a full snapshot');
select pg_temp.check_true(public.read_cookbook_changes(15)->>'unchanged' = 'true', 'an up-to-date client gets no payload');
reset role;

set role service_role;
select public.write_cookbook_patch(current_setting('test.cookbook')::uuid,15,'{"collections":{"pantry":{"upsert":[],"remove":["stock"]}},"values":{},"appendOperations":["rebase-delete-1"]}');
select pg_temp.check_true(public.read_cookbook_changes(15)->'patch'->'collections'->'pantry'->'remove' ? 'stock', 'deletions are reported');
select pg_temp.check_true(public.write_cookbook_patch(current_setting('test.cookbook')::uuid,16,'{"collections":{},"values":{},"appendOperations":["rebase-delete-1"]}')->>'duplicate' = 'true', 'a repeated operation is reported as a duplicate');
select pg_temp.check_true(public.cookbook_info()->>'revision' = '16', 'a duplicate changes nothing');
select pg_temp.check_true(public.cookbook_operation_applied('rebase-delete-1'), 'the function can confirm an old retry');
-- An Edge Function deployed before this migration may still send the operation list.
select public.write_cookbook_patch(current_setting('test.cookbook')::uuid,16,'{"collections":{},"values":{"operations":["legacy"],"shoppingWeek":"2026-11-23"},"appendOperations":["legacy-values-1"]}');
select pg_temp.check_true(not ((select meta from public.cookbook_meta) ? 'operations') and (select meta->>'shoppingWeek' from public.cookbook_meta) = '2026-11-23', 'legacy operation lists are ignored');
select pg_temp.check_true(public.write_cookbook_patch(current_setting('test.cookbook')::uuid,3,'{}') is null, 'a lost race is still reported to the function');
-- Reordering marks moved records as changed.
select public.write_cookbook_patch(current_setting('test.cookbook')::uuid,17,'{"collections":{"recipes":{"upsert":[{"id":"second","title":"Second"}],"remove":[],"order":["second","rice"]}},"values":{},"appendOperations":["rebase-order-1"]}');
select pg_temp.check_true(public.read_cookbook_changes(17)->'patch'->'collections'->'recipes'->'order' = '["second","rice"]', 'order is included with changes');
reset role;
-- Menus are a record collection (20261121010000_menus.sql).
set role service_role;
select public.write_cookbook_patch(current_setting('test.cookbook')::uuid,18,'{"collections":{"menus":{"upsert":[{"id":"holiday","name":"Holiday","description":"","items":[{"recipeId":"rice","day":1,"slot":"Dinner"}],"createdAt":"2026-11-21T00:00:00.000Z","updatedAt":"2026-11-21T00:00:00.000Z"}],"remove":[]}},"values":{},"appendOperations":["menu-save-1"]}');
select pg_temp.check_true(jsonb_array_length(public.read_cookbook()->'state'->'menus') = 1, 'menus are stored and returned');
select pg_temp.check_true(public.read_cookbook_changes(18)->'patch'->'collections' ? 'menus', 'menu changes are in the change feed');
reset role;
