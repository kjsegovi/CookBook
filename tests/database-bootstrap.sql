create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, banned_until timestamptz);
create table auth.sessions(id uuid primary key, user_id uuid references auth.users(id), not_after timestamptz);
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('sub',auth.uid(),'session_id',coalesce(nullif(current_setting('request.jwt.claim.session_id',true),''),auth.uid()::text)) $$;
grant usage on schema public, auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
insert into auth.users(id,email,email_confirmed_at) values
('00000000-0000-4000-8000-000000000001','owner@example.test',now()),
('00000000-0000-4000-8000-000000000002','member@example.test',now()),
('00000000-0000-4000-8000-000000000003','stranger@example.test',now()),
('00000000-0000-4000-8000-000000000004','unconfirmed@example.test',null),
('00000000-0000-4000-8000-000000000005','other-owner@example.test',now()),
('00000000-0000-4000-8000-000000000006','expired@example.test',now());
insert into auth.sessions(id,user_id) select id,id from auth.users;
