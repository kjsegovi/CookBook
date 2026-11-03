\o /dev/null
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000001';
select set_config('test.cookbook',public.cookbook_info()->>'householdId',false);
do $$ begin
    if public.read_cookbook()->>'revision' <> '0' or public.read_cookbook()->'state'->'settings'->>'autoLeftovers' <> 'true' then raise exception 'Fresh cookbook defaults are invalid.'; end if;
    if jsonb_array_length(public.read_cookbook()->'state'->'recipes') <> 0 then raise exception 'Fresh cookbook is not empty.'; end if;
end $$;
set request.jwt.claim.sub = '00000000-0000-4000-8000-000000000003';
do $$ begin
    if public.cookbook_info()->>'householdId' <> current_setting('test.cookbook') then raise exception 'Fresh accounts opened different cookbooks.'; end if;
end $$;
