create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  pseudo text,
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists pseudo text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_pseudo_length'
  ) then
    alter table public.profiles
      add constraint profiles_pseudo_length
      check (pseudo is null or char_length(pseudo) <= 32);
  end if;
end;
$$;

create table if not exists public.meals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  name text not null,
  calories numeric not null check (calories >= 0),
  proteins numeric not null check (proteins >= 0),
  photo_path text,
  created_at timestamptz not null default now()
);

alter table public.meals
  add column if not exists photo_path text;

create table if not exists public.weights (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text,
  weight numeric not null check (weight > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.activity_reactions (
  target_type text not null check (target_type in ('meal', 'weight')),
  target_id bigint not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('up', 'down')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (target_type, target_id, user_id)
);

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

alter table public.profiles enable row level security;
alter table public.meals enable row level security;
alter table public.weights enable row level security;
alter table public.activity_reactions enable row level security;
alter table public.web_push_subscriptions enable row level security;
alter table public.web_push_reminder_deliveries enable row level security;

drop policy if exists "Profiles are visible to authenticated users" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Profiles are visible to authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Meals are visible to authenticated users" on public.meals;
drop policy if exists "Users can insert their own meals" on public.meals;

create policy "Meals are visible to authenticated users"
  on public.meals for select
  to authenticated
  using (true);

create policy "Users can insert their own meals"
  on public.meals for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Weights are visible to authenticated users" on public.weights;
drop policy if exists "Users can insert their own weights" on public.weights;

create policy "Weights are visible to authenticated users"
  on public.weights for select
  to authenticated
  using (true);

create policy "Users can insert their own weights"
  on public.weights for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Activity reactions are visible to authenticated users" on public.activity_reactions;
drop policy if exists "Users can insert their own activity reactions" on public.activity_reactions;
drop policy if exists "Users can update their own activity reactions" on public.activity_reactions;
drop policy if exists "Users can delete their own activity reactions" on public.activity_reactions;

create policy "Activity reactions are visible to authenticated users"
  on public.activity_reactions for select
  to authenticated
  using (true);

create policy "Users can insert their own activity reactions"
  on public.activity_reactions for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update their own activity reactions"
  on public.activity_reactions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete their own activity reactions"
  on public.activity_reactions for delete
  to authenticated
  using (auth.uid() = user_id);

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

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-photos',
  'meal-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Meal photos are visible to authenticated users" on storage.objects;
drop policy if exists "Users can upload their own meal photos" on storage.objects;
drop policy if exists "Users can update their own meal photos" on storage.objects;
drop policy if exists "Users can delete their own meal photos" on storage.objects;

create policy "Meal photos are visible to authenticated users"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'meal-photos');

create policy "Users can upload their own meal photos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can update their own meal photos"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete their own meal photos"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'meal-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create index if not exists meals_user_created_at_idx on public.meals (user_id, created_at desc);
create index if not exists weights_user_created_at_idx on public.weights (user_id, created_at desc);
create index if not exists activity_reactions_target_idx
  on public.activity_reactions (target_type, target_id);
create index if not exists web_push_subscriptions_user_idx
  on public.web_push_subscriptions (user_id);
create index if not exists web_push_reminder_deliveries_user_idx
  on public.web_push_reminder_deliveries (user_id, local_date desc);
