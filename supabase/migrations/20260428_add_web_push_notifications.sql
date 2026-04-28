create extension if not exists pgcrypto with schema extensions;

create table if not exists public.web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  expiration_time timestamptz,
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.web_push_reminder_deliveries (
  subscription_id uuid not null references public.web_push_subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reminder_id text not null,
  local_date date not null,
  sent_at timestamptz not null default now(),
  primary key (subscription_id, reminder_id, local_date)
);

alter table public.web_push_subscriptions enable row level security;
alter table public.web_push_reminder_deliveries enable row level security;

drop policy if exists "Users can see their own web push subscriptions" on public.web_push_subscriptions;
drop policy if exists "Users can insert their own web push subscriptions" on public.web_push_subscriptions;
drop policy if exists "Users can update their own web push subscriptions" on public.web_push_subscriptions;
drop policy if exists "Users can delete their own web push subscriptions" on public.web_push_subscriptions;

create policy "Users can see their own web push subscriptions"
  on public.web_push_subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert their own web push subscriptions"
  on public.web_push_subscriptions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own web push subscriptions"
  on public.web_push_subscriptions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own web push subscriptions"
  on public.web_push_subscriptions for delete
  to authenticated
  using (auth.uid() = user_id);

create index if not exists web_push_subscriptions_user_idx
  on public.web_push_subscriptions (user_id);
create index if not exists web_push_reminder_deliveries_user_idx
  on public.web_push_reminder_deliveries (user_id, local_date desc);
