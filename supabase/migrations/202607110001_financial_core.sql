create table public.categories (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('expense', 'income', 'transfer')),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table public.categorization_rules (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  field text not null check (field in ('description', 'merchant')),
  operator text not null check (operator in ('contains', 'equals', 'starts_with')),
  pattern text not null check (char_length(trim(pattern)) > 0),
  category_id text not null references public.categories(id) on delete restrict,
  priority integer not null default 50 check (priority between 0 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, field, operator, pattern)
);

create table public.import_jobs (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  account_id text not null references public.accounts(id) on delete cascade,
  file_name text not null,
  status text not null check (status in ('processing', 'completed', 'completed_with_errors', 'failed')),
  total_rows integer not null default 0 check (total_rows >= 0),
  imported_rows integer not null default 0 check (imported_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  invalid_rows integer not null default 0 check (invalid_rows >= 0),
  mapping jsonb not null,
  error_summary jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

alter table public.transactions
  add column source text not null default 'synced' check (source in ('synced', 'manual', 'imported')),
  add column original_description text,
  add column original_merchant text,
  add column original_category text,
  add column category_id text references public.categories(id) on delete set null,
  add column category_source text not null default 'original' check (category_source in ('original', 'rule')),
  add column categorization_confidence numeric(5, 4) check (categorization_confidence between 0 and 1),
  add column import_job_id text references public.import_jobs(id) on delete set null,
  add column import_fingerprint text;

update public.transactions
set original_description = description,
    original_merchant = merchant,
    original_category = category
where original_description is null;

create table public.transaction_user_edits (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  transaction_id text not null references public.transactions(id) on delete cascade,
  category_id text references public.categories(id) on delete restrict,
  notes text check (char_length(notes) <= 2000),
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, transaction_id)
);

create index categories_workspace_name_idx on public.categories(workspace_id, name);
create unique index categories_workspace_name_lower_unique on public.categories(workspace_id, lower(name));
create index categorization_rules_workspace_priority_idx on public.categorization_rules(workspace_id, is_active, priority desc);
create unique index categorization_rules_workspace_match_lower_unique on public.categorization_rules(workspace_id, field, operator, lower(pattern));
create index import_jobs_workspace_created_idx on public.import_jobs(workspace_id, created_at desc);
create index transaction_user_edits_workspace_idx on public.transaction_user_edits(workspace_id, transaction_id);
create unique index transactions_import_fingerprint_unique
  on public.transactions(workspace_id, account_id, import_fingerprint)
  where import_fingerprint is not null;

alter table public.categories enable row level security;
alter table public.categorization_rules enable row level security;
alter table public.import_jobs enable row level security;
alter table public.transaction_user_edits enable row level security;

create policy "members manage categories" on public.categories
  for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage categorization rules" on public.categorization_rules
  for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage import jobs" on public.import_jobs
  for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage transaction edits" on public.transaction_user_edits
  for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

comment on column public.transactions.original_description is 'Provider or imported description preserved separately from future user-facing overlays.';
comment on column public.transactions.import_fingerprint is 'SHA-256 fingerprint used to make repeated CSV imports idempotent within an account.';
comment on table public.transaction_user_edits is 'User-authored overlays kept separate from the normalized transaction received from its source.';
