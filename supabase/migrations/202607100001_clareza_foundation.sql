create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id text primary key,
  name text not null,
  type text not null check (type in ('personal', 'family')),
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id text not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.accounts (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  type text not null check (type in ('checking', 'savings', 'credit', 'cash', 'investment', 'loan')),
  source text not null check (source in ('synced', 'manual', 'imported')),
  institution_name text,
  currency char(3) not null default 'EUR',
  balance_cents bigint not null,
  available_balance_cents bigint,
  is_hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  account_id text not null references public.accounts(id) on delete cascade,
  provider_transaction_id text,
  description text not null,
  merchant text,
  amount_cents bigint not null,
  currency char(3) not null default 'EUR',
  category text not null,
  status text not null check (status in ('pending', 'booked')),
  booked_at date not null,
  is_internal_transfer boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (workspace_id, provider_transaction_id)
);

create table if not exists public.budgets (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  category text not null,
  limit_cents bigint not null check (limit_cents > 0),
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  rollover boolean not null default false,
  unique (workspace_id, category, month)
);

create table if not exists public.goals (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  name text not null,
  target_cents bigint not null check (target_cents > 0),
  current_cents bigint not null default 0 check (current_cents >= 0),
  target_date date,
  priority text not null check (priority in ('low', 'medium', 'high'))
);

create table if not exists public.bank_connections (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  provider text not null,
  institution_id text not null,
  institution_name text not null,
  status text not null check (status in ('connected', 'syncing', 'requires_action', 'expired', 'revoked', 'error')),
  last_synced_at timestamptz,
  consent_expires_at timestamptz,
  unique (workspace_id, institution_id)
);

create table if not exists public.audit_events (
  id text primary key,
  workspace_id text not null references public.workspaces(id) on delete cascade,
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists accounts_workspace_idx on public.accounts(workspace_id);
create index if not exists transactions_workspace_date_idx on public.transactions(workspace_id, booked_at desc);
create index if not exists goals_workspace_idx on public.goals(workspace_id);
create index if not exists audit_workspace_date_idx on public.audit_events(workspace_id, created_at desc);

create or replace function public.is_workspace_member(target_workspace_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_workspace_member(text) from public;
grant execute on function public.is_workspace_member(text) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.accounts enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.goals enable row level security;
alter table public.bank_connections enable row level security;
alter table public.audit_events enable row level security;

create policy "members can read workspaces" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));
create policy "members can read workspace membership" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));

create policy "members manage accounts" on public.accounts
  for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage transactions" on public.transactions
  for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage budgets" on public.budgets
  for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage goals" on public.goals
  for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members manage bank connections" on public.bank_connections
  for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));
create policy "members read audit events" on public.audit_events
  for select to authenticated using (public.is_workspace_member(workspace_id));

comment on table public.bank_connections is 'Stores connection metadata only. Provider tokens must be encrypted separately and never returned to the browser.';
