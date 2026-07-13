alter table public.bank_connections
  add column country char(2) not null default 'PT',
  add column provider_connection_id text,
  add column provider_reference text,
  add column callback_state_hash text,
  add column callback_state_expires_at timestamptz,
  add column callback_state_used_at timestamptz,
  add column last_attempted_at timestamptz,
  add column next_sync_at timestamptz,
  add column error_code text,
  add column error_message text,
  add column revoked_at timestamptz;

alter table public.accounts
  add column bank_connection_id text references public.bank_connections(id) on delete set null,
  add column provider_account_id text,
  add column masked_identifier text,
  add column balance_as_of timestamptz;

alter table public.transactions
  add column provider_pending_transaction_id text,
  add column value_at date,
  add column provider_metadata jsonb;

update public.bank_connections
set provider_connection_id = 'mock-' || institution_id
where provider = 'mock' and provider_connection_id is null;

update public.bank_connections
set next_sync_at = coalesce(last_synced_at + interval '6 hours', now())
where status = 'connected' and next_sync_at is null;

create table public.financial_institutions (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  provider text not null,
  provider_institution_id text not null,
  country char(2) not null,
  name text not null,
  logo_url text,
  last_verified_at timestamptz not null default now(),
  unique (workspace_id, provider, provider_institution_id)
);

create table public.consents (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  bank_connection_id text not null references public.bank_connections(id) on delete cascade,
  provider_agreement_id text,
  status text not null check (status in ('pending', 'active', 'expired', 'revoked', 'error')),
  scopes text[] not null default array['details', 'balances', 'transactions']::text[],
  granted_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.balance_snapshots (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  account_id text not null references public.accounts(id) on delete cascade,
  booked_balance_cents bigint not null,
  available_balance_cents bigint,
  pending_amount_cents bigint,
  currency char(3) not null,
  source text not null check (source in ('provider', 'manual', 'imported')),
  captured_at timestamptz not null,
  unique (account_id, captured_at)
);

create table public.sync_jobs (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  bank_connection_id text not null references public.bank_connections(id) on delete cascade,
  idempotency_key text not null,
  trigger text not null check (trigger in ('callback', 'manual', 'scheduled')),
  status text not null check (status in ('queued', 'running', 'completed', 'failed')),
  accounts_synced integer not null default 0 check (accounts_synced >= 0),
  transactions_inserted integer not null default 0 check (transactions_inserted >= 0),
  transactions_updated integer not null default 0 check (transactions_updated >= 0),
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create unique index bank_connections_provider_connection_unique
  on public.bank_connections(provider, provider_connection_id)
  where provider_connection_id is not null;
create unique index accounts_provider_account_unique
  on public.accounts(workspace_id, bank_connection_id, provider_account_id);
create index consents_workspace_connection_idx on public.consents(workspace_id, bank_connection_id, created_at desc);
create index balance_snapshots_workspace_account_date_idx on public.balance_snapshots(workspace_id, account_id, captured_at desc);
create index sync_jobs_workspace_connection_date_idx on public.sync_jobs(workspace_id, bank_connection_id, created_at desc);
create index bank_connections_due_sync_idx on public.bank_connections(status, next_sync_at) where status = 'connected';
create index transactions_pending_provider_idx on public.transactions(workspace_id, account_id, provider_pending_transaction_id) where provider_pending_transaction_id is not null;

alter table public.financial_institutions enable row level security;
alter table public.consents enable row level security;
alter table public.balance_snapshots enable row level security;
alter table public.sync_jobs enable row level security;

drop policy if exists "members manage bank connections" on public.bank_connections;
create policy "members read bank connections" on public.bank_connections
  for select to authenticated using (public.is_workspace_member(workspace_id));

create policy "members read financial institutions" on public.financial_institutions
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members read consents" on public.consents
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members read balance snapshots" on public.balance_snapshots
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy "members read sync jobs" on public.sync_jobs
  for select to authenticated using (public.is_workspace_member(workspace_id));

comment on column public.bank_connections.callback_state_hash is 'SHA-256 hash of the short-lived, single-use callback state. The state itself is never stored.';
comment on column public.accounts.masked_identifier is 'Masked provider identifier only. Clareza does not persist a full IBAN in this slice.';
comment on column public.transactions.provider_metadata is 'Minimal reconciliation metadata only; full raw provider payloads are not retained.';
comment on table public.consents is 'Consent lifecycle metadata. Provider application secrets remain in the server secret manager.';
comment on table public.sync_jobs is 'Idempotent Open Banking synchronisation attempts without sensitive provider payloads.';
