-- Durable application profile for TASK-022. This migration is additive to 0001.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  username_normalized text not null unique,
  password_hash text not null,
  password_salt text not null,
  created_at timestamptz not null default now()
);
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on sessions(user_id);

alter table organizations add column if not exists owner_user_id uuid references users(id);
alter table organizations add column if not exists updated_at timestamptz not null default now();
alter table memberships add column if not exists created_at timestamptz not null default now();
alter table projects add column if not exists owner_user_id uuid references users(id);
alter table projects add column if not exists created_at timestamptz not null default now();
alter table projects add column if not exists updated_at timestamptz not null default now();
alter table projects add column if not exists last_successful_version_id text references project_versions(id);
create index if not exists projects_owner_idx on projects(owner_user_id, updated_at desc);

alter table runs add column if not exists request text;
alter table runs add column if not exists lease_owner text;
alter table runs add column if not exists lease_until timestamptz;
alter table runs add column if not exists error text;
alter table runs add column if not exists result jsonb;
alter table runs add column if not exists finished_at timestamptz;
alter table runs add column if not exists updated_at timestamptz not null default now();
create index if not exists runs_queue_idx on runs(status, lease_until, created_at);
create unique index if not exists runs_active_project_idx on runs(project_id) where status in ('queued','running');

alter table project_versions add column if not exists source_files jsonb not null default '{}'::jsonb;
alter table project_versions add column if not exists preview_html text not null default '';
alter table project_versions add column if not exists review jsonb;
alter table project_versions add column if not exists created_at timestamptz not null default now();

alter table project_versions add column if not exists manifest jsonb not null default '{}'::jsonb;
-- Identical source may be reviewed in separate immutable runs; run identity is unique.
alter table project_versions drop constraint if exists project_versions_project_id_manifest_hash_key;
create index if not exists project_versions_manifest_idx on project_versions(project_id,manifest_hash);
create unique index if not exists project_versions_run_idx on project_versions(created_by_run_id) where created_by_run_id is not null;

create unique index if not exists runs_initial_idempotency_idx on runs(requested_by_user_id,idempotency_key) where kind = 'build';

create table if not exists auth_attempts (
  key_hash text primary key,
  failures integer not null default 0,
  window_started_at timestamptz not null default now()
);

create table if not exists application_migrations (
  version integer primary key,
  name text not null,
  checksum text not null,
  applied_at timestamptz not null default now()
);
