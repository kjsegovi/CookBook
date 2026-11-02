create schema auth;
create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema public, auth to anon, authenticated, service_role;
create schema storage;
create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
insert into auth.users values
('00000000-0000-4000-8000-000000000001','owner@example.test',now()),
('00000000-0000-4000-8000-000000000002','member@example.test',now()),
('00000000-0000-4000-8000-000000000003','stranger@example.test',now()),
('00000000-0000-4000-8000-000000000004','unconfirmed@example.test',null),
('00000000-0000-4000-8000-000000000005','other-owner@example.test',now()),
('00000000-0000-4000-8000-000000000006','expired@example.test',now());
