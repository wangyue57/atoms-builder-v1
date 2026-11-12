-- Control-plane baseline for PostgreSQL. The memory repositories are used by
-- the first vertical slice; this migration records the durable constraints.
create table if not exists organizations (
  id text primary key,
  name text not null,
  plan text not null check (plan in ('free', 'pro')),
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  organization_id text not null references organizations(id),
  user_id text not null,
  role text not null check (role in ('owner', 'editor', 'viewer', 'billing')),
  primary key (organization_id, user_id)
);

create table if not exists projects (
  id text primary key,
  organization_id text not null references organizations(id),
  name text not null,
  kind text not null check (kind = 'web'),
  current_version_id text,
  visibility text not null check (visibility in ('private', 'public')),
  status text not null check (status in ('active', 'archived', 'deleted'))
);

create table if not exists project_versions (
  id text primary key,
  project_id text not null references projects(id),
  parent_version_id text references project_versions(id),
  source text not null check (source in ('builder', 'manual_edit', 'restore', 'import')),
  manifest_hash text not null,
  status text not null check (status in ('candidate', 'current', 'superseded', 'failed')),
  created_by_run_id text,
  created_at timestamptz not null default now(),
  unique (project_id, manifest_hash)
);

create table if not exists runs (
  id text primary key,
  project_id text not null references projects(id),
  input_version_id text not null references project_versions(id),
  requested_by_user_id text not null,
  kind text not null check (kind in ('build', 'modify', 'review', 'publish', 'restore')),
  status text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  unique (project_id, requested_by_user_id, idempotency_key)
);

create table if not exists run_events (
  id text primary key,
  run_id text not null references runs(id),
  step_id text,
  sequence integer not null check (sequence > 0),
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (run_id, sequence)
);
